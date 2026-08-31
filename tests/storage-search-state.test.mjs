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

/**
 * storage コントローラーへ検索条件 UI controller を注入して作る。
 * @param {{ data: object, ui: object, constants: object, callbacks: object }} input
 * @returns {object}
 */
function createStorageControllerForTest(input) {
    const bookmarkPersistenceController = createBookmarkPersistenceController({
        data: input.data,
        constants: {
            storageKey: input.constants.BOOKMARK_STORAGE_KEY ?? "bookmarksTest",
            storageVersion: input.constants.BOOKMARK_STORAGE_VERSION ?? 1
        }
    });
    return createStorageController({
        ...input,
        bookmarkPersistenceController,
        callbacks: {
            cancelScheduledSearch: () => {},
            ...input.callbacks
        },
        searchFiltersController: createSearchFiltersController({
            ui: input.ui,
            defaultFormats: input.constants.DEFAULT_FORMATS
        })
    });
}

/**
 * 選択中ブックマークの検索状態復元を検証する最小構成を作る。
 * @param {Record<string, object>} bookmarks
 * @param {{ activeBookmark?: string | null, dataReady?: boolean, pendingValues?: object | null, bookmarkStorageVersion?: number }} [options]
 * @returns {{ controller: object, data: object, getRenderCount: () => number, getScheduleCount: () => number, getCancelCount: () => number }}
 */
function createActiveBookmarkRestoreHarness(bookmarks, options = {}) {
    let renderCount = 0;
    let scheduleCount = 0;
    let cancelCount = 0;
    const data = {
        allSongsRaw: [],
        bookmarks,
        activeBookmark: options.activeBookmark ?? null
    };
    const ui = {
        el: {
            searchBox: { value: "" }
        },
        search: {
            selectedFormats: new Set(),
            dataReady: options.dataReady ?? true,
            userTouchedQuery: false,
            userTouchedFilters: false,
            hasRestoredSearchState: false
        },
        date: {
            bounds: null,
            pendingValues: options.pendingValues ?? null
        }
    };
    const controller = createStorageControllerForTest({
        data,
        ui,
        constants: {
            DEFAULT_FORMATS: ["配信"],
            SEARCH_STATE_KEY: "searchStateTest",
            BOOKMARK_STORAGE_KEY: "bookmarksTest",
            BOOKMARK_STORAGE_VERSION: options.bookmarkStorageVersion
        },
        callbacks: {
            getDateSelectValue: () => "",
            applyPendingDateValues: () => {},
            renderBookmarks: () => { renderCount += 1; },
            cancelScheduledSearch: () => { cancelCount += 1; },
            scheduleSearch: () => { scheduleCount += 1; }
        }
    });
    return {
        controller,
        data,
        getRenderCount: () => renderCount,
        getScheduleCount: () => scheduleCount,
        getCancelCount: () => cancelCount
    };
}

test("restorePersistedState: main branch payload restores into sliced ui state", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        let applyPendingCallCount = 0;
        const data = {
            allSongsRaw: [],
            bookmarks: {},
            activeBookmark: null
        };
        const ui = {
            el: {
                searchBox: { value: "" },
                collabHostOnly: { checked: false },
                collabGuestOnly: { checked: false },
                relayOnly: { checked: false },
                harmonyOnly: { checked: false }
            },
            search: {
                selectedFormats: new Set(),
                userTouchedQuery: false,
                userTouchedFilters: false,
                hasRestoredSearchState: false
            },
            date: {
                bounds: { minKey: 20240210, maxKey: 20240305 },
                pendingValues: null
            }
        };
        const controller = createStorageControllerForTest({
            data,
            ui,
            constants: {
                DEFAULT_FORMATS: ["配信", "歌みた", "ショート", "切り抜き"],
                SEARCH_STATE_KEY: "searchStateTest",
                BOOKMARK_STORAGE_KEY: "bookmarksTest",
                MAX_BOOKMARK_COUNT: 20,
                MAX_SONGS_PER_BOOKMARK: 120
            },
            callbacks: {
                getDateSelectValue: () => "",
                applyPendingDateValues: () => {
                    applyPendingCallCount += 1;
                    ui.date.pendingValues = null;
                },
                renderBookmarks: () => {},
                scheduleSearch: () => {}
            }
        });
        globalThis.localStorage.setItem("searchStateTest", JSON.stringify({
            query: "群青",
            collabOnly: true,
            relayOnly: true,
            harmonyOnly: false,
            frameScope: "guest",
            dateFrom: "2024-02-10",
            dateTo: "2024-03-05",
            formats: ["配信", "歌みた"]
        }));

        controller.restorePersistedState();

        assert.equal(ui.el.searchBox.value, "群青");
        assert.equal(ui.el.collabHostOnly.checked, true);
        assert.equal(ui.el.collabGuestOnly.checked, true);
        assert.equal(ui.el.relayOnly.checked, true);
        assert.equal(ui.el.harmonyOnly.checked, false);
        assert.deepEqual(Array.from(ui.search.selectedFormats), ["配信", "歌みた"]);
        assert.equal(ui.search.userTouchedQuery, true);
        assert.equal(ui.search.userTouchedFilters, true);
        assert.equal(ui.search.hasRestoredSearchState, true);
        assert.equal(ui.date.pendingValues, null);
        assert.equal(applyPendingCallCount, 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("saveSearchState: writes current schema version", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const ui = {
            el: {
                searchBox: { value: "群青" },
                collabHostOnly: { checked: true },
                collabGuestOnly: { checked: false },
                relayOnly: { checked: true },
                harmonyOnly: { checked: false }
            },
            search: {
                selectedFormats: new Set(["配信", "収録"])
            },
            date: {
                bounds: null,
                pendingValues: null
            }
        };
        const controller = createStorageControllerForTest({
            data: {
                allSongsRaw: [],
                bookmarks: {
                    "bookmark-1": { name: "Favorites", songs: [], createdAt: 1 }
                },
                activeBookmark: "bookmark-1"
            },
            ui,
            constants: {
                DEFAULT_FORMATS: ["配信", "歌みた", "ショート", "切り抜き", "収録"],
                SEARCH_STATE_KEY: "searchStateTest",
                BOOKMARK_STORAGE_KEY: "bookmarksTest",
                MAX_BOOKMARK_COUNT: 20,
                MAX_SONGS_PER_BOOKMARK: 120
            },
            callbacks: {
                getDateSelectValue: (kind) => kind === "from" ? "2024" : "",
                applyPendingDateValues: () => {},
                renderBookmarks: () => {},
                scheduleSearch: () => {}
            }
        });

        controller.saveSearchState();

        const parsed = JSON.parse(globalThis.localStorage.getItem("searchStateTest"));
        assert.equal(parsed.version, 6);
        assert.equal(parsed.query, "群青");
        assert.equal(parsed.collabHostOnly, true);
        assert.equal(parsed.collabGuestOnly, false);
        assert.equal(parsed.relayOnly, true);
        assert.equal(parsed.harmonyOnly, false);
        assert.equal(parsed.dateFrom, "2024");
        assert.equal(parsed.dateTo, "");
        assert.deepEqual(parsed.formats, ["配信", "収録"]);
        assert.equal(parsed.activeBookmarkId, "bookmark-1");
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("active bookmark transitions: state, persistence, rendering, and search stay synchronized", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const harness = createActiveBookmarkRestoreHarness({
            "bookmark-1": { name: "Favorites", songs: [], createdAt: 1 }
        });

        const selectResult = harness.controller.selectActiveBookmark("bookmark-1");

        assert.equal(selectResult.ok, true);
        assert.equal(harness.data.activeBookmark, "bookmark-1");
        assert.equal(harness.getRenderCount(), 1);
        assert.equal(harness.getScheduleCount(), 1);
        assert.equal(
            JSON.parse(globalThis.localStorage.getItem("searchStateTest")).activeBookmarkId,
            "bookmark-1"
        );

        const clearResult = harness.controller.clearActiveBookmark();

        assert.equal(clearResult.ok, true);
        assert.equal(harness.data.activeBookmark, null);
        assert.equal(harness.getRenderCount(), 2);
        assert.equal(harness.getScheduleCount(), 2);
        assert.equal(
            JSON.parse(globalThis.localStorage.getItem("searchStateTest")).activeBookmarkId,
            null
        );
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("active bookmark transitions: pending date conditions survive changes before song data is ready", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const harness = createActiveBookmarkRestoreHarness({
            "bookmark-1": { name: "Favorites", songs: [], createdAt: 1 }
        }, {
            dataReady: false,
            pendingValues: {
                from: "2024-02",
                to: "2024-03"
            }
        });

        const result = harness.controller.selectActiveBookmark("bookmark-1");

        assert.equal(result.ok, true);
        const savedSearchState = JSON.parse(globalThis.localStorage.getItem("searchStateTest"));
        assert.equal(savedSearchState.dateFrom, "2024-02");
        assert.equal(savedSearchState.dateTo, "2024-03");
        assert.equal(savedSearchState.activeBookmarkId, "bookmark-1");
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("active bookmark transitions: search waits until song data is ready", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const harness = createActiveBookmarkRestoreHarness({
            "bookmark-1": { name: "Favorites", songs: [], createdAt: 1 }
        }, {
            activeBookmark: "bookmark-1",
            dataReady: false
        });

        const result = harness.controller.clearActiveBookmark();

        assert.equal(result.ok, true);
        assert.equal(harness.data.activeBookmark, null);
        assert.equal(harness.getRenderCount(), 1);
        assert.equal(harness.getScheduleCount(), 0);
        assert.equal(harness.getCancelCount(), 1);
        assert.equal(
            JSON.parse(globalThis.localStorage.getItem("searchStateTest")).activeBookmarkId,
            null
        );
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("restorePersistedState: restores an existing active bookmark and draws once", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const harness = createActiveBookmarkRestoreHarness({
            "bookmark-1": { name: "Favorites", songs: [], createdAt: 1 }
        });
        globalThis.localStorage.setItem(
            "bookmarksTest",
            JSON.stringify(harness.data.bookmarks)
        );
        globalThis.localStorage.setItem("searchStateTest", JSON.stringify({
            version: 6,
            formats: ["配信"],
            activeBookmarkId: "bookmark-1"
        }));

        harness.controller.restorePersistedState();

        assert.equal(harness.data.activeBookmark, "bookmark-1");
        assert.equal(harness.getRenderCount(), 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("restorePersistedState: clears and normalizes an active bookmark id that is no longer present", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const harness = createActiveBookmarkRestoreHarness({});
        globalThis.localStorage.setItem("searchStateTest", JSON.stringify({
            version: 6,
            query: "群青",
            dateFrom: "2024-02",
            dateTo: "2024-03",
            formats: ["配信"],
            activeBookmarkId: "missing-bookmark"
        }));

        harness.controller.restorePersistedState();

        assert.equal(harness.data.activeBookmark, null);
        assert.equal(harness.getRenderCount(), 1);
        const normalizedSearchState = JSON.parse(globalThis.localStorage.getItem("searchStateTest"));
        assert.equal(normalizedSearchState.activeBookmarkId, null);
        assert.equal(normalizedSearchState.query, "群青");
        assert.equal(normalizedSearchState.dateFrom, "2024-02");
        assert.equal(normalizedSearchState.dateTo, "2024-03");
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("restorePersistedState: preserves an active bookmark id from an unsupported future payload", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const harness = createActiveBookmarkRestoreHarness({}, {
            bookmarkStorageVersion: 3
        });
        const futureBookmarksText = JSON.stringify({
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
        const searchStateText = JSON.stringify({
            version: 6,
            query: "群青",
            formats: ["配信"],
            activeBookmarkId: "future"
        });
        globalThis.localStorage.setItem("bookmarksTest", futureBookmarksText);
        globalThis.localStorage.setItem("searchStateTest", searchStateText);

        harness.controller.restorePersistedState();

        assert.deepEqual(harness.data.bookmarks, {});
        assert.equal(harness.data.activeBookmark, null);
        assert.equal(globalThis.localStorage.getItem("bookmarksTest"), futureBookmarksText);
        assert.equal(globalThis.localStorage.getItem("searchStateTest"), searchStateText);

        harness.controller.saveSearchState();

        assert.equal(
            JSON.parse(globalThis.localStorage.getItem("searchStateTest")).activeBookmarkId,
            "future"
        );

        const clearResult = harness.controller.clearActiveBookmark();

        assert.deepEqual(clearResult, { ok: true, changed: true });
        assert.equal(
            JSON.parse(globalThis.localStorage.getItem("searchStateTest")).activeBookmarkId,
            null
        );
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("restorePersistedState: legacy all-format state includes recording in new defaults", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const defaultFormats = ["配信", "歌みた", "ショート", "切り抜き", "収録"];
        const formatCheckboxes = defaultFormats.map((value) => ({ value, checked: false }));
        const formatsList = {
            querySelectorAll: (selector) => {
                assert.equal(selector, 'input[type="checkbox"]');
                return formatCheckboxes;
            }
        };
        const ui = {
            el: {
                searchBox: { value: "" },
                relayOnly: { checked: false },
                harmonyOnly: { checked: false },
                formatsList
            },
            search: {
                selectedFormats: new Set(),
                userTouchedQuery: false,
                userTouchedFilters: false,
                hasRestoredSearchState: false
            },
            date: {
                bounds: null,
                pendingValues: null
            }
        };
        const controller = createStorageControllerForTest({
            data: {
                allSongsRaw: [],
                bookmarks: {},
                activeBookmark: null
            },
            ui,
            constants: {
                DEFAULT_FORMATS: defaultFormats,
                SEARCH_STATE_KEY: "searchStateTest",
                BOOKMARK_STORAGE_KEY: "bookmarksTest",
                MAX_BOOKMARK_COUNT: 20,
                MAX_SONGS_PER_BOOKMARK: 120
            },
            callbacks: {
                getDateSelectValue: () => "",
                applyPendingDateValues: () => {},
                renderBookmarks: () => {},
                scheduleSearch: () => {}
            }
        });
        globalThis.localStorage.setItem("searchStateTest", JSON.stringify({
            query: "",
            collabOnly: true,
            relayOnly: false,
            harmonyOnly: false,
            dateFrom: "",
            dateTo: "",
            formats: ["配信", "歌みた", "ショート", "切り抜き"]
        }));

        controller.restorePersistedState();

        assert.deepEqual(Array.from(ui.search.selectedFormats), defaultFormats);
        assert.deepEqual(formatCheckboxes.map((checkbox) => checkbox.checked), [true, true, true, true, true]);
        assert.equal(ui.search.hasRestoredSearchState, true);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("restorePersistedState: current payload keeps recording unchecked when user saved it off", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const defaultFormats = ["配信", "歌みた", "ショート", "切り抜き", "収録"];
        const formatCheckboxes = defaultFormats.map((value) => ({ value, checked: false }));
        const formatsList = {
            querySelectorAll: (selector) => {
                assert.equal(selector, 'input[type="checkbox"]');
                return formatCheckboxes;
            }
        };
        const ui = {
            el: {
                searchBox: { value: "" },
                relayOnly: { checked: false },
                harmonyOnly: { checked: false },
                formatsList
            },
            search: {
                selectedFormats: new Set(),
                userTouchedQuery: false,
                userTouchedFilters: false,
                hasRestoredSearchState: false
            },
            date: {
                bounds: null,
                pendingValues: null
            }
        };
        const controller = createStorageControllerForTest({
            data: {
                allSongsRaw: [],
                bookmarks: {},
                activeBookmark: null
            },
            ui,
            constants: {
                DEFAULT_FORMATS: defaultFormats,
                SEARCH_STATE_KEY: "searchStateTest",
                BOOKMARK_STORAGE_KEY: "bookmarksTest",
                MAX_BOOKMARK_COUNT: 20,
                MAX_SONGS_PER_BOOKMARK: 120
            },
            callbacks: {
                getDateSelectValue: () => "",
                applyPendingDateValues: () => {},
                renderBookmarks: () => {},
                scheduleSearch: () => {}
            }
        });
        globalThis.localStorage.setItem("searchStateTest", JSON.stringify({
            version: 2,
            query: "",
            relayOnly: false,
            harmonyOnly: false,
            frameScope: "all",
            dateFrom: "",
            dateTo: "",
            formats: ["配信", "歌みた", "ショート", "切り抜き"]
        }));

        controller.restorePersistedState();

        assert.deepEqual(Array.from(ui.search.selectedFormats), ["配信", "歌みた", "ショート", "切り抜き"]);
        assert.deepEqual(formatCheckboxes.map((checkbox) => checkbox.checked), [true, true, true, true, false]);
        assert.equal(ui.search.hasRestoredSearchState, true);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("restorePersistedState: invalid saved formats fall back to defaults and sync checkboxes", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const formatCheckboxes = [
            { value: "配信", checked: false },
            { value: "歌みた", checked: false }
        ];
        const formatsList = {
            querySelectorAll: (selector) => {
                assert.equal(selector, 'input[type="checkbox"]');
                return formatCheckboxes;
            }
        };
        const ui = {
            el: {
                searchBox: { value: "" },
                relayOnly: { checked: false },
                harmonyOnly: { checked: false },
                formatsList
            },
            search: {
                selectedFormats: new Set(["旧値"]),
                userTouchedQuery: false,
                userTouchedFilters: false,
                hasRestoredSearchState: false
            },
            date: {
                bounds: null,
                pendingValues: null
            }
        };
        const controller = createStorageControllerForTest({
            data: {
                allSongsRaw: [],
                bookmarks: {},
                activeBookmark: null
            },
            ui,
            constants: {
                DEFAULT_FORMATS: ["配信", "歌みた"],
                SEARCH_STATE_KEY: "searchStateTest",
                BOOKMARK_STORAGE_KEY: "bookmarksTest",
                MAX_BOOKMARK_COUNT: 20,
                MAX_SONGS_PER_BOOKMARK: 120
            },
            callbacks: {
                getDateSelectValue: () => "",
                applyPendingDateValues: () => {},
                renderBookmarks: () => {},
                scheduleSearch: () => {}
            }
        });
        globalThis.localStorage.setItem("searchStateTest", JSON.stringify({
            query: "",
            relayOnly: false,
            harmonyOnly: false,
            dateFrom: "",
            dateTo: "",
            formats: ["存在しない形式"]
        }));

        controller.restorePersistedState();

        assert.deepEqual(Array.from(ui.search.selectedFormats), ["配信", "歌みた"]);
        assert.equal(formatCheckboxes[0].checked, true);
        assert.equal(formatCheckboxes[1].checked, true);
        assert.equal(ui.search.hasRestoredSearchState, true);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});
