import test from "node:test";
import assert from "node:assert/strict";
import { createSongFixture } from "./fixtures/song.mts";
import { installFakeDom } from "./test-helpers.mts";
import { createPlaybackSessionController } from "../app/controllers/playback-session.mts";
import {
    createYoutubePlaybackStartResult,
    YOUTUBE_PLAYBACK_START_STATUS
} from "../app/lib/youtube/playback-start-attempt.mts";

/**
 * 再生セッション制御テスト用の UI 状態を作る。
 */
function createPlaybackUi(
    settings: Partial<Parameters<typeof createPlaybackSessionController>[0]["ui"]["playback"]> = {}
): Parameters<typeof createPlaybackSessionController>[0]["ui"] {
    return {
        playback: {
            continuousPlayback: Boolean(settings.continuousPlayback),
            loopPlayback: Boolean(settings.loopPlayback),
            activeThumb: settings.activeThumb ?? null
        }
    };
}

/**
 * 再生開始結果テスト用の started 結果を返す。
 */
function playbackStarted() {
    return createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED);
}

/**
 * 再生開始結果テスト用の failed 結果を返す。
 */
function playbackFailed() {
    return createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED);
}

/**
 * 再生開始結果テスト用の unconfirmed 結果を返す。
 */
function playbackUnconfirmed() {
    return createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.UNCONFIRMED);
}

test("playback session: reveals the next song before starting it", async () => {
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" }),
            createSongFixture({ songKey: "song:3" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: (songKey) => {
                calls.push(`reveal:${songKey}`);
                return true;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return playbackStarted();
            }
        }
    });

    const continued = await controller.continuePlayback("song:1");

    assert.equal(continued, true);
    assert.deepEqual(calls, ["reveal:song:2", "play:song:2"]);
});

test("playback session: tries later candidates when the next song cannot start", async () => {
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" }),
            createSongFixture({ songKey: "song:3" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: (songKey) => {
                calls.push(`reveal:${songKey}`);
                return true;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return songKey === "song:3" ? playbackStarted() : playbackFailed();
            }
        }
    });

    const continued = await controller.continuePlayback("song:1");

    assert.equal(continued, true);
    assert.deepEqual(calls, ["reveal:song:2", "play:song:2", "reveal:song:3", "play:song:3"]);
});

test("playback session: repeats current song when loop-only mode is enabled", async () => {
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" })
        ]
    };
    const ui = createPlaybackUi({ loopPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: (songKey) => {
                calls.push(`reveal:${songKey}`);
                return true;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return playbackStarted();
            }
        }
    });

    const continued = await controller.continuePlayback("song:2");

    assert.equal(continued, true);
    assert.deepEqual(calls, ["reveal:song:2", "play:song:2"]);
});

test("playback session: awaits async playback failure before trying the next candidate", async () => {
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" }),
            createSongFixture({ songKey: "song:3" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: (songKey) => {
                calls.push(`reveal:${songKey}`);
                return true;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return Promise.resolve(songKey === "song:3" ? playbackStarted() : playbackFailed());
            }
        }
    });

    const continued = await controller.continuePlayback("song:1");

    assert.equal(continued, true);
    assert.deepEqual(calls, ["reveal:song:2", "play:song:2", "reveal:song:3", "play:song:3"]);
});

test("playback session: reveals wrapped loop candidate even when playback cannot start", async () => {
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true, loopPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: (songKey) => {
                calls.push(`reveal:${songKey}`);
                return true;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return playbackFailed();
            }
        }
    });

    const continued = await controller.continuePlayback("song:2");

    assert.equal(continued, false);
    assert.deepEqual(calls, ["reveal:song:1", "play:song:1"]);
});

test("playback session: stops trying later candidates when playback start is unconfirmed", async () => {
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" }),
            createSongFixture({ songKey: "song:3" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: (songKey) => {
                calls.push(`reveal:${songKey}`);
                return true;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return playbackUnconfirmed();
            }
        }
    });

    const continued = await controller.continuePlayback("song:1");

    assert.equal(continued, false);
    assert.deepEqual(calls, ["reveal:song:2", "play:song:2"]);
});

test("playback session: stops trying later candidates after manual playback takes over", async (t) => {
    const cleanup = installFakeDom();
    t.after(cleanup);
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" }),
            createSongFixture({ songKey: "song:3" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: (songKey) => {
                calls.push(`reveal:${songKey}`);
                return true;
            },
            playSongByKey: async (songKey) => {
                calls.push(`play:${songKey}`);
                if (songKey === "song:2") {
                    ui.playback.activeThumb = document.createElement("div");
                    ui.playback.activeThumb.dataset.songKey = "song:manual";
                    return playbackFailed();
                }
                return playbackStarted();
            }
        }
    });

    const continued = await controller.continuePlayback("song:1");

    assert.equal(continued, false);
    assert.deepEqual(calls, ["reveal:song:2", "play:song:2"]);
});

test("playback session: waits for the next player to become visible before starting it", async () => {
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true });
    const calls: string[] = [];
    const visible = Promise.withResolvers<boolean>();
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: (songKey) => {
                calls.push(`reveal:${songKey}`);
                return visible.promise;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return playbackStarted();
            }
        }
    });

    const continuing = controller.continuePlayback("song:1");
    await Promise.resolve();
    assert.deepEqual(calls, ["reveal:song:2"], "playback waits until the player is visible");

    visible.resolve(true);

    assert.equal(await continuing, true);
    assert.deepEqual(calls, ["reveal:song:2", "play:song:2"]);
});

test("playback session: does not start the next song when its player does not become visible", async () => {
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" }),
            createSongFixture({ songKey: "song:3" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: async (songKey) => {
                calls.push(`reveal:${songKey}`);
                return false;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return playbackStarted();
            }
        }
    });

    const continued = await controller.continuePlayback("song:1");

    assert.equal(continued, false);
    assert.deepEqual(calls, ["reveal:song:2"], "later candidates are not revealed either");
});

test("playback session: stops without playing when manual playback takes over while revealing", async (t) => {
    const cleanup = installFakeDom();
    t.after(cleanup);
    const data = {
        currentResults: [
            createSongFixture({ songKey: "song:1" }),
            createSongFixture({ songKey: "song:2" }),
            createSongFixture({ songKey: "song:3" })
        ]
    };
    const ui = createPlaybackUi({ continuousPlayback: true });
    const calls: string[] = [];
    const controller = createPlaybackSessionController({
        data,
        ui,
        callbacks: {
            revealSongForAutoplay: async (songKey) => {
                calls.push(`reveal:${songKey}`);
                ui.playback.activeThumb = document.createElement("div");
                ui.playback.activeThumb.dataset.songKey = "song:manual";
                return true;
            },
            playSongByKey: (songKey) => {
                calls.push(`play:${songKey}`);
                return playbackStarted();
            }
        }
    });

    const continued = await controller.continuePlayback("song:1");

    assert.equal(continued, false);
    assert.deepEqual(calls, ["reveal:song:2"]);
});
