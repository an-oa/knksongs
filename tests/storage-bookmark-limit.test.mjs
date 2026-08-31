import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkPersistenceController } from "../_build/app/controllers/bookmark-persistence.mjs";
import { createStorageController } from "../_build/app/controllers/storage.mjs";
import { createSearchFiltersController } from "../_build/app/ui/search-filters/controller.mjs";
import { installFakeDom } from "./test-helpers.mjs";

function createFakeLocalStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
        clear() {
            store.clear();
        }
    };
}

function setupStorageController({
    bookmarks,
    activeBookmark,
    maxBookmarkCount,
    maxSongsPerBookmark,
    maxBookmarkNameLength
}) {
    let renderCount = 0;
    let scheduleCount = 0;
    const data = {
        allSongsRaw: [],
        bookmarks: JSON.parse(JSON.stringify(bookmarks || {})),
        activeBookmark: activeBookmark || null
    };
    const ui = {
        el: {},
        search: {
            selectedFormats: new Set(),
            dataReady: true
        },
        date: {
            bounds: null,
            pendingValues: null
        }
    };
    const bookmarkPersistenceController = createBookmarkPersistenceController({
        data,
        constants: {
            storageKey: "bookmarksTest",
            storageVersion: 3
        }
    });
    const controller = createStorageController({
        data,
        ui,
        searchFiltersController: createSearchFiltersController({ ui }),
        bookmarkPersistenceController,
        constants: {
            DEFAULT_FORMATS: [],
            SEARCH_STATE_KEY: "searchStateTest",
            BOOKMARK_STORAGE_KEY: "bookmarksTest",
            BOOKMARK_STORAGE_VERSION: 3,
            MAX_BOOKMARK_COUNT: maxBookmarkCount,
            MAX_SONGS_PER_BOOKMARK: maxSongsPerBookmark,
            MAX_BOOKMARK_NAME_LENGTH: maxBookmarkNameLength
        },
        callbacks: {
            getDateSelectValue: () => "",
            applyPendingDateValues: () => {},
            renderBookmarks: () => { renderCount += 1; },
            cancelScheduledSearch: () => {},
            scheduleSearch: () => { scheduleCount += 1; }
        }
    });
    return {
        controller,
        bookmarkPersistenceController,
        data,
        getRenderCount: () => renderCount,
        getScheduleCount: () => scheduleCount
    };
}

test("restorePersistedState: main branch bookmarks payload is restored from bookmarksV1", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const storedBookmarks = {
            p_1: {
                name: "main branch payload",
                songs: ["arch1::1", "arch2::2"],
                createdAt: 1710000000000
            }
        };
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify(storedBookmarks));

        controller.restorePersistedState();

        assert.deepEqual(data.bookmarks, storedBookmarks);
        assert.equal(getRenderCount(), 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("restorePersistedState: invalid bookmark payload is sanitized and deduplicated", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify({
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
                },
                invalid: null
            }
        }));

        controller.restorePersistedState();

        assert.deepEqual(data.bookmarks, {
            keep: {
                name: "Saved List",
                songs: ["song-1"],
                createdAt: 1710000000000
            }
        });
        assert.equal(getRenderCount(), 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("restorePersistedState: future bookmark payload remains untouched and unsupported", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const futurePayloadText = JSON.stringify({
            version: 4,
            futureMetadata: { mode: "v4" },
            bookmarks: {
                future: {
                    name: "Future payload",
                    songs: ["future-song"],
                    createdAt: 1710000000000,
                    futureField: true
                }
            }
        });
        const { controller, bookmarkPersistenceController, data } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", futurePayloadText);

        controller.restorePersistedState();
        bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();
        const saveResult = bookmarkPersistenceController.saveBookmarks();

        assert.deepEqual(saveResult, {
            ok: false,
            reason: "unsupported_storage_version",
            version: 4
        });
        assert.deepEqual(data.bookmarks, {});
        assert.equal(globalThis.localStorage.getItem("bookmarksTest"), futurePayloadText);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("importBookmarksFromJsonText: confirmed import replaces a future payload", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const futurePayloadText = JSON.stringify({
            version: 4,
            futureMetadata: { mode: "v4" },
            bookmarks: {
                future: {
                    name: "Future payload",
                    songs: ["future-song"],
                    createdAt: 1,
                    futureField: true
                }
            }
        });
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", futurePayloadText);
        controller.restorePersistedState();

        const result = controller.importBookmarksFromJsonText(JSON.stringify({
            version: 3,
            bookmarks: {
                imported: {
                    name: "Imported",
                    songs: ["song-1"],
                    createdAt: 2
                }
            }
        }));

        assert.equal(result.ok, true);
        assert.deepEqual(data.bookmarks, {
            imported: {
                name: "Imported",
                songs: ["song-1"],
                createdAt: 2
            }
        });
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: data.bookmarks
        });

        const createResult = controller.createBookmark("After import");

        assert.equal(createResult.ok, true);
        assert.equal(typeof createResult.id, "string");
        assert.deepEqual(data.bookmarks[createResult.id], {
            name: "After import",
            songs: [],
            createdAt: Number(createResult.id.slice(2))
        });
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: data.bookmarks
        });
        assert.equal(getRenderCount(), 3);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("createBookmark: future payload blocks creation without changing state", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const futurePayloadText = JSON.stringify({
            version: 4,
            bookmarks: {
                future: {
                    name: "Future payload",
                    songs: ["future-song"],
                    createdAt: 1,
                    futureField: true
                }
            }
        });
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", futurePayloadText);
        controller.restorePersistedState();

        const result = controller.createBookmark("Not persisted");

        assert.deepEqual(result, {
            ok: false,
            reason: "unsupported_storage_version",
            version: 4
        });
        assert.deepEqual(data.bookmarks, {});
        assert.equal(globalThis.localStorage.getItem("bookmarksTest"), futurePayloadText);
        assert.equal(getRenderCount(), 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("createBookmark: future-loaded state cannot overwrite a current payload until it is reloaded", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const futurePayloadText = JSON.stringify({
            version: 4,
            bookmarks: {
                future: {
                    name: "Future payload",
                    songs: ["future-song"],
                    createdAt: 1
                }
            }
        });
        const currentPayload = {
            version: 3,
            bookmarks: {
                external: {
                    name: "External current payload",
                    songs: ["song-1"],
                    createdAt: 2
                }
            }
        };
        const currentPayloadText = JSON.stringify(currentPayload);
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", futurePayloadText);
        controller.restorePersistedState();

        globalThis.localStorage.setItem("bookmarksTest", currentPayloadText);
        const blockedResult = controller.createBookmark("Blocked");

        assert.deepEqual(blockedResult, {
            ok: false,
            reason: "storage_reload_required"
        });
        assert.deepEqual(data.bookmarks, {});
        assert.equal(globalThis.localStorage.getItem("bookmarksTest"), currentPayloadText);
        assert.equal(getRenderCount(), 1);

        controller.restorePersistedState();
        const recoveredResult = controller.createBookmark("Recovered");

        assert.equal(recoveredResult.ok, true);
        assert.equal(typeof recoveredResult.id, "string");
        assert.deepEqual(data.bookmarks.external, currentPayload.bookmarks.external);
        assert.deepEqual(data.bookmarks[recoveredResult.id], {
            name: "Recovered",
            songs: [],
            createdAt: Number(recoveredResult.id.slice(2))
        });
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: data.bookmarks
        });
        assert.equal(getRenderCount(), 3);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("createBookmark: blocks a future payload and resumes after storage returns to the current schema", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const currentPayload = {
            version: 3,
            bookmarks: {
                current: {
                    name: "Current payload",
                    songs: ["song-1"],
                    createdAt: 1
                }
            }
        };
        const currentPayloadText = JSON.stringify(currentPayload);
        const futurePayloadText = JSON.stringify({
            version: 4,
            futureMetadata: { mode: "v4" },
            collections: {
                future: {
                    name: "Future payload",
                    songs: ["future-song"],
                    createdAt: 2,
                    futureField: true
                }
            }
        });
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", currentPayloadText);
        controller.restorePersistedState();

        globalThis.localStorage.setItem("bookmarksTest", futurePayloadText);
        const blockedResult = controller.createBookmark("Blocked");

        assert.deepEqual(blockedResult, {
            ok: false,
            reason: "unsupported_storage_version",
            version: 4
        });
        assert.deepEqual(data.bookmarks, currentPayload.bookmarks);
        assert.equal(globalThis.localStorage.getItem("bookmarksTest"), futurePayloadText);
        assert.equal(getRenderCount(), 1);

        globalThis.localStorage.setItem("bookmarksTest", currentPayloadText);
        const recoveredResult = controller.createBookmark("Recovered");

        assert.equal(recoveredResult.ok, true);
        assert.equal(typeof recoveredResult.id, "string");
        assert.deepEqual(data.bookmarks[recoveredResult.id], {
            name: "Recovered",
            songs: [],
            createdAt: Number(recoveredResult.id.slice(2))
        });
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: data.bookmarks
        });
        assert.equal(getRenderCount(), 2);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("createBookmark: current payload changed by another tab requires reload before saving", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const loadedPayload = {
            version: 3,
            bookmarks: {
                loaded: {
                    name: "Loaded payload",
                    songs: ["song-1"],
                    createdAt: 1
                }
            }
        };
        const externalPayload = {
            version: 3,
            bookmarks: {
                external: {
                    name: "External payload",
                    songs: ["song-2"],
                    createdAt: 2
                }
            }
        };
        const externalPayloadText = JSON.stringify(externalPayload);
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify(loadedPayload));
        controller.restorePersistedState();

        globalThis.localStorage.setItem("bookmarksTest", externalPayloadText);
        const blockedResult = controller.createBookmark("Blocked");

        assert.deepEqual(blockedResult, {
            ok: false,
            reason: "storage_reload_required"
        });
        assert.deepEqual(data.bookmarks, loadedPayload.bookmarks);
        assert.equal(globalThis.localStorage.getItem("bookmarksTest"), externalPayloadText);
        assert.equal(getRenderCount(), 1);

        controller.restorePersistedState();
        const recoveredResult = controller.createBookmark("Recovered");

        assert.equal(recoveredResult.ok, true);
        assert.equal(typeof recoveredResult.id, "string");
        assert.deepEqual(data.bookmarks.external, externalPayload.bookmarks.external);
        assert.deepEqual(data.bookmarks[recoveredResult.id], {
            name: "Recovered",
            songs: [],
            createdAt: Number(recoveredResult.id.slice(2))
        });
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: data.bookmarks
        });
        assert.equal(getRenderCount(), 3);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("restorePersistedState: clears loaded bookmarks after storage is removed", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify({
            version: 3,
            bookmarks: {
                loaded: {
                    name: "Loaded payload",
                    songs: ["song-1"],
                    createdAt: 1
                }
            }
        }));
        controller.restorePersistedState();

        globalThis.localStorage.removeItem("bookmarksTest");
        controller.restorePersistedState();

        assert.deepEqual(data.bookmarks, {});
        assert.equal(getRenderCount(), 2);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("migrateLegacyBookmarkSongRefs: waits for reload before upgrading an external legacy payload", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    const storage = createFakeLocalStorage();
    globalThis.localStorage = storage;
    try {
        const futurePayloadText = JSON.stringify({
            version: 4,
            collections: {
                future: {
                    name: "Future payload",
                    songs: ["future-song"],
                    createdAt: 1
                }
            }
        });
        const externalLegacyPayload = {
            version: 2,
            bookmarks: {
                victim: {
                    name: "External legacy payload",
                    songs: ["song-1"],
                    createdAt: 2
                }
            }
        };
        const externalLegacyPayloadText = JSON.stringify(externalLegacyPayload);
        storage.setItem("bookmarksTest", futurePayloadText);
        const { controller, bookmarkPersistenceController, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        controller.restorePersistedState();
        storage.setItem("bookmarksTest", externalLegacyPayloadText);

        bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();

        assert.deepEqual(data.bookmarks, {});
        assert.equal(storage.getItem("bookmarksTest"), externalLegacyPayloadText);
        assert.equal(getRenderCount(), 1);

        controller.restorePersistedState();
        bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();

        assert.deepEqual(data.bookmarks, externalLegacyPayload.bookmarks);
        assert.deepEqual(JSON.parse(storage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: externalLegacyPayload.bookmarks
        });
        assert.equal(getRenderCount(), 2);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("createBookmark: replaces the same malformed payload observed during restore", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    const previousConsoleError = console.error;
    globalThis.localStorage = createFakeLocalStorage();
    console.error = () => {};
    try {
        const malformedPayloadText = '{"version":3,"bookmarks":';
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", malformedPayloadText);

        controller.restorePersistedState();

        assert.deepEqual(data.bookmarks, {});
        assert.equal(globalThis.localStorage.getItem("bookmarksTest"), malformedPayloadText);
        assert.equal(getRenderCount(), 1);

        const result = controller.createBookmark("Recovered");

        assert.equal(result.ok, true);
        assert.equal(typeof result.id, "string");
        assert.deepEqual(data.bookmarks[result.id], {
            name: "Recovered",
            songs: [],
            createdAt: Number(result.id.slice(2))
        });
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: data.bookmarks
        });
        assert.equal(getRenderCount(), 2);
    } finally {
        console.error = previousConsoleError;
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("createBookmark: does not replace a malformed payload first observed after restore", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    const previousConsoleError = console.error;
    globalThis.localStorage = createFakeLocalStorage();
    console.error = () => {};
    try {
        const currentPayload = {
            version: 3,
            bookmarks: {
                current: {
                    name: "Current payload",
                    songs: ["song-1"],
                    createdAt: 1
                }
            }
        };
        const malformedPayloadText = '{"version":3,"bookmarks":';
        const { controller, data, getRenderCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify(currentPayload));
        controller.restorePersistedState();

        globalThis.localStorage.setItem("bookmarksTest", malformedPayloadText);
        const result = controller.createBookmark("Not persisted");

        assert.deepEqual(result, {
            ok: false,
            reason: "storage_write_failed"
        });
        assert.deepEqual(data.bookmarks, currentPayload.bookmarks);
        assert.equal(globalThis.localStorage.getItem("bookmarksTest"), malformedPayloadText);
        assert.equal(getRenderCount(), 1);
    } finally {
        console.error = previousConsoleError;
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("restorePersistedState: existing long bookmark names are preserved", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const longName = "長".repeat(65);
        const { controller, data } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120,
            maxBookmarkNameLength: 64
        });
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify({
            version: 2,
            bookmarks: {
                keep: {
                    name: longName,
                    songs: ["song-1"],
                    createdAt: 1710000000000
                }
            }
        }));

        controller.restorePersistedState();

        assert.equal(data.bookmarks.keep.name, longName);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("migrateLegacyBookmarkSongRefs: rewrites old songKey refs to bookmarkSongKey and saves versioned payload", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const storedBookmarks = {
            p_1: {
                name: "legacy payload",
                songs: ["arch1::1", "arch2::2"],
                createdAt: 1710000000000
            }
        };
        const { controller, bookmarkPersistenceController, data } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        data.allSongsRaw = [
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
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify(storedBookmarks));

        controller.restorePersistedState();
        bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();

        assert.deepEqual(data.bookmarks, {
            p_1: {
                name: "legacy payload",
                songs: ["videoA::1", "videoB::2"],
                createdAt: 1710000000000
            }
        });
        assert.deepEqual(
            JSON.parse(globalThis.localStorage.getItem("bookmarksTest")),
            {
                version: 3,
                bookmarks: data.bookmarks
            }
        );
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("migrateLegacyBookmarkSongRefs: preserves current bookmarkSongKey refs and upgrades payload version", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const storedBookmarks = {
            p_1: {
                name: "already current refs",
                songs: ["videoA::1"],
                createdAt: 1710000000000
            }
        };
        const { controller, bookmarkPersistenceController, data } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        data.allSongsRaw = [
            {
                songKey: "arch1::1",
                bookmarkSongKey: "videoA::1",
                legacySongKey: "arch1::1::https://youtu.be/videoA"
            }
        ];
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify(storedBookmarks));

        controller.restorePersistedState();
        bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();

        assert.deepEqual(
            JSON.parse(globalThis.localStorage.getItem("bookmarksTest")),
            {
                version: 3,
                bookmarks: data.bookmarks
            }
        );
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("migrateLegacyBookmarkSongRefs: retries unresolved legacy refs after songs return", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const legacySongKey = "arch1::1::https://youtu.be/videoA";
        const storedBookmarks = {
            p_1: {
                name: "temporarily unresolved ref",
                songs: [legacySongKey],
                createdAt: 1710000000000
            }
        };
        const { controller, bookmarkPersistenceController, data } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify({
            version: 2,
            bookmarks: storedBookmarks
        }));

        controller.restorePersistedState();
        bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();

        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: storedBookmarks
        });

        data.allSongsRaw = [
            {
                songKey: "arch1::1",
                bookmarkSongKey: "videoA::1",
                legacySongKey
            }
        ];
        bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();

        assert.deepEqual(data.bookmarks, {
            p_1: {
                name: "temporarily unresolved ref",
                songs: ["videoA::1"],
                createdAt: 1710000000000
            }
        });
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: data.bookmarks
        });
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("importBookmarksFromJsonText: replaces current bookmarks and clears missing active bookmark", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                old: { name: "Old", songs: ["old-song"], createdAt: 1 }
            },
            activeBookmark: "old",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        data.allSongsRaw = [
            {
                songKey: "arch1::1",
                bookmarkSongKey: "videoA::1",
                legacySongKey: "arch1::1::https://youtu.be/videoA"
            }
        ];

        const result = controller.importBookmarksFromJsonText(JSON.stringify({
            version: 1,
            bookmarks: {
                imported: {
                    name: " Imported ",
                    songs: ["arch1::1", "arch1::1"],
                    createdAt: 2
                }
            }
        }));

        assert.equal(result.ok, true);
        assert.equal(result.bookmarkCount, 1);
        assert.equal(result.songCount, 1);
        assert.deepEqual(data.bookmarks, {
            imported: {
                name: "Imported",
                songs: ["videoA::1"],
                createdAt: 2
            }
        });
        assert.equal(data.activeBookmark, null);
        assert.equal(getRenderCount(), 1);
        assert.equal(getScheduleCount(), 1);
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bookmarksTest")), {
            version: 3,
            bookmarks: data.bookmarks
        });
        assert.equal(
            JSON.parse(globalThis.localStorage.getItem("searchStateTest")).activeBookmarkId,
            null
        );
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("importBookmarksFromJsonText: rejects bookmark names over the configured limit", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                old: { name: "Old", songs: ["old-song"], createdAt: 1 }
            },
            activeBookmark: "old",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120,
            maxBookmarkNameLength: 64
        });

        const result = controller.importBookmarksFromJsonText(JSON.stringify({
            version: 2,
            bookmarks: {
                imported: {
                    name: "A".repeat(65),
                    songs: ["song-1"],
                    createdAt: 2
                }
            }
        }));

        assert.equal(result.ok, false);
        assert.equal(result.reason, "max_bookmark_name_length");
        assert.equal(result.limit, 64);
        assert.deepEqual(data.bookmarks, {
            old: { name: "Old", songs: ["old-song"], createdAt: 1 }
        });
        assert.equal(getRenderCount(), 0);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("migrateLegacyBookmarkSongRefs: emits opt-in debug logs when migration runs", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    const previousConsoleDebug = console.debug;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const debugCalls = [];
        console.debug = (...args) => {
            debugCalls.push(args);
        };
        const storedBookmarks = {
            p_1: {
                name: "legacy payload",
                songs: ["arch1::1"],
                createdAt: 1710000000000
            }
        };
        const { controller, bookmarkPersistenceController, data } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });
        data.allSongsRaw = [
            {
                songKey: "arch1::1",
                bookmarkSongKey: "videoA::1",
                legacySongKey: "arch1::1::https://youtu.be/videoA"
            }
        ];
        globalThis.localStorage.setItem("debugBookmarkMigration", "true");
        globalThis.localStorage.setItem("bookmarksTest", JSON.stringify(storedBookmarks));

        controller.restorePersistedState();
        bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();

        assert.equal(debugCalls.length >= 3, true);
        assert.deepEqual(debugCalls[0], [
            "[bookmark-migration]",
            "loaded bookmarks payload",
            {
                storedVersion: 1,
                bookmarkCount: 1
            }
        ]);
        assert.deepEqual(debugCalls[1], [
            "[bookmark-migration]",
            "start bookmark ref migration",
            {
                storedVersion: 1,
                targetVersion: 3,
                bookmarkCount: 1,
                songRowCount: 1
            }
        ]);
        assert.deepEqual(debugCalls[2], [
            "[bookmark-migration]",
            "bookmark refs migrated",
            {
                bookmarkId: "p_1",
                before: ["arch1::1"],
                after: ["videoA::1"]
            }
        ]);
        assert.deepEqual(debugCalls[3], [
            "[bookmark-migration]",
            "saved migrated bookmarks payload",
            {
                changedBookmarkIds: ["p_1"],
                upgradedVersion: 3
            }
        ]);
    } finally {
        console.debug = previousConsoleDebug;
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("createBookmarkAndAdd: rejects when bookmark count limit is reached", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 },
                b2: { name: "B", songs: ["s2"], createdAt: 2 }
            },
            maxBookmarkCount: 2,
            maxSongsPerBookmark: 50
        });

        const result = controller.createBookmarkAndAdd("C", "s3");
        assert.equal(result.ok, false);
        assert.equal(result.reason, "max_bookmark_count");
        assert.equal(result.limit, 2);
        assert.equal(Object.keys(data.bookmarks).length, 2);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("createBookmark: succeeds under limit and creates empty bookmark", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: null,
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const result = controller.createBookmark("B");
        assert.equal(result.ok, true);
        assert.equal(typeof result.id, "string");
        assert.equal(data.bookmarks[result.id].name, "B");
        assert.deepEqual(data.bookmarks[result.id].songs, []);
        assert.equal(getRenderCount(), 1);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("createBookmark: rejects names over the configured limit", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {},
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120,
            maxBookmarkNameLength: 64
        });

        const result = controller.createBookmark("A".repeat(65));

        assert.equal(result.ok, false);
        assert.equal(result.reason, "max_bookmark_name_length");
        assert.equal(result.limit, 64);
        assert.deepEqual(data.bookmarks, {});
        assert.equal(getRenderCount(), 0);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("addSongToBookmark: rejects when per-bookmark song limit is reached", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1", "s2"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 2
        });

        const result = controller.addSongToBookmark("b1", "s3");
        assert.equal(result.ok, false);
        assert.equal(result.reason, "max_songs_per_bookmark");
        assert.equal(result.limit, 2);
        assert.equal(data.bookmarks.b1.songs.length, 2);
        assert.equal(getRenderCount(), 0);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("addSongToBookmark: succeeds under limit and triggers render/search for active bookmark", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 2
        });

        const result = controller.addSongToBookmark("b1", "s2");
        assert.equal(result.ok, true);
        assert.deepEqual(data.bookmarks.b1.songs, ["s1", "s2"]);
        assert.equal(getRenderCount(), 1);
        assert.equal(getScheduleCount(), 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("removeSongFromBookmark: succeeds and returns action result", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1", "s2"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const result = controller.removeSongFromBookmark("b1", "s1");

        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        assert.deepEqual(data.bookmarks.b1.songs, ["s2"]);
        assert.equal(getRenderCount(), 1);
        assert.equal(getScheduleCount(), 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("removeSongFromBookmark: missing bookmark or song returns failure without side effects", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const missingBookmarkResult = controller.removeSongFromBookmark("missing", "s1");
        const missingSongResult = controller.removeSongFromBookmark("b1", "missing");

        assert.equal(missingBookmarkResult.ok, false);
        assert.equal(missingBookmarkResult.reason, "bookmark_not_found");
        assert.equal(missingSongResult.ok, false);
        assert.equal(missingSongResult.reason, "song_not_found");
        assert.deepEqual(data.bookmarks.b1.songs, ["s1"]);
        assert.equal(getRenderCount(), 0);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("deleteBookmark: succeeds and returns action result", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 },
                b2: { name: "B", songs: ["s2"], createdAt: 2 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const result = controller.deleteBookmark("b1");

        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        assert.equal(data.bookmarks.b1, undefined);
        assert.ok(data.bookmarks.b2);
        assert.equal(data.activeBookmark, null);
        assert.equal(getRenderCount(), 1);
        assert.equal(getScheduleCount(), 1);
        assert.equal(
            JSON.parse(globalThis.localStorage.getItem("searchStateTest")).activeBookmarkId,
            null
        );
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("deleteBookmark: missing bookmark returns failure without side effects", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const result = controller.deleteBookmark("missing");

        assert.equal(result.ok, false);
        assert.equal(result.reason, "bookmark_not_found");
        assert.ok(data.bookmarks.b1);
        assert.equal(data.activeBookmark, "b1");
        assert.equal(getRenderCount(), 0);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("renameBookmark: rejects invalid input and keeps state unchanged", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const invalidTypeResult = controller.renameBookmark("b1", null);
        assert.equal(invalidTypeResult.ok, false);
        assert.equal(invalidTypeResult.reason, "invalid_name_type");

        const emptyNameResult = controller.renameBookmark("b1", "   ");
        assert.equal(emptyNameResult.ok, false);
        assert.equal(emptyNameResult.reason, "empty_name");

        assert.equal(data.bookmarks.b1.name, "A");
        assert.equal(getRenderCount(), 0);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("renameBookmark: rejects names over the configured limit", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120,
            maxBookmarkNameLength: 64
        });

        const result = controller.renameBookmark("b1", "B".repeat(65));

        assert.equal(result.ok, false);
        assert.equal(result.reason, "max_bookmark_name_length");
        assert.equal(result.limit, 64);
        assert.equal(data.bookmarks.b1.name, "A");
        assert.equal(getRenderCount(), 0);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("renameBookmark: same name is no-op", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const result = controller.renameBookmark("b1", "A");
        assert.equal(result.ok, true);
        assert.equal(result.changed, false);
        assert.equal(data.bookmarks.b1.name, "A");
        assert.equal(getRenderCount(), 0);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("renameBookmark: active bookmark rename triggers render and search", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: "b1",
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const result = controller.renameBookmark("b1", "B");
        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        assert.equal(data.bookmarks.b1.name, "B");
        assert.equal(getRenderCount(), 1);
        assert.equal(getScheduleCount(), 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("renameBookmark: inactive bookmark rename triggers render only", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const { controller, data, getRenderCount, getScheduleCount } = setupStorageController({
            bookmarks: {
                b1: { name: "A", songs: ["s1"], createdAt: 1 }
            },
            activeBookmark: null,
            maxBookmarkCount: 20,
            maxSongsPerBookmark: 120
        });

        const result = controller.renameBookmark("b1", "B");
        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        assert.equal(data.bookmarks.b1.name, "B");
        assert.equal(getRenderCount(), 1);
        assert.equal(getScheduleCount(), 0);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});
