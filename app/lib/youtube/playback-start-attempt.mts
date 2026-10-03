import { isHtmlElement } from "../dom-utils.mjs";
import {
    debugPlayback,
    isAutoplayStartFallbackEnabled
} from "../playback-debug.mjs";

export const DEFAULT_PLAYBACK_START_TIMEOUT_MS = 5000;
export const DEFAULT_PLAYBACK_SETUP_TIMEOUT_MS = 10000;
export const YOUTUBE_PLAYBACK_START_STATUS = Object.freeze({
    STARTED: "started",
    FAILED: "failed",
    UNCONFIRMED: "unconfirmed"
});

export type YoutubePlaybackStartStatus =
    typeof YOUTUBE_PLAYBACK_START_STATUS[keyof typeof YOUTUBE_PLAYBACK_START_STATUS];

export type YoutubePlaybackStartResult = {
    status: YoutubePlaybackStartStatus;
};

/** YouTube 再生開始の成否待ちを表す状態。 */
export type YoutubePlaybackStartAttempt = {
    /** 再生開始待ち対象のセッション ID。 */
    sessionId: number;
    /** 再生開始結果を呼び出し元へ返す Promise resolver。 */
    resolve: (result: YoutubePlaybackStartResult) => void;
    /** セットアップまたは再生開始待ちのタイマー ID。 */
    timeoutId: ReturnType<typeof setTimeout> | null;
    /** 失敗時の復元やログに使う再生開始コンテキスト。 */
    context: {
        thumbDiv?: Element | null;
        playbackMode?: string;
    };
};

type YoutubePlaybackStartAttemptManager = {
    create: (
        sessionId: number,
        inputContext?: YoutubePlaybackStartAttempt["context"]
    ) => Promise<YoutubePlaybackStartResult>;
    armStartTimeout: (sessionId: number) => boolean;
    settle: (sessionId: number | undefined, playbackResult: YoutubePlaybackStartResult) => boolean;
    cancelForThumb: (thumbDiv: unknown) => boolean;
};

type PlaybackStartFailureOptions = {
    playbackMode?: string;
    reason: string;
    wasPlaybackStartUnconfirmed?: boolean;
};

type PlaybackStartTimeoutHandle = ReturnType<typeof setTimeout> & {
    unref?: () => void;
};

/**
 * 再生開始結果を表すオブジェクトを作成する。
 */
export function createYoutubePlaybackStartResult(status: unknown): YoutubePlaybackStartResult {
    switch (status) {
    case YOUTUBE_PLAYBACK_START_STATUS.STARTED:
    case YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED:
        return { status };
    default:
        return { status: YOUTUBE_PLAYBACK_START_STATUS.FAILED };
    }
}

/**
 * 再生開始結果から status を返す。
 */
function getYoutubePlaybackStartStatus(
    playbackResult: { status: string } | boolean | null | undefined
): YoutubePlaybackStartStatus {
    if (playbackResult && typeof playbackResult === "object" && typeof playbackResult.status === "string") {
        return createYoutubePlaybackStartResult(playbackResult.status).status;
    }
    return playbackResult === true
        ? YOUTUBE_PLAYBACK_START_STATUS.STARTED
        : YOUTUBE_PLAYBACK_START_STATUS.FAILED;
}

/**
 * 再生開始結果をオブジェクト形式へ正規化する。
 */
function normalizeYoutubePlaybackStartResult(
    playbackResult: { status: string } | boolean | null | undefined
): YoutubePlaybackStartResult {
    return createYoutubePlaybackStartResult(getYoutubePlaybackStartStatus(playbackResult));
}

/**
 * 再生開始結果が開始済みか返す。
 */
export function isYoutubePlaybackStarted(
    playbackResult: YoutubePlaybackStartResult | boolean | undefined
): boolean {
    return getYoutubePlaybackStartStatus(playbackResult) === YOUTUBE_PLAYBACK_START_STATUS.STARTED;
}

/**
 * 再生開始結果が未確定か返す。
 */
export function isYoutubePlaybackStartUnconfirmed(
    playbackResult: YoutubePlaybackStartResult | boolean | undefined
): boolean {
    return getYoutubePlaybackStartStatus(playbackResult) === YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED;
}

type PlaybackStartAttemptInput = {
    getSharedPlaybackState: () => { playbackStartAttempt: YoutubePlaybackStartAttempt | null };
    getThumbForSession: (sessionId: number) => HTMLElement | null;
    getSessionIdForThumb: (thumbDiv: unknown) => number;
    isCurrentSession: (thumbDiv: HTMLElement, sessionId: number) => boolean;
    handleStartFailure: (thumbDiv: HTMLElement, options: PlaybackStartFailureOptions) => void;
    markUnconfirmedStart: (sessionId: number) => void;
    clearUnconfirmedStart: (sessionId?: number) => boolean;
    timeoutMs?: number;
    setupTimeoutMs?: number;
};

/** YouTube 埋め込み再生の開始待ちを管理する。 */
export function createYoutubePlaybackStartAttemptManager(input: PlaybackStartAttemptInput): YoutubePlaybackStartAttemptManager {
    const {
        getSharedPlaybackState,
        getThumbForSession,
        getSessionIdForThumb,
        isCurrentSession,
        handleStartFailure,
        markUnconfirmedStart,
        clearUnconfirmedStart
    } = input;
    const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
        ? input.timeoutMs
        : DEFAULT_PLAYBACK_START_TIMEOUT_MS;
    const setupTimeoutMs = typeof input.setupTimeoutMs === "number" && Number.isFinite(input.setupTimeoutMs)
        ? input.setupTimeoutMs
        : DEFAULT_PLAYBACK_SETUP_TIMEOUT_MS;

    /**
     * 再生開始待ちのタイムアウトを開始する。
     * @param {YoutubePlaybackStartAttempt} attempt
     * @param {number} timeoutDurationMs
     * @param {string} reason
     * @returns {ReturnType<typeof setTimeout>}
     */
    function startTimeout(attempt: YoutubePlaybackStartAttempt, timeoutDurationMs: number, reason: string) {
        const timeoutId = setTimeout(() => {
            const shouldUseAutoplayStartFallback =
                reason === "start-timeout" &&
                attempt.context.playbackMode === "autoplay" &&
                isAutoplayStartFallbackEnabled();
            const timeoutResult = reason === "start-timeout" && !shouldUseAutoplayStartFallback
                ? createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED)
                : createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED);
            const didSettle = settle(attempt.sessionId, timeoutResult);
            if (!didSettle) return;
            if (isYoutubePlaybackStartUnconfirmed(timeoutResult)) return;
            const thumbDiv = isHtmlElement(attempt.context.thumbDiv)
                ? attempt.context.thumbDiv
                : getThumbForSession(attempt.sessionId);
            if (!isHtmlElement(thumbDiv)) return;
            if (!isCurrentSession(thumbDiv, attempt.sessionId)) return;
            if (shouldUseAutoplayStartFallback) {
                debugPlayback("youtube", "debug autoplay start fallback", {
                    reason,
                    playbackMode: attempt.context.playbackMode
                });
            }
            const failureOptions: PlaybackStartFailureOptions = {
                playbackMode: attempt.context.playbackMode,
                reason: shouldUseAutoplayStartFallback ? "debug-autoplay-start-fallback" : reason
            };
            if (shouldUseAutoplayStartFallback) {
                failureOptions.wasPlaybackStartUnconfirmed = true;
            }
            handleStartFailure(thumbDiv, failureOptions);
        }, timeoutDurationMs);
        const timeoutHandle = timeoutId as PlaybackStartTimeoutHandle;
        if (timeoutHandle && typeof timeoutHandle.unref === "function") {
            timeoutHandle.unref();
        }
        return timeoutId;
    }

    /**
     * 指定セッションの再生開始待ちを完了扱いにする。
     * @param {number | undefined} sessionId
     * @param {YoutubePlaybackStartResult} playbackResult
     * @returns {boolean}
     */
    function settle(sessionId: number | undefined, playbackResult: YoutubePlaybackStartResult) {
        const sharedPlayback = getSharedPlaybackState();
        const attempt = sharedPlayback.playbackStartAttempt;
        if (!attempt) return false;
        if (typeof sessionId === "number" && Number.isFinite(sessionId) && sessionId > 0 && attempt.sessionId !== sessionId) {
            return false;
        }
        sharedPlayback.playbackStartAttempt = null;
        if (attempt.timeoutId) {
            clearTimeout(attempt.timeoutId);
        }
        const normalizedResult = normalizeYoutubePlaybackStartResult(playbackResult);
        if (normalizedResult.status === YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED) {
            markUnconfirmedStart(attempt.sessionId);
            attempt.resolve(normalizedResult);
            return true;
        }
        clearUnconfirmedStart(attempt.sessionId);
        attempt.resolve(normalizedResult);
        return true;
    }

    /**
     * 指定セッションの再生開始待ち Promise を作成する。
     * @param {number} sessionId
     * @param {YoutubePlaybackStartAttempt["context"] | undefined} inputContext
     * @returns {Promise<YoutubePlaybackStartResult>}
     */
    function create(sessionId: number, inputContext?: YoutubePlaybackStartAttempt["context"]) {
        const context = inputContext || {};
        settle(undefined, createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED));
        clearUnconfirmedStart();
        return new Promise<YoutubePlaybackStartResult>((resolve) => {
            const attempt: YoutubePlaybackStartAttempt = {
                sessionId,
                resolve,
                timeoutId: null,
                context
            };
            attempt.timeoutId = startTimeout(attempt, setupTimeoutMs, "setup-timeout");
            getSharedPlaybackState().playbackStartAttempt = attempt;
        });
    }

    /**
     * プレーヤー接続後の再生開始タイムアウトへ切り替える。
     * @param {number} sessionId
     * @returns {boolean}
     */
    function armStartTimeout(sessionId: number) {
        const sharedPlayback = getSharedPlaybackState();
        const attempt = sharedPlayback.playbackStartAttempt;
        if (!attempt) return false;
        if (typeof sessionId === "number" && Number.isFinite(sessionId) && sessionId > 0 && attempt.sessionId !== sessionId) {
            return false;
        }
        if (attempt.timeoutId) {
            clearTimeout(attempt.timeoutId);
        }
        attempt.timeoutId = startTimeout(attempt, timeoutMs, "start-timeout");
        return true;
    }

    /**
     * 有効なセッションを持つサムネイルの開始待ちと未確定記録だけを解除する。
     * @param {unknown} thumbDiv
     * @returns {boolean}
     */
    function cancelForThumb(thumbDiv: unknown) {
        const sessionId = getSessionIdForThumb(thumbDiv);
        if (!Number.isFinite(sessionId) || sessionId <= 0) return false;
        const didClearUnconfirmedStart = clearUnconfirmedStart(sessionId);
        return settle(sessionId, createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED)) ||
            didClearUnconfirmedStart;
    }

    return {
        create,
        armStartTimeout,
        settle,
        cancelForThumb
    };
}
