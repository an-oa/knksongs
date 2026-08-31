import test from "node:test";
import assert from "node:assert/strict";
import {
    ensureSongLookupMaps,
    resolveSongRef,
    resolveSongRefs
} from "../_build/app/lib/song-lookup.mjs";

/**
 * 曲 lookup テスト用の UI slice を作る。
 * @returns {object}
 */
function createLookupUiState() {
    return {
        songMapByBookmarkKey: new Map(),
        songMapByKey: new Map(),
        songLookupSourceRef: null
    };
}

test("song lookup: resolves bookmark and song keys", () => {
    const lookupUi = createLookupUiState();
    const rows = [
        {
            songKey: "arch1::1",
            bookmarkSongKey: "videoA::1",
            title: "青い月"
        },
        {
            songKey: "arch2::2",
            bookmarkSongKey: "videoB::2",
            title: "赤い星"
        }
    ];

    assert.equal(resolveSongRef(lookupUi, rows, "videoA::1"), rows[0]);
    assert.equal(resolveSongRef(lookupUi, rows, "arch2::2"), rows[1]);
    assert.equal(resolveSongRef(lookupUi, rows, "missing"), null);
});

test("song lookup: resolves bookmark song refs in saved order", () => {
    const lookupUi = createLookupUiState();
    const rows = [
        {
            songKey: "arch1::1",
            bookmarkSongKey: "videoA::1",
            title: "青い月"
        },
        {
            songKey: "arch2::2",
            bookmarkSongKey: "videoB::2",
            title: "赤い星"
        }
    ];

    assert.deepEqual(
        resolveSongRefs(lookupUi, rows, ["videoB::2", "missing", "videoA::1"]),
        [rows[1], rows[0]]
    );
});

test("song lookup: rebuilds maps when the source rows reference changes", () => {
    const lookupUi = createLookupUiState();
    const firstRows = [
        {
            songKey: "arch1::1",
            bookmarkSongKey: "videoA::1",
            title: "青い月"
        }
    ];
    const nextRows = [
        {
            songKey: "arch2::2",
            bookmarkSongKey: "videoB::2",
            title: "赤い星"
        }
    ];

    ensureSongLookupMaps(lookupUi, firstRows);
    assert.equal(resolveSongRef(lookupUi, firstRows, "videoA::1"), firstRows[0]);
    assert.equal(lookupUi.songLookupSourceRef, firstRows);

    assert.equal(resolveSongRef(lookupUi, nextRows, "videoA::1"), null);
    assert.equal(resolveSongRef(lookupUi, nextRows, "videoB::2"), nextRows[0]);
    assert.equal(lookupUi.songLookupSourceRef, nextRows);
});
