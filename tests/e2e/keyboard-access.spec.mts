import { test, expect } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { waitForMockYoutube } from "./support/mock-youtube.mts";
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
