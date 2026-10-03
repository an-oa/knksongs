import type { StorageActionFailure, StorageActionResult } from "../../controllers/storage.mjs";
import { isHtmlElement } from "../dom-utils.mjs";

type BookmarkDragReorderDataState = {
    activeBookmark: string | null;
};

type BookmarkDragDataTransfer = {
    setData: (format: string, data: string) => void;
    getData: (format: string) => string;
    effectAllowed: string;
};

type BookmarkDragEvent = {
    currentTarget?: EventTarget | null;
    target?: EventTarget | null;
    dataTransfer: BookmarkDragDataTransfer | null;
    preventDefault: () => void;
};

type BookmarkDragReorderControllerInput = {
    data: BookmarkDragReorderDataState;
    moveSongInActiveBookmark: (fromSongKey: string, toSongKey: string) => StorageActionResult<{ ok: true; changed: boolean }>;
    onSaveFailure: (result: StorageActionFailure) => void;
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
        moveSongInActiveBookmark,
        onSaveFailure
    } = input;

    /**
     * ドラッグ開始時に対象曲キーを dataTransfer へ保存する。
     * @param {BookmarkDragEvent} event
     */
    function onDragStart(event: BookmarkDragEvent): void {
        if (!data.activeBookmark || !event.dataTransfer) {
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
     * 移動元・移動先の曲キーをブックマーク操作 API へ通知する。
     * @param {BookmarkDragEvent} event
     */
    function onDrop(event: BookmarkDragEvent): void {
        const bookmarkId = data.activeBookmark;
        if (!bookmarkId || !event.dataTransfer) return;
        event.preventDefault();
        const draggedKey = event.dataTransfer.getData("text/plain");
        const targetCard = getSongCardFromTarget(event.target);
        if (!isHtmlElement(targetCard)) return;
        targetCard.classList.remove("drag-over");

        const targetKey = targetCard.dataset.songKey || "";
        if (!draggedKey || !targetKey || draggedKey === targetKey) return;
        const saveResult = moveSongInActiveBookmark(draggedKey, targetKey);
        if (saveResult.ok === false) {
            onSaveFailure(saveResult);
            return;
        }
    }

    return {
        onDragStart,
        onDragEnd,
        onDragOver,
        onDragLeave,
        onDrop
    };
}
