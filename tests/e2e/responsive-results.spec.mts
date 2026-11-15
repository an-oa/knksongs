import { test, expect, type Page } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { routeSongsJsonFixture } from "./support/songs-network.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";
import { waitForMockYoutube } from "./support/mock-youtube.mts";
import {
    clickControlLabel,
    closeSidebar,
    enablePlaybackSettings,
    expectSidebarPopoverClosed,
    filterBySongTitle,
    getBookmarkItem,
    getSongCard,
    openBookmarkPanel,
    openSettingsPanel,
    openSidebar,
    waitForInitialLoad
} from "./support/ui-helpers.mts";

/** 実際の矩形で、カード同士の重なりやコンテナからのはみ出しを検証する。 */
async function expectCardsInsideLayout(page: Page) {
    await expect.poll(() => page.locator("#resultList").evaluate((list) => {
        const bounds = list.getBoundingClientRect();
        const rects = Array.from(list.querySelectorAll(".song-card"), (card) => card.getBoundingClientRect());
        return rects.every((rect, index) => (
            rect.height > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 &&
            rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 &&
            rects.slice(index + 1).every((other) => (
                Math.min(rect.right, other.right) - Math.max(rect.left, other.left) <= 1 ||
                Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) <= 1
            ))
        ));
    })).toBe(true);
}

test("mobile recommendations append the same selection and retain it across column changes", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(60).map((song) => ({ ...song, format: "オリ曲" }));
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await waitForInitialLoad(page);
    const cards = page.locator(".song-card");
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", "1");
    const initialKeys = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.songKey));
    expect(initialKeys.length).toBeGreaterThanOrEqual(12);
    expect(initialKeys.length).toBeLessThan(48);
    await expect(cards.first()).toHaveCSS("position", "relative");
    await expectCardsInsideLayout(page);

    await page.locator("#resultTailSentinel").scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(48);
    const allKeys = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.songKey));
    expect(allKeys.slice(0, initialKeys.length)).toEqual(initialKeys);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1280, height: 851 });
    await expect(page.locator("#resultList")).not.toHaveAttribute("data-layout-columns", "1");
    await expect(cards.first()).toHaveCSS("position", "absolute");
    await expectCardsInsideLayout(page);
    await page.setViewportSize({ width: 393, height: 851 });
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", "1");
    await expect(cards).toHaveCount(48);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.songKey))).toEqual(allKeys);
    await expectCardsInsideLayout(page);
});

/** 結果カードの曲キーを表示順に返す。 */
async function readCardKeys(page: Page) {
    return page.locator(".song-card").evaluateAll((nodes) => nodes.map((node) => node.dataset.songKey));
}

/** 画面の上端より上へ過ぎていない最初のカードを、読んでいる位置の目印として、その上端の位置とともに返す。 */
async function readReadingPosition(page: Page) {
    return page.evaluate(() => {
        const cardNodes = Array.from(document.querySelectorAll<HTMLElement>("#resultList .song-card"));
        const card = cardNodes.find((node) => node.getBoundingClientRect().bottom > 0);
        return card ? { songKey: card.dataset.songKey ?? "", top: Math.round(card.getBoundingClientRect().top) } : null;
    });
}

/**
 * 指定したカードの上端の位置を返す。
 * 列数が変わると同じ行に並ぶカードが入れ替わるので、リサイズ後は目印にしたカードそのもので比べる。
 */
async function readCardTop(page: Page, songKey: string) {
    return page.evaluate((key) => {
        const card = Array.from(document.querySelectorAll<HTMLElement>("#resultList .song-card"))
            .find((node) => node.dataset.songKey === key);
        return card ? Math.round(card.getBoundingClientRect().top) : null;
    }, songKey);
}

/**
 * 指定したカードの上端が、期待した位置にあることを確かめる。
 * カードの位置は小数になり、位置合わせは 1px 未満のずれを補正しないので、1px までの差は許す。
 */
async function expectCardTop(page: Page, songKey: string, top: number) {
    await expect.poll(async () => {
        const actualTop = await readCardTop(page, songKey);
        return actualTop === null ? Number.POSITIVE_INFINITY : Math.abs(actualTop - top);
    }).toBeLessThanOrEqual(1);
}

/** 末尾の追加表示を最後まで進め、読み進める途中で件数が変わらないようにする。 */
async function showAllResults(page: Page, resultCount: number) {
    await expect.poll(() => page.evaluate(() => {
        document.querySelector("#resultTailSentinel")?.scrollIntoView();
        return document.querySelectorAll("#resultList .song-card").length;
    })).toBe(resultCount);
}

/**
 * 指定した数の animation frame を待つ。
 * スクロールはブラウザが次の frame で知らせるので、読んでいた位置が記録されてからリサイズするために使う。
 */
async function waitForAnimationFrames(page: Page, frameCount = 2) {
    await page.evaluate((count) => new Promise<void>((resolve) => {
        const step = (remaining: number) => {
            if (remaining <= 0) {
                resolve();
                return;
            }
            requestAnimationFrame(() => step(remaining - 1));
        };
        step(count);
    }), frameCount);
}

/** 先頭から指定位置のカードを画面の上の方まで読み進め、少し戻ってヘッダーを表示した状態にする。 */
async function readUntilCard(page: Page, cardIndex: number) {
    const header = page.locator(".header");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).not.toHaveClass(/is-auto-hidden/);
    await page.evaluate((index) => {
        const card = document.querySelectorAll("#resultList .song-card")[index];
        window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top - 120);
    }, cardIndex);
    await expect(header).toHaveClass(/is-auto-hidden/);
    await page.evaluate(() => window.scrollBy(0, -40));
    await expect(header).not.toHaveClass(/is-auto-hidden/);
}

/**
 * 狭めても戻しても、読んでいたカードが同じ位置に見え、ヘッダーも表示されたままであることを確かめる。
 * 640px 以下ではヘッダーが 2 段になり、その分だけ内容が下がるので、ヘッダーが 1 段のままの幅で確かめる。
 */
async function expectReadingPositionKeptAcrossResize(page: Page, wideColumnCount: string) {
    const readingPosition = await readReadingPosition(page);
    if (!readingPosition) throw new Error("No card is being read");

    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", "2");
    await expectCardTop(page, readingPosition.songKey, readingPosition.top);
    await expect(page.locator(".header")).not.toHaveClass(/is-auto-hidden/);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", wideColumnCount);
    await expectCardTop(page, readingPosition.songKey, readingPosition.top);
    await expect(page.locator(".header")).not.toHaveClass(/is-auto-hidden/);
}

test("search results keep the card being read in place when narrowing and widening", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installNetworkMocks(page);
    await routeSongsJsonFixture(page, createScrollableResultSongs(120));
    await page.goto("/");
    await waitForInitialLoad(page);
    await page.locator("#searchBox").fill("Scroll Artist");
    await expect(page.locator("#resultCount")).toHaveText("120 件がヒット");
    // 検索ボックスにフォーカスがあるとヘッダーが隠れないので、外してから読み進める。
    await page.locator("#searchBox").blur();
    const columnCount = await page.locator("#resultList").getAttribute("data-layout-columns");
    expect(Number(columnCount)).toBeGreaterThan(1);

    await readUntilCard(page, 24);
    await expectReadingPositionKeptAcrossResize(page, columnCount ?? "");
});

test("search results with thumbnails keep the card being read in place when widening from one column", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 800 });
    await installNetworkMocks(page);
    await routeSongsJsonFixture(page, createScrollableResultSongs(120));
    await page.goto("/");
    await waitForInitialLoad(page);
    await enablePlaybackSettings(page);
    await closeSidebar(page);
    await page.locator("#searchBox").fill("Scroll Artist");
    await expect(page.locator("#resultCount")).toHaveText("120 件がヒット");
    await page.locator("#searchBox").blur();
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", "1");
    await showAllResults(page, 120);

    // 25 曲目の上端が画面から 30px はみ出す位置まで読み進める。
    // 1 列ではカードが通常の並びなので、リサイズが知らされる時点でブラウザが先に並び直している。
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => {
        const card = document.querySelectorAll("#resultList .song-card")[24];
        window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top + 30);
    });
    await waitForAnimationFrames(page);
    const readingPosition = await readReadingPosition(page);
    if (!readingPosition) throw new Error("No card is being read");
    // カードの高さは小数になり、スクロール位置を整数へ丸める向きはブラウザで違うので、1px までの差は許す。
    expect(readingPosition.songKey).toBe("scroll00025::1");
    expect(Math.abs(readingPosition.top + 30)).toBeLessThanOrEqual(1);

    // 読んでいた位置はリサイズ前に記録しているので、ヘッダーが 2 段から 1 段に縮んでも、画面上の位置は変わらない。
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", "4");
    await expectCardTop(page, readingPosition.songKey, readingPosition.top);

    // 4 列では同じ行のカードが横に並ぶので、狭め直すときの目印は、その行で DOM 順が最初のカードになる。
    // 複数列のカードはブラウザのスクロール補正が効かないが、記録した位置に合わせるので、ヘッダーが伸びても位置は変わらない。
    const wideReadingPosition = await readReadingPosition(page);
    if (!wideReadingPosition) throw new Error("No card is being read");
    await page.setViewportSize({ width: 393, height: 800 });
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", "1");
    await expectCardTop(page, wideReadingPosition.songKey, wideReadingPosition.top);
});

test("bookmark results keep the card being read in place when narrowing and widening", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(80);
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await page.evaluate((songKeys) => {
        localStorage.setItem("bookmarksV1", JSON.stringify({
            version: 3,
            bookmarks: { b1: { name: "Long Favorites", songs: songKeys, createdAt: 1 } }
        }));
    }, songs.map((song) => song.songKey));
    await page.reload();
    await waitForInitialLoad(page);
    await openSidebar(page);
    await openBookmarkPanel(page);
    await getBookmarkItem(page, "Long Favorites").click();
    await expect(page.locator("#resultCount")).toHaveText("ブックマーク: Long Favorites (80 件)");
    await page.locator("#close-bookmark-sidebar").click();
    await expectSidebarPopoverClosed(page);
    const columnCount = await page.locator("#resultList").getAttribute("data-layout-columns");
    expect(Number(columnCount)).toBeGreaterThan(1);

    await readUntilCard(page, 24);
    await expectReadingPositionKeptAcrossResize(page, columnCount ?? "");
});

test("recommendations return to 48 cards after widening and narrowing again at the top", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(200).map((song) => ({ ...song, format: "オリ曲" }));
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await waitForInitialLoad(page);
    const cards = page.locator(".song-card");
    await expect(cards).toHaveCount(48);
    const initialKeys = await readCardKeys(page);

    // ブラウザの表示を 25% に縮小したときと同じ広さにする。
    await page.setViewportSize({ width: 5120, height: 3200 });
    await expect.poll(() => cards.count()).toBeGreaterThan(48);
    const wideKeys = await readCardKeys(page);
    expect(wideKeys.slice(0, 48)).toEqual(initialKeys);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(cards).toHaveCount(48);
    expect(await readCardKeys(page)).toEqual(initialKeys);
    await expectCardsInsideLayout(page);

    await page.setViewportSize({ width: 5120, height: 3200 });
    await expect(cards).toHaveCount(wideKeys.length);
    expect(await readCardKeys(page)).toEqual(wideKeys);
    await expectCardsInsideLayout(page);
});

test("recommendations return to 48 cards after a 1080p screen is zoomed out and back", async ({ page }) => {
    // 7680×4320 の画面は描画が重く、WebKit では並列実行の負荷が高いと、件数が変わるまで 5 秒を超えることがある。
    test.slow();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(300).map((song) => ({ ...song, format: "オリ曲" }));
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await waitForInitialLoad(page);
    const cards = page.locator(".song-card");
    await expect(cards).toHaveCount(48);
    const initialKeys = await readCardKeys(page);

    // 25% 表示では列数が大きく増えるので、並び直す前の配置で画面内のカードを数えると件数が戻らなくなる。
    await page.setViewportSize({ width: 7680, height: 4320 });
    await expect.poll(() => cards.count(), { timeout: 20_000 }).toBeGreaterThan(200);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(cards).toHaveCount(48, { timeout: 20_000 });
    expect(await readCardKeys(page)).toEqual(initialKeys);
    await expectCardsInsideLayout(page);
});

test("narrowing at the top keeps the recommendation that is playing", async ({ page }) => {
    await page.setViewportSize({ width: 5120, height: 3200 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(200).map((song) => ({ ...song, format: "オリ曲" }));
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await waitForInitialLoad(page);
    await enablePlaybackSettings(page);
    await closeSidebar(page);
    const cards = page.locator(".song-card");
    await expect.poll(() => cards.count()).toBeGreaterThan(100);
    const wideKeys = await readCardKeys(page);

    const playingCard = cards.nth(100);
    await playingCard.locator(".thumb").click();
    await waitForMockYoutube(page);
    await expect(playingCard.locator("iframe")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(cards).toHaveCount(101);
    expect(await readCardKeys(page)).toEqual(wideKeys.slice(0, 101));
    await expect(cards.nth(100).locator("iframe")).toHaveCount(1);
});

test("shrinking only the height keeps the recommendations on screen while a vertical video plays", async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(160).map((song) => {
        const url = `https://www.youtube.com/shorts/${song.videoId}`;
        return { ...song, format: "オリ曲", url };
    });
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await waitForInitialLoad(page);
    await enablePlaybackSettings(page);
    await closeSidebar(page);
    const cards = page.locator(".song-card");
    await expect.poll(() => cards.count()).toBeGreaterThan(48);
    const wideKeys = await readCardKeys(page);

    // 先頭のカードで縦動画を再生すると、そのカードだけが縦に伸び、列ごとの高さがそろわなくなる。
    const playingCard = cards.first();
    await playingCard.locator(".thumb").click();
    await waitForMockYoutube(page);
    await expect(playingCard).toHaveClass(/song-card-expanded/);
    // カードが伸びた後の位置合わせが数フレーム後にスクロールを動かすので、終わるのを待ってから読み進める。
    await waitForAnimationFrames(page, 3);
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);
    await waitForAnimationFrames(page);
    const shrunkHeight = 1650;
    // 高さだけを縮めても配置は変わらないので、縮めた後に一部でも見えるカードを先に調べておく。
    // スクロール中なので、画面の下端で途切れるカードも残す必要がある。
    const keysOnShrunkScreen = await page.evaluate((viewportHeight) => (
        Array.from(document.querySelectorAll<HTMLElement>("#resultList .song-card"))
            .filter((card) => card.getBoundingClientRect().top < viewportHeight)
            .map((card) => card.dataset.songKey)
    ), shrunkHeight);
    expect(keysOnShrunkScreen.length).toBeGreaterThan(72);

    await page.setViewportSize({ width: 3840, height: shrunkHeight });
    await waitForAnimationFrames(page);
    // 伸びたカードの列は後ろのカードが下へずれるので、画面内のカードは先頭から連続した並びにならない。
    const keptKeys = await readCardKeys(page);
    expect(keptKeys).toEqual(expect.arrayContaining(keysOnShrunkScreen));
    expect(keptKeys).toEqual(wideKeys.slice(0, keptKeys.length));
    await expect(playingCard.locator("iframe")).toHaveCount(1);
    await expectCardsInsideLayout(page);
});

test("narrowing while scrolled keeps the recommendation being read and the cards above it", async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(160).map((song) => ({ ...song, format: "オリ曲" }));
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await waitForInitialLoad(page);
    const cards = page.locator(".song-card");
    await expect.poll(() => cards.count()).toBeGreaterThan(48);
    const wideKeys = await readCardKeys(page);

    // おすすめは画面を埋める件数なので、カードを見積もりより高くして再配置し、スクロールできる状態を作る。
    await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>("#resultList .song-card").forEach((card) => {
            card.style.minHeight = "600px";
        });
        window.dispatchEvent(new Event("resize"));
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(4000);
    const scrolledPastCount = await page.evaluate(() => {
        const cardNodes = Array.from(document.querySelectorAll("#resultList .song-card"));
        const columnCount = Number(document.querySelector("#resultList")?.getAttribute("data-layout-columns"));
        window.scrollTo(0, window.scrollY + cardNodes[columnCount * 2].getBoundingClientRect().top);
        return cardNodes.findIndex((card) => card.getBoundingClientRect().bottom > 0);
    });
    await waitForAnimationFrames(page);
    const keptCount = Math.min(wideKeys.length, scrolledPastCount + 48);
    expect(scrolledPastCount).toBeGreaterThan(0);
    expect(keptCount).toBeLessThan(wideKeys.length);
    const readingPosition = await readReadingPosition(page);
    if (!readingPosition) throw new Error("No card is being read");
    expect(readingPosition.songKey).toBe(wideKeys[scrolledPastCount]);

    // ヘッダーが 1 段のままの幅へ狭め、ヘッダーの高さの変化で位置がずれないようにする。
    await page.setViewportSize({ width: 700, height: 851 });
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", "2");
    await expect(cards).toHaveCount(keptCount);
    expect(await readCardKeys(page)).toEqual(wideKeys.slice(0, keptCount));
    await expectCardTop(page, readingPosition.songKey, readingPosition.top);
    await expectCardsInsideLayout(page);
});

/** カードの 4 隅の角丸を、左上・右上・右下・左下の順に返す。 */
async function readCardCornerRadii(page: Page) {
    return page.locator(".song-card").first().evaluate((card) => {
        const style = window.getComputedStyle(card);
        return [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius
        ];
    });
}

test("cards square their top corners while thumbnails are shown so thumbnails and videos reach the corners", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installNetworkMocks(page);
    await page.goto("/");
    await waitForInitialLoad(page);
    await filterBySongTitle(page, "Artist");
    await expect(page.locator(".song-card")).toHaveCount(6);
    // サムネイルを表示していないときは、隅で切り取るものがないので 4 隅とも丸い。
    await expect.poll(() => readCardCornerRadii(page)).toEqual(["12px", "12px", "12px", "12px"]);

    await enablePlaybackSettings(page);
    await closeSidebar(page);
    await expect.poll(() => readCardCornerRadii(page)).toEqual(["0px", "0px", "12px", "12px"]);

    await openSettingsPanel(page);
    await clickControlLabel(page, "#thumbnail-toggle");
    await page.locator("#close-settings-panel").click();
    await closeSidebar(page);
    await expect.poll(() => readCardCornerRadii(page)).toEqual(["12px", "12px", "12px", "12px"]);
});

test("single-column playback and thumbnail toggles keep natural card and list heights", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await installNetworkMocks(page);
    await page.goto("/");
    await waitForInitialLoad(page);
    await enablePlaybackSettings(page);
    await filterBySongTitle(page, "Artist");
    await expect(page.locator(".song-card")).toHaveCount(6);
    const card = getSongCard(page, "Manual Song");
    await card.locator(".thumb").click();
    await expect(card.locator("iframe")).toBeVisible();
    await expectCardsInsideLayout(page);
    await card.locator(".thumb-close-btn").click();
    await expect(card.locator("iframe")).toHaveCount(0);
    const expandedHeight = await page.locator("#resultList").evaluate((list) => list.getBoundingClientRect().height);
    await openSettingsPanel(page);
    await clickControlLabel(page, "#thumbnail-toggle");
    await page.locator("#close-settings-panel").click();
    await closeSidebar(page);
    await expect.poll(() => page.locator("#resultList").evaluate((list) => list.getBoundingClientRect().height)).toBeLessThan(expandedHeight);
    await expectCardsInsideLayout(page);
    expect(await page.locator("#resultList").evaluate((list) => list.style.height)).toBe("");
});

test("vertical playback expands its card without overlap and restores the masonry layout after closing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(8);
    songs[1].videoOrientation = "vertical";
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await waitForInitialLoad(page);
    await enablePlaybackSettings(page);
    await filterBySongTitle(page, "Scroll Artist");
    await page.locator("#searchBox").blur();

    const cards = page.locator(".song-card");
    await expect(cards).toHaveCount(8);
    await expect(page.locator("#resultList")).not.toHaveAttribute("data-layout-columns", "1");
    await expectCardsInsideLayout(page);
    /** カードごとの配置を songKey 付きで記録する。 */
    const readPositions = () => cards.evaluateAll((nodes) => nodes.map((node) => ({
        songKey: node.dataset.songKey || "",
        top: node.style.top,
        left: node.style.left
    })));
    const before = await readPositions();

    const verticalCard = getSongCard(page, "Scroll Song 02");
    const collapsedHeight = await verticalCard.evaluate((node) => node.getBoundingClientRect().height);
    await verticalCard.locator(".thumb").click();
    await expect(verticalCard.locator("iframe")).toBeVisible();
    await expect(verticalCard.locator(".thumb")).toHaveAttribute("data-video-orientation", "vertical");
    await expect.poll(() => verticalCard.evaluate((node) => node.getBoundingClientRect().height))
        .toBeGreaterThan(collapsedHeight);
    await expectCardsInsideLayout(page);

    await verticalCard.locator(".thumb-close-btn").click();
    await expect(verticalCard.locator("iframe")).toHaveCount(0);
    await expect.poll(readPositions).toEqual(before);
    await expectCardsInsideLayout(page);
});

for (const language of ["ja", "en"] as const) {
    test(`card footers keep the date on one line and the bookmark button inside the card with many tags (${language})`, async ({ page }) => {
        await page.addInitScript((siteLanguage) => localStorage.setItem("siteLanguage", siteLanguage), language);
        await installNetworkMocks(page);
        // 形態・コラボ・リレー・ハモリのタグがすべて付く曲と、今のデータにある3つのタグの組み合わせを並べる。
        // 日付は英語で最も長い形(「Sep 30, 2024」)になるようにする。
        const tagSets = [
            { streamRole: "ゲスト", isRelay: true, isHarmony: true },
            { streamRole: "", isRelay: true, isHarmony: true },
            { streamRole: "ゲスト", isRelay: true, isHarmony: false }
        ];
        const songs = createScrollableResultSongs(tagSets.length).map((song, index) => ({
            ...song,
            ...tagSets[index],
            date: "2024/09/30",
            dateKey: 20240930
        }));
        await routeSongsJsonFixture(page, songs);
        await page.goto("/");
        await waitForInitialLoad(page);
        await filterBySongTitle(page, "Scroll Song");

        for (const width of [320, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await expect(page.locator("#resultList .song-card")).toHaveCount(tagSets.length);
            await expect(page.locator("#resultList .song-card").first().locator(".tag")).toHaveCount(4);
            const footers = await page.locator("#resultList .song-card").evaluateAll((cards) => cards.map((card) => {
                const cardRect = card.getBoundingClientRect();
                const date = card.querySelector(".footer-left span");
                const dateRange = document.createRange();
                if (date) dateRange.selectNodeContents(date);
                const dateRight = date ? date.getBoundingClientRect().right : Number.NaN;
                const tags = [...card.querySelectorAll(".tag")].map((tag) => tag.getBoundingClientRect());
                const button = card.querySelector(".card-footer button")?.getBoundingClientRect();
                return {
                    dateLines: date ? dateRange.getClientRects().length : 0,
                    tagsClearOfDate: tags.every((tag) => tag.left >= dateRight),
                    tagsInsideCard: tags.every((tag) => tag.right <= cardRect.right + 0.5),
                    buttonInsideCard: !!button && button.left >= cardRect.left && button.right <= cardRect.right + 0.5
                };
            }));
            for (const [index, footer] of footers.entries()) {
                expect(footer, `${width}px card ${index + 1}`).toEqual({
                    dateLines: 1,
                    tagsClearOfDate: true,
                    tagsInsideCard: true,
                    buttonInsideCard: true
                });
            }
        }
    });
}

test("showing more results leaves the cards already shown untouched", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installNetworkMocks(page);
    await routeSongsJsonFixture(page, createScrollableResultSongs(120));
    await page.goto("/");
    await waitForInitialLoad(page);
    await enablePlaybackSettings(page);
    await closeSidebar(page);
    await page.locator("#searchBox").fill("Scroll Artist");
    await expect(page.locator("#resultCount")).toHaveText("120 件がヒット");
    const cards = page.locator("#resultList .song-card");
    const initialCount = await cards.count();
    expect(initialCount).toBeLessThan(120);

    // 最初のカードの画像とタグに印を付け、続きを読み込んだ後も同じ要素かを確かめる。
    await cards.first().evaluate((card) => {
        card.querySelector(".thumb img")?.setAttribute("data-kept", "image");
        card.querySelector(".tag")?.setAttribute("data-kept", "tag");
    });
    const imageRequests: string[] = [];
    page.on("request", (request) => {
        if (request.url().startsWith("https://i.ytimg.com/")) imageRequests.push(request.url());
    });

    await showAllResults(page, 120);

    // 追加表示のたびに全カードの画像とタグを作り直すと、件数に比例して描画が重くなる。
    await expect(cards.first().locator(".thumb img")).toHaveAttribute("data-kept", "image");
    await expect(cards.first().locator(".tag").first()).toHaveAttribute("data-kept", "tag");
    const firstCardImage = await cards.first().locator(".thumb img").getAttribute("src");
    expect(imageRequests.filter((url) => url === firstCardImage), "the first thumbnail is not requested again").toEqual([]);
});
