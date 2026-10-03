import test from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_PLAYBACK_START_TIMEOUT_MS,
    createYoutubePlaybackStartResult,
    YOUTUBE_PLAYBACK_START_STATUS,
    createYoutubePlaybackStartAttemptManager
} from "../app/lib/youtube/playback-start-attempt.mts";
import { createYoutubeUnconfirmedPlaybackStartManager } from "../app/lib/youtube/unconfirmed-playback-start.mts";
import type { YoutubeSharedPlaybackState } from "../app/lib/youtube/shared-playback.mts";
import { isHtmlElement } from "../app/lib/dom-utils.mts";
import { installFakeDom, installFakeTimeouts } from "./test-helpers.mts";

/** 再生開始待ち manager のテスト用状態を作る。 */
function createAttemptHarness(options: {
    isCurrentSession?: boolean;
    timeoutMs?: number;
    setupTimeoutMs?: number;
} = {}) {
    const sharedPlayback: Pick<YoutubeSharedPlaybackState,
        "playbackStartAttempt" | "unconfirmedPlaybackStartSessionId"> = {
        playbackStartAttempt: null,
        unconfirmedPlaybackStartSessionId: 0
    };
    const thumb = document.createElement("div");
    thumb.dataset.playbackSessionId = "1";
    const failures: {
        target: HTMLElement;
        details: Parameters<Parameters<typeof createYoutubePlaybackStartAttemptManager>[0]["handleStartFailure"]>[1];
    }[] = [];
    const unconfirmedStarts = createYoutubeUnconfirmedPlaybackStartManager({
        getSharedPlaybackState: () => sharedPlayback
    });
    const manager = createYoutubePlaybackStartAttemptManager({
        getSharedPlaybackState: () => sharedPlayback,
        getThumbForSession: () => thumb,
        getSessionIdForThumb: (target) => isHtmlElement(target)
            ? Number.parseInt(target.dataset.playbackSessionId || "", 10)
            : 0,
        isCurrentSession: () => options.isCurrentSession ?? true,
        handleStartFailure: (target, details) => {
            failures.push({ target, details });
        },
        markUnconfirmedStart: (sessionId) => unconfirmedStarts.mark(sessionId),
        clearUnconfirmedStart: (sessionId) => unconfirmedStarts.clear(sessionId),
        timeoutMs: options.timeoutMs,
        setupTimeoutMs: options.setupTimeoutMs
    });
    return { failures, manager, sharedPlayback, thumb, unconfirmedStarts };
}

/** 再生開始結果の期待値を返す。 */
function playbackStartResult(status: string) {
    return createYoutubePlaybackStartResult(status);
}

test("youtube playback start attempt: settle resolves current attempt and clears timeout", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { manager, sharedPlayback, thumb } = createAttemptHarness();
        const attemptPromise = manager.create(1, { thumbDiv: thumb, playbackMode: "manual" });

        assert.ok(sharedPlayback.playbackStartAttempt);
        assert.equal(sharedPlayback.playbackStartAttempt.sessionId, 1);
        assert.equal(manager.settle(1, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED)), true);
        assert.equal(sharedPlayback.playbackStartAttempt, null);
        assert.equal(fakeTimeouts.timeoutCalls.length, 1);
        assert.equal(fakeTimeouts.timeoutCalls[0].cleared, true);
        assert.deepEqual(await attemptPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED));
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube playback start attempt: setup timeout resolves failed result and reports start failure", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { failures, manager, sharedPlayback, thumb } = createAttemptHarness();
        const attemptPromise = manager.create(1, { thumbDiv: thumb, playbackMode: "autoplay" });

        fakeTimeouts.timeoutCalls[0].cb();

        assert.equal(sharedPlayback.playbackStartAttempt, null);
        assert.deepEqual(await attemptPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED));
        assert.equal(failures.length, 1);
        assert.equal(failures[0].target, thumb);
        assert.deepEqual(failures[0].details, {
            playbackMode: "autoplay",
            reason: "setup-timeout"
        });
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube playback start attempt: armStartTimeout switches from setup wait to unconfirmed start wait", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { failures, manager, sharedPlayback, thumb } = createAttemptHarness({
            timeoutMs: 10,
            setupTimeoutMs: 50
        });
        const attemptPromise = manager.create(1, { thumbDiv: thumb, playbackMode: "autoplay" });

        assert.equal(fakeTimeouts.timeoutCalls.length, 1);
        assert.equal(fakeTimeouts.timeoutCalls[0].delay, 50);
        assert.equal(manager.armStartTimeout(1), true);
        assert.equal(fakeTimeouts.timeoutCalls.length, 2);
        assert.equal(fakeTimeouts.timeoutCalls[1].delay, 10);
        assert.equal(fakeTimeouts.timeoutCalls[0].cleared, true);
        assert.equal(fakeTimeouts.timeoutCalls[1].cleared, false);

        fakeTimeouts.timeoutCalls[1].cb();

        assert.deepEqual(await attemptPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED));
        assert.equal(sharedPlayback.unconfirmedPlaybackStartSessionId, 1);
        assert.equal(manager.cancelForThumb(thumb), true);
        assert.equal(sharedPlayback.unconfirmedPlaybackStartSessionId, 0);
        assert.equal(failures.length, 0);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube playback start attempt: debug fallback treats delayed autoplay start as failed", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        window.__KNK_AUTOPLAY_START_FALLBACK__ = true;
        const { failures, manager, sharedPlayback, thumb } = createAttemptHarness({
            timeoutMs: 10,
            setupTimeoutMs: 50
        });
        const attemptPromise = manager.create(1, { thumbDiv: thumb, playbackMode: "autoplay" });

        assert.equal(manager.armStartTimeout(1), true);
        fakeTimeouts.timeoutCalls[1].cb();

        assert.deepEqual(await attemptPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED));
        assert.equal(sharedPlayback.unconfirmedPlaybackStartSessionId, 0);
        assert.equal(failures.length, 1);
        assert.equal(failures[0].target, thumb);
        assert.deepEqual(failures[0].details, {
            playbackMode: "autoplay",
            reason: "debug-autoplay-start-fallback",
            wasPlaybackStartUnconfirmed: true
        });
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube playback start attempt: default start timeout is five seconds", () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { manager, thumb } = createAttemptHarness();

        manager.create(1, { thumbDiv: thumb, playbackMode: "autoplay" });
        manager.armStartTimeout(1);

        assert.equal(fakeTimeouts.timeoutCalls[1].delay, DEFAULT_PLAYBACK_START_TIMEOUT_MS);
        assert.equal(DEFAULT_PLAYBACK_START_TIMEOUT_MS, 5000);
        manager.settle(1, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED));
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube playback start attempt: stale session settle is ignored", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { manager, sharedPlayback, thumb } = createAttemptHarness();
        const attemptPromise = manager.create(1, { thumbDiv: thumb });

        assert.equal(manager.settle(2, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED)), false);
        assert.ok(sharedPlayback.playbackStartAttempt);
        assert.equal(sharedPlayback.playbackStartAttempt.sessionId, 1);
        assert.equal(manager.settle(1, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED)), true);
        assert.deepEqual(await attemptPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED));
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube playback start attempt: cancelForThumb resolves the thumb session as failed result", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { manager, thumb } = createAttemptHarness();
        const attemptPromise = manager.create(1, { thumbDiv: thumb });

        assert.equal(manager.cancelForThumb(thumb), true);
        assert.deepEqual(await attemptPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED));
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube playback start attempt: invalid and unrelated thumb sessions keep the pending attempt and timeout", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { manager, sharedPlayback, thumb } = createAttemptHarness();
        const attemptPromise = manager.create(1, { thumbDiv: thumb });
        const attempt = sharedPlayback.playbackStartAttempt;
        const otherThumb = document.createElement("div");
        for (const sessionValue of ["", "0", "-1", "NaN", "Infinity", "2"]) {
            otherThumb.dataset.playbackSessionId = sessionValue;
            assert.equal(manager.cancelForThumb(otherThumb), false);
            assert.equal(sharedPlayback.playbackStartAttempt, attempt);
            assert.equal(fakeTimeouts.timeoutCalls[0].cleared, false);
        }
        assert.equal(manager.cancelForThumb(null), false);
        assert.equal(manager.settle(1, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED)), true);
        assert.deepEqual(await attemptPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED));
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube playback start attempt: invalid and unrelated thumb sessions keep the unconfirmed record", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { manager, sharedPlayback, thumb } = createAttemptHarness();
        const attemptPromise = manager.create(1, { thumbDiv: thumb });
        manager.armStartTimeout(1);
        fakeTimeouts.timeoutCalls[1].cb();
        assert.deepEqual(await attemptPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED));
        const otherThumb = document.createElement("div");
        for (const sessionValue of ["", "0", "-1", "NaN", "Infinity", "2"]) {
            otherThumb.dataset.playbackSessionId = sessionValue;
            assert.equal(manager.cancelForThumb(otherThumb), false);
            assert.equal(sharedPlayback.unconfirmedPlaybackStartSessionId, 1);
        }
        assert.equal(manager.cancelForThumb(thumb), true);
        assert.equal(sharedPlayback.unconfirmedPlaybackStartSessionId, 0);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});
