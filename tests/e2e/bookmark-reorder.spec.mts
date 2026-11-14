import { test, expect, type Locator, type Page } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { routeSongsJsonFixture } from "./support/songs-network.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";
import { waitForMockYoutube } from "./support/mock-youtube.mts";
import {
    enablePlaybackSettings,
    expectSidebarPopoverClosed,
    getBookmarkItem,
    openBookmarkPanel,
    waitForInitialLoad
} from "./support/ui-helpers.mts";

const BOOKMARK_NAME = "Reorder Favorites";
const ORIGINAL_TITLES = ["Scroll Song 01", "Scroll Song 02", "Scroll Song 03", "Scroll Song 04", "Scroll Song 05", "Scroll Song 06"];
/** 1 番目を 3 番目へ移したときの並び。 */
const FIRST_TO_THIRD_TITLES = ["Scroll Song 02", "Scroll Song 03", "Scroll Song 01", "Scroll Song 04", "Scroll Song 05", "Scroll Song 06"];

type Point = { x: number; y: number };

/**
 * 指定した曲だけを登録したブックマークを保存し、選択して結果一覧へ戻る。
 * @param page 操作するページ
 * @param songs ブックマークに登録する曲
 * @param options thumbnails を true にすると、先にサムネイル表示を有効にする
 */
async function openSeededBookmark(page: Page, songs: Song[], options: { thumbnails?: boolean } = {}) {
    await installNetworkMocks(page);
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await page.evaluate(({ name, songKeys }) => {
        localStorage.setItem("bookmarksV1", JSON.stringify({
            version: 3,
            bookmarks: { b1: { name, songs: songKeys, createdAt: 1 } }
        }));
    }, { name: BOOKMARK_NAME, songKeys: songs.map((song) => song.songKey) });
    await page.reload();
    await waitForInitialLoad(page);
    if (options.thumbnails) await enablePlaybackSettings(page);
    await openBookmarkPanel(page);
    await getBookmarkItem(page, BOOKMARK_NAME).click();
    await expect(page.locator("#resultCount")).toHaveText(`ブックマーク: ${BOOKMARK_NAME} (${songs.length} 件)`);
    await page.locator("#close-bookmark-sidebar").click();
    await expectSidebarPopoverClosed(page);
}

/**
 * 結果カードの曲名を DOM 順に返す。
 * @param page 操作するページ
 */
async function readCardTitles(page: Page) {
    return page.locator("#resultList > .song-card .title").allTextContents();
}

/**
 * 結果カードの曲キーを DOM 順に返す。
 * @param page 操作するページ
 */
async function readCardKeys(page: Page) {
    return page.locator("#resultList > .song-card").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.songKey ?? ""));
}

/**
 * 保存されたブックマークの曲順を返す。
 * @param page 操作するページ
 */
async function readSavedSongKeys(page: Page) {
    return page.evaluate(() => {
        const payload: unknown = JSON.parse(localStorage.getItem("bookmarksV1") ?? "null");
        if (payload === null || typeof payload !== "object" || !("bookmarks" in payload)) return null;
        const bookmarks: unknown = payload.bookmarks;
        if (bookmarks === null || typeof bookmarks !== "object" || !("b1" in bookmarks)) return null;
        const bookmark: unknown = bookmarks.b1;
        return bookmark !== null && typeof bookmark === "object" && "songs" in bookmark ? bookmark.songs : null;
    });
}

/**
 * 結果カードの大きさを、曲キーごとに返す。並べ替えで位置が変わっても比べられるようにする。
 * @param page 操作するページ
 */
async function readCardSizes(page: Page) {
    return page.locator("#resultList > .song-card").evaluateAll((cards) => Object.fromEntries(cards.map((card) => [
        (card as HTMLElement).dataset.songKey ?? "",
        { width: (card as HTMLElement).offsetWidth, height: (card as HTMLElement).offsetHeight }
    ])));
}

/**
 * 結果カードの枠の色と影を DOM 順に返す。ホバーの表示が付いているかを比べるために使う。
 * @param page 操作するページ
 */
async function readCardFrames(page: Page) {
    return page.locator("#resultList > .song-card").evaluateAll((cards) => cards.map((card) => {
        const style = getComputedStyle(card);
        return { outlineColor: style.outlineColor, boxShadow: style.boxShadow };
    }));
}

/**
 * カードの上端・下端・中央の近くの点を返す。
 * @param card 対象のカード
 */
async function getCardPoints(card: Locator) {
    const box = await card.boundingBox();
    if (!box) throw new Error("The card has no bounding box");
    const x = box.x + box.width / 2;
    return {
        top: { x, y: box.y + 10 },
        bottom: { x, y: box.y + box.height - 10 },
        center: { x, y: box.y + box.height / 2 }
    };
}

/**
 * 移動元カードのハンドルを押し、指定した点を順にたどる。離すのは呼び出し元が行う。
 * @param page 操作するページ
 * @param source 移動元のカード
 * @param points たどる点
 */
async function startHandleDrag(page: Page, source: Locator, points: Point[]) {
    await source.locator(".drag-handle").hover();
    await page.mouse.down();
    for (const point of points) {
        await page.mouse.move(point.x, point.y, { steps: 8 });
    }
}

/**
 * 並べ替えのスライドが終わるまで待つ。
 * スライド中のカードは位置が動いているので、続けて操作すると、測った位置がずれる。
 * @param page 操作するページ
 */
async function waitForCardSlides(page: Page) {
    await expect.poll(() => page.evaluate(() => document.getAnimations()
        .filter((animation) => animation.id === "card-reorder" && animation.playState === "running").length)).toBe(0);
}

/**
 * ページのスクロールが止まるまで待つ。
 * なめらかなスクロールの途中で位置を測ると、操作する間にカードがポインタの下を流れていく。
 * @param page 操作するページ
 */
async function waitForScrollToSettle(page: Page) {
    let previous = Number.NaN;
    await expect.poll(async () => {
        const current = await page.evaluate(() => window.scrollY);
        const settled = current === previous;
        previous = current;
        return settled;
    }, { intervals: [150] }).toBe(true);
}

/**
 * 結果カードの animate の呼び出しを、ページの中で記録し始める。
 * @param page 操作するページ
 */
async function recordCardAnimations(page: Page) {
    await page.evaluate(() => {
        window.__knkCardReorderAnimations = [];
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, keyframes, options) {
            if (this instanceof HTMLElement && this.classList.contains("song-card") && Array.isArray(keyframes)) {
                window.__knkCardReorderAnimations?.push({
                    songKey: this.dataset.songKey ?? "",
                    from: String(keyframes[0]?.transform ?? ""),
                    zIndex: String(keyframes[0]?.zIndex ?? "")
                });
            }
            return animate.call(this, keyframes, options);
        };
    });
}

/**
 * 記録した animate の呼び出しを取り出して記録を空にし、開始位置の移動量を読み取る。
 * @param page 操作するページ
 */
async function takeCardAnimations(page: Page) {
    const records = await page.evaluate(() => (window.__knkCardReorderAnimations ?? []).splice(0));
    return records.map((record) => {
        const match = /translate\(([^p]+)px, ([^p]+)px\)/.exec(record.from);
        return {
            songKey: record.songKey,
            dx: match ? Number(match[1]) : Number.NaN,
            dy: match ? Number(match[2]) : Number.NaN,
            zIndex: record.zIndex
        };
    });
}

test("dragging a card by its handle moves it and saves the order", async ({ page }) => {
    const songs = createScrollableResultSongs(6);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");

    const target = await getCardPoints(cards.nth(2));
    await startHandleDrag(page, cards.nth(0), [target.center]);
    await page.mouse.up();

    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    expect(await readSavedSongKeys(page)).toEqual([1, 2, 0, 3, 4, 5].map((index) => songs[index].songKey));
});

test("the cards make room for the dragged card before it is dropped", async ({ page }) => {
    const songs = createScrollableResultSongs(6);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");
    const sizesBefore = await readCardSizes(page);

    // 離す前から、移動元が 3 番目の枠へ移り、間のカードがよける。大きさは変わらず、まだ保存もしない。
    await startHandleDrag(page, cards.nth(0), [(await getCardPoints(cards.nth(2))).center]);
    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    await expect(page.locator('#resultList > .song-card[data-song-key="scroll00001::1"]')).toHaveClass(/dragging/);
    expect(await readCardSizes(page)).toEqual(sizesBefore);
    expect(await readSavedSongKeys(page)).toEqual(songs.map((song) => song.songKey));

    await page.mouse.up();
    await expect.poll(() => readSavedSongKeys(page)).toEqual([1, 2, 0, 3, 4, 5].map((index) => songs[index].songKey));
});

test("releasing right after a single move onto the target card still moves the card", async ({ page }) => {
    const songs = createScrollableResultSongs(6);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");

    // 移動先のカードの下端から上端へ一度に移り、その直後に離す。
    const target = await getCardPoints(cards.nth(2));
    await startHandleDrag(page, cards.nth(0), [target.bottom]);
    await page.mouse.move(target.top.x, target.top.y, { steps: 1 });
    await page.mouse.up();

    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
});

test("releasing outside the list puts the cards back without saving", async ({ page }) => {
    const songs = createScrollableResultSongs(6);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");

    await startHandleDrag(page, cards.nth(0), [(await getCardPoints(cards.nth(2))).center]);
    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    // 一覧の外（ヘッダー）で離すと、ドロップは受け付けられず、元の順序へ戻る。
    await page.mouse.move(640, 20, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => readCardTitles(page)).toEqual(ORIGINAL_TITLES);
    expect(await readSavedSongKeys(page)).toEqual(songs.map((song) => song.songKey));
    await expect(page.locator("#resultList > .song-card.dragging")).toHaveCount(0);
});

test("releasing over the header after scrolling down puts the cards back without saving", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    const songs = createScrollableResultSongs(60);
    await openSeededBookmark(page, songs);
    const header = page.locator(".header");
    // 下へスクロールしてから少し戻し、隠れたヘッダーを出す。一覧の上端は画面の上へ出て、一覧の枠がヘッダーの下にも広がる。
    await page.evaluate(() => window.scrollTo(0, 960));
    await expect(header).toHaveClass(/is-auto-hidden/);
    await page.evaluate(() => window.scrollBy(0, -20));
    await expect(header).not.toHaveClass(/is-auto-hidden/);
    await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
    const headerBox = await header.boundingBox();
    if (!headerBox) throw new Error("The header has no bounding box");
    expect(await page.locator("#resultList").evaluate((list) => list.getBoundingClientRect().top)).toBeLessThan(0);
    const keysBefore = await readCardKeys(page);
    const savedBefore = await readSavedSongKeys(page);

    // ヘッダーの下に見えているカードから、次のカードへ運び、ヘッダーの上で離す。
    const cards = page.locator("#resultList > .song-card");
    const sourceIndex = await cards.evaluateAll((elements, headerBottom) => elements.findIndex((card) => (
        card.getBoundingClientRect().top > headerBottom + 10
    )), headerBox.y + headerBox.height);
    expect(sourceIndex).toBeGreaterThan(0);
    await startHandleDrag(page, cards.nth(sourceIndex), [(await getCardPoints(cards.nth(sourceIndex + 1))).center]);
    await expect.poll(() => readCardKeys(page)).not.toEqual(keysBefore);
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => readCardKeys(page)).toEqual(keysBefore);
    expect(await readSavedSongKeys(page)).toEqual(savedBefore);
    await expect(page.locator("#resultList > .song-card.dragging")).toHaveCount(0);
});

test("scrolling with the wheel during the drag carries the card to the card now under the pointer", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    const songs = createScrollableResultSongs(60);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");
    const pointer = (await getCardPoints(cards.nth(2))).center;
    await startHandleDrag(page, cards.nth(0), [pointer]);
    await expect.poll(async () => (await readCardKeys(page)).indexOf(songs[0].songKey)).toBe(2);
    await waitForCardSlides(page);

    // ポインタを止めたまま、ホイールでスクロールする。ポインタの下に来たカードの枠へ、移動元が移る。
    await page.mouse.wheel(0, 550);
    await waitForScrollToSettle(page);
    await expect.poll(() => page.evaluate(({ x, y }) => {
        const card = document.elementFromPoint(x, y)?.closest(".song-card");
        return card instanceof HTMLElement ? card.dataset.songKey : "";
    }, pointer)).toBe(songs[0].songKey);
    const shownIndex = (await readCardKeys(page)).indexOf(songs[0].songKey);
    expect(shownIndex).toBeGreaterThan(2);

    await page.mouse.up();
    await expect.poll(async () => {
        const savedKeys = await readSavedSongKeys(page);
        return Array.isArray(savedKeys) ? savedKeys.indexOf(songs[0].songKey) : -1;
    }).toBe(shownIndex);
});

test("releasing in the gap between cards keeps the order shown during the drag", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    const songs = createScrollableResultSongs(6);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");

    await startHandleDrag(page, cards.nth(0), [(await getCardPoints(cards.nth(2))).center]);
    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    await waitForCardSlides(page);
    // 3 番目（移った移動元）と 4 番目の間の隙間で離す。
    const placed = await cards.nth(2).boundingBox();
    if (!placed) throw new Error("The placed card has no bounding box");
    await page.mouse.move(placed.x + placed.width / 2, placed.y + placed.height + 5, { steps: 4 });
    await page.mouse.up();

    await expect.poll(() => readSavedSongKeys(page)).toEqual([1, 2, 0, 3, 4, 5].map((index) => songs[index].songKey));
    expect(await readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
});

test("a taller card does not make the cards flip back and forth", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    // 2 曲目を縦の動画にして再生し、縦長に広がった背の高いカードにする。
    const songs = createScrollableResultSongs(4).map((song, index) => (
        index === 1 ? { ...song, videoOrientation: "vertical" as const } : song
    ));
    await openSeededBookmark(page, songs, { thumbnails: true });
    const cards = page.locator("#resultList > .song-card");
    const tallCard = page.locator(`#resultList > .song-card[data-song-key="${songs[1].songKey}"]`);
    await tallCard.locator(".thumb").click();
    await waitForMockYoutube(page);
    await expect(tallCard.locator("iframe")).toBeVisible();
    // 縦の動画を再生すると、広がったカードを画面に収めるようにページがなめらかにスクロールする。止まってから位置を測る。
    await waitForScrollToSettle(page);
    const shortBox = await cards.nth(0).boundingBox();
    if (!shortBox) throw new Error("The short card has no bounding box");
    await expect.poll(async () => (await tallCard.boundingBox())?.height ?? 0).toBeGreaterThan(shortBox.height * 2);
    const tallBox = await tallCard.boundingBox();
    if (!tallBox) throw new Error("The tall card has no bounding box");

    // 背の高いカードの上の方へ移ると、移動元がその枠へ移り、背の高いカードが上へよけてポインタの下に残る。
    const x = tallBox.x + tallBox.width / 2;
    await startHandleDrag(page, cards.nth(0), [{ x, y: tallBox.y + 40 }]);
    const expected = [1, 0, 2, 3].map((index) => songs[index].songKey);
    await expect.poll(() => readCardKeys(page)).toEqual(expected);
    await waitForCardSlides(page);

    // よけたカードの上でポインタを動かしても、移動元が元の枠へ戻って行ったり来たりしない。
    // 1 回の移動で 2 回入れ替わると元の並びに見えてしまうので、1 回の移動は 1 歩にする。
    for (const offset of [60, 80, 100, 120]) {
        await page.mouse.move(x, tallBox.y + offset, { steps: 1 });
        await page.waitForTimeout(80);
        expect(await readCardKeys(page)).toEqual(expected);
    }
    await page.mouse.up();
    await expect.poll(() => readSavedSongKeys(page)).toEqual([1, 0, 2, 3].map((index) => songs[index].songKey));
});

test("dragging a title link does not rearrange the cards", async ({ page }) => {
    await openSeededBookmark(page, createScrollableResultSongs(6));
    const cards = page.locator("#resultList > .song-card");
    const urlBefore = page.url();

    const target = await getCardPoints(cards.nth(2));
    await cards.nth(0).locator(".title").hover();
    await page.mouse.down();
    await page.mouse.move(target.center.x, target.center.y, { steps: 8 });
    expect(await readCardTitles(page)).toEqual(ORIGINAL_TITLES);
    await page.mouse.up();

    expect(await readCardTitles(page)).toEqual(ORIGINAL_TITLES);
    expect(page.url()).toBe(urlBefore);
});

test("dropping onto the video of a playing card moves the card and keeps the video", async ({ page }) => {
    await openSeededBookmark(page, createScrollableResultSongs(6), { thumbnails: true });
    const cards = page.locator("#resultList > .song-card");
    // 再生中のカードは並べ替えで位置が変わるので、曲キーで指す。
    const playingCard = page.locator('#resultList > .song-card[data-song-key="scroll00003::1"]');
    await playingCard.locator(".thumb").click();
    await waitForMockYoutube(page);
    const video = playingCard.locator("iframe");
    await expect(video).toBeVisible();

    // 動画は別オリジンの iframe なので、動画の上のポインタのイベントが一覧に届かないと、動画の上で並べ替えられない。
    const videoBox = await video.boundingBox();
    if (!videoBox) throw new Error("The video has no bounding box");
    await startHandleDrag(page, cards.nth(0), [{ x: videoBox.x + videoBox.width / 2, y: videoBox.y + videoBox.height / 2 }]);
    await page.mouse.up();

    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    await expect(page.locator("#resultList iframe")).toHaveCount(1);
    await expect(video).toBeVisible();
});

test("holding the card near the bottom edge scrolls the page and loads more cards while it stays semi-transparent", async ({ page }) => {
    const viewport = { width: 393, height: 851 };
    await page.setViewportSize(viewport);
    const songs = createScrollableResultSongs(60);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");
    const initialCount = await cards.count();
    expect(initialCount).toBeLessThan(songs.length);
    const cardsOnFirstScreen = await cards.evaluateAll((elements) => elements.filter((card) => card.getBoundingClientRect().top < window.innerHeight).length);

    const source = page.locator('#resultList > .song-card[data-song-key="scroll00001::1"]');
    const center = (await getCardPoints(cards.nth(0))).center;
    // 画面の下端の近くで止めると、ページが自動でスクロールし、末尾に近づくと続きを読み込む。
    await startHandleDrag(page, cards.nth(0), [{ x: center.x, y: viewport.height - 5 }]);
    await expect(source).toHaveClass(/dragging/);
    await expect.poll(() => cards.count(), { timeout: 15_000 }).toBeGreaterThan(initialCount);
    await expect(source).toHaveClass(/dragging/);
    await expect(source).toHaveCSS("opacity", "0.5");

    // 画面の中ほどへ戻すとスクロールが止まり、そこで離すと、最初の画面より先の位置へ運べている。
    await page.mouse.move(center.x, viewport.height / 2, { steps: 4 });
    const stoppedAt = await page.evaluate(() => window.scrollY);
    expect(stoppedAt).toBeGreaterThan(0);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(stoppedAt);
    await page.mouse.up();

    const readSavedIndex = async () => {
        const savedKeys = await readSavedSongKeys(page);
        return Array.isArray(savedKeys) ? savedKeys.indexOf(songs[0].songKey) : -1;
    };
    await expect.poll(readSavedIndex).toBeGreaterThanOrEqual(cardsOnFirstScreen);
    expect((await readCardKeys(page)).indexOf(songs[0].songKey)).toBe(await readSavedIndex());
    await expect(source).not.toHaveClass(/dragging/);
});

test("pressing Esc during the drag puts the cards back without saving", async ({ page }) => {
    const songs = createScrollableResultSongs(6);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");

    await startHandleDrag(page, cards.nth(0), [(await getCardPoints(cards.nth(2))).center]);
    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    await page.keyboard.press("Escape");

    await expect.poll(() => readCardTitles(page)).toEqual(ORIGINAL_TITLES);
    await expect(page.locator("#resultList > .song-card.dragging")).toHaveCount(0);
    // 取り消した後は、ポインタを動かして離しても並べ替えない。
    await page.mouse.move(5, 5, { steps: 4 });
    await page.mouse.up();
    expect(await readCardTitles(page)).toEqual(ORIGINAL_TITLES);
    expect(await readSavedSongKeys(page)).toEqual(songs.map((song) => song.songKey));
});

test("while dragging, the cards slide aside toward the gap in the dragged direction", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    const songs = createScrollableResultSongs(6);
    await openSeededBookmark(page, songs);
    const cards = page.locator("#resultList > .song-card");
    await recordCardAnimations(page);
    const keyOf = (songNumber: number) => songs[songNumber - 1].songKey;

    // 上から下へ（1 番目を 3 番目へ）：よけるカードは上へ、移動元は下へスライドし、移動元だけ前面に出る。
    await startHandleDrag(page, cards.nth(0), [(await getCardPoints(cards.nth(2))).center]);
    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    const downward = await takeCardAnimations(page);
    expect(new Set(downward.map((slide) => slide.songKey))).toEqual(new Set([keyOf(1), keyOf(2), keyOf(3)]));
    for (const slide of downward) {
        expect(Math.abs(slide.dx)).toBeLessThan(1);
        if (slide.songKey === keyOf(1)) {
            expect(slide).toMatchObject({ zIndex: "3" });
            expect(slide.dy).toBeLessThan(0);
        } else {
            expect(slide.dy).toBeGreaterThan(0);
        }
    }
    // 離したときは、もう見えている順序なので、動かない。
    await page.mouse.up();
    await expect.poll(() => readSavedSongKeys(page)).toEqual([1, 2, 0, 3, 4, 5].map((index) => songs[index].songKey));
    expect(await takeCardAnimations(page)).toEqual([]);

    // 下から上へ（5 番目を 2 番目へ）：よけるカードは下へ、移動元は上へスライドする。
    await waitForCardSlides(page);
    await page.mouse.move(5, 5);
    await startHandleDrag(page, cards.nth(4), [(await getCardPoints(cards.nth(1))).center]);
    await expect.poll(() => readCardTitles(page)).toEqual([
        "Scroll Song 02", "Scroll Song 05", "Scroll Song 03", "Scroll Song 01", "Scroll Song 04", "Scroll Song 06"
    ]);
    const upward = await takeCardAnimations(page);
    expect(new Set(upward.map((slide) => slide.songKey))).toEqual(new Set([keyOf(5), keyOf(3), keyOf(1), keyOf(4)]));
    for (const slide of upward) {
        if (slide.songKey === keyOf(5)) {
            expect(slide).toMatchObject({ zIndex: "3" });
            expect(slide.dy).toBeGreaterThan(0);
        } else {
            expect(slide.dy).toBeLessThan(0);
        }
    }
    await page.mouse.up();
});

test("with reduced motion, the cards make room without sliding", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSeededBookmark(page, createScrollableResultSongs(6));
    const cards = page.locator("#resultList > .song-card");
    await recordCardAnimations(page);

    await startHandleDrag(page, cards.nth(0), [(await getCardPoints(cards.nth(2))).center]);
    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    await page.mouse.up();

    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    expect(await takeCardAnimations(page)).toEqual([]);
});

test("dragging the handle neither starts the browser's drag nor selects text", async ({ page }) => {
    await openSeededBookmark(page, createScrollableResultSongs(6));
    const cards = page.locator("#resultList > .song-card");
    await page.evaluate(() => {
        window.__knkNativeDragStarts = 0;
        document.addEventListener("dragstart", () => {
            window.__knkNativeDragStarts = (window.__knkNativeDragStarts ?? 0) + 1;
        }, true);
    });

    // 移動元のカード自身がポインタの下の枠へ移るので、ブラウザのドラッグは使わず、カードの写しも付いてこない。
    await startHandleDrag(page, cards.nth(0), [(await getCardPoints(cards.nth(2))).center]);
    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await page.mouse.up();

    expect(await page.evaluate(() => window.__knkNativeDragStarts)).toBe(0);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
});

test.describe("touch", () => {
    test.use({ hasTouch: true });

    /**
     * Chromium の DevTools Protocol で、画面に触れた指を動かして離す。
     * Playwright の touchscreen は tap しかないので、触れたまま動かす操作はこちらで送る。
     * @param page 操作するページ
     * @param points 触れる点から離す点まで、順にたどる点
     * @param options holdMs を指定すると、最初の点で長押ししてから動かす
     */
    async function touchDrag(page: Page, points: Point[], options: { holdMs?: number } = {}) {
        const client = await page.context().newCDPSession(page);
        const [first, ...rest] = points;
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
        if (options.holdMs) await page.waitForTimeout(options.holdMs);
        let previous = first;
        for (const point of rest) {
            for (let step = 1; step <= 8; step++) {
                const x = previous.x + (point.x - previous.x) * step / 8;
                const y = previous.y + (point.y - previous.y) * step / 8;
                await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
            }
            previous = point;
        }
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await client.detach();
    }

    for (const holdMs of [0, 1000]) {
        test(`a touch drag on the handle moves the card without scrolling the page (hold ${holdMs}ms)`, async ({ page, browserName }) => {
            test.skip(browserName !== "chromium", "触れたまま動かす操作は Chromium の DevTools Protocol でだけ送れる");
            await page.setViewportSize({ width: 393, height: 851 });
            const songs = createScrollableResultSongs(6);
            await openSeededBookmark(page, songs);
            const cards = page.locator("#resultList > .song-card");
            const handleBox = await cards.nth(0).locator(".drag-handle").boundingBox();
            if (!handleBox) throw new Error("The drag handle has no bounding box");
            const scrollYBefore = await page.evaluate(() => window.scrollY);

            // 指で上へなぞるとページはふつう下へスクロールするが、ハンドルからなら並べ替えになる。
            // 長押ししてから動かしても、メニューや文字の選択に変わらない。
            await touchDrag(page, [
                { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
                (await getCardPoints(cards.nth(2))).center
            ], { holdMs });

            await expect.poll(() => readSavedSongKeys(page)).toEqual([1, 2, 0, 3, 4, 5].map((index) => songs[index].songKey));
            expect(await readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
            expect(await page.evaluate(() => window.scrollY)).toBe(scrollYBefore);
            expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
            await expect(page.locator("#resultList > .song-card.dragging")).toHaveCount(0);
        });
    }
});

for (const colorScheme of ["light", "dark"] as const) {
    test(`while dragging, no card shows the hover frame (${colorScheme} theme)`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await openSeededBookmark(page, createScrollableResultSongs(6));
        expect(await page.locator("html").evaluate((element) => element.classList.contains("dark-theme"))).toBe(colorScheme === "dark");
        const cards = page.locator("#resultList > .song-card");
        // 一覧の外へポインタを出し、どのカードも指していないときの枠を覚える。
        await page.mouse.move(640, 20);
        await expect.poll(async () => (await readCardFrames(page)).every((frame) => frame.boxShadow === "none")).toBe(true);
        const [restingFrame] = await readCardFrames(page);

        // ドラッグしていなければ、指したカードにはホバーの枠と影が付く。
        await cards.nth(1).hover();
        await expect(cards.nth(1)).not.toHaveCSS("box-shadow", "none");

        // ドラッグ中は、移動元にも、よけて動いたカードにも付けない。
        // Playwright の Chromium はドラッグ中もポインタの動きでホバーを付け替え、よけたカードに枠が残っていた（WebKit は付けない）。
        await startHandleDrag(page, cards.nth(0), [(await getCardPoints(cards.nth(2))).center]);
        await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
        await expect.poll(() => readCardFrames(page)).toEqual(Array.from({ length: 6 }, () => restingFrame));
        await page.mouse.up();

        // 離した後は、また付く。
        await cards.nth(3).hover();
        await expect(cards.nth(3)).not.toHaveCSS("box-shadow", "none");
    });
}

test("arrow keys on the handle reorder a bookmark, keep focus on the card, and announce the new position", async ({ page }) => {
    const songs = createScrollableResultSongs(6);
    await openSeededBookmark(page, songs);
    const firstCard = page.locator("#resultList > .song-card").filter({ hasText: "Scroll Song 01" });
    const handle = firstCard.getByRole("button", { name: "並べ替え（矢印キーで前後へ移動）" });
    const scrollYBefore = await page.evaluate(() => window.scrollY);

    await handle.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");

    await expect.poll(() => readCardTitles(page)).toEqual(FIRST_TO_THIRD_TITLES);
    expect(await readSavedSongKeys(page)).toEqual([1, 2, 0, 3, 4, 5].map((index) => songs[index].songKey));
    // カードの要素を移してもフォーカスを保ち、続けて動かせる。移動先は読み上げで伝える。
    await expect(handle).toBeFocused();
    await expect(page.locator("#resultAnnouncement")).toHaveText("「Scroll Song 01」を 6 件中 3 番目へ移動しました");
    expect(await page.evaluate(() => window.scrollY), "arrow keys must not scroll the page").toBe(scrollYBefore);

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => readCardTitles(page)).toEqual(ORIGINAL_TITLES);
    await expect(handle).toBeFocused();

    // 先頭ではそれ以上動かず、保存した順序も変わらない。
    await page.keyboard.press("ArrowUp");
    expect(await readCardTitles(page)).toEqual(ORIGINAL_TITLES);
    expect(await readSavedSongKeys(page)).toEqual(songs.map((song) => song.songKey));

    // 並べ替えた順序は、読み込み直しても残る。
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => readSavedSongKeys(page)).toEqual([1, 0, 2, 3, 4, 5].map((index) => songs[index].songKey));
    await page.reload();
    await waitForInitialLoad(page);
    await expect.poll(() => readCardTitles(page)).toEqual(
        ["Scroll Song 02", "Scroll Song 01", "Scroll Song 03", "Scroll Song 04", "Scroll Song 05", "Scroll Song 06"]
    );
});
