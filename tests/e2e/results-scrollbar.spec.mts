import { test, expect, type Page } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { routeSongsJsonFixture } from "./support/songs-network.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";
import {
    enablePlaybackSettings,
    expectSidebarPopoverClosed,
    getBookmarkItem,
    openBookmarkPanel,
    typeSearchQueryKeepingFocus,
    waitForInitialLoad
} from "./support/ui-helpers.mts";

const BOOKMARK_NAME = "Scrollbar Check";
const SCROLLBAR_SKIP_REASON = "このブラウザのスクロールバーは重ねて表示され、幅を取らない";

// ヘッドレスの Chromium は既定でスクロールバーを隠す。Windows などと同じく、幅を取るスクロールバーを出して確かめる。
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

/**
 * サムネイルを表示し、10 曲を登録したブックマークを開く。
 * サムネイルはカードの幅に合わせて高さが変わるので、一覧の幅が変わるとページの高さも変わる。
 * @param page 操作するページ
 */
async function openThumbnailBookmark(page: Page) {
    const songs = createScrollableResultSongs(10);
    await installNetworkMocks(page);
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await page.evaluate(({ name, songKeys }) => {
        localStorage.setItem("bookmarksV1", JSON.stringify({
            version: 3,
            bookmarks: { b1: { name, songs: songKeys, createdAt: 1 } }
        }));
    }, { name: BOOKMARK_NAME, songKeys: songs.map((song) => song.bookmarkSongKey) });
    await page.reload();
    await waitForInitialLoad(page);
    await enablePlaybackSettings(page);
    await openBookmarkPanel(page);
    await getBookmarkItem(page, BOOKMARK_NAME).click();
    await expect(page.locator("#resultCount")).toHaveText(`ブックマーク: ${BOOKMARK_NAME} (${songs.length} 件)`);
    await page.locator("#close-bookmark-sidebar").click();
    await expectSidebarPopoverClosed(page);
}

/**
 * スクロールするページで、スクロールバーが取る幅を返す。スクロールバーを重ねて表示するブラウザでは 0 になる。
 * @param page 操作するページ
 */
async function readScrollbarWidth(page: Page) {
    return page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
}

/**
 * ページの中身の下端を返す。画面に固定した要素は除き、画面の高さによらない値にする。
 * @param page 操作するページ
 */
async function readContentBottom(page: Page) {
    return page.evaluate(() => window.scrollY + Math.max(...[...document.body.children]
        .filter((element) => {
            const style = getComputedStyle(element);
            return style.position !== "fixed" && style.display !== "none";
        })
        .map((element) => element.getBoundingClientRect().bottom)));
}

/**
 * 30 フレームの間に、ページの幅と一覧の幅・高さが何回変わったかを数える。
 * スクロールバーの出入りと並べ直しが繰り返すと、毎フレームのように変わる。
 * @param page 操作するページ
 */
async function countLayoutChangesOverFrames(page: Page) {
    return page.evaluate(async () => {
        const list = document.getElementById("resultList");
        let previous = "";
        let changes = 0;
        for (let frame = 0; frame < 30; frame++) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const current = `${document.documentElement.clientWidth}/${list?.clientWidth}/${list?.offsetHeight}`;
            if (frame > 0 && current !== previous) changes++;
            previous = current;
        }
        return changes;
    });
}

test("the result list keeps its width whether or not the page scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1400 });
    await openThumbnailBookmark(page);
    const resultList = page.locator("#resultList");
    // 画面が十分に高いので、ページはスクロールしない。
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    const widthWithoutScrolling = await resultList.evaluate((element) => element.clientWidth);

    await page.setViewportSize({ width: 1600, height: 500 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
    test.skip(await readScrollbarWidth(page) === 0, SCROLLBAR_SKIP_REASON);
    expect(await resultList.evaluate((element) => element.clientWidth)).toBe(widthWithoutScrolling);
});

test("the cards settle when the page is about as tall as the screen", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openThumbnailBookmark(page);
    // 複数列ではカードの幅を JavaScript で決め直すので、スクロールバーの出入りと並べ直しが繰り返すことがあった。
    // 1 列はカードの幅を CSS で決め、スクロールバーの有無もブラウザが 1 回のレイアウトで決めるので、繰り返さない。
    expect(await page.locator("#resultList").getAttribute("data-layout-columns")).not.toBe("1");
    await page.setViewportSize({ width: 1600, height: 500 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
    test.skip(await readScrollbarWidth(page) === 0, SCROLLBAR_SKIP_REASON);

    // 画面の高さを、ページの下端の前後で 1px ずつ変える。スクロールバーが出入りする境目でも、並べ直しが続かないこと。
    const contentBottom = await readContentBottom(page);
    for (let height = Math.floor(contentBottom) - 2; height <= Math.ceil(contentBottom) + 4; height++) {
        await page.setViewportSize({ width: 1600, height });
        await page.waitForTimeout(150);
        expect(await countLayoutChangesOverFrames(page), `viewport height ${height}`).toBe(0);
    }
});

/**
 * 検索窓を押して検索語を入力し、フォーカスを残したまま、スクロールできる検索結果を表示する。
 * @param page 操作するページ
 */
async function typeSearchForScrollableResults(page: Page) {
    await installNetworkMocks(page);
    await routeSongsJsonFixture(page, createScrollableResultSongs(60));
    await page.goto("/");
    await waitForInitialLoad(page);
    await typeSearchQueryKeepingFocus(page, "Scroll Artist");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
        .toBeGreaterThan(600);
    await expect(page.locator(".header")).not.toHaveClass(/is-auto-hidden/);
}

/**
 * ページの縦スクロールバーで押す位置を返す。
 * ページの先頭にいるとき、つまみはスクロールバーの上端から、画面に見えている割合の長さを占める。
 * トラックは、つまみより下の、画面の下端に近い位置を押す。
 * @param page 操作するページ
 */
async function readScrollbarPoints(page: Page) {
    return page.evaluate(() => {
        const root = document.documentElement;
        return {
            x: Math.round((root.clientWidth + window.innerWidth) / 2),
            thumbY: Math.round(window.innerHeight * window.innerHeight / root.scrollHeight / 2),
            trackY: window.innerHeight - 40
        };
    });
}

/**
 * スクロールバーで下へ進んだ後、検索窓のフォーカスを残したまま、ヘッダーが隠れたことを確かめる。
 * @param page 操作するページ
 */
async function expectHeaderHiddenWithSearchFocus(page: Page) {
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    await expect(page.locator(".header")).toHaveClass(/is-auto-hidden/);
    await expect(page.locator("#searchBox")).toBeFocused();
}

test("after typing in the search box, dragging the scrollbar thumb hides the header", async ({ page }) => {
    await typeSearchForScrollableResults(page);
    test.skip(await readScrollbarWidth(page) === 0, SCROLLBAR_SKIP_REASON);

    // 入力を終えて、フォーカスを外さずに、スクロールバーのつまみを下へドラッグする。
    const { x, thumbY } = await readScrollbarPoints(page);
    await page.mouse.move(x, thumbY);
    await page.mouse.down();
    await page.mouse.move(x, thumbY + 200, { steps: 10 });
    await page.mouse.up();
    await expectHeaderHiddenWithSearchFocus(page);
});

test("after typing in the search box, clicking the scrollbar track hides the header", async ({ page }) => {
    await typeSearchForScrollableResults(page);
    test.skip(await readScrollbarWidth(page) === 0, SCROLLBAR_SKIP_REASON);

    // 入力を終えて、フォーカスを外さずに、つまみより下のトラックを押して 1 画面分進む。
    const { x, trackY } = await readScrollbarPoints(page);
    await page.mouse.click(x, trackY);
    await expectHeaderHiddenWithSearchFocus(page);
});
