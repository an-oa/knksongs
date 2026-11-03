import { getSongDisplayTitle } from "../../lib/song-display-name.mjs";
import { getBookmarkText } from "./text.mjs";
import type { LocalizedText } from "./text.mjs";
import type { SiteLanguage } from "../../lib/site-language.mjs";
import { resolveSongRef } from "../../lib/song-lookup.mjs";
import type { AppDataState, AppUiState } from "../../state.types";

export const BOOKMARK_NOTIFICATION_TIMEOUT_MS = 4000;

/**
 * timeout handle が Node 互換の unref を持つ場合だけ解放する。
 * @param {ReturnType<typeof setTimeout>} timerId
 */
function unrefTimer(timerId: ReturnType<typeof setTimeout>): void {
    const timerHandle = timerId as { unref?: () => void };
    if (typeof timerHandle.unref === "function") {
        timerHandle.unref();
    }
}

/**
 * toast 要素を popover と DOM から取り除く。
 * @param {HTMLElement | null} toast
 */
function removeToastElement(toast: HTMLElement | null): void {
    if (!toast) return;
    if (typeof toast.hidePopover === "function") {
        try {
            toast.hidePopover();
        } catch {
            // すでに閉じている popover は、そのまま DOM から取り除く。
        }
    }
    if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
    }
}

/**
 * ブックマーク操作の通知表示を管理するコントローラーを作成する。
 */
export function createBookmarkNotificationController({
    data,
    ui,
    timeoutMs = BOOKMARK_NOTIFICATION_TIMEOUT_MS
}: {
    data: Pick<AppDataState, "allSongsRaw">;
    ui: Pick<AppUiState, "lookup" | "language"> & {
        el: Pick<AppUiState["el"], "bookmarkNotificationRegion">;
    };
    timeoutMs?: number;
}) {
    const lookupUi = ui.lookup;
    let currentToast: HTMLElement | null = null;
    /** 表示中の通知の文言の作り方。言語が変わったときに、同じ内容を新しい言語で書き直すために覚えておく。 */
    let currentMessage: LocalizedText | null = null;
    let currentTimerId: ReturnType<typeof setTimeout> | null = null;
    let nextToastSequence = 0;

    /**
     * 自動消去 timer を解除する。
     */
    function clearNotificationTimer(): void {
        if (currentTimerId === null) return;
        clearTimeout(currentTimerId);
        currentTimerId = null;
    }

    /**
     * 表示中のブックマーク通知を消す。
     */
    function dismissBookmarkNotification(): void {
        clearNotificationTimer();
        removeToastElement(currentToast);
        currentToast = null;
        currentMessage = null;
    }

    /**
     * ブックマーク操作の成功を toast と polite live region で通知する。
     * @param message 通知する文言の作り方
     */
    function showBookmarkNotification(message: LocalizedText): void {
        const region = ui.el.bookmarkNotificationRegion;
        const language = ui.language.current;
        const messageText = message(language);
        if (!region || !messageText) return;

        dismissBookmarkNotification();
        region.replaceChildren();

        const toast = document.createElement("div");
        const toastId = `bookmark-toast-${Date.now()}-${++nextToastSequence}`;
        toast.id = toastId;
        toast.className = "bookmark-toast";
        toast.setAttribute("popover", "manual");

        const messageEl = document.createElement("span");
        messageEl.className = "bookmark-toast-message";
        messageEl.textContent = messageText;

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "bookmark-toast-close";
        closeBtn.setAttribute("aria-label", getBookmarkText(language).closeNotification);
        closeBtn.setAttribute("popovertarget", toastId);
        closeBtn.setAttribute("popovertargetaction", "hide");
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", dismissBookmarkNotification);

        toast.append(messageEl, closeBtn);
        region.appendChild(toast);
        currentToast = toast;
        currentMessage = message;

        if (typeof toast.showPopover === "function") {
            try {
                toast.showPopover();
            } catch {
                // Popover 非対応相当の状態では通常要素として表示する。
            }
        }

        currentTimerId = setTimeout(dismissBookmarkNotification, timeoutMs);
        unrefTimer(currentTimerId);
    }

    /**
     * 表示中の通知の文言と閉じるボタンの読み上げ名を、今の言語で書き直す。通知を出していなければ何もしない。
     */
    function refreshText(): void {
        if (!currentToast || !currentMessage) return;
        const language = ui.language.current;
        const messageEl = currentToast.querySelector(".bookmark-toast-message");
        if (messageEl) messageEl.textContent = currentMessage(language);
        currentToast.querySelector(".bookmark-toast-close")
            ?.setAttribute("aria-label", getBookmarkText(language).closeNotification);
    }

    /**
     * ブックマーク保存用の曲参照から、通知に表示する曲名を指定した言語の表記で返す。
     * @param songRef ブックマーク保存用の曲参照
     * @param language 通知の言語
     * @returns 通知に表示する曲名
     */
    function getSongTitleForNotification(songRef: string | null | undefined, language: SiteLanguage): string {
        const song = resolveSongRef(lookupUi, data.allSongsRaw, songRef);
        const title = song ? getSongDisplayTitle(song, language).text.trim() : "";
        return title || getBookmarkText(language).unknownSong;
    }

    /**
     * ブックマーク作成の成功をユーザーへ通知する。
     * @param bookmarkName 作成したブックマークの名前
     */
    function notifyBookmarkCreated(bookmarkName: string): void {
        showBookmarkNotification((language) => getBookmarkText(language).created(bookmarkName));
    }

    /**
     * ブックマーク削除の成功をユーザーへ通知する。
     * @param bookmarkName 削除したブックマークの名前
     */
    function notifyBookmarkDeleted(bookmarkName: string): void {
        showBookmarkNotification((language) => getBookmarkText(language).deleted(bookmarkName));
    }

    /**
     * カードをブックマークへ保存した成功をユーザーへ通知する。
     * @param bookmarkName 保存先のブックマークの名前
     * @param songRef 保存した曲の参照
     * @param options createdBookmark が true なら、ブックマークを作って保存したことを伝える
     */
    function notifySongSavedToBookmark(
        bookmarkName: string,
        songRef: string | null | undefined,
        options?: { createdBookmark?: boolean }
    ): void {
        showBookmarkNotification((language) => {
            const text = getBookmarkText(language);
            const songTitle = getSongTitleForNotification(songRef, language);
            return options?.createdBookmark
                ? text.createdAndSaved(bookmarkName, songTitle)
                : text.saved(bookmarkName, songTitle);
        });
    }

    /**
     * カードをブックマークから削除した成功をユーザーへ通知する。
     * @param bookmarkName 削除元のブックマークの名前
     * @param songRef 削除した曲の参照
     */
    function notifySongRemovedFromBookmark(
        bookmarkName: string,
        songRef: string | null | undefined
    ): void {
        showBookmarkNotification((language) => getBookmarkText(language).removed(
            bookmarkName,
            getSongTitleForNotification(songRef, language)
        ));
    }

    return {
        dismissBookmarkNotification,
        refreshText,
        notifyBookmarkCreated,
        notifyBookmarkDeleted,
        notifySongSavedToBookmark,
        notifySongRemovedFromBookmark
    };
}
