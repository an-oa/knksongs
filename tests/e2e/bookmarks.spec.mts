import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";
import { routeSongsJsonFixture } from "./support/songs-network.mts";
import {
    createBookmarkFromSong,
    expectBookmarkToast,
    getBookmarkItem,
    getSongCard,
    openBookmarkPanel,
    openSidebar,
    pressTabUntilFocused,
    waitForInitialLoad
} from "./support/ui-helpers.mts";
import { MAX_BOOKMARK_IMPORT_BYTES } from "../../app/lib/storage/bookmark-transfer.mts";

test.beforeEach(async ({ page }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await page.evaluate(() => {
        localStorage.clear();
    });
    await page.reload();
    await waitForInitialLoad(page);
});

/** テストで保存しておくブックマーク。曲参照は曲データにない文字列でもそのまま残る。 */
type StoredBookmarkFixture = Record<string, { name: string; songs: string[]; createdAt: number }>;

/**
 * 保存済みのブックマークを入れて読み込み直し、初期表示を待つ。
 * @param page 操作するページ
 * @param bookmarks 保存しておくブックマーク
 */
async function seedBookmarks(page: Page, bookmarks: StoredBookmarkFixture) {
    await page.evaluate((payload) => {
        localStorage.setItem("bookmarksV1", JSON.stringify(payload));
    }, { version: 3, bookmarks });
    await page.reload();
    await waitForInitialLoad(page);
}

/**
 * localStorage に保存されたブックマークの payload を返す。
 * @param page 操作するページ
 */
async function readStoredBookmarks(page: Page): Promise<unknown> {
    return JSON.parse(await page.evaluate(() => localStorage.getItem("bookmarksV1")) ?? "null");
}

/**
 * エクスポートのダイアログで決定し、ダウンロードされたファイルを読む。
 * 保存先を選ぶ画面はテストから操作できないため、ダウンロードでの保存に切り替える。
 * @param page 操作するページ
 * @param options すでにダイアログを開いている場合は dialogOpen を true にする
 */
async function exportBookmarksByDownload(page: Page, options?: { dialogOpen?: boolean }) {
    await page.evaluate(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }));
    if (!options?.dialogOpen) await page.locator("#bookmark-panel-export-btn").click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("dialog", { name: "ブックマークのエクスポート" })
        .getByRole("button", { name: "エクスポート", exact: true })
        .click();
    const path = await (await downloaded).path();
    if (!path) throw new Error("Bookmark download path is unavailable");
    const content = await readFile(path);
    return { path, byteLength: content.byteLength, text: content.toString("utf8") };
}

test("bookmark notification toast opens, closes, and auto-dismisses", async ({ page }) => {
    const bookmarkName = "Toast Check";
    await createBookmarkFromSong(page, {
        bookmarkName,
        songTitle: "Manual Song"
    });

    const createToast = await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」を作成し、「Manual Song」を保存しました。`
    );

    await createToast.locator(".bookmark-toast-close").click();
    await expect(createToast).toHaveCount(0);

    await openBookmarkPanel(page);
    await getBookmarkItem(page, bookmarkName).click();
    await page.locator("#close-bookmark-sidebar").click();
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#open-sidebar")).toHaveAttribute("aria-expanded", "false");

    const activeBookmarkCard = getSongCard(page, "Manual Song");
    await expect(activeBookmarkCard.locator(".remove-from-bookmark-btn")).toBeVisible();
    await activeBookmarkCard.locator(".remove-from-bookmark-btn").click();

    const removeToast = await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」から「Manual Song」を削除しました。`
    );
    await expect(removeToast).toHaveCount(0, { timeout: 6_000 });
});

test("active bookmark persists across reload", async ({ page }) => {
    const bookmarkName = "Reload Favorites";
    await createBookmarkFromSong(page, {
        bookmarkName,
        songTitle: "Manual Song"
    });

    const createToast = await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」を作成し、「Manual Song」を保存しました。`
    );
    await createToast.locator(".bookmark-toast-close").click();

    await openBookmarkPanel(page);
    const bookmarkItem = getBookmarkItem(page, bookmarkName);
    await bookmarkItem.click();
    await expect(bookmarkItem).toHaveClass(/active/);
    await expect(page.locator("#resultCount")).toHaveText(`ブックマーク: ${bookmarkName} (1 件)`);
    await expect.poll(() => page.evaluate(() => {
        const text = localStorage.getItem("searchStateV1");
        if (text === null) return null;
        const state: unknown = JSON.parse(text);
        return state !== null && typeof state === "object" && "activeBookmarkId" in state
            ? state.activeBookmarkId : null;
    })).toBeTruthy();

    await page.reload();
    await waitForInitialLoad(page);

    await expect(page.locator("#resultCount")).toHaveText(`ブックマーク: ${bookmarkName} (1 件)`);
    await openSidebar(page);
    await openBookmarkPanel(page);
    await expect(getBookmarkItem(page, bookmarkName)).toHaveClass(/active/);
});

test("bookmarks saved with older song references open the same songs and are rewritten to the current keys", async ({ page }) => {
    const songs = createScrollableResultSongs(4);
    await routeSongsJsonFixture(page, songs);
    // 旧形式の保存内容。version 3 より前は、曲を archiveId と歌唱順で指していた。
    await page.evaluate((payload) => {
        localStorage.setItem("bookmarksV1", JSON.stringify(payload));
    }, {
        version: 1,
        bookmarks: {
            p_1: {
                name: "Old Favorites",
                songs: [
                    // 最初期の形式。archiveId と歌唱順の後ろに、保存した当時の URL が付く。
                    `${songs[2].archiveId}::${songs[2].archiveOrder}::${songs[2].url}`,
                    // 保存した後に曲データの URL が変わっていても、同じ曲を指す。
                    `${songs[0].archiveId}::${songs[0].archiveOrder}::https://www.youtube.com/watch?v=${songs[0].videoId}&t=999s`,
                    // その次の形式。archiveId と歌唱順だけ。
                    `${songs[1].archiveId}::${songs[1].archiveOrder}`
                ],
                createdAt: 1
            }
        }
    });
    await page.reload();
    await waitForInitialLoad(page);

    // 読み込んだ時点で、今の曲キー (videoId と歌唱順) へ書き換えて保存する。
    await expect.poll(() => readStoredBookmarks(page)).toEqual({
        version: 3,
        bookmarks: {
            p_1: {
                name: "Old Favorites",
                songs: [songs[2].songKey, songs[0].songKey, songs[1].songKey],
                createdAt: 1
            }
        }
    });

    await openBookmarkPanel(page);
    await getBookmarkItem(page, "Old Favorites").click();
    await expect(page.locator("#resultCount")).toHaveText("ブックマーク: Old Favorites (3 件)");
    await expect(page.locator("#resultList > .song-card .title")).toHaveText([
        "Scroll Song 03",
        "Scroll Song 01",
        "Scroll Song 02"
    ]);
});

test("keyboard selects and clears a bookmark while keeping focus on it", async ({ page }) => {
    const bookmarkName = "Keyboard Select";
    await createBookmarkFromSong(page, {
        bookmarkName,
        songTitle: "Manual Song"
    });
    const createToast = await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」を作成し、「Manual Song」を保存しました。`
    );
    await createToast.locator(".bookmark-toast-close").click();

    await openBookmarkPanel(page);
    const bookmarkItem = getBookmarkItem(page, bookmarkName);
    const selectButton = bookmarkItem.locator(".bookmark-item-select");
    await pressTabUntilFocused(page, selectButton);

    await page.keyboard.press("Enter");
    await expect(bookmarkItem).toHaveClass(/active/);
    await expect(selectButton).toHaveAttribute("aria-pressed", "true");
    await expect(selectButton).toBeFocused();
    await expect(page.locator("#resultCount")).toHaveText(`ブックマーク: ${bookmarkName} (1 件)`);

    await page.keyboard.press("Space");
    await expect(bookmarkItem).not.toHaveClass(/active/);
    await expect(selectButton).toHaveAttribute("aria-pressed", "false");
    await expect(selectButton).toBeFocused();
});

test("keyboard adds a song to an existing bookmark and returns focus to the card", async ({ page }) => {
    const bookmarkName = "Keyboard Add";
    await createBookmarkFromSong(page, {
        bookmarkName,
        songTitle: "Manual Song"
    });
    const createToast = await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」を作成し、「Manual Song」を保存しました。`
    );
    // 作成と同時の追加でも、カードから開いたサイドバーを閉じて + ボタンへ戻る。
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "true");
    await expect(getSongCard(page, "Manual Song").locator(".add-to-bookmark-btn")).toBeFocused();
    await createToast.locator(".bookmark-toast-close").click();

    await page.locator("#searchBox").fill("Replay Song");
    const addButton = getSongCard(page, "Replay Song").locator(".add-to-bookmark-btn");
    await expect(addButton).toBeVisible();
    await addButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();

    const selectButton = getBookmarkItem(page, bookmarkName).locator(".bookmark-item-select");
    await pressTabUntilFocused(page, selectButton);
    await page.keyboard.press("Enter");

    await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」に「Replay Song」を保存しました。`
    );
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "true");
    await expect(addButton).toBeFocused();
});

test("bookmark deletion toast shows the deleted bookmark name", async ({ page }) => {
    const bookmarkName = "Delete Toast";
    await createBookmarkFromSong(page, {
        bookmarkName,
        songTitle: "Manual Song"
    });

    const createToast = await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」を作成し、「Manual Song」を保存しました。`
    );
    await createToast.locator(".bookmark-toast-close").click();
    await expect(createToast).toHaveCount(0);

    await openBookmarkPanel(page);

    const bookmarkItem = getBookmarkItem(page, bookmarkName);
    await expect(bookmarkItem).toBeVisible();
    await bookmarkItem.hover();
    await expect(bookmarkItem.locator(".bookmark-delete-btn")).toHaveCSS("pointer-events", "auto");

    await bookmarkItem.locator(".bookmark-delete-btn").click();
    // 削除はページ内のダイアログで確かめる。今ある内容を消す操作なので、最初のフォーカスは取り消しに置く。
    const confirmDialog = page.getByRole("dialog", { name: "ブックマークの削除" });
    await expect(confirmDialog.locator("#bookmark-prompt-message")).toHaveText(`ブックマーク「${bookmarkName}」を削除しますか？`);
    await expect(confirmDialog.getByRole("button", { name: "キャンセル" })).toBeFocused();
    await confirmDialog.getByRole("button", { name: "削除", exact: true }).click();
    await expect(confirmDialog).toBeHidden();

    await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」を削除しました。`
    );
    await expect(bookmarkItem).toHaveCount(0);
    // 削除した項目のボタンは消えるので、フォーカスをパネルの中の作成欄へ移す。
    await expect(page.locator("#bookmark-panel-new-name")).toBeFocused();
});

test("renaming and deleting use in-page dialogs that Escape closes without closing the bookmark panel", async ({ page }) => {
    await seedBookmarks(page, {
        p_1: { name: "Morning Set", songs: [], createdAt: 1 },
        p_2: { name: "Evening Set", songs: [], createdAt: 2 }
    });
    const nativeDialogs: string[] = [];
    page.on("dialog", async (dialog) => {
        nativeDialogs.push(dialog.type());
        await dialog.dismiss();
    });
    await openBookmarkPanel(page);
    const morningItem = getBookmarkItem(page, "Morning Set");
    const renameButton = morningItem.getByRole("button", { name: "ブックマーク名を変更" });

    // キーボードだけで、名前の変更を開き、入力して Enter で確定する。
    await renameButton.focus();
    await page.keyboard.press("Enter");
    const renameDialog = page.getByRole("dialog", { name: "ブックマーク名の変更" });
    const nameInput = renameDialog.getByRole("textbox", { name: "新しいブックマーク名を入力してください。" });
    await expect(nameInput).toBeFocused();
    await expect(nameInput).toHaveValue("Morning Set");

    // 空の名前では閉じず、理由をダイアログの中に出す。
    await nameInput.fill("   ");
    await page.keyboard.press("Enter");
    await expect(renameDialog.locator("#bookmark-prompt-status")).toHaveText("ブックマーク名を入力してください。");
    await expect(renameDialog).toBeVisible();
    await expect(nameInput).toBeFocused();

    await nameInput.fill("Daybreak Set");
    await page.keyboard.press("Enter");
    await expect(renameDialog).toBeHidden();
    const renamedItem = getBookmarkItem(page, "Daybreak Set");
    await expect(renamedItem).toBeVisible();
    await expect(getBookmarkItem(page, "Morning Set")).toHaveCount(0);
    // 一覧は作り直すが、フォーカスは同じブックマークの同じボタンへ戻す。
    await expect(renamedItem.getByRole("button", { name: "ブックマーク名を変更" })).toBeFocused();
    expect(await readStoredBookmarks(page)).toEqual({
        version: 3,
        bookmarks: {
            p_1: { name: "Daybreak Set", songs: [], createdAt: 1 },
            p_2: { name: "Evening Set", songs: [], createdAt: 2 }
        }
    });

    // Esc はダイアログだけを閉じ、ブックマークパネルとサイドバーは開いたままにする。
    const deleteButton = renamedItem.getByRole("button", { name: "ブックマークを削除" });
    await deleteButton.focus();
    await page.keyboard.press("Enter");
    const deleteDialog = page.getByRole("dialog", { name: "ブックマークの削除" });
    await expect(deleteDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(deleteDialog).toBeHidden();
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "false");
    await expect(renamedItem).toBeVisible();
    await expect(deleteButton).toBeFocused();

    expect(nativeDialogs, "the browser's own prompt, confirm, and alert are not used").toEqual([]);
});

test("Escape that cancels a kana-kanji conversion keeps the rename dialog and the typed name", async ({ page, browserName }) => {
    // かな漢字変換の途中の状態は、Chromium の開発者向けの通信 (CDP) でしか作れない。
    test.skip(browserName !== "chromium", "an IME conversion can only be simulated through CDP");
    await seedBookmarks(page, { p_1: { name: "Morning Set", songs: [], createdAt: 1 } });
    await openBookmarkPanel(page);
    await getBookmarkItem(page, "Morning Set").getByRole("button", { name: "ブックマーク名を変更" }).focus();
    await page.keyboard.press("Enter");
    const renameDialog = page.getByRole("dialog", { name: "ブックマーク名の変更" });
    const nameInput = renameDialog.getByRole("textbox", { name: "新しいブックマーク名を入力してください。" });
    await nameInput.fill("あさの");

    // 「きょく」を変換している途中で、変換を取り消すつもりで Esc を押す。
    const ime = await page.context().newCDPSession(page);
    await ime.send("Input.imeSetComposition", { text: "きょく", selectionStart: 3, selectionEnd: 3 });
    await page.keyboard.press("Escape");
    await expect(renameDialog).toBeVisible();
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();

    // 変換を確定した後は、入力した名前が残っていて、Esc でダイアログだけが閉じる。
    await ime.send("Input.insertText", { text: "曲" });
    await expect(nameInput).toHaveValue("あさの曲");
    await page.keyboard.press("Escape");
    await expect(renameDialog).toBeHidden();
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();
    await expect(getBookmarkItem(page, "Morning Set")).toBeVisible();
});

test("a failed bookmark action is reported in a toast instead of a blocking alert", async ({ page }) => {
    await seedBookmarks(page, { p_1: { name: "Morning Set", songs: [], createdAt: 1 } });
    const nativeDialogs: string[] = [];
    page.on("dialog", async (dialog) => {
        nativeDialogs.push(dialog.type());
        await dialog.dismiss();
    });
    // 別のタブがブックマークを書き換えた状態にする。保存の直前の検査で見つかる。
    await page.evaluate(() => {
        localStorage.setItem("bookmarksV1", JSON.stringify({
            version: 3,
            bookmarks: { p_9: { name: "Other Tab", songs: [], createdAt: 9 } }
        }));
    });

    await page.locator("#searchBox").fill("Manual Song");
    await getSongCard(page, "Manual Song").locator(".add-to-bookmark-btn").click();
    await getBookmarkItem(page, "Morning Set").click();

    const errorToast = page.locator(".bookmark-toast-error");
    await expect(errorToast).toHaveAttribute("role", "alert");
    await expect(errorToast.locator(".bookmark-toast-message")).toHaveText(
        "別のタブでブックマークが更新された可能性があります。画面を再読み込みしてから、もう一度お試しください。"
    );
    // 通知は操作を止めないので、追加先を選ぶパネルは開いたまま続けられる。
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();
    expect(nativeDialogs).toEqual([]);
});

test("the edit button fits beside the song count in Japanese and English", async ({ page }) => {
    const labels = [
        { language: "ja", text: "変更", name: "ブックマーク名を変更" },
        { language: "en", text: "Edit", name: "Edit bookmark name" }
    ];
    for (const label of labels) {
        await page.evaluate((language) => localStorage.setItem("siteLanguage", language), label.language);
        await seedBookmarks(page, {
            p_1: {
                name: "とても長いブックマークの名前がここに入ります",
                songs: Array.from({ length: 128 }, (_, index) => `song-${index}`),
                createdAt: 1
            }
        });
        await openBookmarkPanel(page);

        const bookmarkItem = page.locator(".bookmark-item");
        await bookmarkItem.hover();
        const editButton = bookmarkItem.locator(".bookmark-rename-btn");
        await expect(editButton).toHaveCSS("pointer-events", "auto");
        await expect(editButton).toHaveText(label.text);
        await expect(editButton).toHaveAccessibleName(label.name);

        const layout = await bookmarkItem.evaluate((item) => {
            /** 一覧項目内の要素の左右の端を返す。 */
            const readEdges = (selector: string) => {
                const rect = item.querySelector(selector)?.getBoundingClientRect();
                return { left: rect?.left ?? Number.NaN, right: rect?.right ?? Number.NaN };
            };
            const range = document.createRange();
            range.selectNodeContents(item.querySelector(".bookmark-rename-btn") ?? item);
            const text = range.getBoundingClientRect();
            return {
                count: readEdges(".bookmark-item-count"),
                button: readEdges(".bookmark-rename-btn"),
                text: { left: text.left, right: text.right },
                deleteButton: readEdges(".bookmark-delete-btn")
            };
        });
        const message = `${label.language}: ${JSON.stringify(layout)}`;
        expect(layout.text.left, message).toBeGreaterThanOrEqual(layout.button.left);
        expect(layout.text.right, message).toBeLessThanOrEqual(layout.button.right);
        expect(layout.button.left, message).toBeGreaterThanOrEqual(layout.count.right);
        expect(layout.button.right, message).toBeLessThanOrEqual(layout.deleteButton.left);
    }
});

test("oversized bookmark imports are rejected before reading and preserve existing bookmarks", async ({ page }) => {
    const bookmarkName = "Keep Favorites";
    await createBookmarkFromSong(page, { bookmarkName, songTitle: "Manual Song" });
    await openBookmarkPanel(page);
    const previousStored = await page.evaluate(() => localStorage.getItem("bookmarksV1"));
    await page.evaluate(() => {
        File.prototype.text = async function () {
            throw new Error("Oversized bookmark file must not be read");
        };
    });

    await page.locator("#bookmark-panel-import-input").setInputFiles({
        name: "oversized.json",
        mimeType: "application/json",
        buffer: Buffer.alloc(MAX_BOOKMARK_IMPORT_BYTES + 1, " ")
    });

    await expect(page.locator("#bookmark-panel-error")).toHaveText("インポートできるファイルは最大1 MBです。");
    await expect(getBookmarkItem(page, bookmarkName)).toBeVisible();
    await expect(page.locator("#bookmark-panel-import-input")).toHaveValue("");
    expect(await page.evaluate(() => localStorage.getItem("bookmarksV1"))).toBe(previousStored);
});

test("bookmarks at the file size limit can be exported and imported again", async ({ page }) => {
    await openSidebar(page);
    await openBookmarkPanel(page);
    const payload = { version: 3, bookmarks: { b1: { name: "Boundary Favorites", songs: [""], createdAt: 1 } } };
    payload.bookmarks.b1.songs = ["x".repeat(MAX_BOOKMARK_IMPORT_BYTES - Buffer.byteLength(JSON.stringify(payload)))];
    const buffer = Buffer.from(JSON.stringify(payload));
    expect(buffer.byteLength).toBe(MAX_BOOKMARK_IMPORT_BYTES);
    await page.locator("#bookmark-panel-import-input").setInputFiles({ name: "boundary.json", mimeType: "application/json", buffer });
    const importDialog = page.getByRole("dialog", { name: "ブックマークのインポート" });
    await importDialog.getByRole("button", { name: "インポート", exact: true }).click();
    await expect(getBookmarkItem(page, "Boundary Favorites")).toBeVisible();
    await expect(page.locator("#bookmark-panel-error")).toBeHidden();
    const exported = await exportBookmarksByDownload(page);
    expect(exported.byteLength).toBeLessThanOrEqual(MAX_BOOKMARK_IMPORT_BYTES);
    expect(JSON.parse(exported.text)).toEqual(payload);

    await page.locator("#bookmark-panel-import-input").setInputFiles(exported.path);
    // 中身が同じなので追加・上書きの対象はなく、ブックマーク全体の置換で読み込み直す。
    await expect(importDialog.getByRole("checkbox", { name: /Boundary Favorites/ })).toBeDisabled();
    await importDialog.getByRole("button", { name: "取り込み方を選ぶ" }).click();
    await importDialog.getByRole("menuitemradio", { name: /ブックマーク全体を置換/ }).click();
    await importDialog.getByRole("button", { name: "置換", exact: true }).click();
    await page.getByRole("dialog", { name: "ブックマーク全体の置換" }).getByRole("button", { name: "置換", exact: true }).click();
    await expect(importDialog).toBeHidden();
    await expect(page.locator("#bookmark-panel-import-input")).toHaveValue("");
    await expect(page.locator("#bookmark-panel-error")).toBeHidden();
    expect(await readStoredBookmarks(page)).toEqual(payload);
});

test("exporting writes only the bookmarks chosen in the dialog", async ({ page }) => {
    await seedBookmarks(page, {
        p_1: { name: "Morning Set", songs: ["ref-a", "ref-b"], createdAt: 1 },
        p_2: { name: "Night Set", songs: ["ref-c"], createdAt: 2 }
    });
    await openBookmarkPanel(page);
    await page.locator("#bookmark-panel-export-btn").click();

    const dialog = page.getByRole("dialog", { name: "ブックマークのエクスポート" });
    await expect(dialog.locator("#bookmark-transfer-select-all")).toBeFocused();
    await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("2件を選択中");
    await dialog.getByRole("checkbox", { name: /Morning Set/ }).uncheck();
    await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("1件を選択中");
    const exported = await exportBookmarksByDownload(page, { dialogOpen: true });

    expect(JSON.parse(exported.text)).toEqual({
        version: 3,
        bookmarks: { p_2: { name: "Night Set", songs: ["ref-c"], createdAt: 2 } }
    });
    await expect(dialog).toBeHidden();
    await expect(page.locator("#bookmark-panel-export-btn")).toBeFocused();
});

test("Escape closes only the bookmark transfer dialog", async ({ page }) => {
    await seedBookmarks(page, { p_1: { name: "Morning Set", songs: ["ref-a"], createdAt: 1 } });
    await openBookmarkPanel(page);
    await page.locator("#bookmark-panel-export-btn").click();
    const dialog = page.getByRole("dialog", { name: "ブックマークのエクスポート" });
    await expect(dialog).toBeVisible();
    // フォーカスできない見出しを押した後も、Esc はダイアログだけを閉じる。
    await dialog.locator("#bookmark-transfer-title").click();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();
    await expect(page.locator("#bookmark-panel-export-btn")).toBeFocused();
});

test("importing chosen bookmarks adds new IDs and overwrites the same ID after showing the difference", async ({ page }) => {
    await seedBookmarks(page, {
        p_1: { name: "Shared Set", songs: ["ref-a", "ref-b"], createdAt: 1 },
        p_2: { name: "Kept Set", songs: ["ref-c"], createdAt: 2 }
    });
    await openBookmarkPanel(page);
    const file = {
        version: 3,
        bookmarks: {
            p_1: { name: "Shared Set", songs: ["ref-b", "ref-d", "ref-e"], createdAt: 1 },
            p_2: { name: "Kept Set", songs: ["ref-c"], createdAt: 2 },
            p_3: { name: "Friend Set", songs: ["ref-f"], createdAt: 3 }
        }
    };
    await page.locator("#bookmark-panel-import-input").setInputFiles({
        name: "friend.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(file))
    });

    const dialog = page.getByRole("dialog", { name: "ブックマークのインポート" });
    const sharedOption = dialog.locator(".bookmark-transfer-option").filter({ hasText: "Shared Set" });
    await expect(sharedOption).toContainText("上書き");
    await expect(sharedOption).toContainText("3曲（2曲追加、1曲削除）");
    await expect(dialog.getByRole("checkbox", { name: /Kept Set/ })).toBeDisabled();
    await expect(dialog.getByRole("checkbox", { name: /Friend Set/ })).toBeChecked();
    await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("1件を追加・1件を上書き");
    await dialog.getByRole("button", { name: "インポート", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expectBookmarkToast(page, "ブックマークを1件追加し、1件上書きしました。");
    await expect(getBookmarkItem(page, "Friend Set")).toBeVisible();
    expect(await readStoredBookmarks(page)).toEqual(file);
});

test("the import menu switches to replacing every bookmark and back to the previous selection", async ({ page }) => {
    await seedBookmarks(page, {
        p_1: { name: "Shared Set", songs: ["ref-a", "ref-b"], createdAt: 1 },
        p_2: { name: "Kept Set", songs: ["ref-c"], createdAt: 2 }
    });
    await openBookmarkPanel(page);
    await page.locator("#bookmark-panel-import-input").setInputFiles({
        name: "friend.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
            version: 3,
            bookmarks: {
                p_1: { name: "Shared Set", songs: ["ref-b", "ref-d"], createdAt: 1 },
                p_3: { name: "Friend Set", songs: ["ref-f"], createdAt: 3 }
            }
        }))
    });
    const dialog = page.getByRole("dialog", { name: "ブックマークのインポート" });
    const friendCheckbox = dialog.getByRole("checkbox", { name: /Friend Set/ });
    const friendOption = dialog.locator(".bookmark-transfer-option").filter({ hasText: "Friend Set" });
    const sharedCheckbox = dialog.getByRole("checkbox", { name: /Shared Set/ });
    const submitButton = dialog.locator("#bookmark-transfer-submit");
    const menuButton = dialog.getByRole("button", { name: "取り込み方を選ぶ" });
    const menu = dialog.getByRole("menu");
    await friendCheckbox.uncheck();
    await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("1件を上書き");

    // キーボードでメニューを開くと、選んでいる取り込み方へフォーカスが移る。
    await menuButton.focus();
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible();
    await expect(dialog.getByRole("menuitemradio", { name: /選んだブックマークを取り込む/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("menuitemradio", { name: /ブックマーク全体を置換/ })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(menu).toBeHidden();
    await expect(submitButton).toHaveText("置換");
    await expect(submitButton).toBeFocused();
    await expect(dialog.locator(".bookmark-transfer-submit-group")).toHaveClass(/bookmark-transfer-submit-group-caution/);
    await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("今ある2件を削除し、ファイルの2件で置換します。");
    await expect(friendCheckbox).toBeChecked();
    await expect(friendCheckbox).toBeDisabled();
    await expect(sharedCheckbox).toBeDisabled();
    await expect(friendOption).toHaveClass(/bookmark-transfer-option-disabled/);

    // メニューを開いている間の Esc は、メニューだけを閉じる。
    await menuButton.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await dialog.getByRole("menuitemradio", { name: /選んだブックマークを取り込む/ }).click();
    await expect(submitButton).toHaveText("インポート");
    await expect(dialog.locator(".bookmark-transfer-submit-group")).not.toHaveClass(/bookmark-transfer-submit-group-caution/);
    await expect(friendCheckbox).not.toBeChecked();
    await expect(friendCheckbox).toBeEnabled();
    await expect(friendOption).not.toHaveClass(/bookmark-transfer-option-disabled/);
    await expect(sharedCheckbox).toBeChecked();
    await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("1件を上書き");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator("#bookmark-sidebar-panel")).toBeVisible();
});

/** 失敗と辞退のテストで、手元にある1件。 */
const KEPT_BOOKMARKS = { p_1: { name: "Kept Set", songs: ["ref-a"], createdAt: 1 } };

/** 失敗と辞退のテストで読み込む、新しいブックマーク1件のファイル。 */
const FRIEND_FILE = { version: 3, bookmarks: { p_2: { name: "Friend Set", songs: ["ref-f"], createdAt: 2 } } };

test("a failed import keeps the dialog open so the same choice can be retried", async ({ page }) => {
    await seedBookmarks(page, KEPT_BOOKMARKS);
    await openBookmarkPanel(page);
    await page.locator("#bookmark-panel-import-input").setInputFiles({
        name: "friend.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(FRIEND_FILE))
    });
    const dialog = page.getByRole("dialog", { name: "ブックマークのインポート" });
    const submitButton = dialog.getByRole("button", { name: "インポート", exact: true });
    await expect(submitButton).toBeEnabled();
    // ブックマークの保存を1回だけ失敗させる。
    await page.evaluate(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failNextBookmarkSave = true;
        Storage.prototype.setItem = function (key: string, value: string) {
            if (failNextBookmarkSave && key === "bookmarksV1") {
                failNextBookmarkSave = false;
                throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
            }
            return originalSetItem.call(this, key, value);
        };
    });

    await submitButton.click();

    await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("インポートしたブックマークを保存できませんでした。");
    await expect(dialog.getByRole("checkbox", { name: /Friend Set/ })).toBeChecked();
    await expect(submitButton).toBeEnabled();
    expect(await readStoredBookmarks(page)).toEqual({ version: 3, bookmarks: KEPT_BOOKMARKS });

    await submitButton.click();

    await expect(dialog).toBeHidden();
    await expectBookmarkToast(page, "ブックマークを1件追加しました。");
    expect(await readStoredBookmarks(page)).toEqual({
        version: 3,
        bookmarks: { ...KEPT_BOOKMARKS, ...FRIEND_FILE.bookmarks }
    });
});

test("declining the replace confirmation keeps the dialog open to continue", async ({ page }) => {
    await seedBookmarks(page, KEPT_BOOKMARKS);
    await openBookmarkPanel(page);
    await page.locator("#bookmark-panel-import-input").setInputFiles({
        name: "friend.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(FRIEND_FILE))
    });
    const dialog = page.getByRole("dialog", { name: "ブックマークのインポート" });
    const menuButton = dialog.getByRole("button", { name: "取り込み方を選ぶ" });
    await menuButton.click();
    await dialog.getByRole("menuitemradio", { name: /ブックマーク全体を置換/ }).click();
    await dialog.getByRole("button", { name: "置換", exact: true }).click();

    // 確認はインポートのダイアログの上に重ねて出す。件数を並べた確認文は、改行のまま見せる。
    const confirmDialog = page.getByRole("dialog", { name: "ブックマーク全体の置換" });
    await expect(confirmDialog.locator("#bookmark-prompt-message")).toHaveText([
        "現在のブックマークをすべて削除し、ファイルの内容で置換します。",
        "削除するブックマーク：1件",
        "置換後のブックマーク：1件（1曲）",
        "よろしいですか？"
    ].join("\n"));
    await expect(confirmDialog.locator("#bookmark-prompt-message")).toHaveCSS("white-space", "pre-line");
    await expect(confirmDialog.getByRole("button", { name: "キャンセル" })).toBeFocused();
    await confirmDialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(confirmDialog).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#bookmark-transfer-submit")).toHaveText("置換");
    await expect(dialog.locator("#bookmark-transfer-status")).toHaveText("今ある1件を削除し、ファイルの1件で置換します。");
    expect(await readStoredBookmarks(page)).toEqual({ version: 3, bookmarks: KEPT_BOOKMARKS });

    // 取り込み方を戻せば、続けて選んだブックマークを取り込める。
    await menuButton.click();
    await dialog.getByRole("menuitemradio", { name: /選んだブックマークを取り込む/ }).click();
    await dialog.getByRole("button", { name: "インポート", exact: true }).click();

    await expect(dialog).toBeHidden();
    expect(await readStoredBookmarks(page)).toEqual({
        version: 3,
        bookmarks: { ...KEPT_BOOKMARKS, ...FRIEND_FILE.bookmarks }
    });
});
