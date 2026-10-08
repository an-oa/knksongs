import {
    buildBookmarkExportFileName,
    buildBookmarkImportConfirmMessage,
    getBookmarkImportErrorMessage,
    readFileText,
    saveTextFile
} from "./import-export.mjs";
import { createBookmarkNotificationController } from "./notifications.mjs";
import { createSidebarSubpanelController } from "../sidebar/subpanel.mjs";
import { MAX_BOOKMARK_IMPORT_BYTES } from "../../lib/storage/bookmark-transfer.mjs";
import type { AppDataState, AppUiState } from "../../state.types";
import type { StorageActionResult } from "../../controllers/storage.mjs";

export type BookmarkUiCallbacks = {
    onSelectActiveBookmark: (bookmarkId: string) => StorageActionResult;
    onClearActiveBookmark: () => StorageActionResult;
    onAddSongToBookmark: (
        bookmarkId: string,
        songKey: string
    ) => StorageActionResult;
    onCreateBookmark: (bookmarkName: string) => StorageActionResult;
    onCreateBookmarkAndAdd: (
        bookmarkName: string,
        songKey: string
    ) => StorageActionResult;
    onDeleteBookmark: (bookmarkId: string) => StorageActionResult;
    onRenameBookmark: (bookmarkId: string, bookmarkName: string) => StorageActionResult;
    onRemoveSongFromBookmark: (
        bookmarkId: string,
        songKey: string
    ) => StorageActionResult;
    onRequestCloseSidebar: () => void;
    onExportBookmarks: () => StorageActionResult<{ ok: true; text: string; fileName?: string }>;
    onPreviewBookmarkImport: (text: string) => StorageActionResult<{ ok: true; bookmarkCount: number; songCount: number }>;
    onImportBookmarksText: (text: string) => StorageActionResult<{ ok: true; bookmarkCount: number; songCount: number }>;
    saveTextFile?: (text: string, fileName: string, mimeType: string) => Promise<void> | void;
};

type BookmarkUiControllerInput = {
    data: Pick<AppDataState, "allSongsRaw" | "bookmarks" | "activeBookmark">;
    ui: Pick<AppUiState, "el" | "lookup" | "bookmarkPanel">;
    callbacks: BookmarkUiCallbacks;
};

/**
 * ブックマークUIのイベント処理・描画・選択状態管理をまとめたコントローラーを作成する。
 */
export function createBookmarkUiController({ data, ui, callbacks }: BookmarkUiControllerInput) {
    const bookmarkPanelUi = ui.bookmarkPanel;
    const bookmarkSubpanel = createSidebarSubpanelController({
        getPanel: () => ui.el.bookmarkSidebarPanel,
        getSidebar: () => ui.el.sidebar,
        getBackgroundElements: () => [ui.el.sidebarHeader, ui.el.sidebarScrollArea],
        getOpener: () => ui.el.openBookmarkPanelBtn,
        state: bookmarkPanelUi
    });
    const bookmarkNotifications = createBookmarkNotificationController({ data, ui });
    const {
        onSelectActiveBookmark,
        onClearActiveBookmark,
        onAddSongToBookmark,
        onCreateBookmark,
        onCreateBookmarkAndAdd,
        onDeleteBookmark,
        onRenameBookmark,
        onRemoveSongFromBookmark,
        onRequestCloseSidebar,
        onExportBookmarks,
        onPreviewBookmarkImport,
        onImportBookmarksText,
        saveTextFile: saveTextFileCallback = saveTextFile
    } = callbacks;

    /**
     * 上限エラー時に理由別のメッセージを表示し、通知したかどうかを返す。
     * @param {StorageActionResult} result
     * @returns {boolean}
     */
    function notifyIfLimitError(result: StorageActionResult): boolean {
        if (result.ok === true) return false;
        if (result.reason === "max_bookmark_count") {
            const limit = Number.isFinite(result.limit) ? result.limit : null;
            if (limit === null) {
                alert("ブックマークの登録上限に達しています。不要なブックマークを削除してください。");
            } else {
                alert(`ブックマークは最大${limit}件までです。不要なブックマークを削除してください。`);
            }
            return true;
        }
        if (result.reason === "max_songs_per_bookmark") {
            const limit = Number.isFinite(result.limit) ? result.limit : null;
            if (limit === null) {
                alert("1つのブックマークに登録できる曲数の上限に達しています。");
            } else {
                alert(`1つのブックマークに登録できる曲は最大${limit}曲です。`);
            }
            return true;
        }
        return false;
    }

    /**
     * ブックマークが見つからない失敗を共通文言で通知する。
     * @param {StorageActionResult} result
     * @returns {boolean}
     */
    function notifyIfBookmarkNotFoundError(result: StorageActionResult): boolean {
        if (result.ok === true || result.reason !== "bookmark_not_found") return false;
        alert("ブックマークが見つかりません。画面を更新して再度お試しください。");
        return true;
    }

    /**
     * ブックマーク永続化の失敗を理由別のメッセージで通知する。
     * @param {StorageActionResult} result
     * @returns {boolean}
     */
    function notifyIfBookmarkSaveError(result: StorageActionResult): boolean {
        if (result.ok === true) return false;
        if (result.reason === "unsupported_storage_version") {
            alert("このアプリより新しい形式のブックマークが保存されているため、変更できません。");
            return true;
        }
        if (result.reason === "storage_reload_required") {
            alert("別のタブでブックマークが更新された可能性があります。画面を再読み込みしてから、もう一度お試しください。");
            return true;
        }
        if (result.reason === "storage_write_failed") {
            alert("ブックマークを保存できませんでした。ブラウザのストレージ設定をご確認ください。");
            return true;
        }
        return false;
    }

    /**
     * 外部操作から受け取ったブックマーク保存失敗を共通文言で通知する。
     */
    function notifyBookmarkSaveError(result: StorageActionResult): boolean {
        return notifyIfBookmarkSaveError(result);
    }

    /**
     * リネーム失敗時に理由別メッセージを表示し、通知したかどうかを返す。
     * @param {StorageActionResult} result
     * @returns {boolean}
     */
    function notifyIfRenameError(result: StorageActionResult): boolean {
        if (result.ok === true) return false;
        if (notifyIfBookmarkSaveError(result)) return true;
        if (result.reason === "empty_name") {
            alert("ブックマーク名を入力してください。");
            return true;
        }
        if (result.reason === "max_bookmark_name_length") {
            const limit = Number.isFinite(result.limit) ? result.limit : null;
            alert(limit === null
                ? "ブックマーク名の文字数上限を超えています。"
                : `ブックマーク名は最大${limit}文字までです。`);
            return true;
        }
        if (notifyIfBookmarkNotFoundError(result)) return true;
        return false;
    }

    /**
     * 曲追加失敗時に理由別メッセージを表示し、通知したかどうかを返す。
     * @param {StorageActionResult} result
     * @returns {boolean}
     */
    function notifyIfAddSongError(result: StorageActionResult): boolean {
        if (result.ok === true) return false;
        if (notifyIfBookmarkSaveError(result)) return true;
        if (notifyIfLimitError(result)) return true;
        if (result.reason === "duplicate_song") {
            alert("この曲はすでに選択したブックマークに追加されています。");
            return true;
        }
        if (notifyIfBookmarkNotFoundError(result)) return true;
        return false;
    }

    /**
     * ブックマークIDを作成日時順で取得する。
     */
    function getSortedBookmarkIds() {
        return Object.keys(data.bookmarks).sort((a, b) => {
            return (data.bookmarks[a].createdAt || 0) - (data.bookmarks[b].createdAt || 0);
        });
    }

    /**
     * 現在が「曲を追加するための選択モード」かどうかを返す。
     */
    function isAddingSongMode() {
        return Boolean(bookmarkPanelUi.pendingAction && bookmarkPanelUi.pendingAction.songKey);
    }

    /**
     * ブックマーク専用パネルを表示する。
     * @param {{ returnFocusEl?: Element | null | undefined, focusEl?: HTMLElement | null | undefined } | undefined} [options]
     */
    function showBookmarkPanel(options?: {
        returnFocusEl?: Element | null | undefined;
        focusEl?: HTMLElement | null | undefined;
    }) {
        bookmarkSubpanel.open(options);
    }

    /**
     * ブックマーク専用パネルを閉じる。
     * @param {{ restoreFocus?: boolean } | undefined} [options]
     */
    function hideBookmarkPanel(options?: { restoreFocus?: boolean }) {
        bookmarkSubpanel.close(options);
    }

    /**
     * 現在モードに応じて作成フォームの表示を更新する。
     */
    function syncBookmarkPanelMode() {
        const createWrap = ui.el.bookmarkPanelCreate;
        const nameInput = ui.el.bookmarkPanelNewName;
        const createBtn = ui.el.bookmarkPanelCreateBtn;
        if (!createWrap || !nameInput || !createBtn) return;

        createWrap.hidden = false;
        nameInput.placeholder = "新規ブックマーク名";
        createBtn.textContent = "作成";
    }

    /**
     * 空状態表示を生成する。
     * @param {string} message
     */
    function createEmptyBookmarkElement(message: string) {
        const empty = document.createElement("div");
        empty.className = "bookmark-empty-state";
        empty.textContent = message;
        return empty;
    }

    /**
     * 作成欄のインラインエラーを表示する。
     * @param {string} message
     */
    function showBookmarkPanelError(message: string) {
        const errorEl = ui.el.bookmarkPanelError;
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.hidden = !message;
    }

    /**
     * 作成欄のインラインエラーをクリアする。
     */
    function clearBookmarkPanelError() {
        showBookmarkPanelError("");
    }

    /**
     * ブックマークを JSON ファイルとしてエクスポートする。
     */
    async function exportBookmarksFromPanel() {
        clearBookmarkPanelError();
        try {
            const result = onExportBookmarks();
            if (result.ok === false) {
                showBookmarkPanelError("ブックマークをエクスポートできませんでした。");
                return;
            }
            const fileName = typeof result.fileName === "string" && result.fileName.trim()
                ? result.fileName.trim()
                : buildBookmarkExportFileName(new Date());
            await saveTextFileCallback(result.text, fileName, "application/json");
        } catch (error) {
            if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
            showBookmarkPanelError("ブックマークをエクスポートできませんでした。");
        }
    }

    /**
     * ファイル選択ダイアログを開く。
     */
    function requestBookmarkImportFile() {
        const input = ui.el.bookmarkPanelImportInput;
        if (!input) return;
        clearBookmarkPanelError();
        input.value = "";
        input.click();
    }

    /**
     * 選択された JSON ファイルを読み込み、全置き換えでインポートする。
     */
    async function importBookmarksFromSelectedFile() {
        const input = ui.el.bookmarkPanelImportInput;
        if (!input) return;
        const file = input.files?.[0] ?? null;
        if (!file) return;

        clearBookmarkPanelError();
        try {
            if (file.size > MAX_BOOKMARK_IMPORT_BYTES) {
                showBookmarkPanelError(getBookmarkImportErrorMessage({
                    ok: false,
                    reason: "max_import_file_size",
                    limit: MAX_BOOKMARK_IMPORT_BYTES
                }));
                return;
            }
            const text = await readFileText(file);
            const preview = onPreviewBookmarkImport(text);
            if (preview.ok === false) {
                showBookmarkPanelError(getBookmarkImportErrorMessage(preview));
                return;
            }
            if (!confirm(buildBookmarkImportConfirmMessage(preview))) return;

            const result = onImportBookmarksText(text);
            if (result.ok === false) {
                showBookmarkPanelError(getBookmarkImportErrorMessage(result));
                return;
            }
            alert(`ブックマークを${result.bookmarkCount}件インポートしました。`);
        } catch {
            showBookmarkPanelError("ブックマークファイルを読み込めませんでした。");
        } finally {
            input.value = "";
        }
    }

    /**
     * ブックマークを追加モード/閲覧モードに応じて描画する。
     */
    function renderBookmarks() {
        const container = ui.el.bookmarkList;
        if (!container) return;

        syncBookmarkPanelMode();

        const sortedIds = getSortedBookmarkIds();
        if (sortedIds.length === 0) {
            container.replaceChildren(createEmptyBookmarkElement("ブックマークはまだありません。"));
            return;
        }

        const addingMode = isAddingSongMode();
        container.replaceChildren(...sortedIds.map((id) => {
            const bookmark = data.bookmarks[id];
            const item = document.createElement("div");
            item.className = "bookmark-item";
            item.dataset.bookmarkId = id;

            if (addingMode) {
                item.classList.add("bookmark-item-selecting");
                item.innerHTML = `
                    <span class="bookmark-item-name"></span>
                    <span class="bookmark-item-count">${bookmark.songs.length}</span>
                `;
            } else {
                item.innerHTML = `
                    <span class="bookmark-item-name"></span>
                    <span class="bookmark-item-count">${bookmark.songs.length}</span>
                    <button class="bookmark-rename-btn" aria-label="ブックマーク名を変更">変更</button>
                    <button class="bookmark-delete-btn" aria-label="ブックマークを削除"><span>&times;</span></button>
                `;
            }

            const nameEl = item.querySelector(".bookmark-item-name");
            if (!(nameEl instanceof HTMLElement)) return item;
            nameEl.textContent = bookmark.name;
            nameEl.title = bookmark.name;

            if (!addingMode && data.activeBookmark === id) {
                item.classList.add("active");
            }

            item.addEventListener("click", (e) => {
                const target = e.target instanceof Element ? e.target : null;
                if (!target) return;

                if (addingMode) {
                    const pendingSongKey = bookmarkPanelUi.pendingAction?.songKey;
                    if (!pendingSongKey) return;
                    const result = onAddSongToBookmark(id, pendingSongKey);
                    if (result.ok === true) {
                        bookmarkNotifications.notifySongSavedToBookmark(bookmark.name, pendingSongKey);
                        closeBookmarkModal();
                        return;
                    }
                    notifyIfAddSongError(result);
                    return;
                }

                const renameBtn = target.closest(".bookmark-rename-btn");
                if (renameBtn) {
                    e.stopPropagation();
                    const newName = prompt("新しいブックマーク名を入力してください:", bookmark.name);
                    if (newName === null) return;
                    const result = onRenameBookmark(id, newName);
                    notifyIfRenameError(result);
                    return;
                }

                const deleteBtn = target.closest(".bookmark-delete-btn");
                if (deleteBtn) {
                    e.stopPropagation();
                    if (confirm(`ブックマーク「${bookmark.name}」を削除しますか？`)) {
                        const result = onDeleteBookmark(id);
                        if (result.ok === true) {
                            bookmarkNotifications.notifyBookmarkDeleted(bookmark.name);
                        } else {
                            if (!notifyIfBookmarkSaveError(result)) {
                                notifyIfBookmarkNotFoundError(result);
                            }
                        }
                    }
                    return;
                }

                if (data.activeBookmark === id) {
                    clearActiveBookmark();
                } else {
                    setActiveBookmark(id);
                }
            });

            return item;
        }));
    }

    /**
     * 新規ブックマークを作成し、保留中の曲を追加する。
     */
    function createBookmarkFromPanel() {
        const nameInput = ui.el.bookmarkPanelNewName;
        if (!nameInput) return;

        const newName = nameInput.value.trim();
        if (!newName) {
            showBookmarkPanelError("ブックマーク名を入力してください。");
            nameInput.focus();
            return;
        }

        clearBookmarkPanelError();

        const pendingSongKey = bookmarkPanelUi.pendingAction?.songKey;
        const result = pendingSongKey
            ? onCreateBookmarkAndAdd(newName, pendingSongKey)
            : onCreateBookmark(newName);
        if (result.ok === true) {
            nameInput.value = "";
            clearBookmarkPanelError();
            if (pendingSongKey) {
                bookmarkNotifications.notifySongSavedToBookmark(newName, pendingSongKey, { createdBookmark: true });
                closeBookmarkModal();
            } else {
                bookmarkNotifications.notifyBookmarkCreated(newName);
                renderBookmarks();
                nameInput.focus();
            }
            return;
        }
        if (result.reason === "empty_name") {
            showBookmarkPanelError("ブックマーク名を入力してください。");
            nameInput.focus();
            return;
        }
        if (result.reason === "max_bookmark_name_length") {
            const limit = Number.isFinite(result.limit) ? result.limit : null;
            showBookmarkPanelError(limit === null
                ? "ブックマーク名の文字数上限を超えています。"
                : `ブックマーク名は最大${limit}文字までです。`);
            nameInput.focus();
            return;
        }
        if (!notifyIfBookmarkSaveError(result)) {
            notifyIfLimitError(result);
        }
    }

    /**
     * ブックマークパネルのイベントを登録する。
     */
    function setupBookmarkHandlers() {
        const createBtn = ui.el.bookmarkPanelCreateBtn;
        const nameInput = ui.el.bookmarkPanelNewName;
        const exportBtn = ui.el.bookmarkPanelExportBtn;
        const importBtn = ui.el.bookmarkPanelImportBtn;
        const importInput = ui.el.bookmarkPanelImportInput;
        if (createBtn) {
            createBtn.addEventListener("click", createBookmarkFromPanel);
        }
        if (nameInput) {
            nameInput.addEventListener("input", clearBookmarkPanelError);
            nameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    createBookmarkFromPanel();
                }
            });
        }
        if (exportBtn) {
            exportBtn.addEventListener("click", exportBookmarksFromPanel);
        }
        if (importBtn) {
            importBtn.addEventListener("click", requestBookmarkImportFile);
        }
        if (importInput) {
            importInput.addEventListener("change", importBookmarksFromSelectedFile);
        }
    }

    /**
     * 閲覧モードでブックマークパネルを開く。
     * @param {{ returnFocusEl?: Element | null | undefined } | undefined} [options]
     */
    function openBookmarkBrowser(options?: { returnFocusEl?: Element | null | undefined }) {
        bookmarkPanelUi.pendingAction = null;
        bookmarkPanelUi.exitClosesSidebar = false;
        clearBookmarkPanelError();
        renderBookmarks();
        showBookmarkPanel({
            returnFocusEl: options?.returnFocusEl,
            focusEl: ui.el.closeBookmarkPanelBtn
        });
    }

    /**
     * 指定した曲を追加するためのブックマーク選択パネルを開く。
     * @param {string} songKey
     * @param {{
     *   closeSidebarOnExit?: boolean,
     *   returnFocusEl?: Element | null | undefined
     * } | undefined} [options]
     */
    function openBookmarkModal(
        songKey: string,
        options?: {
            closeSidebarOnExit?: boolean;
            returnFocusEl?: Element | null | undefined;
        }
    ) {
        bookmarkPanelUi.pendingAction = { songKey };
        bookmarkPanelUi.exitClosesSidebar = Boolean(options?.closeSidebarOnExit);
        clearBookmarkPanelError();
        renderBookmarks();
        showBookmarkPanel({
            returnFocusEl: options?.returnFocusEl,
            focusEl: ui.el.bookmarkPanelNewName || ui.el.closeBookmarkPanelBtn
        });
    }

    /**
     * ブックマーク追加モードを終了し、専用パネルを閉じる。
     * @param {{ restoreFocus?: boolean } | undefined} [options]
     */
    function closeBookmarkModal(options?: { restoreFocus?: boolean }) {
        const shouldCloseSidebar =
            Boolean(options?.restoreFocus) &&
            Boolean(bookmarkPanelUi.exitClosesSidebar);
        bookmarkPanelUi.pendingAction = null;
        bookmarkPanelUi.exitClosesSidebar = false;
        clearBookmarkPanelError();
        hideBookmarkPanel({ restoreFocus: options?.restoreFocus && !shouldCloseSidebar });
        renderBookmarks();
        if (shouldCloseSidebar) {
            bookmarkPanelUi.returnFocusEl = null;
            onRequestCloseSidebar();
            return;
        }
    }

    /**
     * ブックマーク選択の意図を状態管理側へ通知する。
     * @param {string} bookmarkId
     */
    function setActiveBookmark(bookmarkId: string) {
        onSelectActiveBookmark(bookmarkId);
    }

    /**
     * ブックマーク選択解除の意図を状態管理側へ通知する。
     */
    function clearActiveBookmark() {
        onClearActiveBookmark();
    }

    /**
     * 現在アクティブなブックマークから指定曲を削除する。
     * @param {string} songKey
     */
    function removeSongFromActiveBookmark(songKey: string) {
        if (!data.activeBookmark) return;
        const bookmarkId = data.activeBookmark;
        const bookmark = data.bookmarks[data.activeBookmark];
        const bookmarkName = bookmark ? bookmark.name : "";
        const result = onRemoveSongFromBookmark(bookmarkId, songKey);
        if (result.ok && bookmarkName) {
            bookmarkNotifications.notifySongRemovedFromBookmark(bookmarkName, songKey);
            return;
        }
        notifyIfBookmarkSaveError(result);
    }

    return {
        setupBookmarkHandlers,
        renderBookmarks,
        openBookmarkBrowser,
        openBookmarkModal,
        closeBookmarkModal,
        setActiveBookmark,
        clearActiveBookmark,
        notifyBookmarkSaveError,
        removeSongFromActiveBookmark
    };
}
