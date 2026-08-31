import test from "node:test";
import assert from "node:assert/strict";
import {
    exportBookmarksAsJsonText,
    parseBookmarkImportText
} from "../_build/app/lib/storage/bookmark-transfer.mjs";

test("bookmark transfer: exports a versioned bookmark JSON payload", () => {
    const result = exportBookmarksAsJsonText({
        b1: { name: "A", songs: ["videoA::1"], createdAt: 1 }
    }, 3);

    assert.equal(result.ok, true);
    assert.equal(result.bookmarkCount, 1);
    assert.equal(result.songCount, 1);
    assert.deepEqual(JSON.parse(result.text), {
        version: 3,
        bookmarks: {
            b1: { name: "A", songs: ["videoA::1"], createdAt: 1 }
        }
    });
});

test("bookmark transfer: drops unresolved numeric refs before applying song limits", () => {
    const result = parseBookmarkImportText(JSON.stringify({
        version: 2,
        bookmarks: {
            imported: {
                name: "Legacy indices",
                songs: [0, 1, "s1"],
                createdAt: 2
            }
        }
    }), {
        storageVersion: 3,
        songRows: [{ songKey: "s1", bookmarkSongKey: "s1" }],
        maxBookmarkCount: 20,
        maxSongsPerBookmark: 1
    });

    assert.equal(result.ok, true);
    assert.equal(result.songCount, 1);
    assert.deepEqual(result.bookmarks.imported.songs, ["s1"]);
});

test("bookmark transfer: never exports unresolved numeric refs", () => {
    const result = exportBookmarksAsJsonText({
        b1: { name: "A", songs: [0, "videoA::1"], createdAt: 1 }
    }, 3);

    assert.equal(result.songCount, 1);
    assert.deepEqual(JSON.parse(result.text).bookmarks.b1.songs, ["videoA::1"]);
});

test("bookmark transfer: parses and migrates import payloads", () => {
    const result = parseBookmarkImportText(JSON.stringify({
        version: 1,
        bookmarks: {
            imported: {
                name: " Imported ",
                songs: ["arch1::1", "arch1::1"],
                createdAt: 2
            }
        }
    }), {
        storageVersion: 3,
        songRows: [
            {
                songKey: "arch1::1",
                bookmarkSongKey: "videoA::1",
                legacySongKey: "arch1::1::https://youtu.be/videoA"
            }
        ],
        maxBookmarkCount: 20,
        maxSongsPerBookmark: 120
    });

    assert.equal(result.ok, true);
    assert.equal(result.bookmarkCount, 1);
    assert.equal(result.songCount, 1);
    assert.deepEqual(result.bookmarks, {
        imported: {
            name: "Imported",
            songs: ["videoA::1"],
            createdAt: 2
        }
    });
});

test("bookmark transfer: rejects invalid JSON and import files over limits", () => {
    const options = {
        storageVersion: 3,
        songRows: [
            { songKey: "s1", bookmarkSongKey: "s1" },
            { songKey: "s2", bookmarkSongKey: "s2" }
        ],
        maxBookmarkCount: 1,
        maxSongsPerBookmark: 1,
        maxBookmarkNameLength: 64
    };

    assert.deepEqual(parseBookmarkImportText("{", options), {
        ok: false,
        reason: "invalid_json"
    });
    assert.deepEqual(parseBookmarkImportText(JSON.stringify({ hello: "world" }), options), {
        ok: false,
        reason: "invalid_bookmark_file"
    });
    assert.deepEqual(parseBookmarkImportText(JSON.stringify({
        version: 2,
        bookmarks: {
            b1: { name: "A", songs: ["s1"], createdAt: 1 },
            b2: { name: "B", songs: ["s2"], createdAt: 2 }
        }
    }), options), {
        ok: false,
        reason: "max_bookmark_count",
        limit: 1
    });
    assert.deepEqual(parseBookmarkImportText(JSON.stringify({
        version: 2,
        bookmarks: {
            b1: { name: "A", songs: ["s1", "s2"], createdAt: 1 }
        }
    }), options), {
        ok: false,
        reason: "max_songs_per_bookmark",
        limit: 1,
        bookmarkName: "A"
    });
    assert.deepEqual(parseBookmarkImportText(JSON.stringify({
        version: 2,
        bookmarks: {
            b1: { name: "A".repeat(65), songs: ["s1"], createdAt: 1 }
        }
    }), options), {
        ok: false,
        reason: "max_bookmark_name_length",
        limit: 64
    });
});

test("bookmark transfer: rejects payloads from a future storage version", () => {
    const result = parseBookmarkImportText(JSON.stringify({
        version: 4,
        bookmarks: {
            future: { name: "Future", songs: ["s1"], createdAt: 1 }
        }
    }), {
        storageVersion: 3
    });

    assert.deepEqual(result, {
        ok: false,
        reason: "unsupported_version",
        version: 4
    });
});
