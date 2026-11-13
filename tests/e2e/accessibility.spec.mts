import { test, expect } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { waitForInitialLoad } from "./support/ui-helpers.mts";

test.beforeEach(async ({ page }) => {
    await installNetworkMocks(page);
});

test("the page is divided into banner, search, main, and footer landmarks", async ({ page }) => {
    await page.goto("/");
    await waitForInitialLoad(page);

    // header と footer は main の外に置き、ページ全体のランドマークとして読み上げ環境から移動できるようにする。
    const banner = page.getByRole("banner");
    const main = page.getByRole("main");
    const footer = page.getByRole("contentinfo");
    await expect(banner).toHaveCount(1);
    await expect(main).toHaveCount(1);
    await expect(footer).toHaveCount(1);
    await expect(banner.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(main.getByRole("heading", { level: 2, name: "検索結果" })).toHaveCount(1);
    await expect(main.locator("#resultList")).toHaveCount(1);
    await expect(footer).toContainText("本サイトは非公式のファンメイドです。");

    // 検索窓は search のランドマークに入れる。
    const search = page.getByRole("search");
    await expect(search).toHaveCount(1);
    await expect(search.getByRole("textbox", { name: "曲名・アーティスト名・読みで検索" })).toHaveCount(1);
    await expect(banner.getByRole("search")).toHaveCount(1);
});
