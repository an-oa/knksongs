import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { waitForMockYoutube } from "./support/mock-youtube.mts";
import {
    closeSidebar,
    createBookmarkFromSong,
    enablePlaybackSettings,
    filterBySongTitle,
    getBookmarkItem,
    getSongCard,
    openBookmarkPanel,
    openSidebar,
    waitForInitialLoad
} from "./support/ui-helpers.mts";

/**
 * 今の画面を axe で検査し、違反した規則と要素を返す。
 * 規則は絞らず、WCAG の達成基準と best-practice の両方を見る。
 * axe が判定できなかった項目 (incomplete) は違反に数えない。疑似要素の背景に重なる文字のコントラストなどが当たる。
 * @param page 検査するページ
 * @returns 違反した規則の id と、対象の要素のセレクター
 */
async function findAccessibilityViolations(page: Page) {
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations.map((violation) => ({
        rule: violation.id,
        elements: violation.nodes.map((node) => node.target.join(" "))
    }));
}

/**
 * 今の画面に axe の違反がないことを確かめる。
 * @param page 検査するページ
 * @param screen 失敗したときに出す画面の名前
 */
async function expectNoAccessibilityViolations(page: Page, screen: string) {
    await test.step(`axe: ${screen}`, async () => {
        expect(await findAccessibilityViolations(page), `accessibility violations on: ${screen}`).toEqual([]);
    });
}

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

for (const { colorScheme, locale, songTitle } of [
    { colorScheme: "light", locale: "ja-JP", songTitle: "Manual Song" },
    { colorScheme: "dark", locale: "en-US", songTitle: "Manual Song" }
] as const) {
    test.describe(`${colorScheme} theme, ${locale}`, () => {
        test.use({ colorScheme, locale });

        test("axe finds no accessibility violations on the main screens", async ({ page }) => {
            // 画面ごとに axe を動かすので、既定の制限時間より長くかかる。
            test.slow();
            await page.goto("/");
            await waitForInitialLoad(page);
            if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/dark-theme/);
            await expect(page.locator("html")).toHaveAttribute("lang", locale === "en-US" ? "en" : "ja");
            await expectNoAccessibilityViolations(page, "results");

            await filterBySongTitle(page, "no-such-song-for-the-accessibility-check");
            await expect(page.locator("#resultList .song-card")).toHaveCount(0);
            await expectNoAccessibilityViolations(page, "no results");
            await filterBySongTitle(page, "");

            await openSidebar(page);
            await expectNoAccessibilityViolations(page, "filters and settings");
            await page.locator("#open-settings-panel").click();
            await expect(page.locator("#settings-sidebar-panel")).toBeVisible();
            await expectNoAccessibilityViolations(page, "settings panel");
            await page.locator("#close-settings-panel").click();
            await closeSidebar(page);

            // サムネイルを出し、動画を再生している状態も検査する。
            await enablePlaybackSettings(page);
            await closeSidebar(page);
            await filterBySongTitle(page, songTitle);
            const card = getSongCard(page, songTitle);
            await expect(card.locator(".thumb-play-btn")).toBeVisible();
            await expectNoAccessibilityViolations(page, "results with thumbnails");
            await card.locator(".thumb-play-btn").click();
            await waitForMockYoutube(page);
            await expect(card.locator(".thumb iframe")).toHaveCount(1);
            await expectNoAccessibilityViolations(page, "playing a video");
            await card.locator(".thumb-close-btn").click();
            await expect(card.locator(".thumb iframe")).toHaveCount(0);

            // ブックマークの追加・管理・表示。
            await createBookmarkFromSong(page, { bookmarkName: "Morning", songTitle });
            await expect(page.locator(".bookmark-toast")).toBeVisible();
            await expectNoAccessibilityViolations(page, "toast after adding a song to a bookmark");
            await openBookmarkPanel(page);
            const bookmarkItem = getBookmarkItem(page, "Morning");
            await expect(bookmarkItem).toBeVisible();
            await expectNoAccessibilityViolations(page, "bookmark panel");

            // 名前の変更と削除のボタンは、ポインターを載せるかフォーカスしたときに押せるようになる。キーボードで開く。
            await bookmarkItem.locator(".bookmark-rename-btn").focus();
            await page.keyboard.press("Enter");
            await expect(page.locator("#bookmark-prompt-dialog")).toBeVisible();
            await expectNoAccessibilityViolations(page, "rename dialog");
            await page.keyboard.press("Escape");
            await expect(page.locator("#bookmark-prompt-dialog")).toBeHidden();

            await bookmarkItem.locator(".bookmark-delete-btn").focus();
            await page.keyboard.press("Enter");
            await expect(page.locator("#bookmark-prompt-dialog")).toBeVisible();
            await expectNoAccessibilityViolations(page, "delete confirmation dialog");
            await page.keyboard.press("Escape");
            await expect(page.locator("#bookmark-prompt-dialog")).toBeHidden();

            await page.locator("#bookmark-panel-export-btn").click();
            await expect(page.locator("#bookmark-transfer-dialog")).toBeVisible();
            await expectNoAccessibilityViolations(page, "export dialog");
            await page.keyboard.press("Escape");
            await expect(page.locator("#bookmark-transfer-dialog")).toBeHidden();

            // インポートのダイアログは、ファイルを選んだ後に開く。同じ名前のブックマークを含め、上書きの表示も出す。
            await page.locator("#bookmark-panel-import-input").setInputFiles({
                name: "bookmarks.json",
                mimeType: "application/json",
                buffer: Buffer.from(JSON.stringify({
                    version: 3,
                    bookmarks: {
                        b1: { name: "Morning", songs: [], createdAt: 1 },
                        b2: { name: "Evening", songs: [], createdAt: 2 }
                    }
                }))
            });
            await expect(page.locator("#bookmark-transfer-dialog")).toBeVisible();
            await expectNoAccessibilityViolations(page, "import dialog");
            await page.keyboard.press("Escape");
            await expect(page.locator("#bookmark-transfer-dialog")).toBeHidden();

            // ブックマークを選び、ブックマークパネルの閉じるボタンで結果一覧へ戻る。
            await bookmarkItem.locator(".bookmark-item-select").click();
            await page.locator("#close-bookmark-sidebar").click();
            await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "true");
            await expect(page.locator("#resultList .song-card .remove-from-bookmark-btn")).toHaveCount(1);
            await expectNoAccessibilityViolations(page, "bookmark view with reorder handles");
        });
    });
}
