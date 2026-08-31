import test from "node:test";
import assert from "node:assert/strict";
import {
    buildStoredBookmarksPayload,
    migrateLegacyBookmarkSongRefsToCurrent,
    parseStoredBookmarksPayload,
    sanitizeBookmarks
} from "../_build/app/lib/storage/bookmark-schema.mjs";
import { normalizeLegacySongRefToCurrent } from "../_build/app/lib/song-identity.mjs";

test("bookmark storage schema: parses legacy and versioned payloads with sanitization", () => {
    assert.deepEqual(
        parseStoredBookmarksPayload({
            version: 2,
            bookmarks: {
                keep: {
                    name: "  Saved List  ",
                    songs: ["song-1", "song-1", " ", 4, 4, null],
                    createdAt: 1710000000000
                },
                emptyName: {
                    name: "   ",
                    songs: ["song-2"],
                    createdAt: 1710000000001
                }
            }
        }, 3),
        {
            supported: true,
            version: 2,
            bookmarks: {
                keep: {
                    name: "Saved List",
                    songs: ["song-1"],
                    createdAt: 1710000000000
                }
            }
        }
    );

    assert.deepEqual(
        parseStoredBookmarksPayload({
            legacy: {
                name: "Legacy",
                songs: ["arch1::1"],
                createdAt: 10
            }
        }, 3),
        {
            supported: true,
            version: 1,
            bookmarks: {
                legacy: {
                    name: "Legacy",
                    songs: ["arch1::1"],
                    createdAt: 10
                }
            }
        }
    );
});

test("bookmark storage schema: rejects future payloads without normalizing their contents", () => {
    const raw = {
        version: 4,
        futureMetadata: { mode: "v4" },
        bookmarks: {
            future: {
                name: " Future ",
                songs: ["song-1", "song-1"],
                createdAt: 1,
                futureField: true
            }
        }
    };

    assert.deepEqual(parseStoredBookmarksPayload(raw, 3), {
        supported: false,
        version: 4
    });
    assert.equal(raw.bookmarks.future.name, " Future ");
    assert.deepEqual(raw.bookmarks.future.songs, ["song-1", "song-1"]);

    assert.deepEqual(parseStoredBookmarksPayload({
        version: 4,
        collections: {
            future: { futureField: true }
        }
    }, 3), {
        supported: false,
        version: 4
    });
});

test("bookmark storage schema: builds versioned storage payload", () => {
    const bookmarks = {
        p_1: {
            name: "List",
            songs: ["videoA::1"],
            createdAt: 1
        }
    };

    assert.deepEqual(buildStoredBookmarksPayload(bookmarks, 3), {
        version: 3,
        bookmarks
    });
});

test("bookmark storage migration: rewrites legacy refs to current bookmark song keys", () => {
    const bookmarks = {
        p_1: {
            name: "Mixed refs",
            songs: [
                "arch1::01::https://youtu.be/videoA",
                "arch2::2",
                "arch2::2::https://youtu.be/videoB",
                0,
                "missing"
            ],
            createdAt: 1
        }
    };
    const songRows = [
        {
            songKey: "arch1::1",
            bookmarkSongKey: "videoA::1",
            legacySongKey: "arch1::1::https://youtu.be/videoA"
        },
        {
            songKey: "arch2::2",
            bookmarkSongKey: "videoB::2",
            legacySongKey: "arch2::2::https://youtu.be/videoB"
        }
    ];

    const result = migrateLegacyBookmarkSongRefsToCurrent({ bookmarks, songRows });

    assert.equal(result.updated, true);
    assert.deepEqual(result.changedBookmarkIds, ["p_1"]);
    assert.deepEqual(bookmarks.p_1.songs, ["videoA::1", "videoB::2", "missing"]);
    assert.deepEqual(result.changes, [
        {
            bookmarkId: "p_1",
            before: [
                "arch1::01::https://youtu.be/videoA",
                "arch2::2",
                "arch2::2::https://youtu.be/videoB",
                0,
                "missing"
            ],
            after: ["videoA::1", "videoB::2", "missing"]
        }
    ]);
});

test("bookmark storage migration: preserves unresolved string refs for temporarily missing songs", () => {
    const bookmarks = {
        p_1: {
            name: "Unavailable song",
            songs: ["removedVideo::3"],
            createdAt: 1
        }
    };

    const result = migrateLegacyBookmarkSongRefsToCurrent({ bookmarks, songRows: [] });

    assert.equal(result.updated, false);
    assert.deepEqual(bookmarks.p_1.songs, ["removedVideo::3"]);
});

test("bookmark storage migration: keeps current refs without marking changes", () => {
    const bookmarks = {
        p_1: {
            name: "Current refs",
            songs: ["videoA::1"],
            createdAt: 1
        }
    };

    const result = migrateLegacyBookmarkSongRefsToCurrent({
        bookmarks,
        songRows: [
            {
                songKey: "arch1::1",
                bookmarkSongKey: "videoA::1"
            }
        ]
    });

    assert.equal(result.updated, false);
    assert.deepEqual(result.changedBookmarkIds, []);
    assert.deepEqual(bookmarks.p_1.songs, ["videoA::1"]);
});

test("bookmark storage schema: normalizes legacy song refs by archive and order", () => {
    assert.equal(normalizeLegacySongRefToCurrent(" arch1 :: 001 :: https://youtu.be/videoA"), "arch1::1");
    assert.equal(normalizeLegacySongRefToCurrent("arch1::not-number"), null);
    assert.equal(normalizeLegacySongRefToCurrent("::1"), null);
    assert.equal(normalizeLegacySongRefToCurrent(null), null);
});

test("bookmark storage schema: sanitizes invalid bookmark maps to an empty object", () => {
    assert.deepEqual(sanitizeBookmarks(null), {});
    assert.deepEqual(sanitizeBookmarks([]), {});
});
