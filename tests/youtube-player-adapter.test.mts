import test from "node:test";
import assert from "node:assert/strict";
import {
    YT_EMBED_HOST,
    YT_NOCOOKIE_EMBED_HOST
} from "../app/lib/youtube/embed.mts";
import { createYoutubePlayerAdapter } from "../app/lib/youtube/player-adapter.mts";
import type { YoutubePlayerEvent } from "../app/lib/youtube/iframe-api.types.mts";
import type { YoutubeSharedPlaybackState } from "../app/lib/youtube/shared-playback.mts";
import { createYoutubeIframeApiFixture } from "./fixtures/youtube-api.mts";
import { installFakeDom } from "./test-helpers.mts";

/**
 * YT.Player adapter のテスト用状態を作る。
 */
function createAdapterHarness(options: { ensureReady?: () => Promise<unknown> } = {}) {
    const sharedPlayback: Pick<YoutubeSharedPlaybackState, "player"> = {
        player: null
    };
    const calls: {
        appliedIframes: (Element | null)[];
        debug: { message: string; details: unknown }[];
        errors: { event: YoutubePlayerEvent; playbackSessionId: number }[];
        stateChanges: { event: YoutubePlayerEvent; playbackSessionId: number }[];
        sync: number;
    } = {
        appliedIframes: [],
        debug: [],
        errors: [],
        stateChanges: [],
        sync: 0
    };
    const adapter = createYoutubePlayerAdapter({
        getSharedPlaybackState: () => sharedPlayback,
        ensureReady: options.ensureReady || (() => Promise.resolve()),
        applyIframeAttributes: (iframe) => {
            calls.appliedIframes.push(iframe);
        },
        syncIframe: () => {
            calls.sync += 1;
        },
        handleStateChange: (event, playbackSessionId) => {
            calls.stateChanges.push({ event, playbackSessionId });
        },
        handlePlayerError: (event, playbackSessionId) => {
            calls.errors.push({ event, playbackSessionId });
        },
        debug: (message, details) => {
            calls.debug.push({ message, details });
        }
    });
    return { adapter, calls, sharedPlayback };
}

test("youtube player adapter: creates a YT.Player for the iframe and bridges events", async () => {
    const cleanup = installFakeDom();
    try {
        const { adapter, calls, sharedPlayback } = createAdapterHarness();
        const iframe = document.createElement("iframe");
        document.body.appendChild(iframe);
        const { api, creations } = createYoutubeIframeApiFixture();
        window.YT = api;

        const player = await adapter.attach(iframe, 7);

        assert.equal(player, sharedPlayback.player);
        assert.equal(creations.length, 1);
        assert.equal(creations[0].iframe, iframe);
        assert.equal(creations[0].options.host, YT_EMBED_HOST);
        assert.equal(creations[0].player, sharedPlayback.player);
        assert.deepEqual(calls.appliedIframes, [iframe], "ready has not been emitted yet");
        assert.equal(calls.sync, 1);

        creations[0].emitReady();
        assert.deepEqual(calls.appliedIframes, [iframe, iframe]);

        const stateEvent = { data: 1 };
        const errorEvent = { data: 150 };
        const events = creations[0].options.events;
        assert.ok(events?.onStateChange);
        assert.ok(events.onError);
        events.onStateChange(stateEvent);
        events.onError(errorEvent);

        assert.deepEqual(calls.stateChanges, [{ event: stateEvent, playbackSessionId: 7 }]);
        assert.deepEqual(calls.errors, [{ event: errorEvent, playbackSessionId: 7 }]);
    } finally {
        cleanup();
    }
});

test("youtube player adapter: uses nocookie host option for nocookie iframes", async () => {
    const cleanup = installFakeDom();
    try {
        const { adapter } = createAdapterHarness();
        const iframe = document.createElement("iframe");
        iframe.src = `${YT_NOCOOKIE_EMBED_HOST}/embed/video1?enablejsapi=1`;
        document.body.appendChild(iframe);
        const { api, creations } = createYoutubeIframeApiFixture();
        window.YT = api;

        await adapter.attach(iframe, 7);

        assert.equal(creations.length, 1);
        assert.equal(creations[0].options.host, YT_NOCOOKIE_EMBED_HOST);
    } finally {
        cleanup();
    }
});

test("youtube player adapter: an iframe removed while init is waiting gets no player, and the newer iframe does", async () => {
    const cleanup = installFakeDom();
    try {
        const ready = Promise.withResolvers<void>();
        const { adapter, calls, sharedPlayback } = createAdapterHarness({
            ensureReady: () => ready.promise
        });
        const firstIframe = document.createElement("iframe");
        document.body.appendChild(firstIframe);
        const { api, creations } = createYoutubeIframeApiFixture();
        window.YT = api;

        const firstAttach = adapter.attach(firstIframe, 1);
        // 別のカードで再生を始めると、前の iframe は破棄されて DOM から外れる。
        document.body.removeChild(firstIframe);
        const secondIframe = document.createElement("iframe");
        document.body.appendChild(secondIframe);
        const secondAttach = adapter.attach(secondIframe, 2);

        ready.resolve();
        assert.equal(await firstAttach, null);
        const player = await secondAttach;

        assert.equal(creations.length, 1);
        assert.equal(creations[0].iframe, secondIframe);
        assert.equal(player, sharedPlayback.player);

        const stateEvent = { data: 1 };
        creations[0].options.events?.onStateChange?.(stateEvent);
        assert.deepEqual(calls.stateChanges, [{ event: stateEvent, playbackSessionId: 2 }]);
    } finally {
        cleanup();
    }
});

test("youtube player adapter: ensureReady rejection rejects without creating a player", async () => {
    const cleanup = installFakeDom();
    try {
        const expectedError = new Error("iframe api failed");
        const { adapter, sharedPlayback } = createAdapterHarness({
            ensureReady: () => Promise.reject(expectedError)
        });
        const iframe = document.createElement("iframe");
        document.body.appendChild(iframe);

        await assert.rejects(adapter.attach(iframe, 1), expectedError);
        assert.equal(sharedPlayback.player, null);
    } finally {
        cleanup();
    }
});
