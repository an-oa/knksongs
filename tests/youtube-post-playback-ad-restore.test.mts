import test from "node:test";
import assert from "node:assert/strict";
import {
    createYoutubePostPlaybackAdRestoreManager,
    hasReachedYoutubePlaybackEnd,
    isPlaybackContinuingPlayerState,
    isPostPlaybackAdFinishedPlayerState,
    YOUTUBE_POST_PLAYBACK_AD_RESTORE_POLL_MS
} from "../app/lib/youtube/post-playback-ad-restore.mts";
import type { YoutubePlayerLike } from "../app/lib/youtube/iframe-api.types.mts";
import { YOUTUBE_PLAYER_STATE } from "../app/lib/youtube/player-state.mts";
import {
    installFakeDom,
    installFakeTimeouts
} from "./test-helpers.mts";

/** 動画後広告復元 manager テスト用の Player mock を作る。 */
function createPlayer(input: { state?: number; currentTime?: number; duration?: number } = {}) {
    return {
        state: input.state ?? YOUTUBE_PLAYER_STATE.PLAYING,
        currentTime: input.currentTime ?? 75,
        duration: input.duration ?? 120,
        getPlayerState() {
            return this.state;
        },
        getCurrentTime() {
            return this.currentTime;
        },
        getDuration() {
            return this.duration;
        }
    };
}

/** 動画後広告復元 manager と周辺状態を作る。 */
function createManagerHarness(input: {
    player?: YoutubePlayerLike;
    expectedEndSeconds?: number | null;
    now?: () => number;
    timeoutMs?: number;
} = {}) {
    const thumb = document.createElement("div");
    document.body.appendChild(thumb);
    const player = input.player ?? createPlayer();
    const expectedEndSeconds = input.expectedEndSeconds === undefined
        ? 75
        : input.expectedEndSeconds;
    const completes: { thumb: HTMLElement; sessionId: number }[] = [];
    const debugCalls: { message: string; details?: Record<string, unknown> }[] = [];
    const manager = createYoutubePostPlaybackAdRestoreManager({
        getPlayer: () => player,
        getThumbForSession: () => thumb,
        isCurrentSession: (targetThumb) => targetThumb === thumb,
        getExpectedPlaybackEndSeconds: () => expectedEndSeconds,
        completeEndedPlayback: (targetThumb, sessionId) => {
            completes.push({ thumb: targetThumb, sessionId });
        },
        debug: (message, details) => {
            debugCalls.push({ message, details });
        },
        now: input.now,
        timeoutMs: input.timeoutMs
    });
    return {
        manager,
        thumb,
        completes,
        debugCalls
    };
}

test("youtube post-playback ad restore: classifies player states without timers", () => {
    assert.equal(isPlaybackContinuingPlayerState(YOUTUBE_PLAYER_STATE.PLAYING), true);
    assert.equal(isPlaybackContinuingPlayerState(YOUTUBE_PLAYER_STATE.BUFFERING), true);
    assert.equal(isPlaybackContinuingPlayerState(YOUTUBE_PLAYER_STATE.PAUSED), false);
    assert.equal(isPostPlaybackAdFinishedPlayerState(YOUTUBE_PLAYER_STATE.ENDED), true);
    assert.equal(isPostPlaybackAdFinishedPlayerState(YOUTUBE_PLAYER_STATE.PAUSED), true);
    assert.equal(isPostPlaybackAdFinishedPlayerState(YOUTUBE_PLAYER_STATE.CUED), true);
    assert.equal(isPostPlaybackAdFinishedPlayerState(YOUTUBE_PLAYER_STATE.UNSTARTED), true);
    assert.equal(isPostPlaybackAdFinishedPlayerState(YOUTUBE_PLAYER_STATE.PLAYING), false);
});

test("youtube post-playback ad restore: detects playback end without timers", () => {
    assert.equal(hasReachedYoutubePlaybackEnd(createPlayer({ currentTime: 73.4 }), 75), false);
    assert.equal(hasReachedYoutubePlaybackEnd(createPlayer({ currentTime: 73.5 }), 75), true);
    assert.equal(hasReachedYoutubePlaybackEnd(createPlayer({ currentTime: 118.5, duration: 120 }), null), true);
    assert.equal(hasReachedYoutubePlaybackEnd(createPlayer({ currentTime: 118.4, duration: 120 }), null), false);
    assert.equal(hasReachedYoutubePlaybackEnd(createPlayer({ currentTime: 120, duration: 0 }), null), false);
});

test("youtube post-playback ad restore: stale ended state starts a restore watch", () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const player = createPlayer({
            state: YOUTUBE_PLAYER_STATE.PLAYING,
            currentTime: 75
        });
        const { manager, thumb, completes } = createManagerHarness({ player });

        assert.equal(manager.handleStaleEndedState({
            thumbDiv: thumb,
            playbackSessionId: 7,
            eventState: YOUTUBE_PLAYER_STATE.ENDED,
            currentPlayerState: YOUTUBE_PLAYER_STATE.PLAYING,
            player
        }), true);

        assert.equal(manager.isWatching(7), true);
        assert.deepEqual(completes, []);
        assert.equal(fakeTimeouts.timeoutCalls[0]?.delay, YOUTUBE_POST_PLAYBACK_AD_RESTORE_POLL_MS);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube post-playback ad restore: duplicate stale ended state keeps the existing watch", () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const player = createPlayer({
            state: YOUTUBE_PLAYER_STATE.PLAYING,
            currentTime: 75
        });
        const { manager, thumb, completes } = createManagerHarness({ player });

        manager.handleStaleEndedState({
            thumbDiv: thumb,
            playbackSessionId: 7,
            eventState: YOUTUBE_PLAYER_STATE.ENDED,
            currentPlayerState: YOUTUBE_PLAYER_STATE.PLAYING,
            player
        });
        const restorePoll = fakeTimeouts.timeoutCalls[0];

        assert.equal(manager.handleStaleEndedState({
            thumbDiv: thumb,
            playbackSessionId: 7,
            eventState: YOUTUBE_PLAYER_STATE.ENDED,
            currentPlayerState: YOUTUBE_PLAYER_STATE.PLAYING,
            player
        }), true);

        assert.equal(manager.isWatching(7), true);
        assert.deepEqual(completes, []);
        assert.equal(fakeTimeouts.timeoutCalls.length, 1);
        assert.equal(restorePoll.cleared, false);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube post-playback ad restore: watching state completes when the ad reaches a stopped state", () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const player = createPlayer({
            state: YOUTUBE_PLAYER_STATE.PLAYING,
            currentTime: 75
        });
        const { manager, thumb, completes } = createManagerHarness({ player });

        manager.handleStaleEndedState({
            thumbDiv: thumb,
            playbackSessionId: 7,
            eventState: YOUTUBE_PLAYER_STATE.ENDED,
            currentPlayerState: YOUTUBE_PLAYER_STATE.PLAYING,
            player
        });
        const restorePoll = fakeTimeouts.timeoutCalls[0];
        player.state = YOUTUBE_PLAYER_STATE.PAUSED;

        assert.equal(manager.handleWatchingStateEvent({
            playbackSessionId: 7,
            eventState: YOUTUBE_PLAYER_STATE.PAUSED,
            currentPlayerState: YOUTUBE_PLAYER_STATE.PAUSED
        }), true);

        assert.deepEqual(completes, [{ thumb, sessionId: 7 }]);
        assert.equal(restorePoll.cleared, true);
        assert.equal(manager.isWatching(7), false);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube post-playback ad restore: polling completes after timeout while ad remains active", () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    let nowValue = 0;
    try {
        const player = createPlayer({
            state: YOUTUBE_PLAYER_STATE.PLAYING,
            currentTime: 75
        });
        const { manager, thumb, completes, debugCalls } = createManagerHarness({
            player,
            now: () => nowValue,
            timeoutMs: 1000
        });

        manager.handleStaleEndedState({
            thumbDiv: thumb,
            playbackSessionId: 7,
            eventState: YOUTUBE_PLAYER_STATE.ENDED,
            currentPlayerState: YOUTUBE_PLAYER_STATE.PLAYING,
            player
        });
        nowValue = 1000;
        fakeTimeouts.timeoutCalls[0].cb();

        assert.deepEqual(completes, [{ thumb, sessionId: 7 }]);
        assert.ok(debugCalls.some((call) => call.message === "post-playback ad restore watch timed out"));
        assert.equal(manager.isWatching(7), false);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});
