import { test, expect } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { waitForMockYoutube } from "./support/mock-youtube.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";
import { routeSongsJsonFixture } from "./support/songs-network.mts";
import {
    closeSidebar,
    enablePlaybackSettings,
    filterBySongTitle,
    getSongCard,
    pressTabUntilFocused,
    waitForInitialLoad
} from "./support/ui-helpers.mts";

test.beforeEach(async ({ page }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await page.evaluate(() => {
        localStorage.clear();
    });
    await page.reload();
    await waitForInitialLoad(page);
});

test("a thumbnail can be played and closed with the keyboard without losing focus", async ({ page }) => {
    await enablePlaybackSettings(page);
    await closeSidebar(page);
    await filterBySongTitle(page, "Manual Song");
    const card = getSongCard(page, "Manual Song");
    await expect(card).toBeVisible();

    // サムネイルは、どの曲を再生するかを名前に持つボタンとして、Tab で届く。
    const playButton = card.getByRole("button", { name: "「Manual Song」を再生" });
    await expect(playButton.locator("img")).toHaveAttribute("alt", "");
    await page.locator("#searchBox").focus();
    await pressTabUntilFocused(page, playButton);

    await page.keyboard.press("Enter");
    await waitForMockYoutube(page);
    await expect(card.locator(".thumb iframe")).toHaveCount(1);
    // 再生ボタンは動画と入れ替わって消えるので、フォーカスを閉じるボタンへ引き継ぐ。
    const closeButton = card.getByRole("button", { name: "サムネイルに戻す" });
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(card.locator(".thumb iframe")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "「Manual Song」を再生" })).toBeFocused();

    // Space でも再生できる。
    await page.keyboard.press("Space");
    await expect(card.locator(".thumb iframe")).toHaveCount(1);
});

test("after a video is closed with the keyboard, showing more results keeps focus on the play button", async ({ page }) => {
    // 続きを表示できるよう、最初に出す件数より多い曲を用意する。
    await routeSongsJsonFixture(page, createScrollableResultSongs(120));
    await page.reload();
    await waitForInitialLoad(page);
    await enablePlaybackSettings(page);
    await closeSidebar(page);
    await filterBySongTitle(page, "Scroll Song");
    const cards = page.locator("#resultList > .song-card");
    const card = getSongCard(page, "Scroll Song 01");
    const playButton = card.getByRole("button", { name: "「Scroll Song 01」を再生" });
    await page.locator("#searchBox").focus();
    await pressTabUntilFocused(page, playButton);

    await page.keyboard.press("Enter");
    await waitForMockYoutube(page);
    await expect(card.locator(".thumb iframe")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(card.locator(".thumb iframe")).toHaveCount(0);
    await expect(playButton).toBeFocused();

    // PageDown で末尾へ進み、続きの曲を表示させる。表示済みのカードにも曲情報を反映し直す。
    const shownCount = await cards.count();
    await expect.poll(async () => {
        await page.keyboard.press("PageDown");
        return cards.count();
    }).toBeGreaterThan(shownCount);

    // 再生ボタンを作り直すと、フォーカスがページへ落ち、次の Tab が同じ再生ボタンへ戻ってしまう。
    await expect(playButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(card.locator("a.title-link")).toBeFocused();

    // 使い続けた再生ボタンから、もう一度再生できる。
    await playButton.focus();
    await page.keyboard.press("Enter");
    await expect(card.locator(".thumb iframe")).toHaveCount(1);
});

test("the play button is named in the page language", async ({ page }) => {
    await enablePlaybackSettings(page);
    await closeSidebar(page);
    await filterBySongTitle(page, "Manual Song");
    const card = getSongCard(page, "Manual Song");
    await expect(card.locator(".thumb-play-btn")).toHaveAttribute("aria-label", "「Manual Song」を再生");

    await page.locator("#site-language-btn").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(card.locator(".thumb-play-btn")).toHaveAttribute("aria-label", "Play “Manual Song”");
});

test("the result count is announced as a status when the results change", async ({ page }) => {
    const resultCount = page.getByRole("status").filter({ hasText: /おすすめ|件がヒット/ });
    await expect(resultCount).toHaveText("おすすめを表示中");
    await filterBySongTitle(page, "Manual Song");
    await expect(resultCount).toHaveText("1 件がヒット");
});
