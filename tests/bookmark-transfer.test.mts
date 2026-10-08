import test from "node:test";
import assert from "node:assert/strict";
import {
    exportBookmarksAsJsonText,
    MAX_BOOKMARK_IMPORT_BYTES,
    parseBookmarkImportText
} from "../app/lib/storage/bookmark-transfer.mts";

test("bookmark transfer: exports a versioned bookmark JSON payload", () => {
    const result = exportBookmarksAsJsonText({
        b1: { name: "A", songs: ["videoA::1"], createdAt: 1 }
    }, 3);

    assert.equal(result.ok, true);
    assert.equal(result.bookmarkCount, 1);
    assert.equal(result.songCount, 1);
    assert.match(result.text, /\n {2}"version": 3,/);
    assert.ok(result.text.endsWith("\n"));
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
    const songLimitResult = parseBookmarkImportText(JSON.stringify({
        version: 2,
        bookmarks: {
            b1: { name: "A", songs: ["s1", "s2"], createdAt: 1 }
        }
    }), options);
    assert.equal(songLimitResult.ok, false);
    assert.equal(songLimitResult.reason, "max_songs_per_bookmark");
    assert.equal(songLimitResult.limit satisfies number, 1);
    assert.equal(songLimitResult.bookmarkName satisfies string, "A");
    assert.deepEqual(songLimitResult, {
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

    assert.equal(result.ok, false);
    assert.equal(result.reason, "unsupported_version");
    assert.equal(result.version satisfies number, 4);
    assert.deepEqual(result, {
        ok: false,
        reason: "unsupported_version",
        version: 4
    });
});

test("bookmark transfer: imports and exports __proto__ IDs as ordinary bookmark data", () => {
    const result = parseBookmarkImportText(`{
        "version": 3,
        "bookmarks": {
            "__proto__": { "name": "Imported", "createdAt": 1, "songs": ["s1"] }
        }
    }`, { storageVersion: 3 });

    assert.equal(result.ok, true);
    assert.equal(result.bookmarkCount, 1);
    assert.equal(result.songCount, 1);
    assert.equal(Object.getPrototypeOf(result.bookmarks), Object.prototype);
    const exported = exportBookmarksAsJsonText(result.bookmarks, 3);
    assert.equal(exported.bookmarkCount, 1);
    assert.equal(Object.hasOwn(JSON.parse(exported.text).bookmarks, "__proto__"), true);
});

test("bookmark transfer: applies the UTF-8 byte limit before JSON parsing", () => {
    const options = { storageVersion: 3 };
    const text = JSON.stringify({ version: 3, bookmarks: {} });
    const atLimit = text.padEnd(MAX_BOOKMARK_IMPORT_BYTES, " ");

    assert.equal(parseBookmarkImportText(atLimit, options).ok, true);
    assert.deepEqual(parseBookmarkImportText(`${atLimit} `, options), {
        ok: false,
        reason: "max_import_file_size",
        limit: MAX_BOOKMARK_IMPORT_BYTES
    });
    assert.deepEqual(parseBookmarkImportText("{".repeat(MAX_BOOKMARK_IMPORT_BYTES + 1), options), {
        ok: false,
        reason: "max_import_file_size",
        limit: MAX_BOOKMARK_IMPORT_BYTES
    });

    const multibyteText = JSON.stringify({ version: 3, bookmarks: {}, padding: "あ".repeat(MAX_BOOKMARK_IMPORT_BYTES / 2) });
    assert.ok(multibyteText.length < MAX_BOOKMARK_IMPORT_BYTES);
    assert.deepEqual(parseBookmarkImportText(multibyteText, options), {
        ok: false,
        reason: "max_import_file_size",
        limit: MAX_BOOKMARK_IMPORT_BYTES
    });
});

for (const character of ["x", "あ"]) {
    test(`bookmark transfer: exported ${character} references at the byte limit can be imported again`, () => {
        const options = { storageVersion: 3, maxBookmarkCount: 20, maxSongsPerBookmark: 120, maxBookmarkNameLength: 64 };
        const payload = { version: 3, bookmarks: { b1: { name: "A", songs: [""], createdAt: 1 } } };
        const availableBytes = MAX_BOOKMARK_IMPORT_BYTES - Buffer.byteLength(JSON.stringify(payload));
        const characterBytes = Buffer.byteLength(character);
        payload.bookmarks.b1.songs = [character.repeat(Math.floor(availableBytes / characterBytes)) + "x".repeat(availableBytes % characterBytes)];
        const text = JSON.stringify(payload);
        assert.equal(Buffer.byteLength(text), MAX_BOOKMARK_IMPORT_BYTES);
        assert.ok(Buffer.byteLength(JSON.stringify(payload, null, 2)) > MAX_BOOKMARK_IMPORT_BYTES);

        const imported = parseBookmarkImportText(text, options);
        assert.equal(imported.ok, true);
        const exported = exportBookmarksAsJsonText(imported.bookmarks, 3);
        assert.equal(Buffer.byteLength(exported.text), MAX_BOOKMARK_IMPORT_BYTES);
        assert.deepEqual(JSON.parse(exported.text), payload);
        assert.deepEqual(parseBookmarkImportText(exported.text, options), imported);
    });
}

test("bookmark transfer: rejects legacy data that grows beyond the byte limit when normalized", () => {
    const payload = { b1: { name: "A", songs: [""] } };
    payload.b1.songs = ["x".repeat(MAX_BOOKMARK_IMPORT_BYTES - Buffer.byteLength(JSON.stringify(payload)))];
    const text = JSON.stringify(payload);
    assert.equal(Buffer.byteLength(text), MAX_BOOKMARK_IMPORT_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify({
        version: 3,
        bookmarks: { b1: { ...payload.b1, createdAt: 0 } }
    })) > MAX_BOOKMARK_IMPORT_BYTES);

    assert.deepEqual(parseBookmarkImportText(text, { storageVersion: 3 }), {
        ok: false,
        reason: "max_import_file_size",
        limit: MAX_BOOKMARK_IMPORT_BYTES
    });
});
