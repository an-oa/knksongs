import test from "node:test";
import assert from "node:assert/strict";
import { createSearchFiltersController } from "../_build/app/ui/search-filters/controller.mjs";
import { normalizeForSearch } from "../_build/app/lib/search-normalization.mjs";
import { createSearchController } from "../_build/app/controllers/search.mjs";
import { createDateFilterController } from "../_build/app/ui/date/filter.mjs";

let autoSongId = 0;

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
        getRecommendedDisplayCount: callbacks.getRecommendedDisplayCount
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

test("createSearchController: recommendation count expands to the responsive display count", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
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
    let recommendedDisplayCount = 12;
    let scrollCount = 0;
    let updateCount = 0;
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks({
            getRecommendedDisplayCount: () => recommendedDisplayCount,
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
    assert.equal(data.currentResults.length, 12);
    assert.equal(data.displayLimit, 12);
    assert.equal(scrollCount, 1);
    assert.equal(updateCount, 1);

    recommendedDisplayCount = 20;
    assert.equal(controller.refreshRecommendedDisplay(), true);
    assert.equal(data.currentResults.length, 20);
    assert.equal(data.displayLimit, 20);
    assert.deepEqual(data.currentResults.slice(0, 12), firstRecommendedSongs);
    assert.equal(scrollCount, 1);
    assert.equal(updateCount, 2);

    recommendedDisplayCount = 10;
    assert.equal(controller.refreshRecommendedDisplay(), true);
    assert.equal(data.currentResults.length, 10);
    assert.equal(data.displayLimit, 10);
    assert.deepEqual(data.currentResults, firstRecommendedSongs.slice(0, 10));
    assert.equal(scrollCount, 1);
    assert.equal(updateCount, 3);

    ui.el.searchBox.value = "おすすめ1";
    assert.equal(controller.refreshRecommendedDisplay(), false);
    assert.equal(updateCount, 3);
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
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        callbacks: createSearchCallbacks({
            getRecommendedDisplayCount: () => 20
        })
    });

    controller.search();

    assert.equal(data.currentResults.length, 7);
    assert.equal(data.displayLimit, 7);
    assert.equal(ui.el.resultCount.innerText, "おすすめを表示中");
});
