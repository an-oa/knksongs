import test from "node:test";
import { setImmediate } from "node:timers/promises";
import assert from "node:assert/strict";
import { createYoutubeIframeApiFixture } from "./fixtures/youtube-api.mts";
import { createFakeLocalStorage } from "./fixtures/local-storage.mts";
import type { YoutubePlaybackStartResult } from "../app/lib/youtube/playback-start-attempt.mts";
import { YOUTUBE_PLAYER_STATE } from "../app/lib/youtube/player-state.mts";
import { extractYoutubeInfo } from "../app/controllers/youtube.mts";
import {
    DEFAULT_PLAYBACK_START_TIMEOUT_MS,
    DEFAULT_PLAYBACK_SETUP_TIMEOUT_MS,
    createYoutubePlaybackStartResult,
    YOUTUBE_PLAYBACK_START_STATUS
} from "../app/lib/youtube/playback-start-attempt.mts";
import {
    installFakeTimeouts,
    installFakeAnimationFrames,
    getFakeElement,
    installFakeDom,
    invokeListener,
    setGlobalValue
} from "./test-helpers.mts";
import {
    createYoutubeControllerHarness,
    createYoutubeUiState,
    installYoutubePlayerFixture
} from "./youtube-harness.mts";

/** 登録されたサムネイルのクリック処理をモック上で実行する。 */
function clickThumbnail(thumb: HTMLElement) {
    const element = getFakeElement(thumb);
    assert.ok(element.onclick);
    element.onclick({});
}

/** サムネイル内の iframe が存在することを確認して返す。 */
function requireIframe(thumb: HTMLElement): HTMLIFrameElement {
    const iframe = thumb.querySelector("iframe");
    assert.ok(iframe);
    return iframe;
}

/** 指定した待ち時間の未キャンセルタイマーが1件だけあることを確認する。 */
function requireActiveTimeout(fakeTimeouts: ReturnType<typeof installFakeTimeouts>, delay: number) {
    const pending = fakeTimeouts.timeoutCalls.filter((call) => call.delay === delay && !call.cleared);
    assert.equal(pending.length, 1, `expected one active ${delay}ms timer`);
    return pending[0];
}

/**
 * 再生開始結果の期待値を返す。
 * @param {string} status
 * @returns {{ status: string }}
 */
function playbackStartResult(status: string) {
    return createYoutubePlaybackStartResult(status);
}

/**
 * 再生開始結果の status を検証する。
 * @param {unknown} actual
 * @param {string} status
 */
function assertPlaybackStartStatus(actual: unknown, status: string) {
    assert.deepEqual(actual, playbackStartResult(status));
}

/**
 * 共有プレーヤー再生成テスト用のサムネイル2件を作成して初期化する。
 * @param {ReturnType<typeof createYoutubeControllerHarness>["controller"]} controller
 * @returns {{ thumbA: HTMLElement, thumbB: HTMLElement }}
 */
function createTwoYoutubePlaybackThumbs(controller: ReturnType<typeof createYoutubeControllerHarness>["controller"]) {
    const cardA = document.createElement("div");
    const cardB = document.createElement("div");
    cardA.className = "song-card";
    cardB.className = "song-card";
    const thumbA = document.createElement("div");
    const thumbB = document.createElement("div");
    cardA.appendChild(thumbA);
    cardB.appendChild(thumbB);
    document.body.append(cardA, cardB);

    controller.updateThumbnail(thumbA, { isVertical: false, videoId: "video1", startSeconds: 5, endSeconds: 25 });
    controller.updateThumbnail(thumbB, { isVertical: false, videoId: "video2", startSeconds: 15, endSeconds: 45 });
    return { thumbA, thumbB };
}

test("youtube: disconnected active thumb is cleared without restore work", () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            activeThumb: document.createElement("div")
        });
        const { controller } = createYoutubeControllerHarness({ ui });

        controller.restoreActivePlayback();
        assert.equal(ui.playback.activeThumb, null);
    } finally {
        cleanup();
    }
});

test("youtube: shorts url is treated as vertical playback target", () => {
    const yt = extractYoutubeInfo("https://www.youtube.com/shorts/abc123?t=45");
    assert.deepEqual(yt, { videoId: "abc123", startSeconds: 45, isVertical: true });
});

test("youtube: vertical videos stay landscape in thumbnail mode and switch on iframe playback", () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        let layoutRefreshCount = 0;
        controller.setLayoutHook(() => {
            layoutRefreshCount += 1;
        });

        const card = document.createElement("div");
        card.className = "song-card";
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        controller.updateThumbnail(thumb, { videoId: "short1", startSeconds: 0, isVertical: true });
        assert.equal(thumb.dataset.videoOrientation, "landscape");
        assert.equal(card.classList.contains("song-card-expanded"), false);

        assert.equal(typeof thumb.onclick, "function");
        clickThumbnail(thumb);
        assert.match(requireIframe(thumb).src, /^https:\/\/www\.youtube\.com\/embed\/short1\?/);
        assert.equal(thumb.dataset.videoOrientation, "vertical");
        assert.equal(card.classList.contains("song-card-expanded"), true);
        assert.equal(layoutRefreshCount, 1);

        const close = thumb.querySelector("button");
        invokeListener(close, "click", {
            stopPropagation() {}
        });
        assert.equal(thumb.dataset.videoOrientation, "landscape");
        assert.equal(card.classList.contains("song-card-expanded"), false);
        assert.equal(layoutRefreshCount, 2);
    } finally {
        cleanup();
    }
});

test("youtube: player init uses prebuilt iframe src and binds YT.Player to it", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const { api, creations: playerCalls } = createYoutubeIframeApiFixture();
        window.YT = api;

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 45 });

        clickThumbnail(thumb);
        await setImmediate();
        assert.equal(playerCalls.length, 1);
        playerCalls[0].emitReady();

        assert.equal(playerCalls[0].iframe, requireIframe(thumb));
        assert.equal(playerCalls[0].iframe.tagName, "IFRAME");
        assert.match(
            requireIframe(thumb).src,
            /^https:\/\/www\.youtube\.com\/embed\/video1\?/
        );
        assert.equal("videoId" in playerCalls[0].options, false);
        assert.equal("playerVars" in playerCalls[0].options, false);
        const iframe = thumb.querySelector("iframe");
        assert.ok(iframe);
        assert.match(iframe.src, /^https:\/\/www\.youtube\.com\/embed\/video1\?/);
        assert.match(iframe.src, /autoplay=0/);
        assert.match(iframe.src, /start=45/);
        assert.match(iframe.src, /enablejsapi=1/);
        assert.equal(iframe.allow, "autoplay; encrypted-media");
        assert.equal(iframe.referrerPolicy, "strict-origin-when-cross-origin");
        assert.equal(iframe.allowFullscreen, true);
    } finally {
        cleanup();
    }
});

test("youtube: manual playback keeps embed autoplay disabled during continuous playback", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            continuousPlayback: true
        });
        const { controller } = createYoutubeControllerHarness({ ui });
        const { api, creations: playerCalls } = createYoutubeIframeApiFixture();
        window.YT = api;

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 45 });

        clickThumbnail(thumb);
        await setImmediate();
        assert.equal(playerCalls.length, 1);
        playerCalls[0].emitReady();

        const iframe = thumb.querySelector("iframe");
        assert.ok(iframe);
        assert.match(iframe.src, /autoplay=0/);
    } finally {
        cleanup();
    }
});

test("youtube: embed autoplay is enabled for continuation playback", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            continuousPlayback: true
        });
        const { controller } = createYoutubeControllerHarness({ ui });
        const { api, creations: playerCalls } = createYoutubeIframeApiFixture();
        window.YT = api;

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);

        controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video1",
            startSeconds: 45
        }, {
            playbackMode: "autoplay"
        });
        await setImmediate();
        assert.equal(playerCalls.length, 1);
        playerCalls[0].emitReady();

        const iframe = thumb.querySelector("iframe");
        assert.ok(iframe);
        assert.match(iframe.src, /autoplay=1/);
    } finally {
        cleanup();
    }
});

test("youtube: manual playback reveals a clipped card below the sticky header", () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const header = document.createElement("div");
        header.className = "header";
        getFakeElement(header)._rect = { top: 0, bottom: 60, left: 0, right: 300, width: 300, height: 60 };
        document.body.appendChild(header);
        const card = document.createElement("div");
        card.className = "song-card";
        getFakeElement(card)._rect = { top: 40, bottom: 240, left: 0, right: 300, width: 300, height: 200 };
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        assert.ok(document.scrollingElement);
        document.scrollingElement.scrollTop = 120;
        const scrollCalls: ScrollToOptions[] = [];
        cleanup.window.scrollTo = (options: ScrollToOptions) => {
            scrollCalls.push(options);
        };

        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 45 });
        clickThumbnail(thumb);

        assert.deepEqual(scrollCalls, [{ top: 100, behavior: "smooth" }]);
    } finally {
        cleanup();
    }
});

test("youtube: stale queued layout refresh requests are ignored", () => {
    const cleanup = installFakeDom();
    const fakeFrames = installFakeAnimationFrames();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        let layoutRefreshCount = 0;
        controller.setLayoutHook(() => {
            layoutRefreshCount += 1;
        });

        const card = document.createElement("div");
        card.className = "song-card";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        controller.updateThumbnail(thumb, { videoId: "short1", startSeconds: 0, isVertical: true });

        clickThumbnail(thumb);
        const close = thumb.querySelector("button");
        invokeListener(close, "click", {
            stopPropagation() {}
        });

        while (fakeFrames.pendingCount > 0) fakeFrames.advanceFrame();

        assert.equal(layoutRefreshCount, 1);
    } finally {
        fakeFrames.cleanup();
        cleanup();
    }
});

test("youtube: after explicit restore, same target does not auto-resume on redraw", () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        thumb.dataset.videoId = "video1";
        thumb.dataset.playbackKey = "video1:0";
        thumb.classList.add("playing");
        thumb.appendChild(document.createElement("iframe"));
        ui.playback.activeThumb = thumb;

        controller.restoreActivePlayback();
        assert.equal(ui.playback.activeThumb, null);
        assert.equal(thumb.querySelector("iframe"), null);

        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 0 });
        assert.equal(thumb.querySelector("iframe"), null);
        assert.ok(thumb.querySelector("img"));
        assert.equal(typeof thumb.onclick, "function");
    } finally {
        cleanup();
    }
});

test("youtube: switching to another thumbnail recreates the shared player", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            playArchiveToEnd: false,
            continuousPlayback: true
        });
        const { controller } = createYoutubeControllerHarness({ ui });
        const players = installYoutubePlayerFixture();
        const { thumbA, thumbB } = createTwoYoutubePlaybackThumbs(controller);

        clickThumbnail(thumbA);
        await setImmediate();

        const firstIframe = thumbA.querySelector("iframe");
        assert.ok(firstIframe);
        assert.equal(firstIframe.src.includes("autoplay=0"), true);
        assert.equal(players.length, 1);

        clickThumbnail(thumbB);
        await setImmediate();

        const secondIframe = thumbB.querySelector("iframe");
        assert.equal(thumbA.querySelector("iframe"), null);
        assert.ok(secondIframe);
        assert.notEqual(secondIframe, firstIframe);
        assert.equal(secondIframe.src.includes("autoplay=0"), true);
        assert.equal(players.length, 2);
        assert.equal(players[0].player.stopCalls, 1);
        assert.equal(players[0].player.destroyCalls, 1);
        assert.deepEqual(players[0].player.loadCalls, []);
    } finally {
        cleanup();
    }
});

test("youtube: pending shared player init uses the latest clicked thumbnail", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            playArchiveToEnd: false,
            continuousPlayback: true
        });
        const { controller } = createYoutubeControllerHarness({ ui });
        const { api, creations: playerCalls } = createYoutubeIframeApiFixture();
        window.YT = api;

        const cardA = document.createElement("div");
        const cardB = document.createElement("div");
        cardA.className = "song-card";
        cardB.className = "song-card";
        cardA.dataset.songKey = "song:a";
        cardB.dataset.songKey = "song:b";
        const thumbA = document.createElement("div");
        const thumbB = document.createElement("div");
        cardA.appendChild(thumbA);
        cardB.appendChild(thumbB);
        document.body.append(cardA, cardB);

        controller.updateThumbnail(thumbA, { isVertical: false, videoId: "video-a", startSeconds: 5, endSeconds: 25 });
        controller.updateThumbnail(thumbB, { isVertical: false, videoId: "video-b", startSeconds: 15, endSeconds: 45 });

        clickThumbnail(thumbA);
        clickThumbnail(thumbB);
        await setImmediate();
        assert.equal(playerCalls.length, 1);
        playerCalls[0].emitReady();

        assert.equal(playerCalls[0].iframe, requireIframe(thumbB));
        assert.equal(playerCalls[0].iframe.tagName, "IFRAME");
        assert.match(requireIframe(thumbB).src, /^https:\/\/www\.youtube\.com\/embed\/video-b\?/);
        assert.equal(thumbA.querySelector("iframe"), null);
        assert.ok(thumbB.querySelector("iframe"));
    } finally {
        cleanup();
    }
});

test("youtube: same thumbnail recreates a fresh player after restore", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            playArchiveToEnd: false,
            continuousPlayback: true
        });
        const { controller } = createYoutubeControllerHarness({ ui });
        const players = installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        document.body.append(card);

        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 5, endSeconds: 25 });
        clickThumbnail(thumb);
        await setImmediate();

        const firstIframe = thumb.querySelector("iframe");
        assert.ok(firstIframe);
        assert.equal(players.length, 1);

        const close = thumb.querySelector("button");
        invokeListener(close, "click", {
            stopPropagation() {}
        });

        assert.equal(players[0].player.stopCalls, 1);
        assert.ok(thumb.querySelector("img"));

        clickThumbnail(thumb);
        await setImmediate();

        const secondIframe = thumb.querySelector("iframe");
        assert.notEqual(secondIframe, firstIframe);
        assert.equal(players.length, 2);
        assert.deepEqual(players[0].player.loadCalls, []);
    } finally {
        cleanup();
    }
});

/** 同じサムネイルで旧Playerを閉じ、新Playerの開始通知待ちまで進める。 */
async function prepareSameThumbReplay() {
    const { ui, controller } = createYoutubeControllerHarness();
    const players = installYoutubePlayerFixture({ readPlayerState: true });
    const card = document.createElement("div");
    card.className = "song-card";
    card.dataset.songKey = "song:replay";
    const thumb = document.createElement("div");
    card.appendChild(thumb);
    document.body.appendChild(card);
    const target = { isVertical: false, videoId: "video1", startSeconds: 5, endSeconds: 25 };
    const firstPromise = controller.playThumbnail(thumb, target);
    await setImmediate();
    assert.equal(players.length, 1);
    const oldPlayer = players[0];
    oldPlayer.player.currentState = YOUTUBE_PLAYER_STATE.PLAYING;
    oldPlayer.emitStateChange(YOUTUBE_PLAYER_STATE.PLAYING);
    assertPlaybackStartStatus(await firstPromise, YOUTUBE_PLAYBACK_START_STATUS.STARTED);

    controller.restoreActivePlayback();
    await setImmediate();
    const replayPromise = controller.playThumbnail(thumb, target);
    await setImmediate();
    assert.equal(players.length, 2);
    const newPlayer = players[1];
    assert.notEqual(newPlayer.player, oldPlayer.player);
    assert.equal(oldPlayer.player.destroyCalls, 1);
    return { ui, controller, thumb, oldPlayer, newPlayer, replayPromise };
}

test("youtube: old Player ended/error events do not tear down the same-thumb replay", async (t) => {
    t.after(installFakeDom());
    const { ui, controller, thumb, oldPlayer, newPlayer, replayPromise } = await prepareSameThumbReplay();
    const ended = t.mock.fn();
    const failed = t.mock.fn();
    controller.setPlaybackEndedHook(ended);
    controller.setPlaybackStartFailedHook(failed);
    newPlayer.player.currentState = YOUTUBE_PLAYER_STATE.PLAYING;
    newPlayer.emitStateChange(YOUTUBE_PLAYER_STATE.PLAYING);
    assertPlaybackStartStatus(await replayPromise, YOUTUBE_PLAYBACK_START_STATUS.STARTED);

    oldPlayer.player.currentState = YOUTUBE_PLAYER_STATE.ENDED;
    oldPlayer.emitStateChange(YOUTUBE_PLAYER_STATE.ENDED);
    oldPlayer.emitError(150);
    await setImmediate();

    assert.equal(requireIframe(thumb), newPlayer.iframe);
    assert.equal(ui.playback.activeThumb, thumb);
    assert.equal(newPlayer.player.destroyCalls, 0);
    assert.equal(ended.mock.callCount(), 0);
    assert.equal(failed.mock.callCount(), 0);
});

test("youtube: old Player events do not settle the pending same-thumb replay", async (t) => {
    t.after(installFakeDom());
    const { ui, controller, thumb, oldPlayer, newPlayer, replayPromise } = await prepareSameThumbReplay();
    const settled = t.mock.fn();
    const failed = t.mock.fn();
    replayPromise.then(settled);
    controller.setPlaybackStartFailedHook(failed);

    oldPlayer.player.currentState = YOUTUBE_PLAYER_STATE.ENDED;
    oldPlayer.emitStateChange(YOUTUBE_PLAYER_STATE.ENDED);
    oldPlayer.emitError(150);
    await setImmediate();

    assert.equal(settled.mock.callCount(), 0);
    assert.equal(failed.mock.callCount(), 0);
    assert.equal(requireIframe(thumb), newPlayer.iframe);
    assert.equal(ui.playback.activeThumb, thumb);
    newPlayer.player.currentState = YOUTUBE_PLAYER_STATE.PLAYING;
    newPlayer.emitStateChange(YOUTUBE_PLAYER_STATE.PLAYING);
    assertPlaybackStartStatus(await replayPromise, YOUTUBE_PLAYBACK_START_STATUS.STARTED);
});

test("youtube: current Player ignores ended notification when its state still reports playing", async (t) => {
    t.after(installFakeDom());
    const { ui, thumb, newPlayer, replayPromise } = await prepareSameThumbReplay();
    const settled = t.mock.fn();
    replayPromise.then(settled);
    newPlayer.player.currentState = YOUTUBE_PLAYER_STATE.PLAYING;
    newPlayer.emitStateChange(YOUTUBE_PLAYER_STATE.ENDED);
    await setImmediate();

    assert.equal(settled.mock.callCount(), 0);
    assert.equal(requireIframe(thumb), newPlayer.iframe);
    assert.equal(ui.playback.activeThumb, thumb);
    newPlayer.emitStateChange(YOUTUBE_PLAYER_STATE.PLAYING);
    assertPlaybackStartStatus(await replayPromise, YOUTUBE_PLAYBACK_START_STATUS.STARTED);
});

test("youtube: playback start timeout leaves the iframe mounted as unconfirmed", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        installYoutubePlayerFixture();

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video-timeout",
            startSeconds: 0
        });
        await setImmediate();

        assert.ok(thumb.querySelector("iframe"));
        const startTimeout = requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_START_TIMEOUT_MS);

        startTimeout.cb();
        await setImmediate();

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED);
        assert.ok(thumb.querySelector("iframe"));
        assert.equal(thumb.querySelector("img"), null);
        assert.equal(ui.playback.activeThumb, thumb);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: autoplay timeout leaves the iframe mounted as unconfirmed", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video-auto-timeout",
            startSeconds: 0
        }, {
            playbackMode: "autoplay"
        });
        await setImmediate();

        const startTimeout = requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_START_TIMEOUT_MS);

        startTimeout.cb();
        await setImmediate();

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED);
        assert.ok(thumb.querySelector("iframe"));
        assert.equal(thumb.querySelector("img"), null);
        assert.equal(ui.playback.activeThumb, thumb);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: debug autoplay fallback restores thumbnail and notifies continuation", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        window.__KNK_AUTOPLAY_START_FALLBACK__ = true;
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const failedCalls: Parameters<Parameters<typeof controller.setPlaybackStartFailedHook>[0]>[0][] = [];
        controller.setPlaybackStartFailedHook((payload) => {
            failedCalls.push(payload);
        });
        installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:debug-autoplay-fallback";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video-debug-autoplay-fallback",
            startSeconds: 0
        }, {
            playbackMode: "autoplay"
        });
        await setImmediate();

        const startTimeout = requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_START_TIMEOUT_MS);
        startTimeout.cb();
        await setImmediate();

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.FAILED);
        assert.ok(thumb.querySelector("img"));
        assert.equal(thumb.querySelector("iframe"), null);
        assert.equal(ui.playback.activeThumb, null);
        assert.deepEqual(failedCalls, [
            {
                songKey: "song:debug-autoplay-fallback",
                playbackMode: "autoplay",
                wasPlaybackStartUnconfirmed: true
            }
        ]);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: delayed autoplay error after unconfirmed timeout notifies continuation", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const failedCalls: Parameters<Parameters<typeof controller.setPlaybackStartFailedHook>[0]>[0][] = [];
        controller.setPlaybackStartFailedHook((payload) => {
            failedCalls.push(payload);
        });
        const players = installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:delayed-autoplay-error";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video-delayed-autoplay-error",
            startSeconds: 0
        }, {
            playbackMode: "autoplay"
        });
        await setImmediate();

        const startTimeout = requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_START_TIMEOUT_MS);
        startTimeout.cb();
        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED);

        players[0].emitError(150);
        await setImmediate();

        assert.ok(thumb.querySelector("img"));
        assert.equal(ui.playback.activeThumb, null);
        assert.deepEqual(failedCalls, [
            {
                songKey: "song:delayed-autoplay-error",
                playbackMode: "autoplay",
                wasPlaybackStartUnconfirmed: true
            }
        ]);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: manual API fallback survives a late cancelled setup callback", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const ui = createYoutubeUiState({});
        const { youtube, controller } = createYoutubeControllerHarness({ ui });

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video-fallback",
            startSeconds: 12
        });
        await setImmediate();

        const setupTimeout = requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_SETUP_TIMEOUT_MS);
        const apiScript = document.head.querySelector("script");
        assert.ok(apiScript);
        assert.equal(apiScript.tagName, "SCRIPT");
        assert.ok(apiScript.onerror);
        apiScript.onerror(new Event("error"));
        assert.ok(youtube.apiPromise);
        await youtube.apiPromise.catch(() => {});
        await setImmediate();

        assert.ok(thumb.querySelector("iframe"));
        assert.equal(setupTimeout.cleared, true);

        // API失敗で開始待ちを解決した後に、キャンセル済みの通知が遅れて届く場合。
        setupTimeout.cb();
        await setImmediate();

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.STARTED);
        assert.ok(thumb.querySelector("iframe"));
        assert.equal(thumb.querySelector("img"), null);
        assert.equal(ui.playback.activeThumb, thumb);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: autoplay playback is restored when iframe api loading fails", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const ui = createYoutubeUiState({});
        const { youtube, controller } = createYoutubeControllerHarness({ ui });

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        thumb.dataset.videoId = "video-fallback-autoplay";
        const playbackPromise = controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video-fallback-autoplay",
            startSeconds: 12
        }, {
            playbackMode: "autoplay"
        });
        await setImmediate();

        const setupTimeout = requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_SETUP_TIMEOUT_MS);
        const apiScript = document.head.querySelector("script");
        assert.ok(apiScript);
        assert.equal(apiScript.tagName, "SCRIPT");
        assert.ok(apiScript.onerror);
        apiScript.onerror(new Event("error"));
        assert.ok(youtube.apiPromise);
        await youtube.apiPromise.catch(() => {});
        await setImmediate();

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.FAILED);
        assert.ok(thumb.querySelector("img"));
        assert.equal(thumb.querySelector("iframe"), null);
        assert.equal(ui.playback.activeThumb, null);
        assert.equal(setupTimeout.cleared, true);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: embed url includes end time when archive-to-end playback is disabled", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            playArchiveToEnd: false
        });
        const { controller } = createYoutubeControllerHarness({ ui });
        installYoutubePlayerFixture();

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 45, endSeconds: 75 });
        clickThumbnail(thumb);
        await setImmediate();

        assert.match(requireIframe(thumb).src, /^https:\/\/www\.youtube\.com\/embed\/video1\?/);
        assert.match(requireIframe(thumb).src, /start=45/);
        assert.match(requireIframe(thumb).src, /end=75/);
        assert.equal(thumb.dataset.playbackKey, "video1:45:75");
        assert.equal(thumb.dataset.playbackEndSeconds, "75");
    } finally {
        cleanup();
    }
});

test("youtube: embed url uses youtube-nocookie host when enabled", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            useYoutubeNoCookie: true
        });
        const { controller } = createYoutubeControllerHarness({ ui });
        installYoutubePlayerFixture();

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 45, endSeconds: 75 });
        clickThumbnail(thumb);
        await setImmediate();

        assert.match(
            requireIframe(thumb).src,
            /^https:\/\/www\.youtube-nocookie\.com\/embed\/video1\?/
        );
        assert.match(requireIframe(thumb).src, /start=45/);
        assert.match(requireIframe(thumb).src, /end=75/);
    } finally {
        cleanup();
    }
});

test("youtube: embed url omits end time when archive-to-end playback is enabled", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({
            playArchiveToEnd: true
        });
        const { controller } = createYoutubeControllerHarness({ ui });
        installYoutubePlayerFixture();

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 45, endSeconds: 75 });
        clickThumbnail(thumb);
        await setImmediate();

        assert.match(requireIframe(thumb).src, /^https:\/\/www\.youtube\.com\/embed\/video1\?/);
        assert.match(requireIframe(thumb).src, /start=45/);
        assert.equal(/(?:\?|&)end=/.test(requireIframe(thumb).src), false);
        assert.equal(thumb.dataset.playbackKey, "video1:45:");
        assert.equal(thumb.dataset.playbackEndSeconds, undefined);
    } finally {
        cleanup();
    }
});

test("youtube: ended playback restores thumbnail while paused playback keeps iframe", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });

        const players = installYoutubePlayerFixture();

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video1", startSeconds: 45 });
        clickThumbnail(thumb);
        await setImmediate();

        assert.ok(thumb.querySelector("iframe"));
        assert.equal(thumb.classList.contains("playing"), true);

        players[0].emitStateChange(globalThis.window.YT.PlayerState.PAUSED);
        assert.ok(thumb.querySelector("iframe"));
        assert.equal(thumb.classList.contains("playing"), false);

        thumb.classList.add("playing");
        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        await setImmediate();
        assert.equal(thumb.querySelector("iframe"), null);
        assert.ok(thumb.querySelector("img"));
        assert.equal(thumb.classList.contains("playing"), false);
        assert.equal(ui.playback.activeThumb, null);
        assert.equal(players[0].player.stopCalls, 1);
    } finally {
        cleanup();
    }
});

test("youtube: ended playback notifies song key for playback continuation", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        let endedSongKey = "";
        controller.setPlaybackEndedHook(({ songKey }) => {
            endedSongKey = songKey;
        });
        const players = installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:2";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video2", startSeconds: 0 });
        clickThumbnail(thumb);
        await setImmediate();

        players[0].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);
        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        await setImmediate();

        assert.equal(endedSongKey, "song:2");
        assert.equal(ui.playback.activeThumb, null);
        assert.ok(thumb.querySelector("img"));
    } finally {
        cleanup();
    }
});

test("youtube: updating another thumbnail preserves the active player's ended handling", async () => {
    const cleanup = installFakeDom();
    try {
        const { ui, controller } = createYoutubeControllerHarness();
        const players = installYoutubePlayerFixture();
        const endedCalls: string[] = [];
        controller.setPlaybackEndedHook(({ songKey }) => endedCalls.push(songKey));
        const { thumbA, thumbB } = createTwoYoutubePlaybackThumbs(controller);
        const cardA = thumbA.closest(".song-card");
        assert.ok(cardA instanceof HTMLElement);
        cardA.dataset.songKey = "song:a";
        clickThumbnail(thumbA);
        await setImmediate();
        players[0].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);

        controller.updateThumbnail(thumbB, { videoId: "new-video", startSeconds: 0, isVertical: false });
        assert.equal(ui.playback.activeThumb, thumbA);
        assert.ok(thumbA.querySelector("iframe"));
        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        await setImmediate();

        assert.deepEqual(endedCalls, ["song:a"]);
        assert.equal(thumbA.querySelector("iframe"), null);
        assert.ok(thumbA.querySelector("img"));
        assert.equal(ui.playback.activeThumb, null);
    } finally {
        cleanup();
    }
});

test("youtube: updating another thumbnail keeps playback start pending until PLAYING", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { youtube, controller } = createYoutubeControllerHarness();
        const players = installYoutubePlayerFixture();
        const { thumbA, thumbB } = createTwoYoutubePlaybackThumbs(controller);
        const startPromise = controller.playThumbnail(thumbA, { videoId: "video1", startSeconds: 5, isVertical: false });
        await setImmediate();
        const attempt = youtube.sharedPlayback?.playbackStartAttempt;
        assert.ok(attempt);
        const startTimeout = requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_START_TIMEOUT_MS);

        controller.updateThumbnail(thumbB, { videoId: "new-video", startSeconds: 0, isVertical: false });

        assert.equal(youtube.sharedPlayback?.playbackStartAttempt, attempt);
        assert.equal(startTimeout.cleared, false);
        players[0].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);
        assert.deepEqual(await startPromise, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED));
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: updating another thumbnail keeps an unconfirmed start record for a delayed error", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { youtube, controller } = createYoutubeControllerHarness();
        const players = installYoutubePlayerFixture();
        const failedCalls: Parameters<Parameters<typeof controller.setPlaybackStartFailedHook>[0]>[0][] = [];
        controller.setPlaybackStartFailedHook((payload) => failedCalls.push(payload));
        const { thumbA, thumbB } = createTwoYoutubePlaybackThumbs(controller);
        const cardA = thumbA.closest(".song-card");
        assert.ok(cardA instanceof HTMLElement);
        cardA.dataset.songKey = "song:unconfirmed";
        const startPromise = controller.playThumbnail(thumbA, { videoId: "video1", startSeconds: 5, isVertical: false }, {
            playbackMode: "autoplay"
        });
        await setImmediate();
        requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_START_TIMEOUT_MS).cb();
        assertPlaybackStartStatus(await startPromise, YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED);
        const sessionId = Number(thumbA.dataset.playbackSessionId);

        controller.updateThumbnail(thumbB, { videoId: "new-video", startSeconds: 0, isVertical: false });

        assert.equal(youtube.sharedPlayback?.unconfirmedPlaybackStartSessionId, sessionId);
        players[0].emitError(150);
        await setImmediate();
        assert.deepEqual(failedCalls, [{
            songKey: "song:unconfirmed",
            playbackMode: "autoplay",
            wasPlaybackStartUnconfirmed: true
        }]);
        assert.equal(thumbA.querySelector("iframe"), null);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: updating another thumbnail keeps the post-playback ad watch until a stop event", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const { ui, controller } = createYoutubeControllerHarness();
        const players = installYoutubePlayerFixture({ readPlayerState: true, duration: 120 });
        const endedCalls: string[] = [];
        controller.setPlaybackEndedHook(({ songKey }) => endedCalls.push(songKey));
        const { thumbA, thumbB } = createTwoYoutubePlaybackThumbs(controller);
        const cardA = thumbA.closest(".song-card");
        assert.ok(cardA instanceof HTMLElement);
        cardA.dataset.songKey = "song:post-ad";
        clickThumbnail(thumbA);
        await setImmediate();
        const player = players[0].player;
        player.currentState = globalThis.window.YT.PlayerState.PLAYING;
        players[0].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);
        player.currentTime = 25;
        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        const restorePoll = requireActiveTimeout(fakeTimeouts, 500);

        controller.updateThumbnail(thumbB, { videoId: "new-video", startSeconds: 0, isVertical: false });

        assert.equal(restorePoll.cleared, false);
        assert.ok(thumbA.querySelector("iframe"));
        assert.deepEqual(endedCalls, []);
        player.currentState = globalThis.window.YT.PlayerState.PAUSED;
        players[0].emitStateChange(globalThis.window.YT.PlayerState.PAUSED);
        await setImmediate();
        assert.equal(thumbA.querySelector("iframe"), null);
        assert.equal(ui.playback.activeThumb, null);
        assert.deepEqual(endedCalls, ["song:post-ad"]);
        assert.equal(restorePoll.cleared, true);
        assert.equal(player.stopCalls, 1);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: post-playback ad end restores thumbnail after stale ended state", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const endedCalls: string[] = [];
        controller.setPlaybackEndedHook(({ songKey }) => {
            endedCalls.push(songKey);
        });
        const players = installYoutubePlayerFixture({ readPlayerState: true, duration: 120 });

        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:post-ad";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video-post-ad", startSeconds: 45, endSeconds: 75 });
        clickThumbnail(thumb);
        await setImmediate();

        const playerInstance = players[0].player;
        assert.equal(thumb.dataset.playbackEndSeconds, "75");
        playerInstance.currentState = globalThis.window.YT.PlayerState.PLAYING;
        players[0].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);

        playerInstance.currentTime = 75;
        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        await setImmediate();

        assert.ok(thumb.querySelector("iframe"));
        assert.deepEqual(endedCalls, []);

        const restorePoll = requireActiveTimeout(fakeTimeouts, 500);
        playerInstance.currentState = globalThis.window.YT.PlayerState.PAUSED;
        restorePoll.cb();
        await setImmediate();

        assert.equal(thumb.querySelector("iframe"), null);
        assert.ok(thumb.querySelector("img"));
        assert.equal(thumb.dataset.playbackEndSeconds, undefined);
        assert.equal(ui.playback.activeThumb, null);
        assert.deepEqual(endedCalls, ["song:post-ad"]);
        assert.equal(playerInstance.stopCalls, 1);
    } finally {
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: stale ended event from a closed player does not notify playback continuation", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const endedCalls: string[] = [];
        const failedCalls: Parameters<Parameters<typeof controller.setPlaybackStartFailedHook>[0]>[0][] = [];
        controller.setPlaybackEndedHook(({ songKey }) => {
            endedCalls.push(songKey);
        });
        controller.setPlaybackStartFailedHook((payload) => {
            failedCalls.push(payload);
        });
        const players = installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:stale";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        controller.updateThumbnail(thumb, { isVertical: false, videoId: "video-stale", startSeconds: 0 });
        clickThumbnail(thumb);
        await setImmediate();

        const close = thumb.querySelector("button");
        invokeListener(close, "click", {
            stopPropagation() {}
        });
        await setImmediate();

        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        await setImmediate();

        assert.deepEqual(endedCalls, []);
        assert.equal(ui.playback.activeThumb, null);
    } finally {
        cleanup();
    }
});

test("youtube: ended playback waits for layout refresh before notifying", async () => {
    const cleanup = installFakeDom();
    const fakeFrames = installFakeAnimationFrames();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const order: string[] = [];
        controller.setLayoutHook(() => {
            order.push("layout");
        });
        controller.setPlaybackEndedHook(({ songKey }) => {
            order.push(`ended:${songKey}`);
        });
        const players = installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:wait";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        controller.playThumbnail(thumb, { isVertical: false, videoId: "video-wait", startSeconds: 0 });
        await setImmediate();

        players[0].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);
        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        assert.deepEqual(order, []);

        fakeFrames.advanceFrame();
        assert.deepEqual(order, ["layout"]);

        fakeFrames.advanceFrame();
        await setImmediate();

        assert.deepEqual(order, ["layout", "ended:song:wait"]);
    } finally {
        fakeFrames.cleanup();
        cleanup();
    }
});

test("youtube: ended playback does not continue after a newer playback starts", async () => {
    const cleanup = installFakeDom();
    const fakeFrames = installFakeAnimationFrames();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const endedCalls: string[] = [];
        controller.setPlaybackEndedHook(({ songKey }) => {
            endedCalls.push(songKey);
        });
        const players = installYoutubePlayerFixture();

        const firstCard = document.createElement("div");
        firstCard.className = "song-card";
        firstCard.dataset.songKey = "song:first";
        document.body.appendChild(firstCard);
        const firstThumb = document.createElement("div");
        firstCard.appendChild(firstThumb);
        controller.updateThumbnail(firstThumb, { isVertical: false, videoId: "video-first", startSeconds: 0 });
        clickThumbnail(firstThumb);
        await setImmediate();
        players[0].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);

        const secondCard = document.createElement("div");
        secondCard.className = "song-card";
        secondCard.dataset.songKey = "song:second";
        document.body.appendChild(secondCard);
        const secondThumb = document.createElement("div");
        secondCard.appendChild(secondThumb);

        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        controller.playThumbnail(secondThumb, { isVertical: false, videoId: "video-second", startSeconds: 0 });
        await setImmediate();

        while (fakeFrames.pendingCount > 0) fakeFrames.advanceFrame();
        await setImmediate();

        assert.deepEqual(endedCalls, []);
        assert.equal(ui.playback.activeThumb, secondThumb);
    } finally {
        fakeFrames.cleanup();
        cleanup();
    }
});

test("youtube: ended before playback starts restores thumbnail without notifying continuation", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const endedCalls: string[] = [];
        const failedCalls: Parameters<Parameters<typeof controller.setPlaybackStartFailedHook>[0]>[0][] = [];
        controller.setPlaybackEndedHook(({ songKey }) => {
            endedCalls.push(songKey);
        });
        controller.setPlaybackStartFailedHook((payload) => {
            failedCalls.push(payload);
        });
        const players = installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:instant-end";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, { isVertical: false, videoId: "video-instant-end", startSeconds: 0 });
        await setImmediate();

        players[0].emitStateChange(globalThis.window.YT.PlayerState.ENDED);
        await setImmediate();

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.FAILED);
        assert.deepEqual(endedCalls, []);
        assert.deepEqual(failedCalls, [
            {
                songKey: "song:instant-end",
                playbackMode: "manual"
            }
        ]);
        assert.equal(ui.playback.activeThumb, null);
        assert.ok(thumb.querySelector("img"));
    } finally {
        cleanup();
    }
});

test("youtube: playThumbnail resolves started result after the player enters PLAYING", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const players = installYoutubePlayerFixture();

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, { isVertical: false, videoId: "video-play", startSeconds: 0 });
        await setImmediate();

        players[0].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.STARTED);
    } finally {
        cleanup();
    }
});

test("youtube: playThumbnail resolves started result when attached player is already playing", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        installYoutubePlayerFixture({ readPlayerState: true, initialState: YOUTUBE_PLAYER_STATE.PLAYING });

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, { isVertical: false, videoId: "video-already-playing", startSeconds: 0 });
        await setImmediate();

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.STARTED);
    } finally {
        cleanup();
    }
});

test("youtube: playThumbnail resolves failed result and restores the thumbnail after a player error", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const failedCalls: Parameters<Parameters<typeof controller.setPlaybackStartFailedHook>[0]>[0][] = [];
        controller.setPlaybackStartFailedHook((payload) => {
            failedCalls.push(payload);
        });
        const players = installYoutubePlayerFixture();

        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = "song:player-error";
        document.body.appendChild(card);
        const thumb = document.createElement("div");
        card.appendChild(thumb);
        thumb.dataset.videoId = "video-error";
        const playbackPromise = controller.playThumbnail(thumb, { isVertical: false, videoId: "video-error", startSeconds: 0 });
        await setImmediate();

        players[0].emitError(150);

        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.FAILED);
        assert.ok(thumb.querySelector("img"));
        assert.equal(thumb.classList.contains("playing"), false);
        assert.deepEqual(failedCalls, [
            {
                songKey: "song:player-error",
                playbackMode: "manual"
            }
        ]);
    } finally {
        cleanup();
    }
});

test("youtube: autoplay timeout emits debug logs only when debug mode is enabled", async () => {
    const cleanup = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    const previousConsoleDebug = console.debug;
    const previousConsoleTrace = console.trace;
    const previousLocalStorage = globalThis.localStorage;
    const debugCalls: unknown[][] = [];
    setGlobalValue("localStorage", createFakeLocalStorage());
    console.debug = (...args) => {
        debugCalls.push(args);
    };
    console.trace = () => {};
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });

        const thumb = document.createElement("div");
        document.body.appendChild(thumb);
        const playbackPromise = controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video-autoplay-debug",
            startSeconds: 30
        }, {
            playbackMode: "autoplay"
        });
        await setImmediate();

        requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_SETUP_TIMEOUT_MS).cb();
        await setImmediate();
        assertPlaybackStartStatus(await playbackPromise, YOUTUBE_PLAYBACK_START_STATUS.FAILED);
        assert.deepEqual(debugCalls, []);

        globalThis.localStorage.setItem("debugYoutubePlayer", "true");

        const secondPlaybackPromise = controller.playThumbnail(thumb, {
            isVertical: false,
            videoId: "video-autoplay-debug-2",
            startSeconds: 45
        }, {
            playbackMode: "autoplay"
        });
        await setImmediate();

        requireActiveTimeout(fakeTimeouts, DEFAULT_PLAYBACK_SETUP_TIMEOUT_MS).cb();
        await setImmediate();
        assertPlaybackStartStatus(await secondPlaybackPromise, YOUTUBE_PLAYBACK_START_STATUS.FAILED);
        assert.equal(
            debugCalls.some((args) => JSON.stringify(args) === JSON.stringify([
                "[youtube]",
                "autoplay playback start failed; skipping candidate",
                {
                    songKey: "",
                    videoId: "video-autoplay-debug-2",
                    reason: "setup-timeout"
                }
            ])),
            true
        );
    } finally {
        console.debug = previousConsoleDebug;
        console.trace = previousConsoleTrace;
        setGlobalValue("localStorage", previousLocalStorage);
        fakeTimeouts.cleanup();
        cleanup();
    }
});

test("youtube: recreating the shared player does not fail the newer playback attempt early", async () => {
    const cleanup = installFakeDom();
    try {
        const ui = createYoutubeUiState({});
        const { controller } = createYoutubeControllerHarness({ ui });
        const players = installYoutubePlayerFixture();

        const firstCard = document.createElement("div");
        const secondCard = document.createElement("div");
        firstCard.className = "song-card";
        secondCard.className = "song-card";
        const firstThumb = document.createElement("div");
        const secondThumb = document.createElement("div");
        firstCard.appendChild(firstThumb);
        secondCard.appendChild(secondThumb);
        document.body.append(firstCard, secondCard);

        const firstPromise = controller.playThumbnail(firstThumb, { isVertical: false, videoId: "video-first", startSeconds: 0 });
        await setImmediate();

        let secondResult: YoutubePlaybackStartResult | "pending" = "pending";
        const secondPromise = controller.playThumbnail(secondThumb, { isVertical: false, videoId: "video-second", startSeconds: 0 });
        secondPromise.then((didStart) => {
            secondResult = didStart;
        });
        await setImmediate();

        assertPlaybackStartStatus(await firstPromise, YOUTUBE_PLAYBACK_START_STATUS.FAILED);
        assert.equal(secondResult, "pending");

        players[1].emitStateChange(globalThis.window.YT.PlayerState.PLAYING);

        assertPlaybackStartStatus(await secondPromise, YOUTUBE_PLAYBACK_START_STATUS.STARTED);
        assertPlaybackStartStatus(secondResult, YOUTUBE_PLAYBACK_START_STATUS.STARTED);
    } finally {
        cleanup();
    }
});
