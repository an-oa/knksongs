import { createBookmarkNotificationController } from "./notifications.mjs";
import { getBookmarkIdsInListOrder, refreshBookmarkPanelError, setBookmarkPanelError } from "./panel.mjs";
import { createSidebarSubpanelController } from "../sidebar/subpanel.mjs";
import { isHtmlElement } from "../../lib/dom-utils.mjs";
import { getBookmarkText } from "./text.mjs";
import type { LocalizedText } from "./text.mjs";
import type { AppDataState, AppUiState } from "../../state.types";
import type { StorageActionResult } from "../../controllers/storage.mjs";

/** 一覧項目内で、再描画後もフォーカスを戻す対象にする操作ボタン。 */
const BOOKMARK_ITEM_CONTROL_SELECTORS = [
    ".bookmark-item-select",
    ".bookmark-rename-btn",
    ".bookmark-delete-btn"
] as const;

/** 再描画の直前に一覧内でフォーカスされていた操作。 */
type BookmarkListFocus = {
    bookmarkId: string;
    controlSelector: typeof BOOKMARK_ITEM_CONTROL_SELECTORS[number];
    /** 項目が消えた場合に、近い位置の項目へフォーカスを移すための並び位置。 */
    index: number;
};

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
};

type BookmarkUiControllerInput = {
    data: Pick<AppDataState, "allSongsRaw" | "bookmarks" | "activeBookmark">;
    ui: Pick<AppUiState, "el" | "lookup" | "bookmarkPanel" | "language">;
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

    /**
     * サイトの言語のブックマークの文言を返す。
     * @returns ブックマークの文言
     */
    function getText() {
        return getBookmarkText(ui.language.current);
    }
    const {
        onSelectActiveBookmark,
        onClearActiveBookmark,
        onAddSongToBookmark,
        onCreateBookmark,
        onCreateBookmarkAndAdd,
        onDeleteBookmark,
        onRenameBookmark,
        onRemoveSongFromBookmark,
        onRequestCloseSidebar
    } = callbacks;

    /**
     * 上限エラー時に理由別のメッセージを表示し、通知したかどうかを返す。
     * @param result 保存・変更の結果
     * @returns 通知した場合は true
     */
    function notifyIfLimitError(result: StorageActionResult): boolean {
        if (result.ok === true) return false;
        if (result.reason === "max_bookmark_count") {
            const limit = Number.isFinite(result.limit) ? result.limit : null;
            if (limit === null) {
                alert(getText().bookmarkLimitReached);
            } else {
                alert(getText().maxBookmarks(limit));
            }
            return true;
        }
        if (result.reason === "max_songs_per_bookmark") {
            const limit = Number.isFinite(result.limit) ? result.limit : null;
            if (limit === null) {
                alert(getText().songLimitReached);
            } else {
                alert(getText().maxSongs(limit));
            }
            return true;
        }
        return false;
    }

    /**
     * ブックマークが見つからない失敗を共通文言で通知する。
     * @param result 保存・変更の結果
     * @returns 通知した場合は true
     */
    function notifyIfBookmarkNotFoundError(result: StorageActionResult): boolean {
        if (result.ok === true || result.reason !== "bookmark_not_found") return false;
        alert(getText().notFound);
        return true;
    }

    /**
     * ブックマーク永続化の失敗を理由別のメッセージで通知する。
     * @param result 保存・変更の結果
     * @returns 通知した場合は true
     */
    function notifyIfBookmarkSaveError(result: StorageActionResult): boolean {
        if (result.ok === true) return false;
        if (result.reason === "unsupported_storage_version") {
            alert(getText().newerStorage);
            return true;
        }
        if (result.reason === "storage_reload_required") {
            alert(getText().reloadRequired);
            return true;
        }
        if (result.reason === "storage_write_failed") {
            alert(getText().saveFailed);
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
     * @param result 保存・変更の結果
     * @returns 通知した場合は true
     */
    function notifyIfRenameError(result: StorageActionResult): boolean {
        if (result.ok === true) return false;
        if (notifyIfBookmarkSaveError(result)) return true;
        if (result.reason === "empty_name") {
            alert(getText().nameRequired);
            return true;
        }
        if (result.reason === "max_bookmark_name_length") {
            const limit = Number.isFinite(result.limit) ? result.limit : null;
            alert(limit === null ? getText().nameTooLong : getText().maxNameLength(limit));
            return true;
        }
        if (notifyIfBookmarkNotFoundError(result)) return true;
        return false;
    }

    /**
     * 曲追加失敗時に理由別メッセージを表示し、通知したかどうかを返す。
     * @param result 保存・変更の結果
     * @returns 通知した場合は true
     */
    function notifyIfAddSongError(result: StorageActionResult): boolean {
        if (result.ok === true) return false;
        if (notifyIfBookmarkSaveError(result)) return true;
        if (notifyIfLimitError(result)) return true;
        if (result.reason === "duplicate_song") {
            alert(getText().alreadyAdded);
            return true;
        }
        if (notifyIfBookmarkNotFoundError(result)) return true;
        return false;
    }

    /**
     * ブックマークIDを作成日時順で取得する。
     */
    function getSortedBookmarkIds() {
        return getBookmarkIdsInListOrder(data.bookmarks);
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
     * 作成欄のインラインエラーを表示する。言語が変わったら、同じ内容を新しい言語で書き直す。
     * @param message 表示する文言の作り方
     */
    function showBookmarkPanelError(message: LocalizedText) {
        setBookmarkPanelError(ui.el.bookmarkPanelError, message, ui.language.current);
    }

    /**
     * 作成欄のインラインエラーをクリアする。
     */
    function clearBookmarkPanelError() {
        setBookmarkPanelError(ui.el.bookmarkPanelError, null, ui.language.current);
    }

    /**
     * ブックマークを追加モード/閲覧モードに応じて描画する。
     * 一覧内にフォーカスがあった場合は、項目を作り直した後も同じ操作へフォーカスを戻す。
     */
    function renderBookmarks() {
        const container = ui.el.bookmarkList;
        if (!container) return;

        const listFocus = captureBookmarkListFocus(container);
        const sortedIds = getSortedBookmarkIds();
        if (sortedIds.length === 0) {
            container.replaceChildren(createEmptyBookmarkElement(getText().empty));
        } else {
            const addingMode = isAddingSongMode();
            container.replaceChildren(...sortedIds.map((id) => createBookmarkItemElement(id, addingMode)));
        }
        restoreBookmarkListFocus(container, listFocus);
    }

    /**
     * ブックマーク 1 件分の一覧項目を作る。
     * キーボードで操作できるよう選択用の button を置き、閲覧モードの変更・削除ボタンは
     * button の入れ子にならないよう兄弟要素として並べる。
     * @param bookmarkId 描画するブックマークの ID
     * @param addingMode 曲の追加先を選ぶモードで描画するかどうか
     * @returns ブックマークの一覧項目
     */
    function createBookmarkItemElement(bookmarkId: string, addingMode: boolean): HTMLElement {
        const bookmark = data.bookmarks[bookmarkId];
        const item = document.createElement("div");
        item.className = "bookmark-item";
        item.dataset.bookmarkId = bookmarkId;

        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "bookmark-item-select";
        const nameEl = document.createElement("span");
        nameEl.className = "bookmark-item-name";
        nameEl.textContent = bookmark.name;
        nameEl.title = bookmark.name;
        const countEl = document.createElement("span");
        countEl.className = "bookmark-item-count";
        countEl.textContent = String(bookmark.songs.length);
        selectButton.append(nameEl, countEl);
        item.append(selectButton);

        if (addingMode) {
            item.classList.add("bookmark-item-selecting");
        } else {
            const isActive = data.activeBookmark === bookmarkId;
            if (isActive) item.classList.add("active");
            selectButton.setAttribute("aria-pressed", isActive ? "true" : "false");

            const renameButton = document.createElement("button");
            renameButton.type = "button";
            renameButton.className = "bookmark-rename-btn";
            renameButton.setAttribute("aria-label", getText().renameLabel);
            renameButton.textContent = getText().rename;
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "bookmark-delete-btn";
            deleteButton.setAttribute("aria-label", getText().deleteLabel);
            const deleteMark = document.createElement("span");
            deleteMark.textContent = "×";
            deleteButton.append(deleteMark);
            item.append(renameButton, deleteButton);
        }

        item.addEventListener("click", (e) => {
            handleBookmarkItemClick(e, bookmarkId, bookmark.name, addingMode);
        });
        return item;
    }

    /**
     * 一覧項目内のクリックを、曲の追加・名前の変更・削除・選択の切り替えへ振り分ける。
     * 選択用 button の Enter / Space 操作も click として届く。
     * @param e 一覧項目で受け取った click イベント
     * @param bookmarkId 操作対象のブックマーク ID
     * @param bookmarkName 確認・通知に使うブックマーク名
     * @param addingMode 曲の追加先を選ぶモードで描画した項目かどうか
     */
    function handleBookmarkItemClick(e: Event, bookmarkId: string, bookmarkName: string, addingMode: boolean): void {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        if (addingMode) {
            const pendingSongKey = bookmarkPanelUi.pendingAction?.songKey;
            if (!pendingSongKey) return;
            const result = onAddSongToBookmark(bookmarkId, pendingSongKey);
            if (result.ok === true) {
                bookmarkNotifications.notifySongSavedToBookmark(bookmarkName, pendingSongKey);
                // 戻るボタンや Esc と同じ終了処理で、カードから開いたサイドバーを閉じて操作元へ戻す。
                closeBookmarkModal({ restoreFocus: true });
                return;
            }
            notifyIfAddSongError(result);
            return;
        }

        const renameBtn = target.closest(".bookmark-rename-btn");
        if (renameBtn) {
            e.stopPropagation();
            const newName = prompt(getText().renamePrompt, bookmarkName);
            if (newName === null) return;
            const result = onRenameBookmark(bookmarkId, newName);
            notifyIfRenameError(result);
            return;
        }

        const deleteBtn = target.closest(".bookmark-delete-btn");
        if (deleteBtn) {
            e.stopPropagation();
            if (confirm(getText().deleteConfirm(bookmarkName))) {
                const result = onDeleteBookmark(bookmarkId);
                if (result.ok === true) {
                    bookmarkNotifications.notifyBookmarkDeleted(bookmarkName);
                } else {
                    if (!notifyIfBookmarkSaveError(result)) {
                        notifyIfBookmarkNotFoundError(result);
                    }
                }
            }
            return;
        }

        if (data.activeBookmark === bookmarkId) {
            clearActiveBookmark();
        } else {
            setActiveBookmark(bookmarkId);
        }
    }

    /**
     * 項目を作り直す前に、一覧内でフォーカスされている操作を記録する。
     * @param container ブックマーク一覧の要素
     * @returns 記録したフォーカス。一覧の外にフォーカスがある場合は null
     */
    function captureBookmarkListFocus(container: HTMLElement): BookmarkListFocus | null {
        const active = document.activeElement;
        if (!isHtmlElement(active) || !container.contains(active)) return null;
        const item = active.closest(".bookmark-item");
        if (!isHtmlElement(item) || !item.dataset.bookmarkId) return null;
        const controlSelector = BOOKMARK_ITEM_CONTROL_SELECTORS.find((selector) => active.closest(selector) !== null) ??
            ".bookmark-item-select";
        return {
            bookmarkId: item.dataset.bookmarkId,
            controlSelector,
            index: Array.from(container.children).indexOf(item)
        };
    }

    /**
     * 作り直した一覧で、同じブックマークの同じ操作へフォーカスを戻す。
     * 削除などで項目がなくなった場合は同じ位置の項目へ、項目が残っていなければ作成欄へ移す。
     * @param container ブックマーク一覧の要素
     * @param listFocus 再描画の直前に記録したフォーカス
     */
    function restoreBookmarkListFocus(container: HTMLElement, listFocus: BookmarkListFocus | null): void {
        if (!listFocus) return;
        const items = Array.from(container.querySelectorAll(".bookmark-item")).filter(isHtmlElement);
        const sameItem = items.find((item) => item.dataset.bookmarkId === listFocus.bookmarkId);
        const nearbyItem = items[Math.min(listFocus.index, items.length - 1)];
        const target = sameItem
            ? sameItem.querySelector(listFocus.controlSelector) ?? sameItem.querySelector(".bookmark-item-select")
            : nearbyItem?.querySelector(".bookmark-item-select") ?? ui.el.bookmarkPanelNewName;
        if (isHtmlElement(target)) target.focus();
    }

    /**
     * 新規ブックマークを作成し、保留中の曲を追加する。
     */
    function createBookmarkFromPanel() {
        const nameInput = ui.el.bookmarkPanelNewName;
        if (!nameInput) return;

        const newName = nameInput.value.trim();
        if (!newName) {
            showBookmarkPanelError((language) => getBookmarkText(language).nameRequired);
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
                // 既存ブックマークへの追加と同じく、Esc と同じ終了処理で操作元へ戻す。
                closeBookmarkModal({ restoreFocus: true });
            } else {
                bookmarkNotifications.notifyBookmarkCreated(newName);
                renderBookmarks();
                nameInput.focus();
            }
            return;
        }
        if (result.reason === "empty_name") {
            showBookmarkPanelError((language) => getBookmarkText(language).nameRequired);
            nameInput.focus();
            return;
        }
        if (result.reason === "max_bookmark_name_length") {
            const limit = Number.isFinite(result.limit) ? result.limit : null;
            showBookmarkPanelError((language) => {
                const text = getBookmarkText(language);
                return limit === null ? text.nameTooLong : text.maxNameLength(limit);
            });
            nameInput.focus();
            return;
        }
        if (!notifyIfBookmarkSaveError(result)) {
            notifyIfLimitError(result);
        }
    }

    /**
     * ブックマークパネルの作成欄のイベントを登録する。
     * エクスポート・インポートのイベントは、入出力の controller が登録する。
     */
    function setupBookmarkHandlers() {
        const createBtn = ui.el.bookmarkPanelCreateBtn;
        const nameInput = ui.el.bookmarkPanelNewName;
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

    /**
     * 一覧と、パネル上部のエラー欄・表示中の通知の文言を、今の言語で書き直す。言語の切り替えで使う。
     */
    function refreshText(): void {
        renderBookmarks();
        refreshBookmarkPanelError(ui.el.bookmarkPanelError, ui.language.current);
        bookmarkNotifications.refreshText();
    }

    return {
        setupBookmarkHandlers,
        renderBookmarks,
        refreshText,
        openBookmarkBrowser,
        openBookmarkModal,
        closeBookmarkModal,
        setActiveBookmark,
        clearActiveBookmark,
        notifyBookmarkSaveError,
        removeSongFromActiveBookmark
    };
}
