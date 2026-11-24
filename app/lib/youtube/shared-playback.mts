import { isHtmlElement } from "../dom-utils.mjs";
import type { YoutubePlayerLike } from "./iframe-api.types.mjs";

/**
 * カードが順に使う、YouTube の iframe と Player の状態。同時に 1 つだけで、再生のたびに作り直す。
 * 破棄のたびに消えるのは Player・iframe・載せているサムネイル・セッション ID で、
 * 閉じるボタンと、再生開始の待ちと未確定の記録は、作り直しをまたいで残す。
 */
export type YoutubeSharedPlaybackState = {
    /** iframe に紐付いた YouTube Player。 */
    player: YoutubePlayerLike | null;
    /** 今の再生に使う iframe。 */
    iframe: HTMLIFrameElement | null;
    /** 再生を閉じるボタン。作り直さずに次の再生でも使う。 */
    closeButton: HTMLButtonElement | null;
    /** iframe を載せているサムネイル。 */
    hostThumb: HTMLElement | null;
    /** 今の Player のイベントをカードへ対応付ける再生セッション ID。 */
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
    createFrame?: () => HTMLIFrameElement | null;
    createCloseButton?: () => HTMLButtonElement | null;
};

type DestroySharedPlaybackPlayerInput = {
    youtube: SharedPlaybackInput;
    syncIframe?: () => HTMLIFrameElement | null;
    debug?: (message: string, details?: Record<string, unknown>) => void;
};

/**
 * 埋め込みプレーヤーの保持領域を返す。まだなければ空の状態で作る。
 * @param youtube 保持領域を持つ YouTube のランタイム状態
 */
export function getYoutubeSharedPlaybackState(youtube: SharedPlaybackInput): YoutubeSharedPlaybackState {
    if (!youtube.sharedPlayback) {
        youtube.sharedPlayback = {
            player: null,
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
 * 次の再生に使う iframe を新しく作り、閉じるボタンはまだなければ作る。
 * iframe は再生のたびに作り直すので、前の iframe を destroyYoutubeSharedPlaybackPlayer で破棄してから呼ぶ。
 * @param input 状態の保持領域と、iframe・閉じるボタンを作る関数
 */
export function prepareYoutubeSharedPlaybackElements({
    youtube,
    createFrame,
    createCloseButton
}: SharedPlaybackElementsInput): YoutubeSharedPlaybackState {
    const sharedPlayback = getYoutubeSharedPlaybackState(youtube);
    sharedPlayback.iframe = typeof createFrame === "function" ? createFrame() : null;
    if (!isHtmlElement(sharedPlayback.closeButton)) {
        sharedPlayback.closeButton = typeof createCloseButton === "function"
            ? createCloseButton()
            : null;
    }
    return sharedPlayback;
}

/**
 * Player と iframe、カードへの紐付けを破棄する。
 * 作り直す前に作成した playbackStartAttempt と未確定セッションは保持し、
 * その完了・解除は各管理モジュールへ委ねる。閉じるボタンは次の再生でも使うので残す。
 * @param input 状態の保持領域と、iframe の同期・デバッグ出力の関数
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
    sharedPlayback.iframe = null;
    sharedPlayback.hostThumb = null;
    sharedPlayback.sessionId = 0;
}
