import test from "node:test";
import assert from "node:assert/strict";
import { createSongFixture } from "./fixtures/song.mts";
import type { LookupUiRuntimeState } from "../app/state.types";
import {
    ensureSongLookupMaps,
    resolveSongRef,
    resolveSongRefs
} from "../app/lib/song-lookup.mts";

/**
 * 曲 lookup テスト用の UI slice を作る。
 */
function createLookupUiState(): LookupUiRuntimeState {
    return {
        songMapByKey: new Map(),
        songLookupSourceRef: null
    };
}

test("song lookup: resolves a song key, and nothing else", () => {
    const lookupUi = createLookupUiState();
    const rows = [
        createSongFixture({
            archiveId: "arch1",
            archiveOrder: 1,
            songKey: "videoA::1",
            title: "青い月"
        }),
        createSongFixture({
            archiveId: "arch2",
            archiveOrder: 2,
            songKey: "videoB::2",
            title: "赤い星"
        })
    ];

    assert.equal(resolveSongRef(lookupUi, rows, "videoA::1"), rows[0]);
    assert.equal(resolveSongRef(lookupUi, rows, "videoB::2"), rows[1]);
    assert.equal(resolveSongRef(lookupUi, rows, "missing"), null);
    // 旧形式の参照 (archiveId と歌唱順) は、ブックマークの移行で書き換える。ここでは解決しない。
    assert.equal(resolveSongRef(lookupUi, rows, "arch2::2"), null);
});

test("song lookup: resolves bookmark song refs in saved order", () => {
    const lookupUi = createLookupUiState();
    const rows = [
        createSongFixture({
            archiveId: "arch1",
            archiveOrder: 1,
            songKey: "videoA::1",
            title: "青い月"
        }),
        createSongFixture({
            archiveId: "arch2",
            archiveOrder: 2,
            songKey: "videoB::2",
            title: "赤い星"
        })
    ];

    assert.deepEqual(
        resolveSongRefs(lookupUi, rows, ["videoB::2", "missing", "videoA::1"]),
        [rows[1], rows[0]]
    );
});

test("song lookup: rebuilds maps when the source rows reference changes", () => {
    const lookupUi = createLookupUiState();
    const firstRows = [
        createSongFixture({
            archiveId: "arch1",
            archiveOrder: 1,
            songKey: "videoA::1",
            title: "青い月"
        })
    ];
    const nextRows = [
        createSongFixture({
            archiveId: "arch2",
            archiveOrder: 2,
            songKey: "videoB::2",
            title: "赤い星"
        })
    ];

    ensureSongLookupMaps(lookupUi, firstRows);
    assert.equal(resolveSongRef(lookupUi, firstRows, "videoA::1"), firstRows[0]);
    assert.equal(lookupUi.songLookupSourceRef, firstRows);

    assert.equal(resolveSongRef(lookupUi, nextRows, "videoA::1"), null);
    assert.equal(resolveSongRef(lookupUi, nextRows, "videoB::2"), nextRows[0]);
    assert.equal(lookupUi.songLookupSourceRef, nextRows);
});
