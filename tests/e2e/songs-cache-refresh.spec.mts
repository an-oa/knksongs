import { test, expect, type Page } from "@playwright/test";
import { parseSongsJsonPayload } from "../../app/lib/songs-json.mts";
import { installNetworkMocks } from "./support/network-mocks.mts";
import {
    routeDeferredSongsJsonFixture,
    routeRepublishedDefaultSongs,
    routeSlowSongsJsonFixture
} from "./support/songs-network.mts";
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

/**
 * IndexedDBへ保存されている曲データの生成日時を返す。
 */
async function readCachedGeneratedAt(page: Page): Promise<string | null> {
    const cacheText = await readSongsJsonCacheText(page);
    return cacheText ? parseSongsJsonPayload(cacheText).generatedAt : null;
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

    // 取得は中断せずに続けていて、届いた内容を次回の表示用に保存する。
    await expect.poll(() => readCachedSongTitles(page)).toEqual(["Scroll Song 01"]);
    expect(requests).toEqual(["/data/songs-meta.json", "/data/songs.json"]);
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

test("a slow line where meta and json each answer in three seconds still refreshes the cache for the next visit", async ({ page }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await waitForInitialLoad(page);
    await expect.poll(() => readCachedSongTitles(page)).toContain("Manual Song");

    // 公開内容が 1 曲に更新された。この回線では、meta も JSON も、応答までに 3 秒かかる。
    // meta は応答を待つ期限 (2 秒) で中断され、JSON は表示の期限に間に合わない。
    await routeSlowSongsJsonFixture(page, createScrollableResultSongs(1), "2026-08-15T00:00:00.000Z", 3000);
    const requests: string[] = [];
    page.on("request", (request) => {
        if (/\/data\/songs(?:-meta)?\.json/.test(request.url())) requests.push(new URL(request.url()).pathname);
    });
    await page.reload();
    await waitForInitialLoad(page);
    await openSidebar(page);
    await filterBySongTitle(page, "Manual Song");
    await expect(getSongCard(page, "Manual Song"), "the cache is shown while the json is still on its way").toBeVisible();

    // 遅れて届いた JSON は、保存の前に通信を挟まずに保存する。同じ回線で通信をもう一度待つと、それも期限に間に合わない。
    await expect.poll(() => readCachedSongTitles(page)).toEqual(["Scroll Song 01"]);
    expect(requests).toEqual(["/data/songs-meta.json", "/data/songs.json"]);
});

test("a late public json is not saved after the csv was reverted to the cached content and republished", async ({ page, context }) => {
    // A: 既定の曲データ。最初の表示でキャッシュに保存される。
    await installNetworkMocks(page);
    await page.goto("/");
    await waitForInitialLoad(page);
    await expect.poll(() => readCachedSongTitles(page)).toContain("Manual Song");
    const titlesOfA = await readCachedSongTitles(page);

    // B: 公開内容が 1 曲に更新された。このタブを読み込み直すが、B の本文が表示の期限に間に合わない。
    const readSaveAttempts = await observeSongsCacheSaveAttempts(page);
    const publishedB = await routeDeferredSongsJsonFixture(page, createScrollableResultSongs(1), "2026-08-15T00:00:00.000Z");
    await page.reload();
    await publishedB.requestStarted;
    try {
        await waitForInitialLoad(page);

        // 待っている間に CSV が A へ戻されて再生成され、A が新しい生成日時で公開される。その後で別のタブを開く。
        const otherTab = await context.newPage();
        await installNetworkMocks(otherTab);
        await routeRepublishedDefaultSongs(otherTab, "2026-08-16T00:00:00.000Z");
        const otherTabBodyRequests: string[] = [];
        otherTab.on("request", (request) => {
            if (/\/data\/songs\.json/.test(request.url())) otherTabBodyRequests.push(request.url());
        });
        await otherTab.goto("/");
        await waitForInitialLoad(otherTab);
        // 別のタブは、meta の hash がキャッシュの A と一致するので、本文を取らずにキャッシュを使う。
        // そのとき、内容は A のまま、公開し直された生成日時をキャッシュに残す。
        expect(otherTabBodyRequests).toEqual([]);
        await expect.poll(() => readCachedGeneratedAt(otherTab)).toBe("2026-08-16T00:00:00.000Z");
        expect(await readCachedSongTitles(otherTab)).toEqual(titlesOfA);
        await otherTab.close();
    } finally {
        publishedB.releaseResponse();
    }

    // このタブに B が届く。取得を始めた時点の meta とは整合するが、保存済みの A の生成日時より古いので保存しない。
    await expect.poll(readSaveAttempts).toBe(1);
    expect(await readCachedSongTitles(page), "the cache still holds A, the content being published").toEqual(titlesOfA);
    expect(await readCachedGeneratedAt(page)).toBe("2026-08-16T00:00:00.000Z");
});
