import test from "node:test";
import assert from "node:assert/strict";
import { createUiSyncController } from "../app/ui/core/sync.mts";
import { installFakeDom, installFakeTimeouts, invokeListener, installFakeAnimationFrames } from "./test-helpers.mts";

/**
 * UI sync テスト用のスパイ群を作る。
 */
function createUiSyncSpies() {
    const calls = {
        refreshConditionInputs: 0,
        applyThemeFromStorage: 0,
        applyPlaybackSettingsFromStorage: 0,
        applySiteLanguageFromStorage: 0
    };

    return {
        calls,
        input: {
            uiSyncPasses: 1,
            refreshConditionInputs() {
                calls.refreshConditionInputs += 1;
            },
            applyThemeFromStorage() {
                calls.applyThemeFromStorage += 1;
            },
            applyPlaybackSettingsFromStorage() {
                calls.applyPlaybackSettingsFromStorage += 1;
            },
            applySiteLanguageFromStorage() {
                calls.applySiteLanguageFromStorage += 1;
            }
        }
    };
}

/** 4 つの同期がそれぞれ同じ回数だけ呼ばれたことを確かめる。 */
function assertSyncCount(calls: ReturnType<typeof createUiSyncSpies>["calls"], expected: number) {
    assert.deepEqual(calls, {
        refreshConditionInputs: expected,
        applyThemeFromStorage: expected,
        applyPlaybackSettingsFromStorage: expected,
        applySiteLanguageFromStorage: expected
    });
}

test("ui sync: scheduleSyncUiState syncs the stored settings and the condition inputs, then again on the next frame", () => {
    const restoreDom = installFakeDom();
    const frames = installFakeAnimationFrames();
    try {
        const { calls, input } = createUiSyncSpies();
        const controller = createUiSyncController({
            ...input,
            uiSyncPasses: 2
        });

        controller.scheduleSyncUiState();
        assertSyncCount(calls, 1);
        assert.equal(frames.pendingCount, 1);

        frames.advanceFrame();
        assertSyncCount(calls, 2);
        assert.equal(frames.pendingCount, 0);
    } finally {
        frames.cleanup();
        restoreDom();
    }
});

test("ui sync: a single pass does not wait for the next frame", () => {
    const restoreDom = installFakeDom();
    const frames = installFakeAnimationFrames();
    try {
        const { calls, input } = createUiSyncSpies();
        const controller = createUiSyncController(input);

        controller.scheduleSyncUiState();
        assertSyncCount(calls, 1);
        assert.equal(frames.pendingCount, 0);
    } finally {
        frames.cleanup();
        restoreDom();
    }
});

test("ui sync: scheduleDelayedSync waits 200ms by default", () => {
    const restoreDom = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    const scheduled = fakeTimeouts.timeoutCalls;
    try {
        const { calls, input } = createUiSyncSpies();
        const controller = createUiSyncController(input);

        controller.scheduleDelayedSync();

        assert.deepEqual(scheduled.map((entry) => entry.delay), [200]);
        assertSyncCount(calls, 0);
        scheduled[0].cb();
        assertSyncCount(calls, 1);
    } finally {
        fakeTimeouts.cleanup();
        restoreDom();
    }
});

test("ui sync: visibilitychange only syncs when visible and pageshow adds a delayed sync", () => {
    const restoreDom = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    const scheduled = fakeTimeouts.timeoutCalls;
    try {
        const { calls, input } = createUiSyncSpies();
        const controller = createUiSyncController(input);
        controller.setupSyncEvents();

        restoreDom.document.visibilityState = "hidden";
        invokeListener(restoreDom.document, "visibilitychange", {});
        assertSyncCount(calls, 0);

        restoreDom.document.visibilityState = "visible";
        invokeListener(restoreDom.document, "visibilitychange", {});
        assertSyncCount(calls, 1);

        invokeListener(restoreDom.window, "focus", {});
        assertSyncCount(calls, 2);

        invokeListener(restoreDom.window, "pageshow", {});
        assertSyncCount(calls, 3);
        assert.deepEqual(scheduled.map((entry) => entry.delay), [200]);

        // ブラウザがフォームの値を後から復元した場合に備え、少し後にも入力欄を状態へ揃え直す。
        scheduled[0].cb();
        assertSyncCount(calls, 4);
    } finally {
        fakeTimeouts.cleanup();
        restoreDom();
    }
});
