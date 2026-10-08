import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { createBookmarkFromSong, expectBookmarkToast, getBookmarkItem, getSongCard, openBookmarkPanel, openSidebar, waitForInitialLoad } from "./support/ui-helpers.mts";
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

    const dialogPromise = new Promise<string>((resolve) => {
        page.once("dialog", async (dialog) => {
            const message = dialog.message();
            await dialog.accept();
            resolve(message);
        });
    });

    await bookmarkItem.locator(".bookmark-delete-btn").click();
    expect(await dialogPromise).toBe(`ブックマーク「${bookmarkName}」を削除しますか？`);

    await expectBookmarkToast(
        page,
        `ブックマーク「${bookmarkName}」を削除しました。`
    );
    await expect(bookmarkItem).toHaveCount(0);
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
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("#bookmark-panel-import-input").setInputFiles({ name: "boundary.json", mimeType: "application/json", buffer });
    await expect(getBookmarkItem(page, "Boundary Favorites")).toBeVisible();
    await expect(page.locator("#bookmark-panel-error")).toBeHidden();
    await page.evaluate(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }));
    const downloaded = page.waitForEvent("download");
    await page.locator("#bookmark-panel-export-btn").click();
    const path = await (await downloaded).path();
    if (!path) throw new Error("Bookmark download path is unavailable");
    const exported = await readFile(path);
    expect(exported.byteLength).toBeLessThanOrEqual(MAX_BOOKMARK_IMPORT_BYTES);
    expect(JSON.parse(exported.toString("utf8"))).toEqual(payload);

    await page.locator("#bookmark-panel-import-input").setInputFiles(path);
    await expect(page.locator("#bookmark-panel-import-input")).toHaveValue("");
    await expect(page.locator("#bookmark-panel-error")).toBeHidden();
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem("bookmarksV1")) ?? "null")).toEqual(payload);
});
