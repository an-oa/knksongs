import { test, expect } from "@playwright/test";
import { installNetworkMocks, routeSongsJsonFixture } from "./support/mock-youtube.mjs";
import { createScrollableResultSongs } from "./support/song-fixtures.mjs";
import {
    clickControlLabel,
    closeSidebar,
    enablePlaybackSettings,
    filterBySongTitle,
    getSongCard,
    openSettingsPanel,
    waitForInitialLoad
} from "./support/ui-helpers.mjs";

/** 実際の矩形で、カード同士の重なりやコンテナからのはみ出しを検証する。 */
async function expectCardsInsideLayout(page) {
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

test("wide recommendations retain more than 48 cards when shrinking to mobile", async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await installNetworkMocks(page);
    const songs = createScrollableResultSongs(160).map((song) => ({ ...song, format: "オリ曲" }));
    await routeSongsJsonFixture(page, songs);
    await page.goto("/");
    await waitForInitialLoad(page);
    const cards = page.locator(".song-card");
    await expect.poll(() => cards.count()).toBeGreaterThan(48);
    const wideKeys = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.songKey));

    await page.setViewportSize({ width: 393, height: 851 });
    await expect(page.locator("#resultList")).toHaveAttribute("data-layout-columns", "1");
    await expect(cards).toHaveCount(wideKeys.length);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.songKey))).toEqual(wideKeys);
    await expectCardsInsideLayout(page);

    await page.setViewportSize({ width: 3840, height: 2160 });
    await expect(page.locator("#resultList")).not.toHaveAttribute("data-layout-columns", "1");
    await expect(cards).toHaveCount(wideKeys.length);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.songKey))).toEqual(wideKeys);
    await expectCardsInsideLayout(page);
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
