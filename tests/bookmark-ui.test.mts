import type { StorageActionResult } from "../app/controllers/storage.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkUiController } from "../app/ui/bookmark/ui.mts";
import { createSongFixture } from "./fixtures/song.mts";
import type { BookmarkUiCallbacks } from "../app/ui/bookmark/ui.mts";
import type { BookmarkPromptDialogRequest } from "../app/ui/bookmark/prompt-dialog.mts";
import type { SiteLanguage } from "../app/lib/site-language.mts";
import { installFakeDom, invokeListener } from "./test-helpers.mts";

/** 偽の確認・入力ダイアログで行う操作。submit は入力した値 (省略時は開いたときの値) で決定し、cancel は取り消す。 */
type PromptDialogChoice =
    | { action: "submit"; value?: string }
    | { action: "cancel" };

/** ダイアログを閉じた後のフォーカスの移動など、Promise の後に続く処理が終わるまで待つ。 */
function settlePromptDialog() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * ブックマーク UI テスト用の最小状態を作る。
 */
function createBookmarkUiState() {
    const sidebar = document.createElement("div");
    const sidebarHeader = document.createElement("div");
    const sidebarScrollArea = document.createElement("div");
    const openBookmarkPanelBtn = document.createElement("button");
    const bookmarkSidebarPanel = document.createElement("section");
    const closeBookmarkPanelBtn = document.createElement("button");
    const bookmarkPanelCreate = document.createElement("div");
    const bookmarkPanelNewName = document.createElement("input");
    const bookmarkPanelError = document.createElement("div");
    const bookmarkPanelCreateBtn = document.createElement("button");
    const bookmarkList = document.createElement("div");
    const bookmarkNotificationRegion = document.createElement("div");

    openBookmarkPanelBtn.setAttribute("id", "open-bookmark-panel");
    bookmarkSidebarPanel.hidden = true;
    bookmarkPanelError.hidden = true;

    sidebar.append(
        sidebarHeader,
        sidebarScrollArea,
        openBookmarkPanelBtn,
        bookmarkSidebarPanel
    );
    bookmarkSidebarPanel.append(
        closeBookmarkPanelBtn,
        bookmarkPanelCreate
    );
    bookmarkPanelCreate.append(
        bookmarkPanelNewName,
        bookmarkPanelError,
        bookmarkPanelCreateBtn
    );
    bookmarkSidebarPanel.append(bookmarkList);
    document.body.appendChild(bookmarkNotificationRegion);
    document.body.appendChild(sidebar);

    const bookmarkPanel: Parameters<typeof createBookmarkUiController>[0]["ui"]["bookmarkPanel"] = {
        pendingAction: null,
        exitClosesSidebar: false,
        returnFocusEl: null
    };
    return {
        el: {
            sidebar,
            sidebarHeader,
            sidebarScrollArea,
            openBookmarkPanelBtn,
            bookmarkSidebarPanel,
            closeBookmarkPanelBtn,
            bookmarkPanelNewName,
            bookmarkPanelError,
            bookmarkPanelCreateBtn,
            bookmarkList,
            bookmarkNotificationRegion
        },
        lookup: {
            songMapByKey: new Map<string, Song>(),
            songLookupSourceRef: null
        },
        language: {
            current: "ja" as const
        },
        bookmarkPanel
    };
}

/**
 * 指定 ID のブックマーク項目要素を返す。
 * @param {string} bookmarkId
 */
function findBookmarkItem(ui: ReturnType<typeof createBookmarkUiState>, bookmarkId: string) {
    const item = Array.from(ui.el.bookmarkList.querySelectorAll<HTMLElement>(".bookmark-item"))
        .find((child) => child.dataset.bookmarkId === bookmarkId);
    assert.ok(item, `bookmark item ${bookmarkId} is missing`);
    return item;
}

/**
 * ブックマーク UI テスト用のコントローラーとスパイを作る。
 */
function createBookmarkHarness(options: {
    allSongsRaw?: Song[];
    bookmarks?: Parameters<typeof createBookmarkUiController>[0]["data"]["bookmarks"];
    activeBookmark?: string | null;
    onCreateBookmark?: (name: string, data: Parameters<typeof createBookmarkUiController>[0]["data"]) => StorageActionResult;
    onCreateBookmarkAndAdd?: (name: string, songKey: string, data: Parameters<typeof createBookmarkUiController>[0]["data"]) => StorageActionResult;
    onAddSongToBookmarkResult?: StorageActionResult;
    onDeleteBookmarkResult?: StorageActionResult;
    onRenameBookmarkResult?: StorageActionResult;
    onRemoveSongFromBookmarkResult?: StorageActionResult;
    /** 選択・解除・削除の成功時に state を更新し、本番の storage と同じく一覧を再描画する。 */
    rerenderOnStateChange?: boolean;
    /** 偽の確認・入力ダイアログでの操作。省略時は開いたときの値のまま決定する。 */
    promptDialogChoice?: PromptDialogChoice;
} = {}) {
    const data: Parameters<typeof createBookmarkUiController>[0]["data"] = {
        allSongsRaw: options.allSongsRaw || [
            createSongFixture({
                songKey: "song-z",
                title: "透明な朝"
            })
        ],
        bookmarks: options.bookmarks || {
            "bookmark-1": { name: "First", createdAt: 10, songs: ["song-a"] },
            "bookmark-2": { name: "Second", createdAt: 20, songs: ["song-b", "song-c"] }
        },
        activeBookmark: options.activeBookmark ?? null
    };
    const ui = createBookmarkUiState();
    const calls: {
        selectActiveBookmarkArgs: string[];
        clearActiveBookmark: number;
        addSongArgs: [string, string][];
        createBookmarkArgs: string[];
        createBookmarkAndAddArgs: [string, string][];
        deleteBookmarkArgs: string[];
        renameBookmarkArgs: [string, string][];
        removeSongArgs: [string, string][];
        requestCloseSidebar: number;
        /** 偽の確認・入力ダイアログが受け取った表示内容。 */
        promptDialogRequests: BookmarkPromptDialogRequest[];
        /** 決定が失敗して、ダイアログに開いたまま出す理由。 */
        promptDialogErrors: string[];
        promptDialogRefreshLanguages: SiteLanguage[];
    } = {
        selectActiveBookmarkArgs: [],
        clearActiveBookmark: 0,
        addSongArgs: [],
        createBookmarkArgs: [],
        createBookmarkAndAddArgs: [],
        deleteBookmarkArgs: [],
        renameBookmarkArgs: [],
        removeSongArgs: [],
        requestCloseSidebar: 0,
        promptDialogRequests: [],
        promptDialogErrors: [],
        promptDialogRefreshLanguages: []
    };
    const callbacks: BookmarkUiCallbacks = {
        onSelectActiveBookmark(bookmarkId) {
            calls.selectActiveBookmarkArgs.push(bookmarkId);
            if (options.rerenderOnStateChange) {
                data.activeBookmark = bookmarkId;
                controller.renderBookmarks();
            }
            return { ok: true };
        },
        onClearActiveBookmark() {
            calls.clearActiveBookmark += 1;
            if (options.rerenderOnStateChange) {
                data.activeBookmark = null;
                controller.renderBookmarks();
            }
            return { ok: true };
        },
        onAddSongToBookmark(bookmarkId, songKey) {
            calls.addSongArgs.push([bookmarkId, songKey]);
            return options.onAddSongToBookmarkResult ?? { ok: true };
        },
        onCreateBookmark(name) {
            calls.createBookmarkArgs.push(name);
            if (typeof options.onCreateBookmark === "function") {
                return options.onCreateBookmark(name, data);
            }
            data.bookmarks["bookmark-new"] = {
                name,
                createdAt: 30,
                songs: []
            };
            return { ok: true };
        },
        onCreateBookmarkAndAdd(name, songKey) {
            calls.createBookmarkAndAddArgs.push([name, songKey]);
            if (typeof options.onCreateBookmarkAndAdd === "function") {
                return options.onCreateBookmarkAndAdd(name, songKey, data);
            }
            return { ok: true };
        },
        onDeleteBookmark(bookmarkId) {
            calls.deleteBookmarkArgs.push(bookmarkId);
            const result = options.onDeleteBookmarkResult ?? { ok: true };
            if (options.rerenderOnStateChange && result.ok) {
                delete data.bookmarks[bookmarkId];
                controller.renderBookmarks();
            }
            return result;
        },
        onRenameBookmark(bookmarkId, name) {
            calls.renameBookmarkArgs.push([bookmarkId, name]);
            return options.onRenameBookmarkResult ?? { ok: true };
        },
        onRemoveSongFromBookmark(bookmarkId, songKey) {
            calls.removeSongArgs.push([bookmarkId, songKey]);
            return options.onRemoveSongFromBookmarkResult ?? { ok: true };
        },
        onRequestCloseSidebar() {
            calls.requestCloseSidebar += 1;
        },
        promptDialog: {
            async open(buildRequest, language) {
                const request = buildRequest(language);
                calls.promptDialogRequests.push(request);
                const choice = options.promptDialogChoice ?? { action: "submit" };
                if (choice.action === "cancel") return false;
                const result = request.onSubmit(choice.value ?? request.input?.value ?? "");
                if (result.ok) return true;
                // 本物のダイアログは開いたまま理由を出す。ここでは理由を記録し、利用者が閉じたものとして扱う。
                calls.promptDialogErrors.push(result.message(language));
                return false;
            },
            refreshText(language) {
                calls.promptDialogRefreshLanguages.push(language);
            }
        }
    };

    const controller = createBookmarkUiController({ data, ui, callbacks });
    return {
        data,
        ui,
        calls,
        controller
    };
}

/**
 * 表示中の失敗の通知の文言を返す。
 * @param ui ブックマーク UI の状態
 * @returns 失敗の通知の文言。出ていなければ null
 */
function readErrorToast(ui: ReturnType<typeof createBookmarkUiState>) {
    return ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-error")
        ?.querySelector(".bookmark-toast-message")?.textContent ?? null;
}

/**
 * ブックマーク項目内の操作ボタンを返す。
 * @param item ブックマーク項目
 * @param selector 操作ボタンのセレクター
 */
function getBookmarkItemControl(item: HTMLElement, selector: string) {
    const control = item.querySelector<HTMLElement>(selector);
    assert.ok(control, `${selector} is missing`);
    return control;
}

test("bookmark ui: selecting a bookmark delegates the intent to state management", () => {
    const restoreDom = installFakeDom();
    try {
        const { calls, controller } = createBookmarkHarness();

        controller.setActiveBookmark("bookmark-1");

        assert.deepEqual(calls.selectActiveBookmarkArgs, ["bookmark-1"]);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: clearing a bookmark delegates the intent to state management", () => {
    const restoreDom = installFakeDom();
    try {
        const { calls, controller } = createBookmarkHarness({
            activeBookmark: "bookmark-1"
        });

        controller.clearActiveBookmark();

        assert.equal(calls.clearActiveBookmark, 1);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: items place a select button beside rename and delete buttons", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, controller } = createBookmarkHarness({ activeBookmark: "bookmark-2" });
        controller.renderBookmarks();

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        const firstSelect = firstItem.querySelector<HTMLButtonElement>(".bookmark-item-select");
        assert.ok(firstSelect);
        assert.equal(firstSelect.type, "button");
        assert.equal(firstSelect.getAttribute("aria-pressed"), "false");
        assert.equal(getBookmarkItemControl(firstItem, ".bookmark-item-name").textContent, "First");
        assert.equal(getBookmarkItemControl(firstItem, ".bookmark-item-count").textContent, "1");
        for (const selector of [".bookmark-rename-btn", ".bookmark-delete-btn"]) {
            const control = getBookmarkItemControl(firstItem, selector);
            assert.equal(control.parentElement, firstItem, `${selector} must not be nested in the select button`);
        }

        const secondItem = findBookmarkItem(ui, "bookmark-2");
        assert.equal(secondItem.classList.contains("active"), true);
        assert.equal(getBookmarkItemControl(secondItem, ".bookmark-item-select").getAttribute("aria-pressed"), "true");

        controller.openBookmarkModal("song-z", {});
        const addingItem = findBookmarkItem(ui, "bookmark-1");
        assert.equal(getBookmarkItemControl(addingItem, ".bookmark-item-select").hasAttribute("aria-pressed"), false);
        assert.equal(addingItem.querySelector(".bookmark-rename-btn"), null);
        assert.equal(addingItem.querySelector(".bookmark-delete-btn"), null);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: selecting and clearing keep focus on the same bookmark after re-render", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({ rerenderOnStateChange: true });
        controller.renderBookmarks();

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        const selectButton = getBookmarkItemControl(firstItem, ".bookmark-item-select");
        selectButton.focus();
        invokeListener(firstItem, "click", { target: selectButton, stopPropagation() {} });

        const selectedItem = findBookmarkItem(ui, "bookmark-1");
        const selectedButton = getBookmarkItemControl(selectedItem, ".bookmark-item-select");
        assert.deepEqual(calls.selectActiveBookmarkArgs, ["bookmark-1"]);
        assert.notEqual(selectedItem, firstItem);
        assert.equal(selectedButton.getAttribute("aria-pressed"), "true");
        assert.equal(document.activeElement, selectedButton);

        invokeListener(selectedItem, "click", { target: selectedButton, stopPropagation() {} });

        const clearedButton = getBookmarkItemControl(findBookmarkItem(ui, "bookmark-1"), ".bookmark-item-select");
        assert.equal(calls.clearActiveBookmark, 1);
        assert.equal(clearedButton.getAttribute("aria-pressed"), "false");
        assert.equal(document.activeElement, clearedButton);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: deleting a focused bookmark moves focus to a nearby bookmark or the create field", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({ rerenderOnStateChange: true });
        controller.renderBookmarks();

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        const firstDelete = getBookmarkItemControl(firstItem, ".bookmark-delete-btn");
        firstDelete.focus();
        invokeListener(firstItem, "click", { target: firstDelete, stopPropagation() {} });
        await settlePromptDialog();

        const secondItem = findBookmarkItem(ui, "bookmark-2");
        assert.deepEqual(calls.deleteBookmarkArgs, ["bookmark-1"]);
        assert.equal(document.activeElement, getBookmarkItemControl(secondItem, ".bookmark-item-select"));

        const secondDelete = getBookmarkItemControl(secondItem, ".bookmark-delete-btn");
        secondDelete.focus();
        invokeListener(secondItem, "click", { target: secondDelete, stopPropagation() {} });
        await settlePromptDialog();

        assert.deepEqual(calls.deleteBookmarkArgs, ["bookmark-1", "bookmark-2"]);
        assert.equal(ui.el.bookmarkList.querySelector(".bookmark-item"), null);
        assert.equal(document.activeElement, ui.el.bookmarkPanelNewName);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: renaming asks for the new name in a dialog and returns focus to the rename button", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({
            promptDialogChoice: { action: "submit", value: "Renamed" }
        });
        ui.el.bookmarkPanelNewName.maxLength = 64;
        controller.renderBookmarks();

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        const renameButton = getBookmarkItemControl(firstItem, ".bookmark-rename-btn");
        invokeListener(firstItem, "click", { target: renameButton, stopPropagation() {} });

        assert.equal(calls.promptDialogRequests.length, 1);
        const [request] = calls.promptDialogRequests;
        assert.equal(request.title, "ブックマーク名の変更");
        assert.equal(request.message, "新しいブックマーク名を入力してください。");
        assert.deepEqual(request.input, { value: "First", maxLength: 64 });
        assert.equal(request.submitLabel, "変更");
        assert.equal(request.cancelLabel, "キャンセル");
        assert.equal(Boolean(request.isDestructive), false);
        assert.deepEqual(calls.renameBookmarkArgs, [["bookmark-1", "Renamed"]]);
        assert.deepEqual(calls.selectActiveBookmarkArgs, [], "the rename button does not select the bookmark");

        await settlePromptDialog();
        assert.equal(document.activeElement, renameButton);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: a failed rename keeps its reason in the dialog instead of a notification", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({
            onRenameBookmarkResult: { ok: false, reason: "max_bookmark_name_length", limit: 64 }
        });
        controller.renderBookmarks();

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        invokeListener(firstItem, "click", {
            target: getBookmarkItemControl(firstItem, ".bookmark-rename-btn"),
            stopPropagation() {}
        });

        assert.deepEqual(calls.promptDialogErrors, ["ブックマーク名は最大64文字までです。"]);
        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 0);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: a language change is passed on to the open dialog", () => {
    const restoreDom = installFakeDom();
    try {
        const { calls, controller } = createBookmarkHarness();
        controller.refreshText();
        assert.deepEqual(calls.promptDialogRefreshLanguages, ["ja"]);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: add mode success adds to existing bookmark, closes the panel, and returns focus", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness();

        controller.openBookmarkModal("song-z", {
            returnFocusEl: ui.el.openBookmarkPanelBtn
        });

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        const selectButton = getBookmarkItemControl(firstItem, ".bookmark-item-select");
        selectButton.focus();
        invokeListener(firstItem, "click", {
            target: selectButton,
            stopPropagation() {}
        });

        assert.deepEqual(calls.addSongArgs, [["bookmark-1", "song-z"]]);
        assert.equal(ui.el.bookmarkSidebarPanel.hidden, true);
        assert.equal(ui.el.sidebarHeader.hasAttribute("inert"), false);
        assert.equal(ui.el.sidebarScrollArea.hasAttribute("inert"), false);
        assert.equal(document.activeElement, ui.el.openBookmarkPanelBtn);
        assert.equal(calls.requestCloseSidebar, 0);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: add success from a card closes the sidebar like Escape", () => {
    const restoreDom = installFakeDom();
    try {
        const existingHarness = createBookmarkHarness();
        existingHarness.controller.openBookmarkModal("song-z", {
            returnFocusEl: existingHarness.ui.el.openBookmarkPanelBtn,
            closeSidebarOnExit: true
        });
        const firstItem = findBookmarkItem(existingHarness.ui, "bookmark-1");
        invokeListener(firstItem, "click", {
            target: getBookmarkItemControl(firstItem, ".bookmark-item-select"),
            stopPropagation() {}
        });

        assert.deepEqual(existingHarness.calls.addSongArgs, [["bookmark-1", "song-z"]]);
        assert.equal(existingHarness.ui.el.bookmarkSidebarPanel.hidden, true);
        assert.equal(existingHarness.calls.requestCloseSidebar, 1);

        const createHarness = createBookmarkHarness();
        createHarness.controller.setupBookmarkHandlers();
        createHarness.controller.openBookmarkModal("song-z", {
            returnFocusEl: createHarness.ui.el.openBookmarkPanelBtn,
            closeSidebarOnExit: true
        });
        createHarness.ui.el.bookmarkPanelNewName.value = "Card Songs";
        invokeListener(createHarness.ui.el.bookmarkPanelCreateBtn, "click", {});

        assert.deepEqual(createHarness.calls.createBookmarkAndAddArgs, [["Card Songs", "song-z"]]);
        assert.equal(createHarness.ui.el.bookmarkSidebarPanel.hidden, true);
        assert.equal(createHarness.calls.requestCloseSidebar, 1);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: add mode success notifies bookmark name and song title", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, controller } = createBookmarkHarness();

        controller.openBookmarkModal("song-z", {
            returnFocusEl: ui.el.openBookmarkPanelBtn
        });

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        assert.ok(firstItem);
        invokeListener(firstItem, "click", {
            target: firstItem,
            stopPropagation() {}
        });

        const message = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-message");
        assert.ok(message);
        assert.equal(message.textContent, "ブックマーク「First」に「透明な朝」を保存しました。");
    } finally {
        restoreDom();
    }
});

test("bookmark ui: create-and-add closes the panel and returns focus to the opener", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness();
        controller.setupBookmarkHandlers();
        controller.openBookmarkModal("song-z", {
            returnFocusEl: ui.el.openBookmarkPanelBtn
        });

        ui.el.bookmarkPanelNewName.value = "Focus Songs";
        ui.el.bookmarkPanelCreateBtn.focus();
        invokeListener(ui.el.bookmarkPanelCreateBtn, "click", {});

        assert.deepEqual(calls.createBookmarkAndAddArgs, [["Focus Songs", "song-z"]]);
        assert.equal(ui.el.bookmarkSidebarPanel.hidden, true);
        assert.equal(ui.el.bookmarkSidebarPanel.getAttribute("aria-hidden"), "true");
        assert.equal(document.activeElement, ui.el.openBookmarkPanelBtn);
        assert.equal(ui.el.sidebarHeader.hasAttribute("inert"), false);
        assert.equal(ui.el.sidebarScrollArea.hasAttribute("inert"), false);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: create-and-add notifies created bookmark and saved song title", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, controller } = createBookmarkHarness();
        controller.setupBookmarkHandlers();
        controller.openBookmarkModal("song-z", {
            returnFocusEl: ui.el.openBookmarkPanelBtn
        });

        ui.el.bookmarkPanelNewName.value = "Focus Songs";
        invokeListener(ui.el.bookmarkPanelCreateBtn, "click", {});

        const message = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-message");
        assert.ok(message);
        assert.equal(message.textContent, "ブックマーク「Focus Songs」を作成し、「透明な朝」を保存しました。");
    } finally {
        restoreDom();
    }
});

test("bookmark ui: duplicate add shows an error notification and keeps the selection panel open", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({
            onAddSongToBookmarkResult: { ok: false, reason: "duplicate_song" }
        });

        controller.openBookmarkModal("song-z", {});
        const secondItem = findBookmarkItem(ui, "bookmark-2");
        assert.ok(secondItem);
        invokeListener(secondItem, "click", {
            target: secondItem,
            stopPropagation() {}
        });

        assert.deepEqual(calls.addSongArgs, [["bookmark-2", "song-z"]]);
        assert.equal(ui.el.bookmarkSidebarPanel.hidden, false);
        assert.equal(readErrorToast(ui), "この曲はすでに選択したブックマークに追加されています。");
        assert.equal(
            ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-error")?.getAttribute("role"),
            "alert"
        );
    } finally {
        restoreDom();
    }
});

test("bookmark ui: create form shows inline error, clears it on input, and creates on Enter", () => {
    const restoreDom = installFakeDom();
    try {
        const { data, ui, calls, controller } = createBookmarkHarness();
        controller.setupBookmarkHandlers();

        ui.el.bookmarkPanelNewName.value = "   ";
        invokeListener(ui.el.bookmarkPanelCreateBtn, "click", {});
        assert.equal(ui.el.bookmarkPanelError.hidden, false);
        assert.equal(ui.el.bookmarkPanelError.textContent, "ブックマーク名を入力してください。");
        assert.equal(document.activeElement, ui.el.bookmarkPanelNewName);

        ui.el.bookmarkPanelNewName.value = "Focus Songs";
        invokeListener(ui.el.bookmarkPanelNewName, "input", {});
        assert.equal(ui.el.bookmarkPanelError.hidden, true);

        let prevented = false;
        // かな漢字変換を確定する Enter では作成しない。isComposing を付けるブラウザと、キーコード 229 だけを付けるブラウザがある。
        for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
            invokeListener(ui.el.bookmarkPanelNewName, "keydown", {
                key: "Enter",
                ...composing,
                preventDefault() {
                    prevented = true;
                }
            });
        }
        assert.equal(prevented, false);
        assert.deepEqual(calls.createBookmarkArgs, []);
        assert.equal(ui.el.bookmarkPanelNewName.value, "Focus Songs");

        invokeListener(ui.el.bookmarkPanelNewName, "keydown", {
            key: "Enter",
            preventDefault() {
                prevented = true;
            }
        });

        assert.equal(prevented, true);
        assert.deepEqual(calls.createBookmarkArgs, ["Focus Songs"]);
        assert.equal(ui.el.bookmarkPanelNewName.value, "");
        assert.equal(document.activeElement, ui.el.bookmarkPanelNewName);
        assert.ok(data.bookmarks["bookmark-new"]);
        const name = findBookmarkItem(ui, "bookmark-new").querySelector(".bookmark-item-name");
        assert.ok(name);
        assert.equal(name.textContent, "Focus Songs");
    } finally {
        restoreDom();
    }
});

test("bookmark ui: create form success notifies created bookmark", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, controller } = createBookmarkHarness();
        controller.setupBookmarkHandlers();

        ui.el.bookmarkPanelNewName.value = "Focus Songs";
        invokeListener(ui.el.bookmarkPanelCreateBtn, "click", {});

        const toast = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast");
        assert.ok(toast);
        const message = toast.querySelector(".bookmark-toast-message");
        assert.ok(message);
        const closeBtn = toast.querySelector(".bookmark-toast-close");
        assert.ok(closeBtn);
        assert.equal(message.textContent, "ブックマーク「Focus Songs」を作成しました。");
        assert.equal(closeBtn.getAttribute("aria-label"), "通知を閉じる");
        assert.equal(closeBtn.getAttribute("popovertargetaction"), "hide");
    } finally {
        restoreDom();
    }
});

test("bookmark ui: unsupported storage version shows an error without a success notification", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, controller } = createBookmarkHarness({
            onCreateBookmark: () => ({
                ok: false,
                reason: "unsupported_storage_version",
                version: 4
            })
        });
        controller.setupBookmarkHandlers();
        ui.el.bookmarkPanelNewName.value = "Not persisted";

        invokeListener(ui.el.bookmarkPanelCreateBtn, "click", {});

        assert.equal(readErrorToast(ui), "このアプリより新しい形式のブックマークが保存されているため、変更できません。");
        assert.equal(ui.el.bookmarkPanelNewName.value, "Not persisted");
        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 1, "only the error is shown");
    } finally {
        restoreDom();
    }
});

test("bookmark ui: stale loaded storage state asks for a reload without a success notification", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, controller } = createBookmarkHarness({
            onCreateBookmark: () => ({
                ok: false,
                reason: "storage_reload_required"
            })
        });
        controller.setupBookmarkHandlers();
        ui.el.bookmarkPanelNewName.value = "Not persisted";

        invokeListener(ui.el.bookmarkPanelCreateBtn, "click", {});

        assert.equal(readErrorToast(ui), "別のタブでブックマークが更新された可能性があります。画面を再読み込みしてから、もう一度お試しください。");
        assert.equal(ui.el.bookmarkPanelNewName.value, "Not persisted");
        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 1, "only the error is shown");
    } finally {
        restoreDom();
    }
});

test("bookmark ui: public save error notifier asks for a reload", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, controller } = createBookmarkHarness();

        const didNotify = controller.notifyBookmarkSaveError({
            ok: false,
            reason: "storage_reload_required"
        });

        assert.equal(didNotify, true);
        assert.equal(
            readErrorToast(ui),
            "別のタブでブックマークが更新された可能性があります。画面を再読み込みしてから、もう一度お試しください。"
        );
    } finally {
        restoreDom();
    }
});

test("bookmark ui: removing a song from active bookmark notifies bookmark name and song title", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({
            activeBookmark: "bookmark-1",
            bookmarks: {
                "bookmark-1": { name: "First", createdAt: 10, songs: ["song-z"] }
            }
        });

        controller.removeSongFromActiveBookmark("song-z");

        const message = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-message");
        assert.ok(message);
        assert.deepEqual(calls.removeSongArgs, [["bookmark-1", "song-z"]]);
        assert.equal(message.textContent, "ブックマーク「First」から「透明な朝」を削除しました。");
    } finally {
        restoreDom();
    }
});

test("bookmark ui: failed song removal does not show a success notification", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({
            activeBookmark: "bookmark-1",
            bookmarks: {
                "bookmark-1": { name: "First", createdAt: 10, songs: ["song-z"] }
            },
            onRemoveSongFromBookmarkResult: { ok: false, reason: "song_not_found" }
        });

        controller.removeSongFromActiveBookmark("song-z");

        assert.deepEqual(calls.removeSongArgs, [["bookmark-1", "song-z"]]);
        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 0);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: deleting a bookmark asks in a dialog and notifies the deleted bookmark name", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness();
        controller.renderBookmarks();

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        const deleteButton = firstItem.querySelector(".bookmark-delete-btn");
        assert.ok(deleteButton);
        invokeListener(firstItem, "click", {
            target: deleteButton,
            stopPropagation() {}
        });

        const message = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-message");
        assert.ok(message);
        assert.deepEqual(calls.deleteBookmarkArgs, ["bookmark-1"]);
        assert.equal(message.textContent, "ブックマーク「First」を削除しました。");
        const [request] = calls.promptDialogRequests;
        assert.equal(request.title, "ブックマークの削除");
        assert.equal(request.message, "ブックマーク「First」を削除しますか？");
        assert.equal(request.submitLabel, "削除");
        assert.equal(request.input, undefined);
        assert.equal(request.isDestructive, true);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: failed bookmark deletion keeps its reason in the dialog without a success notification", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({
            onDeleteBookmarkResult: { ok: false, reason: "bookmark_not_found" }
        });
        controller.renderBookmarks();

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        const deleteButton = firstItem.querySelector(".bookmark-delete-btn");
        assert.ok(deleteButton);
        invokeListener(firstItem, "click", {
            target: deleteButton,
            stopPropagation() {}
        });

        assert.deepEqual(calls.deleteBookmarkArgs, ["bookmark-1"]);
        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 0);
        assert.deepEqual(calls.promptDialogErrors, ["ブックマークが見つかりません。画面を更新して再度お試しください。"]);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: closing with restoreFocus returns focus to opener, or closes sidebar when requested", () => {
    const restoreDom = installFakeDom();
    try {
        const firstHarness = createBookmarkHarness();
        firstHarness.controller.openBookmarkBrowser({
            returnFocusEl: firstHarness.ui.el.openBookmarkPanelBtn
        });
        firstHarness.controller.closeBookmarkModal({ restoreFocus: true });

        assert.equal(firstHarness.ui.el.bookmarkSidebarPanel.hidden, true);
        assert.equal(document.activeElement, firstHarness.ui.el.openBookmarkPanelBtn);

        const secondHarness = createBookmarkHarness();
        secondHarness.controller.openBookmarkModal("song-z", {
            returnFocusEl: secondHarness.ui.el.openBookmarkPanelBtn,
            closeSidebarOnExit: true
        });
        secondHarness.controller.closeBookmarkModal({ restoreFocus: true });

        assert.equal(secondHarness.calls.requestCloseSidebar, 1);
        assert.notEqual(document.activeElement, secondHarness.ui.el.openBookmarkPanelBtn);
    } finally {
        restoreDom();
    }
});

test("bookmark ui: rename cancel and delete cancel are no-ops", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createBookmarkHarness({ promptDialogChoice: { action: "cancel" } });
        controller.renderBookmarks();

        const firstItem = findBookmarkItem(ui, "bookmark-1");
        const renameButton = firstItem.querySelector(".bookmark-rename-btn");
        assert.ok(renameButton);
        const deleteButton = firstItem.querySelector(".bookmark-delete-btn");
        assert.ok(deleteButton);

        invokeListener(firstItem, "click", {
            target: renameButton,
            stopPropagation() {}
        });
        invokeListener(firstItem, "click", {
            target: deleteButton,
            stopPropagation() {}
        });

        assert.equal(calls.promptDialogRequests.length, 2);
        assert.deepEqual(calls.renameBookmarkArgs, []);
        assert.deepEqual(calls.deleteBookmarkArgs, []);
        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 0);
    } finally {
        restoreDom();
    }
});

for (const { result, saveMessage } of [
    {
        result: { ok: false, reason: "storage_write_failed" },
        saveMessage: "ブックマークを保存できませんでした。ブラウザのストレージ設定をご確認ください。"
    },
    {
        result: { ok: false, reason: "storage_reload_required" },
        saveMessage: "別のタブでブックマークが更新された可能性があります。画面を再読み込みしてから、もう一度お試しください。"
    },
    {
        result: { ok: false, reason: "unsupported_storage_version", version: 4 },
        saveMessage: "このアプリより新しい形式のブックマークが保存されているため、変更できません。"
    }
] as const) {
    test(`bookmark ui: ${result.reason} add result keeps the panel open without a success toast`, () => {
        const restoreDom = installFakeDom();
        try {
            const { ui, calls, controller } = createBookmarkHarness({ onAddSongToBookmarkResult: result });
            controller.openBookmarkModal("song-z", {});
            const item = findBookmarkItem(ui, "bookmark-1");
            invokeListener(item, "click", { target: item });

            assert.deepEqual(calls.addSongArgs, [["bookmark-1", "song-z"]]);
            assert.equal(ui.el.bookmarkSidebarPanel.hidden, false);
            assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 1, "only the error is shown");
            assert.equal(readErrorToast(ui), saveMessage);
        } finally {
            restoreDom();
        }
    });
}
