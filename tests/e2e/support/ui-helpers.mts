import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 初期データ読み込み完了まで待機する。
 */
export async function waitForInitialLoad(page: Page) {
    await expect(page.locator("#searchBox")).toBeEnabled();
    await expect(page.locator("#resultCount")).not.toHaveText("接続中...");
}

/**
 * 指定フォームコントロールを囲む label を返す。
 */
export function getControlLabel(page: Page, selector: string) {
    return page.locator(selector).locator("xpath=ancestor::label[1]");
}

/**
 * 指定フォームコントロールの label をクリックする。
 */
export async function clickControlLabel(page: Page, selector: string) {
    const controlLabel = getControlLabel(page, selector);
    await expect(controlLabel).toBeVisible();
    await controlLabel.click();
}

/**
 * 検索サイドバーを開く。
 */
export async function openSidebar(page: Page) {
    await page.locator("#open-sidebar").click();
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("#open-sidebar")).toHaveAttribute("aria-expanded", "true");
}

/**
 * サイドバーの設定パネルを開く。
 */
export async function openSettingsPanel(page: Page) {
    await openSidebar(page);
    await page.locator("#open-settings-panel").click();
    await expect(page.locator("#settings-sidebar-panel")).toBeVisible();
}

/**
 * 検索サイドバーを閉じて結果一覧へ戻る。
 */
export async function closeSidebar(page: Page) {
    await page.locator("#close-sidebar").click();
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#open-sidebar")).toHaveAttribute("aria-expanded", "false");
}

/**
 * サイドバーが開いていれば閉じる。開いている間はヘッダーの検索窓が inert になる。
 */
export async function closeSidebarIfOpen(page: Page) {
    if (await page.locator("#sidebar").getAttribute("aria-hidden") === "false") {
        await closeSidebar(page);
    }
}

/**
 * サイドバー popover の backdrop 領域をクリックする。
 */
export async function clickSidebarBackdrop(page: Page) {
    await page.mouse.click(20, 100);
}

/**
 * サイドバー popover が開き、背面が inert になっていることを確認する。
 */
export async function expectSidebarPopoverOpen(page: Page) {
    const sidebar = page.locator("#sidebar");
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("#open-sidebar")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".main-content")).toHaveAttribute("inert", "");
    await expect
        .poll(() => sidebar.evaluate((element) => element.matches(":popover-open")))
        .toBe(true);
}

/**
 * サイドバー popover が閉じ、背面の inert が解除されていることを確認する。
 */
export async function expectSidebarPopoverClosed(page: Page) {
    const sidebar = page.locator("#sidebar");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#open-sidebar")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".main-content")).not.toHaveAttribute("inert", "");
    await expect
        .poll(() => sidebar.evaluate((element) => element.matches(":popover-open")))
        .toBe(false);
}

/**
 * 指定の設定トグルを必要時だけ ON にする。
 */
export async function ensureToggleEnabled(page: Page, selector: string) {
    const toggle = page.locator(selector);
    const switchLabel = getControlLabel(page, selector);
    await expect(switchLabel).toBeVisible();
    if (await toggle.isChecked()) return;
    await switchLabel.click();
}

/**
 * 再生設定を有効化する。
 */
export async function enablePlaybackSettings(page: Page, options?: { continuousPlayback?: boolean }) {
    const settings = options || {};
    await openSettingsPanel(page);
    await ensureToggleEnabled(page, "#thumbnail-toggle");
    if (settings.continuousPlayback) {
        await page.evaluate(() => {
            if (!window.knkPlaybackSettings) throw new Error("Playback settings API is unavailable");
            window.knkPlaybackSettings.setExperimentalPlaybackSettings(true);
        });
        await expect(page.locator("#experimental-playback-settings")).toBeVisible();
        await ensureToggleEnabled(page, "#continuous-playback-toggle");
    }
    await page.locator("#close-settings-panel").click();
    await expect(page.locator("#open-settings-panel")).toBeVisible();
}

/**
 * サイドバーを閉じた状態で、ヘッダーの検索窓から曲タイトルで結果を絞り込む。
 */
export async function filterBySongTitle(page: Page, query: string) {
    await closeSidebarIfOpen(page);
    await page.locator("#searchBox").fill(query);
    await expect(page.locator("#searchBox")).toHaveValue(query);
}

/**
 * 利用者と同じく検索窓を押して検索語を入力し、フォーカスを残したまま結果が出るまで待つ。
 * テスト都合でフォーカスを外さず、入力からそのまま次の操作へ進む流れを確かめるときに使う。
 * @param page 操作するページ
 * @param query 入力する検索語
 * @param pressSearchBox 検索窓を押す操作。省略するとクリックする。タッチ画面ではタップを渡す
 */
export async function typeSearchQueryKeepingFocus(
    page: Page,
    query: string,
    pressSearchBox: (searchBox: Locator) => Promise<void> = (searchBox) => searchBox.click()
) {
    const searchBox = page.locator("#searchBox");
    await pressSearchBox(searchBox);
    await page.keyboard.type(query);
    await expect(page.locator(".song-card")).not.toHaveCount(0);
    await expect(searchBox).toBeFocused();
}

/**
 * タイトルを含む結果カードを返す。
 */
export function getSongCard(page: Page, title: string) {
    return page.locator(".song-card").filter({ hasText: title });
}

/**
 * 指定した曲カードからブックマークを作成する。
 */
export async function createBookmarkFromSong(page: Page, { bookmarkName, songTitle }: { bookmarkName: string; songTitle: string }) {
    await closeSidebarIfOpen(page);
    await page.locator("#searchBox").fill(songTitle);
    await expect(page.locator("#searchBox")).toHaveValue(songTitle);

    const songCard = getSongCard(page, songTitle);
    await expect(songCard).toBeVisible();

    await songCard.locator(".add-to-bookmark-btn").click();
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();
    await page.locator("#bookmark-panel-new-name").fill(bookmarkName);
    await page.locator("#bookmark-panel-create-btn").click();
}

/**
 * 指定名のブックマーク項目を返す。
 */
export function getBookmarkItem(page: Page, bookmarkName: string) {
    return page.locator(".bookmark-item").filter({ hasText: bookmarkName });
}

/**
 * ブックマーク通知 toast の文言と popover 表示を確認する。
 */
export async function expectBookmarkToast(page: Page, message: string) {
    const toast = page.locator(".bookmark-toast");
    await expect(toast.locator(".bookmark-toast-message")).toHaveText(message);
    await expect
        .poll(() => toast.evaluate((element) => element.matches(":popover-open")))
        .toBe(true);
    return toast;
}

/**
 * ブックマーク管理パネルを開く。曲の追加後などでサイドバーが閉じていれば先に開く。
 */
export async function openBookmarkPanel(page: Page) {
    if (await page.locator("#sidebar").getAttribute("aria-hidden") !== "false") {
        await openSidebar(page);
    }
    await page.locator("#open-bookmark-panel").click();
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();
}

/**
 * 対象の要素にフォーカスが届くまで Tab キーを押し、キーボードだけで到達できることを確かめる。
 * @param page 操作するページ
 * @param target フォーカスを届かせたい要素
 * @param maxPresses 到達を諦めるまでに押す Tab の回数
 */
export async function pressTabUntilFocused(page: Page, target: Locator, maxPresses = 12) {
    for (let pressCount = 0; pressCount < maxPresses; pressCount += 1) {
        if (await target.evaluate((element) => element === document.activeElement)) return;
        await page.keyboard.press("Tab");
    }
    await expect(target).toBeFocused();
}
