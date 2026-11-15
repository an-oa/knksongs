import { isHtmlElement } from "../dom-utils.mjs";
import type { YoutubePlayerLike } from "./iframe-api.types.mjs";

/** 共有プレーヤー初期化待ち中の最新 iframe 紐付け要求。 */
export type YoutubeSharedPlaybackPendingAttach = {
    /** プレーヤー化する iframe。 */
    iframe: HTMLIFrameElement | null;
    /** iframe を紐付ける再生セッション ID。 */
    playbackSessionId: number;
};

/** 複数カード間で再利用する YouTube 共有 iframe / Player の状態。 */
export type YoutubeSharedPlaybackState = {
    /** 共有 iframe に紐付いた YouTube Player。 */
    player: YoutubePlayerLike | null;
    /** Player 初期化中に共有する Promise。 */
    playerPromise: Promise<YoutubePlayerLike | null> | null;
    /** Player 初期化待ち中に処理する最新の iframe 紐付け要求。 */
    pendingAttach: YoutubeSharedPlaybackPendingAttach | null;
    /** 共有プレーヤーとして使う iframe。 */
    iframe: HTMLIFrameElement | null;
    /** 共有プレーヤーを閉じるボタン。 */
    closeButton: HTMLButtonElement | null;
    /** 現在共有プレーヤーを表示しているサムネイル。 */
    hostThumb: HTMLElement | null;
    /** 現在の共有プレーヤー再生セッション ID。 */
    sessionId: number;
    /** 再生開始待ち中の attempt。 */
    playbackStartAttempt: import("./playback-start-attempt.mjs").YoutubePlaybackStartAttempt | null;
    /** 再生開始が未確定のまま保持されているセッション ID。 */
    unconfirmedPlaybackStartSessionId: number;
};

type SharedPlaybackInput = {
    sharedPlayback?: YoutubeSharedPlaybackState | null;
};

type SharedPlaybackElementsInput = {
    youtube: SharedPlaybackInput;
    syncIframe?: () => HTMLIFrameElement | null;
    createFrame?: () => HTMLIFrameElement | null;
    createCloseButton?: () => HTMLButtonElement | null;
};

type DestroySharedPlaybackPlayerInput = {
    youtube: SharedPlaybackInput;
    syncIframe?: () => HTMLIFrameElement | null;
    debug?: (message: string, details?: Record<string, unknown>) => void;
};

/**
 * 共有埋め込みプレーヤーの保持領域を返す。
 * @param {SharedPlaybackInput} youtube
 */
export function getYoutubeSharedPlaybackState(youtube: SharedPlaybackInput): YoutubeSharedPlaybackState {
    if (!youtube.sharedPlayback) {
        youtube.sharedPlayback = {
            player: null,
            playerPromise: null,
            pendingAttach: null,
            iframe: null,
            closeButton: null,
            hostThumb: null,
            sessionId: 0,
            playbackStartAttempt: null,
            unconfirmedPlaybackStartSessionId: 0
        };
    }
    return youtube.sharedPlayback;
}

/**
 * 共有プレーヤーが内部で置き換えた最新の iframe 要素を同期する。
 * @param {SharedPlaybackInput} youtube
 */
export function syncYoutubeSharedPlaybackIframe(youtube: SharedPlaybackInput): HTMLIFrameElement | null {
    const sharedPlayback = getYoutubeSharedPlaybackState(youtube);
    const player = sharedPlayback.player;
    if (player && typeof player.getIframe === "function") {
        const iframe = player.getIframe();
        if (isHtmlElement(iframe) && iframe.tagName === "IFRAME") {
            sharedPlayback.iframe = iframe as HTMLIFrameElement;
        }
    }
    return sharedPlayback.iframe;
}

/**
 * 共有プレーヤーに紐づく再生セッション ID を設定する。
 * @param {SharedPlaybackInput} youtube
 * @param {number} sessionId
 */
export function setYoutubeSharedPlaybackSessionId(youtube: SharedPlaybackInput, sessionId: number) {
    const sharedPlayback = getYoutubeSharedPlaybackState(youtube);
    sharedPlayback.sessionId = Number.isFinite(sessionId) && sessionId > 0 ? sessionId : 0;
}

/**
 * 共有プレーヤー初期化待ち中に使う最新の紐付け要求を保存する。
 * @param {SharedPlaybackInput} youtube
 * @param {HTMLIFrameElement | null} iframe
 * @param {number} playbackSessionId
 */
export function setPendingYoutubeSharedPlaybackAttach(
    youtube: SharedPlaybackInput,
    iframe: HTMLIFrameElement | null,
    playbackSessionId: number
) {
    const sharedPlayback = getYoutubeSharedPlaybackState(youtube);
    sharedPlayback.pendingAttach = {
        iframe,
        playbackSessionId
    };
}

/**
 * 指定セッションの現在の再生サムネイルを返す。
 * @param {SharedPlaybackInput} youtube
 * @param {number} sessionId
 */
export function getYoutubeSharedPlaybackThumb(youtube: SharedPlaybackInput, sessionId: number): HTMLElement | null {
    const sharedPlayback = getYoutubeSharedPlaybackState(youtube);
    if (!(Number.isFinite(sessionId) && sessionId > 0)) return null;
    if (sharedPlayback.sessionId !== sessionId) return null;
    return isHtmlElement(sharedPlayback.hostThumb) ? sharedPlayback.hostThumb : null;
}

/**
 * 共有 iframe と閉じるボタンを必要に応じて生成する。
 * @param {SharedPlaybackElementsInput} input
 */
export function ensureYoutubeSharedPlaybackElements({
    youtube,
    syncIframe,
    createFrame,
    createCloseButton
}: SharedPlaybackElementsInput): YoutubeSharedPlaybackState {
    const sharedPlayback = getYoutubeSharedPlaybackState(youtube);
    if (typeof syncIframe === "function") {
        syncIframe();
    }
    if (!isHtmlElement(sharedPlayback.iframe)) {
        sharedPlayback.iframe = typeof createFrame === "function" ? createFrame() : null;
    }
    if (!isHtmlElement(sharedPlayback.closeButton)) {
        sharedPlayback.closeButton = typeof createCloseButton === "function"
            ? createCloseButton()
            : null;
    }
    return sharedPlayback;
}

/**
 * 共有プレーヤー実体とカードへの紐付けを破棄する。
 * 再生成前に作成した playbackStartAttempt と未確定セッションは保持し、
 * その完了・解除は各管理モジュールへ委ねる。閉じるボタンも再利用する。
 * @param {DestroySharedPlaybackPlayerInput} input
 */
export function destroyYoutubeSharedPlaybackPlayer({ youtube, syncIframe, debug }: DestroySharedPlaybackPlayerInput) {
    const sharedPlayback = getYoutubeSharedPlaybackState(youtube);
    const iframe = (typeof syncIframe === "function" ? syncIframe() : null) || sharedPlayback.iframe;
    if (typeof debug === "function") {
        debug("destroySharedPlaybackPlayer", {
            hasPlayer: Boolean(sharedPlayback.player),
            hasIframe: isHtmlElement(iframe)
        });
    }
    if (sharedPlayback.player && typeof sharedPlayback.player.destroy === "function") {
        try {
            sharedPlayback.player.destroy();
        } catch {
            if (typeof debug === "function") {
                debug("destroySharedPlaybackPlayer failed");
            }
        }
    }
    if (isHtmlElement(iframe) && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
    }
    if (isHtmlElement(sharedPlayback.closeButton) && sharedPlayback.closeButton.parentNode) {
        sharedPlayback.closeButton.parentNode.removeChild(sharedPlayback.closeButton);
    }
    sharedPlayback.player = null;
    sharedPlayback.playerPromise = null;
    sharedPlayback.pendingAttach = null;
    sharedPlayback.iframe = null;
    sharedPlayback.hostThumb = null;
    sharedPlayback.sessionId = 0;
}
