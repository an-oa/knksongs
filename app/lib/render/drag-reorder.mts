import { isHtmlElement } from "../dom-utils.mjs";
import type { BookmarkRecord } from "../../state.types";

type BookmarkDragReorderDataState = {
    activeBookmark: string | null;
    bookmarks: Record<string, BookmarkRecord>;
    currentResults: Song[];
};

type BookmarkDragDataTransfer = {
    setData: (format: string, data: string) => void;
    getData: (format: string) => string;
    effectAllowed: string;
};

type BookmarkDragEvent = {
    currentTarget?: EventTarget | null;
    target?: EventTarget | null;
    dataTransfer: BookmarkDragDataTransfer;
    preventDefault: () => void;
};

export type BookmarkDragReorderSaveFailure = {
    ok: false;
    reason: string;
    version?: number;
};

export type BookmarkDragReorderSaveResult =
    | { ok: true }
    | BookmarkDragReorderSaveFailure;

type BookmarkDragReorderControllerInput = {
    data: BookmarkDragReorderDataState;
    getBookmarkSongRef: (row: Song) => string;
    saveBookmarks: (
        bookmarks: Record<string, BookmarkRecord>
    ) => BookmarkDragReorderSaveResult;
    onSaveFailure: (result: BookmarkDragReorderSaveFailure) => void;
    updateDisplay: () => void;
};

/**
 * イベント対象から曲カード要素を返す。
 * @param {unknown} target
 * @returns {HTMLElement | null}
 */
function getSongCardFromTarget(target: unknown): HTMLElement | null {
    if (!isHtmlElement(target)) return null;
    const card = (target as HTMLElement).closest(".song-card");
    return isHtmlElement(card) ? card as HTMLElement : null;
}

/**
 * ブックマーク表示中のカードドラッグ並べ替えを扱うコントローラーを作成する。
 */
export function createBookmarkDragReorderController(input: BookmarkDragReorderControllerInput) {
    const {
        data,
        getBookmarkSongRef,
        saveBookmarks,
        onSaveFailure,
        updateDisplay
    } = input;

    /**
     * 指定した結果順を反映したブックマーク曲順の候補を作る。
     * @param bookmark 現在のブックマーク
     * @param orderedResults 並べ替え後の検索結果
     */
    function buildReorderedBookmarkSongs(
        bookmark: BookmarkRecord,
        orderedResults: Song[]
    ): string[] | null {
        if (!Array.isArray(bookmark.songs) || bookmark.songs.length === 0) return null;

        const orderedKeys = orderedResults
            .map((row) => getBookmarkSongRef(row))
            .filter(Boolean);
        if (orderedKeys.length === 0) return null;

        const reorderSet = new Set(orderedKeys);
        const queue = orderedKeys.slice();
        const nextSongs = bookmark.songs.map((songKey) => {
            if (!reorderSet.has(songKey)) return songKey;
            return queue.length > 0 ? queue.shift() : songKey;
        });

        const changed = nextSongs.some((songKey, idx) => songKey !== bookmark.songs[idx]);
        return changed ? nextSongs : null;
    }

    /**
     * ドラッグ開始時に対象曲キーを dataTransfer へ保存する。
     * @param {BookmarkDragEvent} event
     */
    function onDragStart(event: BookmarkDragEvent): void {
        if (!data.activeBookmark) {
            event.preventDefault();
            return;
        }
        const handle = event.currentTarget;
        if (!isHtmlElement(handle)) return;
        const card = getSongCardFromTarget(handle);
        if (!isHtmlElement(card)) return;
        const songKey = card.dataset.songKey || "";
        if (!songKey) {
            event.preventDefault();
            return;
        }
        event.dataTransfer.setData("text/plain", songKey);
        event.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
    }

    /**
     * ドラッグ終了時の一時スタイルを解除する。
     * @param {BookmarkDragEvent} event
     */
    function onDragEnd(event: BookmarkDragEvent): void {
        const handle = event.currentTarget;
        if (!isHtmlElement(handle)) return;
        const card = getSongCardFromTarget(handle);
        if (!isHtmlElement(card)) return;
        card.classList.remove("dragging");
        card.classList.remove("drag-over");
    }

    /**
     * ドロップ候補カードのハイライトを更新する。
     * @param {BookmarkDragEvent} event
     */
    function onDragOver(event: BookmarkDragEvent): void {
        if (!data.activeBookmark) return;
        event.preventDefault();
        const targetCard = getSongCardFromTarget(event.target);
        if (!isHtmlElement(targetCard)) return;
        targetCard.classList.add("drag-over");
    }

    /**
     * ドロップ候補カードのハイライトを解除する。
     * @param {BookmarkDragEvent} event
     */
    function onDragLeave(event: BookmarkDragEvent): void {
        const targetCard = getSongCardFromTarget(event.target);
        if (!isHtmlElement(targetCard)) return;
        targetCard.classList.remove("drag-over");
    }

    /**
     * ドロップ先に合わせて結果順とブックマーク保存順を更新する。
     * @param {BookmarkDragEvent} event
     */
    function onDrop(event: BookmarkDragEvent): void {
        const bookmarkId = data.activeBookmark;
        if (!bookmarkId) return;
        event.preventDefault();
        const draggedKey = event.dataTransfer.getData("text/plain");
        const targetCard = getSongCardFromTarget(event.target);
        if (!isHtmlElement(targetCard)) return;
        targetCard.classList.remove("drag-over");

        const targetKey = targetCard.dataset.songKey;
        if (draggedKey === targetKey) return;

        const fromIndex = data.currentResults.findIndex((song) => song.songKey === draggedKey);
        const toIndex = data.currentResults.findIndex((song) => song.songKey === targetKey);

        if (fromIndex === -1 || toIndex === -1) return;

        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return;

        const nextResults = data.currentResults.slice();
        const [movedItem] = nextResults.splice(fromIndex, 1);
        nextResults.splice(toIndex, 0, movedItem);
        const nextSongs = buildReorderedBookmarkSongs(bookmark, nextResults);
        if (!nextSongs) return;

        const nextBookmarks = {
            ...data.bookmarks,
            [bookmarkId]: { ...bookmark, songs: nextSongs }
        };
        const saveResult = saveBookmarks(nextBookmarks);
        if (saveResult.ok === false) {
            onSaveFailure(saveResult);
            return;
        }

        data.currentResults.splice(0, data.currentResults.length, ...nextResults);
        data.bookmarks = nextBookmarks;
        updateDisplay();
    }

    return {
        onDragStart,
        onDragEnd,
        onDragOver,
        onDragLeave,
        onDrop
    };
}
