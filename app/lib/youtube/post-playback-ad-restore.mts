import { isHtmlElement } from "../dom-utils.mjs";
import {
    readYoutubePlayerCurrentTime,
    readYoutubePlayerDuration,
    readYoutubePlayerState,
    YOUTUBE_PLAYER_STATE
} from "./player-state.mjs";
import type { YoutubePlayerLike } from "./iframe-api.types.mjs";

export const YOUTUBE_POST_PLAYBACK_AD_RESTORE_POLL_MS = 500;
export const YOUTUBE_POST_PLAYBACK_AD_RESTORE_TIMEOUT_MS = 5 * 60 * 1000;

const YOUTUBE_PLAYBACK_END_TOLERANCE_SECONDS = 1.5;

type YoutubePostPlaybackAdRestoreWatch = {
    sessionId: number;
    startedAt: number;
    timeoutId: ReturnType<typeof setTimeout> | null;
};

type YoutubePostPlaybackAdRestoreTimeout = ReturnType<typeof setTimeout> & {
    unref?: () => void;
};

type YoutubePostPlaybackAdRestoreManagerInput = {
    getPlayer: () => YoutubePlayerLike | null | undefined;
    getThumbForSession: (sessionId: number) => HTMLElement | null;
    isCurrentSession: (thumbDiv: Element | null | undefined, sessionId: number) => boolean;
    getExpectedPlaybackEndSeconds: (thumbDiv: Element | null | undefined) => number | null;
    completeEndedPlayback: (thumbDiv: HTMLElement, sessionId: number) => void;
    debug?: (message: string, details?: Record<string, unknown>) => void;
    now?: () => number;
    pollMs?: number;
    timeoutMs?: number;
};

type YoutubePostPlaybackAdWatchingStateEvent = {
    playbackSessionId: number;
    eventState?: number;
    currentPlayerState: number | null;
};

type YoutubePostPlaybackAdStaleEndedState = {
    thumbDiv: HTMLElement;
    playbackSessionId: number;
    eventState?: number;
    currentPlayerState: number | null;
    player: YoutubePlayerLike | null | undefined;
};

type YoutubePostPlaybackAdRestoreManager = {
    clear: () => void;
    isWatching: (playbackSessionId: number) => boolean;
    handleWatchingStateEvent: (event: YoutubePostPlaybackAdWatchingStateEvent) => boolean;
    handleStaleEndedState: (event: YoutubePostPlaybackAdStaleEndedState) => boolean;
};

/**
 * プレーヤーが指定された再生終了位置に到達しているか返す。
 * 本番では manager 経由で使い、境界条件を単体テストするために export している。
 * @param {YoutubePlayerLike | null | undefined} player
 * @param {number | null | undefined} expectedEndSeconds
 * @returns {boolean}
 */
export function hasReachedYoutubePlaybackEnd(
    player: YoutubePlayerLike | null | undefined,
    expectedEndSeconds: number | null | undefined
): boolean {
    const currentTime = readYoutubePlayerCurrentTime(player);
    if (typeof currentTime !== "number") return false;
    const targetEndSeconds = Number.isFinite(expectedEndSeconds) && Number(expectedEndSeconds) > 0
        ? Number(expectedEndSeconds)
        : readYoutubePlayerDuration(player);
    if (typeof targetEndSeconds !== "number" || targetEndSeconds <= 0) return false;
    return currentTime >= targetEndSeconds - YOUTUBE_PLAYBACK_END_TOLERANCE_SECONDS;
}

/**
 * 広告を含めてプレーヤーがまだ動いている state か返す。
 * 本番では manager 経由で使い、境界条件を単体テストするために export している。
 * @param {number | null | undefined} playerState
 * @returns {boolean}
 */
export function isPlaybackContinuingPlayerState(playerState: number | null | undefined): boolean {
    return playerState === YOUTUBE_PLAYER_STATE.PLAYING ||
        playerState === YOUTUBE_PLAYER_STATE.BUFFERING;
}

/**
 * 動画後広告が終わった後に見られる停止系 state か返す。
 * 本番では manager 経由で使い、境界条件を単体テストするために export している。
 * @param {number | null | undefined} playerState
 * @returns {boolean}
 */
export function isPostPlaybackAdFinishedPlayerState(playerState: number | null | undefined): boolean {
    return playerState === YOUTUBE_PLAYER_STATE.ENDED ||
        playerState === YOUTUBE_PLAYER_STATE.PAUSED ||
        playerState === YOUTUBE_PLAYER_STATE.CUED ||
        playerState === YOUTUBE_PLAYER_STATE.UNSTARTED;
}

/**
 * 動画後広告の終了を監視して、埋め込みプレーヤーをサムネイルへ戻す manager を作成する。
 * @param {YoutubePostPlaybackAdRestoreManagerInput} input
 * @returns {YoutubePostPlaybackAdRestoreManager}
 */
export function createYoutubePostPlaybackAdRestoreManager(
    input: YoutubePostPlaybackAdRestoreManagerInput
): YoutubePostPlaybackAdRestoreManager {
    const {
        getPlayer,
        getThumbForSession,
        isCurrentSession,
        getExpectedPlaybackEndSeconds,
        completeEndedPlayback,
        debug
    } = input;
    const now = typeof input.now === "function" ? input.now : () => Date.now();
    const pollMs = Number.isFinite(input.pollMs) && Number(input.pollMs) > 0
        ? Number(input.pollMs)
        : YOUTUBE_POST_PLAYBACK_AD_RESTORE_POLL_MS;
    const timeoutMs = Number.isFinite(input.timeoutMs) && Number(input.timeoutMs) > 0
        ? Number(input.timeoutMs)
        : YOUTUBE_POST_PLAYBACK_AD_RESTORE_TIMEOUT_MS;
    let watch: YoutubePostPlaybackAdRestoreWatch | null = null;

    /**
     * 動画後広告の終了監視タイマーに Node の unref があれば適用する。
     * @param {ReturnType<typeof setTimeout>} timeoutId
     */
    function unrefRestoreTimeout(timeoutId: ReturnType<typeof setTimeout>): void {
        const timeoutHandle = timeoutId as YoutubePostPlaybackAdRestoreTimeout;
        if (timeoutHandle && typeof timeoutHandle.unref === "function") {
            timeoutHandle.unref();
        }
    }

    /**
     * 指定 watch が最新ならサムネイル復元へ進める。
     * @param {YoutubePostPlaybackAdRestoreWatch} targetWatch
     * @param {HTMLElement} thumbDiv
     */
    function completeWatchedPlayback(targetWatch: YoutubePostPlaybackAdRestoreWatch, thumbDiv: HTMLElement): void {
        if (watch !== targetWatch) return;
        const sessionId = targetWatch.sessionId;
        clear();
        completeEndedPlayback(thumbDiv, sessionId);
    }

    /**
     * 動画後広告が終わったか確認し、終わっていれば通常の終了処理へ進める。
     * @param {YoutubePostPlaybackAdRestoreWatch} targetWatch
     */
    function poll(targetWatch: YoutubePostPlaybackAdRestoreWatch): void {
        if (watch !== targetWatch) return;
        targetWatch.timeoutId = null;
        const thumbDiv = getThumbForSession(targetWatch.sessionId);
        if (!isHtmlElement(thumbDiv) || !isCurrentSession(thumbDiv, targetWatch.sessionId)) {
            clear();
            return;
        }
        const playerState = readYoutubePlayerState(getPlayer());
        if (isPostPlaybackAdFinishedPlayerState(playerState)) {
            completeWatchedPlayback(targetWatch, thumbDiv);
            return;
        }
        if (now() - targetWatch.startedAt >= timeoutMs) {
            if (typeof debug === "function") {
                debug("post-playback ad restore watch timed out", {
                    playbackSessionId: targetWatch.sessionId,
                    playerState
                });
            }
            completeWatchedPlayback(targetWatch, thumbDiv);
            return;
        }
        schedulePoll(targetWatch);
    }

    /**
     * 次の動画後広告終了確認を予約する。
     * @param {YoutubePostPlaybackAdRestoreWatch} targetWatch
     */
    function schedulePoll(targetWatch: YoutubePostPlaybackAdRestoreWatch): void {
        const timeoutId = setTimeout(() => {
            poll(targetWatch);
        }, pollMs);
        unrefRestoreTimeout(timeoutId);
        targetWatch.timeoutId = timeoutId;
    }

    /**
     * 動画後広告が続いている間、終了 state へ変わるまで監視する。
     * @param {number} playbackSessionId
     */
    function start(playbackSessionId: number): void {
        clear();
        const nextWatch: YoutubePostPlaybackAdRestoreWatch = {
            sessionId: playbackSessionId,
            startedAt: now(),
            timeoutId: null
        };
        watch = nextWatch;
        schedulePoll(nextWatch);
    }

    /**
     * 動画後広告の終了監視を解除する。
     */
    function clear(): void {
        if (watch && watch.timeoutId) {
            clearTimeout(watch.timeoutId);
        }
        watch = null;
    }

    /**
     * 指定セッションの動画後広告終了監視が動いているか返す。
     * @param {number} playbackSessionId
     * @returns {boolean}
     */
    function isWatching(playbackSessionId: number): boolean {
        return Boolean(watch && watch.sessionId === playbackSessionId);
    }

    /**
     * 監視中のセッションで停止系 state を受け取った場合に復元を完了する。
     * @param {YoutubePostPlaybackAdWatchingStateEvent} event
     * @returns {boolean}
     */
    function handleWatchingStateEvent(event: YoutubePostPlaybackAdWatchingStateEvent): boolean {
        if (!isWatching(event.playbackSessionId)) return false;
        if (
            (
                isPostPlaybackAdFinishedPlayerState(event.eventState) ||
                isPostPlaybackAdFinishedPlayerState(event.currentPlayerState)
            ) &&
            !isPlaybackContinuingPlayerState(event.currentPlayerState)
        ) {
            const thumbDiv = getThumbForSession(event.playbackSessionId);
            if (isHtmlElement(thumbDiv) && isCurrentSession(thumbDiv, event.playbackSessionId) && watch) {
                completeWatchedPlayback(watch, thumbDiv);
                return true;
            }
            clear();
            return true;
        }
        return false;
    }

    /**
     * `ENDED` が広告再生中の古い state として届いた場合に復元を保留する。
     * @param {YoutubePostPlaybackAdStaleEndedState} event
     * @returns {boolean}
     */
    function handleStaleEndedState(event: YoutubePostPlaybackAdStaleEndedState): boolean {
        if (event.eventState !== YOUTUBE_PLAYER_STATE.ENDED) return false;
        if (!hasReachedYoutubePlaybackEnd(event.player, getExpectedPlaybackEndSeconds(event.thumbDiv))) return false;
        if (isPostPlaybackAdFinishedPlayerState(event.currentPlayerState) && isWatching(event.playbackSessionId) && watch) {
            completeWatchedPlayback(watch, event.thumbDiv);
            return true;
        }
        if (isPostPlaybackAdFinishedPlayerState(event.currentPlayerState)) {
            completeEndedPlayback(event.thumbDiv, event.playbackSessionId);
            return true;
        }
        if (!isPlaybackContinuingPlayerState(event.currentPlayerState)) return false;
        if (isWatching(event.playbackSessionId)) return true;
        if (typeof debug === "function") {
            debug("waiting for post-playback ad to finish", {
                playbackSessionId: event.playbackSessionId,
                playerState: event.currentPlayerState
            });
        }
        start(event.playbackSessionId);
        return true;
    }

    return {
        clear,
        isWatching,
        handleWatchingStateEvent,
        handleStaleEndedState
    };
}
