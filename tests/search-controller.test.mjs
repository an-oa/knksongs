import test from "node:test";
import assert from "node:assert/strict";
import { createSearchFiltersController } from "../_build/app/ui/search-filters/controller.mjs";
import { normalizeForSearch } from "../_build/app/lib/search-normalization.mjs";
import { createSearchController } from "../_build/app/controllers/search.mjs";
import { createSearchCoordinator } from "../_build/app/controllers/search-coordinator.mjs";
import { createDateFilterController } from "../_build/app/ui/date/filter.mjs";

let autoSongId = 0;

for (const mode of ["search", "bookmark"]) {
    test(`createSearchController: resize does not inherit ${mode} results before recommendation search commits`, (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const rows = Array.from({ length: 160 }, (_, index) => makeRow({
            archiveId: `pending-${index}`,
            title: `Candidate ${index}`,
            format: "オリ曲"
        }));
        const data = {
            allSongsRaw: rows,
            bookmarks: { saved: { name: "Saved", songs: rows.map((row) => row.songKey) } },
            activeBookmark: null,
            currentResults: [],
            displayLimit: 0
        };
        const ui = createSearchUiState({
            el: { searchBox: { value: "" }, resultCount: { innerText: "" } },
            selectedFormats: new Set(["配信", "歌みた"])
        });
        const renders = [];
        let recommendedCount = 48;
        let initialCount = 12;
        const controller = createSearchControllerForTest({
            data,
            ui,
            constants: {
                RANDOM_DISPLAY_COUNT: 48,
                RESULT_DISPLAY_BATCH_SIZE: 48,
                MIN_PERFORMANCE_FOR_RANDOM: 1,
                DEFAULT_FORMATS: ["配信", "歌みた"]
            },
            callbacks: createSearchCallbacks({
                getRecommendedDisplayCount: () => recommendedCount,
                getInitialDisplayCount: () => initialCount,
                updateDisplay: () => renders.push([data.currentResults.length, data.displayLimit])
            })
        });
        const coordinator = createSearchCoordinator({ search: ui.search, debounceMs: 200, searchController: controller });
        coordinator.search();
        // 一度おすすめを表示してから通常検索へ移り、確定済みモードが更新されることも確認する。
        ui.el.searchBox.value = mode === "search" ? "Candidate" : "";
        data.activeBookmark = mode === "bookmark" ? "saved" : null;
        coordinator.search();
        data.displayLimit = 108;
        const previousResults = data.currentResults;
        const previousLabel = ui.el.resultCount.innerText;
        const previousCache = ui.search.recommendedCache;
        assert.equal(previousResults.length, 160);

        ui.el.searchBox.value = "";
        data.activeBookmark = null;
        assert.equal(coordinator.refreshRecommendedDisplay(), false, "uncommitted inputs cannot change the result mode");
        coordinator.scheduleSearch();
        t.mock.timers.tick(199);
        assert.equal(coordinator.refreshRecommendedDisplay(), false);
        assert.equal(data.currentResults, previousResults);
        assert.equal(data.displayLimit, 108);
        assert.equal(ui.el.resultCount.innerText, previousLabel);
        assert.equal(ui.search.recommendedCache, previousCache);
        assert.equal(renders.length, 2, "resize does not render interim recommendations");

        t.mock.timers.tick(1);
        assert.deepEqual(renders, [[48, 12], [160, 12], [48, 12]]);
        assert.equal(ui.el.resultCount.innerText, "おすすめを表示中");

        // 確定済みのおすすめがあっても、次の検索待機中は再選曲・再描画しない。
        coordinator.scheduleSearch();
        recommendedCount = 108;
        initialCount = 108;
        assert.equal(coordinator.refreshRecommendedDisplay(), false);
        assert.equal(renders.length, 3);
        t.mock.timers.tick(200);
        assert.deepEqual(renders[3], [108, 108]);
        const expandedResults = data.currentResults.slice();
        recommendedCount = 48;
        initialCount = 12;
        assert.equal(coordinator.refreshRecommendedDisplay(), false);
        assert.deepEqual(data.currentResults, expandedResults);
        assert.equal(data.displayLimit, 108);
    });
}

test("createSearchController: limits initial DOM work without reducing recommendation or search results", () => {
    const rows = Array.from({ length: 60 }, (_, index) => makeRow({
        archiveId: `initial-${index}`,
        title: `Candidate ${index}`,
        artist: "A",
        format: "オリ曲"
    }));
    const data = { allSongsRaw: rows, bookmarks: {}, activeBookmark: null, currentResults: [], displayLimit: 0 };
    const ui = createSearchUiState({
        el: { searchBox: { value: "" }, resultCount: { innerText: "" } },
        selectedFormats: new Set(["配信", "歌みた"])
    });
    let initialCount = 12;
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants: {
            RANDOM_DISPLAY_COUNT: 48,
            RESULT_DISPLAY_BATCH_SIZE: 48,
            MIN_PERFORMANCE_FOR_RANDOM: 1,
            DEFAULT_FORMATS: ["配信", "歌みた"]
        },
        callbacks: createSearchCallbacks({ getInitialDisplayCount: () => initialCount })
    });
    controller.search();
    const recommendations = data.currentResults.slice();
    assert.equal(recommendations.length, 48);
    assert.equal(data.displayLimit, 12);

    data.displayLimit = 48;
    controller.refreshRecommendedDisplay();
    assert.deepEqual(data.currentResults, recommendations);
    assert.equal(data.displayLimit, 48, "resize keeps already appended cards");

    ui.el.searchBox.value = "Candidate";
    controller.search();
    assert.equal(data.currentResults.length, 60);
    assert.equal(data.displayLimit, 12);
    data.bookmarks = { saved: { name: "Saved", songs: rows.map((row) => row.songKey) } };
    data.activeBookmark = "saved";
    controller.search();
    assert.equal(data.currentResults.length, 60);
    assert.equal(data.displayLimit, 12);
    for (const invalid of [NaN, Infinity, 0, -1]) {
        initialCount = invalid;
        controller.search();
        assert.equal(data.displayLimit, 48);
    }
});

/**
 * 検索コントローラー検証用の UI 状態を作る。
 * @param {*} input
 * @returns {*}
 */
function createSearchUiState(input) {
    return {
        el: input.el,
        search: {
            selectedFormats: input.selectedFormats,
            debounceId: input.debounceId ?? 0,
            recommendedCache: input.recommendedCache ?? null
        },
        date: {
            bounds: null,
            index: null,
            pendingValues: null
        },
        lookup: {
            songMapByBookmarkKey: new Map(),
            songMapByKey: new Map(),
            songLookupSourceRef: null
        }
    };
}

/**
 * 検索コントローラーへ検索条件 UI controller を注入して作る。
 * @param {{ data: object, ui: object, constants: object, callbacks: object }} input
 * @returns {object}
 */
function createSearchControllerForTest(input) {
    return createSearchController({
        ...input,
        searchFiltersController: createSearchFiltersController({
            ui: input.ui,
            defaultFormats: input.constants.DEFAULT_FORMATS
        }),
        dateFilterController: createDateFilterController({ ui: input.ui })
    });
}

function makeRow(input) {
    const title = input.title ?? "";
    const artist = input.artist ?? "";
    const titleYomi = input.titleYomi ?? "";
    const artistYomi = input.artistYomi ?? "";
    const songKey = input.songKey ?? `song-${++autoSongId}`;
    return {
        archiveId: input.archiveId ?? "",
        archiveOrder: input.archiveOrder ?? 1,
        songKey,
        bookmarkSongKey: input.bookmarkSongKey ?? songKey,
        dateKey: input.dateKey ?? null,
        format: input.format ?? "配信",
        streamRole: input.streamRole ?? "",
        isRelay: !!input.isRelay,
        isHarmony: !!input.isHarmony,
        titleNorm: normalizeForSearch(title),
        artistNorm: normalizeForSearch(artist),
        titleYomiNorm: normalizeForSearch(titleYomi),
        artistYomiNorm: normalizeForSearch(artistYomi)
    };
}

/**
 * 検索コントローラー用の描画コールバックを作る。
 * @param {*} input
 * @returns {*}
 */
function createSearchCallbacks(input) {
    const callbacks = input || {};
    return {
        updateDisplay: callbacks.updateDisplay || (() => {}),
        scrollResultsPaneToTop: callbacks.scrollResultsPaneToTop || (() => {}),
        getRecommendedDisplayCount: callbacks.getRecommendedDisplayCount,
        getInitialDisplayCount: callbacks.getInitialDisplayCount
    };
}

test("createSearchController: active bookmark also applies search criteria", () => {
    const rows = [
        makeRow({ songKey: "s1", title: "青い月", artist: "A", format: "配信" }),
        makeRow({ songKey: "s2", title: "赤い星", artist: "B", format: "歌みた" }),
        makeRow({ songKey: "s3", title: "赤い空", artist: "C", format: "配信" })
    ];
    const data = {
        allSongsRaw: rows,
        bookmarks: {
            bm1: {
                name: "検証",
                songs: ["s1", "s2"]
            }
        },
        activeBookmark: "bm1",
        currentResults: [],
        displayLimit: 0
    };
    const ui = createSearchUiState({
        el: {
            searchBox: { value: "赤い" },
            relayOnly: { checked: false },
            harmonyOnly: { checked: false },
            dateFromYear: null,
            dateFromMonth: null,
            dateFromDay: null,
            dateToYear: null,
            dateToMonth: null,
            dateToDay: null,
            resultCount: { innerText: "" }
        },
        selectedFormats: new Set(["配信"])
    });
    const constants = {
        RANDOM_DISPLAY_COUNT: 10,
        MIN_PERFORMANCE_FOR_RANDOM: 1,
        RESULT_DISPLAY_BATCH_SIZE: 30,
        DEFAULT_FORMATS: ["配信", "歌みた", "ショート"]
    };

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks()
    });
    controller.search();

    assert.equal(data.currentResults.length, 0);
    assert.equal(data.displayLimit, 0);
    assert.equal(ui.el.resultCount.innerText, "ブックマーク: 検証 (0 件)");
});

test("createSearchController: direct search synchronizes restored query validation", () => {
    const attributes = new Map();
    const searchBox = {
        value: "until:2026-13",
        validationMessage: "",
        setCustomValidity(message) {
            this.validationMessage = message;
        },
        setAttribute(name, value) {
            attributes.set(name, value);
        },
        removeAttribute(name) {
            attributes.delete(name);
        }
    };
    const searchBoxError = { hidden: true, textContent: "" };
    const data = {
        allSongsRaw: [makeRow({ title: "until:2026-13", dateKey: 20260101 })],
        bookmarks: {},
        activeBookmark: null,
        currentResults: [],
        displayLimit: 0
    };
    const ui = createSearchUiState({
        el: {
            searchBox,
            searchBoxError,
            relayOnly: { checked: false },
            harmonyOnly: { checked: false },
            dateFromYear: null,
            dateFromMonth: null,
            dateFromDay: null,
            dateToYear: null,
            dateToMonth: null,
            dateToDay: null,
            resultCount: { innerText: "" }
        },
        selectedFormats: new Set(["配信"])
    });
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants: {
            RANDOM_DISPLAY_COUNT: 10,
            MIN_PERFORMANCE_FOR_RANDOM: 1,
            RESULT_DISPLAY_BATCH_SIZE: 30,
            DEFAULT_FORMATS: ["配信"]
        },
        callbacks: createSearchCallbacks()
    });

    controller.search();

    assert.deepEqual(data.currentResults, []);
    assert.equal(ui.el.resultCount.innerText, "0 件がヒット");
    assert.equal(attributes.get("aria-invalid"), "true");
    assert.equal(searchBoxError.hidden, false);

    searchBox.value = '"until:2026-13"';
    controller.search();

    assert.equal(data.currentResults.length, 1);
    assert.equal(attributes.has("aria-invalid"), false);
    assert.equal(searchBoxError.hidden, true);
});

test("createSearchController: active bookmark resolves rows by bookmarkSongKey", () => {
    const rows = [
        makeRow({ songKey: "arch1::1", bookmarkSongKey: "videoA::1", title: "青い月", artist: "A", format: "配信" }),
        makeRow({ songKey: "arch2::2", bookmarkSongKey: "videoB::2", title: "赤い星", artist: "B", format: "歌みた" }),
        makeRow({ songKey: "arch3::3", bookmarkSongKey: "videoC::3", title: "白い空", artist: "C", format: "配信" })
    ];
    const data = {
        allSongsRaw: rows,
        bookmarks: {
            bm1: {
                name: "検証",
                songs: ["videoB::2", "videoA::1"]
            }
        },
        activeBookmark: "bm1",
        currentResults: [],
        displayLimit: 0
    };
    const ui = createSearchUiState({
        el: {
            searchBox: { value: "" },
            relayOnly: { checked: false },
            harmonyOnly: { checked: false },
            dateFromYear: null,
            dateFromMonth: null,
            dateFromDay: null,
            dateToYear: null,
            dateToMonth: null,
            dateToDay: null,
            resultCount: { innerText: "" }
        },
        selectedFormats: new Set(["配信", "歌みた"])
    });
    const constants = {
        RANDOM_DISPLAY_COUNT: 10,
        MIN_PERFORMANCE_FOR_RANDOM: 1,
        RESULT_DISPLAY_BATCH_SIZE: 30,
        DEFAULT_FORMATS: ["配信", "歌みた", "ショート"]
    };

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks()
    });
    controller.search();

    assert.deepEqual(data.currentResults.map((row) => row.songKey), ["arch2::2", "arch1::1"]);
    assert.equal(ui.el.resultCount.innerText, "ブックマーク: 検証 (2 件)");
});

test("createSearchController: active bookmark uses incremental display limit", () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
        makeRow({
            songKey: `s${index + 1}`,
            title: `曲${index + 1}`,
            artist: "A",
            format: "配信"
        })
    );
    const data = {
        allSongsRaw: rows,
        bookmarks: {
            bm1: {
                name: "検証",
                songs: rows.map((row) => row.songKey)
            }
        },
        activeBookmark: "bm1",
        currentResults: [],
        displayLimit: 0
    };
    const ui = createSearchUiState({
        el: {
            searchBox: { value: "" },
            relayOnly: { checked: false },
            harmonyOnly: { checked: false },
            dateFromYear: null,
            dateFromMonth: null,
            dateFromDay: null,
            dateToYear: null,
            dateToMonth: null,
            dateToDay: null,
            resultCount: { innerText: "" }
        },
        selectedFormats: new Set(["配信"])
    });
    const constants = {
        RANDOM_DISPLAY_COUNT: 10,
        MIN_PERFORMANCE_FOR_RANDOM: 1,
        RESULT_DISPLAY_BATCH_SIZE: 2,
        DEFAULT_FORMATS: ["配信", "歌みた", "ショート"]
    };

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks()
    });
    controller.search();

    assert.equal(data.currentResults.length, 5);
    assert.equal(data.displayLimit, 2);
    assert.equal(ui.el.resultCount.innerText, "ブックマーク: 検証 (5 件)");
});

test("createSearchController: an empty quoted query uses recommendation mode for オリ曲", () => {
    const rows = [
        makeRow({ archiveId: "a1", title: "覚声", artist: "PSYBELL", format: "オリ曲" }),
        makeRow({ archiveId: "a2", title: "覚声", artist: "PSYBELL", format: "オリ曲" }),
        makeRow({ archiveId: "a3", title: "覚声", artist: "PSYBELL", format: "オリ曲" })
    ];
    const data = {
        allSongsRaw: rows,
        bookmarks: {},
        activeBookmark: null,
        currentResults: [],
        displayLimit: 0
    };
    const ui = createSearchUiState({
        el: {
            searchBox: { value: '""' },
            relayOnly: { checked: false },
            harmonyOnly: { checked: false },
            dateFromYear: null,
            dateFromMonth: null,
            dateFromDay: null,
            dateToYear: null,
            dateToMonth: null,
            dateToDay: null,
            resultCount: { innerText: "" }
        },
        selectedFormats: new Set(["配信", "歌みた", "ショート", "切り抜き"]),
        recommendedCache: null
    });
    const constants = {
        RANDOM_DISPLAY_COUNT: 10,
        MIN_PERFORMANCE_FOR_RANDOM: 3,
        RESULT_DISPLAY_BATCH_SIZE: 30,
        DEFAULT_FORMATS: ["配信", "歌みた", "ショート", "切り抜き"]
    };

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks()
    });
    controller.search();

    assert.equal(data.currentResults.length, 1);
    assert.equal(data.currentResults[0].format, "オリ曲");
    assert.equal(ui.el.resultCount.innerText, "おすすめを表示中");
});

test("createSearchController: single オリ曲 performance is eligible for recommendation", () => {
    const rows = [
        makeRow({ archiveId: "a1", title: "覚声", artist: "PSYBELL", format: "オリ曲" })
    ];
    const data = {
        allSongsRaw: rows,
        bookmarks: {},
        activeBookmark: null,
        currentResults: [],
        displayLimit: 0
    };
    const ui = createSearchUiState({
        el: {
            searchBox: { value: "" },
            relayOnly: { checked: false },
            harmonyOnly: { checked: false },
            dateFromYear: null,
            dateFromMonth: null,
            dateFromDay: null,
            dateToYear: null,
            dateToMonth: null,
            dateToDay: null,
            resultCount: { innerText: "" }
        },
        selectedFormats: new Set(["配信", "歌みた", "ショート", "切り抜き"]),
        recommendedCache: null
    });
    const constants = {
        RANDOM_DISPLAY_COUNT: 10,
        MIN_PERFORMANCE_FOR_RANDOM: 3,
        RESULT_DISPLAY_BATCH_SIZE: 30,
        DEFAULT_FORMATS: ["配信", "歌みた", "ショート", "切り抜き"]
    };

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks()
    });
    controller.search();

    assert.equal(data.currentResults.length, 1);
    assert.equal(data.currentResults[0].format, "オリ曲");
    assert.equal(ui.el.resultCount.innerText, "おすすめを表示中");
});

test("createSearchController: recommendation selection and rendering retain their limits on resize", () => {
    const rows = Array.from({ length: 160 }, (_, index) =>
        makeRow({
            archiveId: `a${index + 1}`,
            title: `おすすめ${index + 1}`,
            artist: "A",
            format: "配信"
        })
    );
    const data = {
        allSongsRaw: rows,
        bookmarks: {},
        activeBookmark: null,
        currentResults: [],
        displayLimit: 0
    };
    const ui = createSearchUiState({
        el: {
            searchBox: { value: "" },
            relayOnly: { checked: false },
            harmonyOnly: { checked: false },
            dateFromYear: null,
            dateFromMonth: null,
            dateFromDay: null,
            dateToYear: null,
            dateToMonth: null,
            dateToDay: null,
            resultCount: { innerText: "" }
        },
        selectedFormats: new Set(["配信", "歌みた", "ショート"]),
        recommendedCache: null
    });
    const constants = {
        RANDOM_DISPLAY_COUNT: 10,
        MIN_PERFORMANCE_FOR_RANDOM: 1,
        RESULT_DISPLAY_BATCH_SIZE: 10,
        DEFAULT_FORMATS: ["配信", "歌みた", "ショート"]
    };
    let recommendedDisplayCount = 48;
    let initialDisplayCount = 12;
    let scrollCount = 0;
    let updateCount = 0;
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks({
            getRecommendedDisplayCount: () => recommendedDisplayCount,
            getInitialDisplayCount: () => initialDisplayCount,
            updateDisplay: () => {
                updateCount += 1;
            },
            scrollResultsPaneToTop: () => {
                scrollCount += 1;
            }
        })
    });

    controller.search();
    const firstRecommendedSongs = data.currentResults.slice();
    assert.equal(data.currentResults.length, 48);
    assert.equal(data.displayLimit, 12);
    assert.equal(scrollCount, 1);
    assert.equal(updateCount, 1);

    assert.equal(controller.refreshRecommendedDisplay(), false, "unchanged viewport does not render again");
    assert.equal(updateCount, 1);

    initialDisplayCount = 24;
    assert.equal(controller.refreshRecommendedDisplay(), true, "display limit can grow without selecting more songs");
    assert.deepEqual(data.currentResults, firstRecommendedSongs);
    assert.equal(data.displayLimit, 24);
    assert.equal(updateCount, 2);

    data.displayLimit = 40; // Simulate incremental rendering before shrinking.
    recommendedDisplayCount = 10;
    const retainedResults = data.currentResults;
    assert.equal(controller.refreshRecommendedDisplay(), false);
    assert.equal(data.currentResults, retainedResults);
    assert.equal(updateCount, 2);
    assert.deepEqual(data.currentResults, firstRecommendedSongs);
    assert.equal(data.displayLimit, 40);

    recommendedDisplayCount = 108;
    initialDisplayCount = 108;
    assert.equal(controller.refreshRecommendedDisplay(), true);
    assert.equal(data.currentResults.length, 108);
    assert.equal(data.displayLimit, 108);
    assert.deepEqual(data.currentResults.slice(0, 48), firstRecommendedSongs);
    assert.equal(scrollCount, 1);
    assert.equal(updateCount, 3);

    recommendedDisplayCount = 48;
    initialDisplayCount = 12;
    const expandedSongs = data.currentResults.slice();
    assert.equal(controller.refreshRecommendedDisplay(), false);
    assert.deepEqual(data.currentResults, expandedSongs);
    assert.equal(data.currentResults.length, 108);
    assert.equal(data.displayLimit, 108);
    assert.deepEqual(data.currentResults.slice(0, 48), firstRecommendedSongs);
    assert.equal(scrollCount, 1);
    assert.equal(updateCount, 3);

    ui.el.searchBox.value = "おすすめ1";
    recommendedDisplayCount = 120;
    initialDisplayCount = 120;
    assert.equal(controller.refreshRecommendedDisplay(), true, "resize uses the committed mode without collecting inputs");
    assert.equal(data.currentResults.length, 120);
    assert.equal(updateCount, 4);
    assert.equal(ui.el.resultCount.innerText, "おすすめを表示中");
});

test("createSearchController: recommendation expansion dedupes by recommendation song group", () => {
    const previousRandom = Math.random;
    const randomValues = [0.75, 0, 0.75, 0.75, 0];
    Math.random = () => randomValues.shift() ?? 0;
    try {
        const rows = [
            makeRow({
                archiveId: "same-a1",
                title: "同じ曲",
                artist: "A",
                songKey: "same-a1",
                format: "配信"
            }),
            makeRow({
                archiveId: "same-a2",
                title: "同じ曲",
                artist: "A",
                songKey: "same-a2",
                format: "配信"
            }),
            makeRow({
                archiveId: "other-b1",
                title: "別の曲",
                artist: "B",
                songKey: "other-b1",
                format: "配信"
            }),
            makeRow({
                archiveId: "other-b2",
                title: "別の曲",
                artist: "B",
                songKey: "other-b2",
                format: "配信"
            })
        ];
        const data = {
            allSongsRaw: rows,
            bookmarks: {},
            activeBookmark: null,
            currentResults: [],
            displayLimit: 0
        };
        const ui = createSearchUiState({
            el: {
                searchBox: { value: "" },
                relayOnly: { checked: false },
                harmonyOnly: { checked: false },
                dateFromYear: null,
                dateFromMonth: null,
                dateFromDay: null,
                dateToYear: null,
                dateToMonth: null,
                dateToDay: null,
                resultCount: { innerText: "" }
            },
            selectedFormats: new Set(["配信", "歌みた", "ショート"]),
            recommendedCache: null
        });
        const constants = {
            RANDOM_DISPLAY_COUNT: 1,
            MIN_PERFORMANCE_FOR_RANDOM: 2,
            RESULT_DISPLAY_BATCH_SIZE: 10,
            DEFAULT_FORMATS: ["配信", "歌みた", "ショート"]
        };
        let recommendedDisplayCount = 1;
        const controller = createSearchControllerForTest({
            data,
            ui,
            constants,
            callbacks: createSearchCallbacks({
                getRecommendedDisplayCount: () => recommendedDisplayCount
            })
        });

        controller.search();
        assert.equal(data.currentResults.length, 1);
        assert.equal(data.currentResults[0].titleNorm, normalizeForSearch("同じ曲"));

        recommendedDisplayCount = 2;
        assert.equal(controller.refreshRecommendedDisplay(), true);

        assert.equal(data.currentResults.length, 2);
        assert.deepEqual(data.currentResults.map((row) => row.titleNorm), [
            normalizeForSearch("同じ曲"),
            normalizeForSearch("別の曲")
        ]);
    } finally {
        Math.random = previousRandom;
    }
});

test("createSearchController: recommendation count is capped by available recommendations", () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
        makeRow({
            archiveId: `cap${index + 1}`,
            title: `候補${index + 1}`,
            artist: "A",
            format: "配信"
        })
    );
    const data = {
        allSongsRaw: rows,
        bookmarks: {},
        activeBookmark: null,
        currentResults: [],
        displayLimit: 0
    };
    const ui = createSearchUiState({
        el: {
            searchBox: { value: "" },
            relayOnly: { checked: false },
            harmonyOnly: { checked: false },
            dateFromYear: null,
            dateFromMonth: null,
            dateFromDay: null,
            dateToYear: null,
            dateToMonth: null,
            dateToDay: null,
            resultCount: { innerText: "" }
        },
        selectedFormats: new Set(["配信", "歌みた", "ショート"]),
        recommendedCache: null
    });
    const constants = {
        RANDOM_DISPLAY_COUNT: 10,
        MIN_PERFORMANCE_FOR_RANDOM: 1,
        RESULT_DISPLAY_BATCH_SIZE: 10,
        DEFAULT_FORMATS: ["配信", "歌みた", "ショート"]
    };
    let recommendedDisplayCount = 20;
    let updateCount = 0;
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks({
            getRecommendedDisplayCount: () => recommendedDisplayCount,
            updateDisplay: () => { updateCount += 1; }
        })
    });

    controller.search();

    assert.equal(data.currentResults.length, 7);
    assert.equal(data.displayLimit, 7);
    assert.equal(ui.el.resultCount.innerText, "おすすめを表示中");
    const previousResults = data.currentResults;
    recommendedDisplayCount = 30;
    assert.equal(controller.refreshRecommendedDisplay(), false, "exhausted candidates do not trigger a render");
    assert.equal(data.currentResults, previousResults);
    assert.equal(updateCount, 1);

    data.allSongsRaw = [];
    ui.search.recommendedCache = null;
    controller.search();
    assert.equal(data.currentResults.length, 0);
    assert.equal(controller.refreshRecommendedDisplay(), false, "empty recommendations do not trigger a render");
    assert.equal(updateCount, 2);
});
