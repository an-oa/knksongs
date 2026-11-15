import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkPersistenceController } from "../app/controllers/bookmark-persistence.mts";
import { createStorageController } from "../app/controllers/storage.mts";
import { createSearchFiltersController } from "../app/ui/search-filters/controller.mts";
import { createFakeLocalStorage, readStoredText } from "./fixtures/local-storage.mts";
import { createInitialSearchConditions } from "../app/state.mts";
import type { BookmarkRecord } from "../app/state.types.mts";
import type { SiteLanguage } from "../app/lib/site-language.mts";
import { installFakeDom } from "./test-helpers.mts";

/**
 * storage コントローラーへ検索条件 UI controller を注入して作る。
 * テストで省略した定数と undefined を渡した定数は、保存 version 1・上限なし・形式なしとして補う。
 */
function createStorageControllerForTest(input: {
    data: Parameters<typeof createStorageController>[0]["data"];
    ui: Parameters<typeof createStorageController>[0]["ui"] & Parameters<typeof createSearchFiltersController>[0]["ui"];
    constants: Partial<Parameters<typeof createStorageController>[0]["constants"]> & {
        SEARCH_STATE_KEY: string;
        BOOKMARK_STORAGE_KEY?: string;
    };
    callbacks: Omit<Parameters<typeof createStorageController>[0]["callbacks"], "cancelScheduledSearch" | "updateDisplay"> & {
        updateDisplay?: () => void;
        cancelScheduledSearch?: () => void;
    };
}) {
    // スプレッドで補うと undefined を渡したキーが既定値を上書きするため、定数ごとに補う。
    const constants = {
        ...input.constants,
        DEFAULT_FORMATS: input.constants.DEFAULT_FORMATS ?? [],
        BOOKMARK_STORAGE_VERSION: input.constants.BOOKMARK_STORAGE_VERSION ?? 1,
        MAX_BOOKMARK_COUNT: input.constants.MAX_BOOKMARK_COUNT ?? Number.POSITIVE_INFINITY,
        MAX_SONGS_PER_BOOKMARK: input.constants.MAX_SONGS_PER_BOOKMARK ?? Number.POSITIVE_INFINITY,
        MAX_BOOKMARK_NAME_LENGTH: input.constants.MAX_BOOKMARK_NAME_LENGTH ?? Number.POSITIVE_INFINITY
    };
    const bookmarkPersistenceController = createBookmarkPersistenceController({
        data: input.data,
        constants: {
            storageKey: constants.BOOKMARK_STORAGE_KEY ?? "bookmarksTest",
            storageVersion: constants.BOOKMARK_STORAGE_VERSION
        }
    });
    return createStorageController({
        ...input,
        constants,
        bookmarkPersistenceController,
        callbacks: {
            updateDisplay: () => {},
            cancelScheduledSearch: () => {},
            ...input.callbacks
        },
        searchFiltersController: createSearchFiltersController({
            ui: input.ui,
            defaultFormats: constants.DEFAULT_FORMATS
        })
    });
}

/**
 * 選択中ブックマークの検索状態復元を検証する最小構成を作る。
 */
function createActiveBookmarkRestoreHarness(bookmarks: Record<string, BookmarkRecord>, options: {
    activeBookmark?: string | null;
    dataReady?: boolean;
    /** 検索条件の状態に持たせておく日付範囲。曲データの読み込み前は、選択欄へ映さずここにだけ持つ。 */
    dateRange?: { from: string; to: string };
    bookmarkStorageVersion?: number;
} = {}) {
    let renderCount = 0;
    let scheduleCount = 0;
    let cancelCount = 0;
    const data: Parameters<typeof createStorageController>[0]["data"] = {
        allSongsRaw: [],
        currentResults: [],
        bookmarks,
        activeBookmark: options.activeBookmark ?? null
    };
    const ui = {
        el: {},
        search: {
            conditions: {
                ...createInitialSearchConditions(),
                dateFrom: options.dateRange?.from ?? "",
                dateTo: options.dateRange?.to ?? ""
            },
            selectedFormats: new Set<string>(),
            dataReady: options.dataReady ?? true
        },
        language: { current: "ja" as SiteLanguage }
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
            renderSearchConditions: () => {},
            renderBookmarks: () => { renderCount += 1; },
            cancelScheduledSearch: () => { cancelCount += 1; },
            scheduleSearch: () => { scheduleCount += 1; }
        }
    });
    return {
        controller,
        data,
        ui,
        getRenderCount: () => renderCount,
        getScheduleCount: () => scheduleCount,
        getCancelCount: () => cancelCount
    };
}

test("restorePersistedState: a stored payload is restored into the conditions state, then shown in the inputs", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const conditionsAtRender: unknown[] = [];
        const data: Parameters<typeof createStorageController>[0]["data"] = {
            allSongsRaw: [],
            currentResults: [],
            bookmarks: {},
            activeBookmark: null
        };
        const ui = {
            el: {},
            search: {
                conditions: createInitialSearchConditions(),
                selectedFormats: new Set<string>(),
                dataReady: false
            },
            language: { current: "ja" as SiteLanguage }
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
                renderSearchConditions: () => {
                    conditionsAtRender.push(structuredClone(ui.search.conditions));
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

        const restoredConditions = {
            query: "群青",
            booleanFilters: { collabHostOnly: true, collabGuestOnly: true, relayOnly: true, harmonyOnly: false },
            dateFrom: "2024-02-10",
            dateTo: "2024-03-05"
        };
        assert.deepEqual(ui.search.conditions, restoredConditions);
        assert.deepEqual(Array.from(ui.search.selectedFormats), ["配信", "歌みた"]);
        // 入力欄へ映すのは 1 回だけで、状態を復元し終えてから行う。
        assert.deepEqual(conditionsAtRender, [restoredConditions]);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("saveSearchState: writes the conditions state with the current schema version", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const ui = {
            // 入力欄は状態と違う値にしておき、保存が状態だけを読むことを確かめる。
            el: {
                collabHostOnly: { checked: false },
                collabGuestOnly: { checked: true },
                relayOnly: { checked: false },
                harmonyOnly: { checked: true }
            },
            search: {
                conditions: {
                    query: "群青",
                    booleanFilters: { collabHostOnly: true, collabGuestOnly: false, relayOnly: true, harmonyOnly: false },
                    dateFrom: "2024",
                    dateTo: ""
                },
                selectedFormats: new Set(["配信", "収録"]),
                dataReady: false
            },
            language: { current: "ja" as SiteLanguage }
        };
        const controller = createStorageControllerForTest({
            data: {
                allSongsRaw: [],
                currentResults: [],
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
                renderSearchConditions: () => {},
                renderBookmarks: () => {},
                scheduleSearch: () => {}
            }
        });

        controller.saveSearchState();

        const parsed = JSON.parse(readStoredText(globalThis.localStorage, "searchStateTest"));
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
            JSON.parse(readStoredText(globalThis.localStorage, "searchStateTest")).activeBookmarkId,
            "bookmark-1"
        );

        const clearResult = harness.controller.clearActiveBookmark();

        assert.equal(clearResult.ok, true);
        assert.equal(harness.data.activeBookmark, null);
        assert.equal(harness.getRenderCount(), 2);
        assert.equal(harness.getScheduleCount(), 2);
        assert.equal(
            JSON.parse(readStoredText(globalThis.localStorage, "searchStateTest")).activeBookmarkId,
            null
        );
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});

test("active bookmark transitions: date conditions not yet shown in the selects survive changes before song data is ready", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const harness = createActiveBookmarkRestoreHarness({
            "bookmark-1": { name: "Favorites", songs: [], createdAt: 1 }
        }, {
            dataReady: false,
            dateRange: { from: "2024-02", to: "2024-03" }
        });

        const result = harness.controller.selectActiveBookmark("bookmark-1");

        assert.equal(result.ok, true);
        const savedSearchState = JSON.parse(readStoredText(globalThis.localStorage, "searchStateTest"));
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
            JSON.parse(readStoredText(globalThis.localStorage, "searchStateTest")).activeBookmarkId,
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
        const normalizedSearchState = JSON.parse(readStoredText(globalThis.localStorage, "searchStateTest"));
        assert.equal(normalizedSearchState.activeBookmarkId, null);
        assert.equal(normalizedSearchState.query, "群青");
        assert.equal(normalizedSearchState.dateFrom, "2024-02");
        assert.equal(normalizedSearchState.dateTo, "2024-03");
        assert.equal(harness.ui.search.conditions.query, "群青");
        assert.equal(harness.ui.search.conditions.dateFrom, "2024-02");
        assert.equal(harness.ui.search.conditions.dateTo, "2024-03");
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
            JSON.parse(readStoredText(globalThis.localStorage, "searchStateTest")).activeBookmarkId,
            "future"
        );

        const clearResult = harness.controller.clearActiveBookmark();

        assert.deepEqual(clearResult, { ok: true, changed: true });
        assert.equal(
            JSON.parse(readStoredText(globalThis.localStorage, "searchStateTest")).activeBookmarkId,
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
            querySelectorAll: (selector: string) => {
                assert.equal(selector, 'input[type="checkbox"]');
                return formatCheckboxes;
            }
        };
        const ui = {
            el: {
                formatsList
            },
            search: {
                conditions: createInitialSearchConditions(),
                selectedFormats: new Set<string>(),
                dataReady: false
            },
            language: { current: "ja" as SiteLanguage }
        };
        const controller = createStorageControllerForTest({
            data: {
                allSongsRaw: [],
                currentResults: [],
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
                renderSearchConditions: () => {},
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
            querySelectorAll: (selector: string) => {
                assert.equal(selector, 'input[type="checkbox"]');
                return formatCheckboxes;
            }
        };
        const ui = {
            el: {
                formatsList
            },
            search: {
                conditions: createInitialSearchConditions(),
                selectedFormats: new Set<string>(),
                dataReady: false
            },
            language: { current: "ja" as SiteLanguage }
        };
        const controller = createStorageControllerForTest({
            data: {
                allSongsRaw: [],
                currentResults: [],
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
                renderSearchConditions: () => {},
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
            querySelectorAll: (selector: string) => {
                assert.equal(selector, 'input[type="checkbox"]');
                return formatCheckboxes;
            }
        };
        const ui = {
            el: {
                formatsList
            },
            search: {
                conditions: createInitialSearchConditions(),
                selectedFormats: new Set(["旧値"]),
                dataReady: false
            },
            language: { current: "ja" as SiteLanguage }
        };
        const controller = createStorageControllerForTest({
            data: {
                allSongsRaw: [],
                currentResults: [],
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
                renderSearchConditions: () => {},
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
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("restorePersistedState: without a stored payload the default conditions are still shown in the inputs", () => {
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        let renderConditionsCount = 0;
        const ui = {
            el: {},
            search: {
                conditions: createInitialSearchConditions(),
                selectedFormats: new Set<string>(["配信"]),
                dataReady: false
            },
            language: { current: "ja" as SiteLanguage }
        };
        const controller = createStorageControllerForTest({
            data: { allSongsRaw: [], currentResults: [], bookmarks: {}, activeBookmark: null },
            ui,
            constants: { DEFAULT_FORMATS: ["配信"], SEARCH_STATE_KEY: "searchStateTest" },
            callbacks: {
                renderSearchConditions: () => { renderConditionsCount += 1; },
                renderBookmarks: () => {},
                scheduleSearch: () => {}
            }
        });

        controller.restorePersistedState();

        // ブラウザが入力欄へ前の値を復元していても、状態 (何も指定していない条件) の値へ揃える。
        assert.equal(renderConditionsCount, 1);
        assert.deepEqual(ui.search.conditions, createInitialSearchConditions());
        assert.equal(globalThis.localStorage.getItem("searchStateTest"), null);
    } finally {
        globalThis.localStorage = prevLocalStorage;
    }
});
