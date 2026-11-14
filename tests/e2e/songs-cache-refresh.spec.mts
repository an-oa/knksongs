import { test, expect, type Page } from "@playwright/test";
import { parseSongsJsonPayload } from "../../app/lib/songs-json.mts";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { routeDeferredSongsJsonFixture } from "./support/songs-network.mts";
import { observeSongsCacheSaveAttempts, readSongsJsonCacheText } from "./support/songs-cache.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";
import {
    filterBySongTitle,
    getSongCard,
    openSidebar,
    waitForInitialLoad
} from "./support/ui-helpers.mts";

/**
 * IndexedDBへ保存されている曲タイトルを返す。
 */
async function readCachedSongTitles(page: Page): Promise<string[]> {
    const cacheText = await readSongsJsonCacheText(page);
    if (!cacheText) return [];
    return parseSongsJsonPayload(cacheText).songs.map((song) => song.title);
}

for (const [label, generatedAt] of [
    ["newer", "2026-08-15T00:00:00.000Z"],
    ["older", "2026-08-13T00:00:00.000Z"]
]) {
    test(`${label} public songs appear in the initial results after meta confirmation`, async ({ page }) => {
        await installNetworkMocks(page);
        await page.goto("/");
        await waitForInitialLoad(page);
        await expect.poll(() => readCachedSongTitles(page)).toContain("Manual Song");
        await openSidebar(page);
        await filterBySongTitle(page, "Song");
        await expect(getSongCard(page, "Manual Song")).toBeVisible();

        const publicSongs = createScrollableResultSongs(1);
        const deferred = await routeDeferredSongsJsonFixture(page, publicSongs, generatedAt);
        await page.reload();
        await deferred.requestStarted;
        try {
            await expect(page.locator("#searchBox")).toBeDisabled();
            await expect(page.locator("#resultCount")).toHaveText("データを読み込み中...");
            await expect(getSongCard(page, "Manual Song")).toHaveCount(0);
        } finally {
            deferred.releaseResponse();
        }

        await waitForInitialLoad(page);
        // 検索操作を追加せず、復元済みの条件による最初の結果で公開データを確認する。
        await expect(getSongCard(page, "Scroll Song 01")).toBeVisible();
        await expect(getSongCard(page, "Manual Song")).toHaveCount(0);
        await expect.poll(() => readCachedSongTitles(page)).toEqual(["Scroll Song 01"]);
    });
}

test("matching public meta reuses cached songs without requesting the body", async ({ page }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await waitForInitialLoad(page);
    const requests: string[] = [];
    page.on("request", (request) => {
        if (/\/data\/songs(?:-meta)?\.json/.test(request.url())) requests.push(new URL(request.url()).pathname);
    });
    await page.reload();
    await waitForInitialLoad(page);
    await openSidebar(page);
    await filterBySongTitle(page, "Manual Song");
    await expect(getSongCard(page, "Manual Song")).toBeVisible();
    expect(requests).toEqual(["/data/songs-meta.json"]);
});

test("timed out public json keeps showing the cache and is saved for the next visit", async ({ page }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await waitForInitialLoad(page);
    await expect.poll(() => readCachedSongTitles(page)).toContain("Manual Song");
    const deferred = await routeDeferredSongsJsonFixture(page, createScrollableResultSongs(1));
    const requests: string[] = [];
    page.on("request", (request) => {
        if (/\/data\/songs(?:-meta)?\.json/.test(request.url())) requests.push(new URL(request.url()).pathname);
    });
    await page.reload();
    await deferred.requestStarted;
    try {
        // 公開JSONの応答を待つ期限が過ぎると、キャッシュで表示する。
        await waitForInitialLoad(page);
        expect(await readCachedSongTitles(page)).toContain("Manual Song");
    } finally {
        deferred.releaseResponse();
    }
    // 遅れて届いた公開JSONは、表示中の曲とは差し替えない。
    await openSidebar(page);
    await filterBySongTitle(page, "Manual Song");
    await expect(getSongCard(page, "Manual Song")).toBeVisible();
    await expect(getSongCard(page, "Scroll Song 01")).toHaveCount(0);
    expect(requests).toEqual(["/data/songs-meta.json", "/data/songs.json"]);

    // 取得は中断せずに続けていて、届いた内容を次回の表示用に保存する。
    await expect.poll(() => readCachedSongTitles(page)).toEqual(["Scroll Song 01"]);
    requests.length = 0;
    await page.reload();
    await waitForInitialLoad(page);
    await filterBySongTitle(page, "Scroll Song 01");
    await expect(getSongCard(page, "Scroll Song 01")).toBeVisible();
    expect(requests, "the refreshed cache matches the public meta").toEqual(["/data/songs-meta.json"]);
});

test("a late public json does not roll back a newer cache that another tab saved in the meantime", async ({ page, context }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await waitForInitialLoad(page);
    await expect.poll(() => readCachedSongTitles(page)).toContain("Manual Song");

    // このタブを読み込み直す。公開内容は 1 曲に更新されているが、その本文が届かない。
    const readSaveAttempts = await observeSongsCacheSaveAttempts(page);
    const olderPublic = await routeDeferredSongsJsonFixture(page, createScrollableResultSongs(1), "2026-08-15T00:00:00.000Z");
    await page.reload();
    await olderPublic.requestStarted;
    try {
        // 応答を待つ期限が過ぎて、キャッシュで表示する。取得は続いている。
        await waitForInitialLoad(page);

        // 待っている間に公開内容がさらに 2 曲へ更新され、後から開いた別のタブが、その新しい JSON を保存する。
        // 同じブラウザのタブは、同じ IndexedDB のキャッシュを共有する。
        const otherTab = await context.newPage();
        await installNetworkMocks(otherTab);
        const newerPublic = await routeDeferredSongsJsonFixture(otherTab, createScrollableResultSongs(2), "2026-08-16T00:00:00.000Z");
        newerPublic.releaseResponse();
        await otherTab.goto("/");
        await waitForInitialLoad(otherTab);
        await expect.poll(() => readCachedSongTitles(otherTab)).toEqual(["Scroll Song 01", "Scroll Song 02"]);
        await otherTab.close();
    } finally {
        olderPublic.releaseResponse();
    }

    // 最初のタブに古い JSON が届く。取得を始めた時点の meta とは整合するが、保存済みのキャッシュより古いので保存しない。
    await expect.poll(readSaveAttempts).toBe(1);
    expect(await readCachedSongTitles(page)).toEqual(["Scroll Song 01", "Scroll Song 02"]);
});
