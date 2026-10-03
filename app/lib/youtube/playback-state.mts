const YOUTUBE_PLAYBACK_PHASE_IDLE = "idle";
const YOUTUBE_PLAYBACK_PHASE_STARTING = "starting";
const YOUTUBE_PLAYBACK_PHASE_PLAYING = "playing";

/** 再生セッションと状態遷移の世代を保持する状態。 */
export type YoutubePlaybackState = {
    sessionSequence: number;
    transitionGeneration: number;
    activeSessionId: number;
    phase: typeof YOUTUBE_PLAYBACK_PHASE_IDLE | typeof YOUTUBE_PLAYBACK_PHASE_STARTING | typeof YOUTUBE_PLAYBACK_PHASE_PLAYING;
};

/** 再生 controller から状態機械へ渡すイベント。 */
export type YoutubePlaybackStateEvent =
    | { type: "REQUEST_PLAYBACK" }
    | { type: "PLAYBACK_STARTED" | "PLAYBACK_ENDED"; sessionId: number }
    | { type: "RESTORE_PLAYBACK"; sessionId: number; preserveTransitionGeneration?: boolean }
    | { type: "CANCEL_PLAYBACK"; sessionId: number }
    | { type: "STOP_PLAYBACK" };

/**
 * YouTube 埋め込み再生の状態機械が扱う初期 state を返す。
 */
export function createYoutubePlaybackState(): YoutubePlaybackState {
    return {
        sessionSequence: 0,
        transitionGeneration: 0,
        activeSessionId: 0,
        phase: YOUTUBE_PLAYBACK_PHASE_IDLE
    };
}

/**
 * 指定セッションが現在の再生 state に対して有効か判定する。
 */
export function isYoutubePlaybackSessionActive(
    state: Pick<YoutubePlaybackState, "activeSessionId">,
    sessionId: number
): boolean {
    return Number.isFinite(sessionId) && sessionId > 0 && state.activeSessionId === sessionId;
}

/**
 * 初期化済みの再生状態にイベントを適用し、状態機械を 1 ステップ進める。
 */
export function reduceYoutubePlaybackState(
    state: YoutubePlaybackState,
    event: YoutubePlaybackStateEvent
): YoutubePlaybackState {
    const sessionId = "sessionId" in event ? event.sessionId : undefined;
    const targetSessionId = typeof sessionId === "number" && Number.isFinite(sessionId) ? sessionId : 0;
    switch (event.type) {
    case "REQUEST_PLAYBACK": {
        const nextSessionId = state.sessionSequence + 1;
        return {
            ...state,
            sessionSequence: nextSessionId,
            transitionGeneration: state.transitionGeneration + 1,
            activeSessionId: nextSessionId,
            phase: YOUTUBE_PLAYBACK_PHASE_STARTING
        };
    }
    case "PLAYBACK_STARTED":
        if (!isYoutubePlaybackSessionActive(state, targetSessionId)) return state;
        return {
            ...state,
            phase: YOUTUBE_PLAYBACK_PHASE_PLAYING
        };
    case "PLAYBACK_ENDED":
        if (!isYoutubePlaybackSessionActive(state, targetSessionId)) return state;
        return {
            ...state,
            transitionGeneration: state.transitionGeneration + 1,
            activeSessionId: 0,
            phase: YOUTUBE_PLAYBACK_PHASE_IDLE
        };
    case "RESTORE_PLAYBACK":
        if (!isYoutubePlaybackSessionActive(state, targetSessionId)) {
            return state;
        }
        return {
            ...state,
            transitionGeneration: event.preserveTransitionGeneration
                ? state.transitionGeneration
                : state.transitionGeneration + 1,
            activeSessionId: 0,
            phase: YOUTUBE_PLAYBACK_PHASE_IDLE
        };
    case "CANCEL_PLAYBACK":
        if (!isYoutubePlaybackSessionActive(state, targetSessionId)) return state;
        return {
            ...state,
            activeSessionId: 0,
            phase: YOUTUBE_PLAYBACK_PHASE_IDLE
        };
    case "STOP_PLAYBACK":
        return {
            ...state,
            activeSessionId: 0,
            phase: YOUTUBE_PLAYBACK_PHASE_IDLE
        };
    default:
        return state;
    }
}
