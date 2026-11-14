import test from "node:test";
import type { SiteLanguage } from "../app/lib/site-language.mts";
import type {
    AppDataState,
    SearchConditionsState,
    SearchUiRuntimeState,
    DateUiRuntimeState,
    LookupUiRuntimeState
} from "../app/state.types.mts";
import assert from "node:assert/strict";
import { createSearchFiltersController } from "../app/ui/search-filters/controller.mts";
import { createSearchSongFixtureFactory } from "./fixtures/search-song.mts";
import { normalizeForSearch } from "../app/lib/search-normalization.mts";
import { createSearchController } from "../app/controllers/search.mts";
import { createSearchCoordinator } from "../app/controllers/search-coordinator.mts";
import { createDateFilterController } from "../app/ui/date/filter.mts";
import { createResultCountController } from "../app/ui/result-summary/count.mts";
import { createInitialSearchConditions } from "../app/state.mts";
import { SEARCH_BOOLEAN_FILTER_KEYS } from "../app/lib/search-boolean-filters.mts";

const makeRow = createSearchSongFixtureFactory();

for (const mode of ["search", "bookmark"]) {
    test(`createSearchController: resize does not inherit ${mode} results before recommendation search commits`, (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const rows = Array.from({ length: 160 }, (_, index) => makeRow({
            archiveId: `pending-${index}`,
            title: `Candidate ${index}`,
            format: "オリ曲"
        }));
        const data: AppDataState = {
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
        const renders: number[][] = [];
        let recommendedCount = 48;
        let initialCount = 12;
        const controller = createSearchControllerForTest({
            data,
            ui,
            constants: {
                RANDOM_DISPLAY_COUNT: 48,
                RESULT_DISPLAY_BATCH_SIZE: 48,
                MIN_PERFORMANCE_FOR_RANDOM: 1,
            },
            defaultFormats: ["配信", "歌みた"],
            callbacks: createSearchCallbacks({
                getRecommendedDisplayCount: () => recommendedCount,
                getInitialDisplayCount: () => initialCount,
                updateDisplay: () => renders.push([data.currentResults.length, data.displayLimit])
            })
        });
        const coordinator = createSearchCoordinator({ debounceMs: 200, searchController: controller });
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
    const data: AppDataState = { allSongsRaw: rows, bookmarks: {}, activeBookmark: null, currentResults: [], displayLimit: 0 };
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
        },
        defaultFormats: ["配信", "歌みた"],
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

type SearchTestUiElements = Parameters<typeof createSearchController>[0]["ui"]["el"] &
    Parameters<typeof createDateFilterController>[0]["ui"]["el"] &
    Parameters<typeof createSearchFiltersController>[0]["ui"]["el"] &
    Parameters<typeof createResultCountController>[0]["ui"]["el"];

/**
 * テストの入力欄のモックを、検索条件の状態へつなぐ。
 * 本番では search-actions が、入力欄の操作を状態へ書く。検索 controller は状態だけを読むので、
 * ここでは入力欄のモックへの書き込みを利用者の操作として扱い、そのまま状態へ書く。
 * 入力欄に最初から入っている値は、復元済みの条件として状態へ移す。
 * @param el テストが用意した入力欄のモック
 * @param conditions つなぐ先の検索条件の状態
 */
function bindInputsToConditions(el: SearchTestUiElements, conditions: SearchConditionsState) {
    const searchBox = el.searchBox;
    if (searchBox) {
        conditions.query = searchBox.value;
        Object.defineProperty(searchBox, "value", {
            get: () => conditions.query,
            set: (value: string) => { conditions.query = value; },
            configurable: true,
            enumerable: true
        });
    }
    for (const key of SEARCH_BOOLEAN_FILTER_KEYS) {
        const checkbox = el[key];
        if (!checkbox) continue;
        conditions.booleanFilters[key] = Boolean(checkbox.checked);
        Object.defineProperty(checkbox, "checked", {
            get: () => conditions.booleanFilters[key],
            set: (value: boolean) => { conditions.booleanFilters = { ...conditions.booleanFilters, [key]: value }; },
            configurable: true,
            enumerable: true
        });
    }
}

/** 検索コントローラー検証用の UI 状態を作る。 */
function createSearchUiState<Elements extends SearchTestUiElements>(input: {
    el: Elements;
    selectedFormats: Set<string>;
    recommendedCache?: SearchUiRuntimeState["recommendedCache"];
}) {
    const search: SearchUiRuntimeState = {
        conditions: createInitialSearchConditions(),
        selectedFormats: input.selectedFormats,
        recommendedCache: input.recommendedCache ?? null,
        dataReady: false
    };
    bindInputsToConditions(input.el, search.conditions);
    const date: DateUiRuntimeState = { bounds: null, index: null };
    const lookup: LookupUiRuntimeState = {
        songMapByKey: new Map(), songLookupSourceRef: null
    };
    const language = { current: "ja" as SiteLanguage };
    return { el: input.el, search, date, lookup, language };
}

/** 検索条件 UI controller と件数表示の controller を注入して検索 controller を作る。 */
function createSearchControllerForTest(input: {
    data: AppDataState;
    ui: ReturnType<typeof createSearchUiState>;
    constants: Parameters<typeof createSearchController>[0]["constants"];
    defaultFormats: string[];
    callbacks: Omit<Parameters<typeof createSearchController>[0]["callbacks"], "showResultCount">;
}) {
    const { defaultFormats, callbacks, ...searchInput } = input;
    // 件数表示は、本番と同じく件数表示の controller が今の言語の文言で書く。
    const resultCountController = createResultCountController({ ui: input.ui });
    return createSearchController({
        ...searchInput,
        callbacks: {
            ...callbacks,
            showResultCount: (summary) => resultCountController.show({ kind: "results", summary })
        },
        searchFiltersController: createSearchFiltersController({
            ui: input.ui,
            defaultFormats
        })
    });
}

/**
 * 検索コントローラー用の描画コールバックを作る。
 */
function createSearchCallbacks(callbacks: Partial<Parameters<typeof createSearchController>[0]["callbacks"]> = {}) {
    return {
        updateDisplay: callbacks.updateDisplay || (() => {}),
        scrollResultsPaneToTop: callbacks.scrollResultsPaneToTop || (() => {}),
        getRecommendedDisplayCount: callbacks.getRecommendedDisplayCount,
        getScrolledPastResultCount: callbacks.getScrolledPastResultCount,
        getResultCountToKeep: callbacks.getResultCountToKeep,
        getInitialDisplayCount: callbacks.getInitialDisplayCount
    };
}

test("createSearchController: active bookmark also applies search criteria", () => {
    const rows = [
        makeRow({ songKey: "s1", title: "青い月", artist: "A", format: "配信" }),
        makeRow({ songKey: "s2", title: "赤い星", artist: "B", format: "歌みた" }),
        makeRow({ songKey: "s3", title: "赤い空", artist: "C", format: "配信" })
    ];
    const data: AppDataState = {
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
    };
    const defaultFormats = ["配信", "歌みた", "ショート"];

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        defaultFormats,
        callbacks: createSearchCallbacks()
    });
    controller.search();

    assert.equal(data.currentResults.length, 0);
    assert.equal(data.displayLimit, 0);
    assert.equal(ui.el.resultCount.innerText, "ブックマーク: 検証 (0 件)");
});

test("createSearchController: direct search synchronizes restored query validation", () => {
    const attributes = new Map<string, string>();
    const searchBox = {
        value: "until:2026-13",
        validationMessage: "",
        setCustomValidity(message: string) {
            this.validationMessage = message;
        },
        setAttribute(name: string, value: string) {
            attributes.set(name, value);
        },
        removeAttribute(name: string) {
            attributes.delete(name);
        }
    };
    const searchBoxError = { hidden: true, textContent: "" };
    const data: AppDataState = {
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
        },
        defaultFormats: ["配信"],
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

test("createSearchController: active bookmark resolves rows by songKey", () => {
    const rows = [
        makeRow({ songKey: "videoA::1", title: "青い月", artist: "A", format: "配信" }),
        makeRow({ songKey: "videoB::2", title: "赤い星", artist: "B", format: "歌みた" }),
        makeRow({ songKey: "videoC::3", title: "白い空", artist: "C", format: "配信" })
    ];
    const data: AppDataState = {
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
    };
    const defaultFormats = ["配信", "歌みた", "ショート"];

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        defaultFormats,
        callbacks: createSearchCallbacks()
    });
    controller.search();

    assert.deepEqual(data.currentResults.map((row) => row.songKey), ["videoB::2", "videoA::1"]);
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
    const data: AppDataState = {
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
    };
    const defaultFormats = ["配信", "歌みた", "ショート"];

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        defaultFormats,
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
    const data: AppDataState = {
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
    };
    const defaultFormats = ["配信", "歌みた", "ショート", "切り抜き"];

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        defaultFormats,
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
    const data: AppDataState = {
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
    };
    const defaultFormats = ["配信", "歌みた", "ショート", "切り抜き"];

    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        defaultFormats,
        callbacks: createSearchCallbacks()
    });
    controller.search();

    assert.equal(data.currentResults.length, 1);
    assert.equal(data.currentResults[0].format, "オリ曲");
    assert.equal(ui.el.resultCount.innerText, "おすすめを表示中");
});

test("createSearchController: recommendation resize keeps cards scrolled past and shrinks back at the top", () => {
    const rows = Array.from({ length: 160 }, (_, index) =>
        makeRow({
            archiveId: `a${index + 1}`,
            title: `おすすめ${index + 1}`,
            artist: "A",
            format: "配信"
        })
    );
    const data: AppDataState = {
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
    };
    const defaultFormats = ["配信", "歌みた", "ショート"];
    let recommendedDisplayCount = 48;
    let initialDisplayCount = 12;
    let scrolledPastCount = 0;
    let resultCountToKeep = 0;
    let scrollCount = 0;
    let updateCount = 0;
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        defaultFormats,
        callbacks: createSearchCallbacks({
            getRecommendedDisplayCount: () => recommendedDisplayCount,
            getScrolledPastResultCount: () => scrolledPastCount,
            getResultCountToKeep: () => resultCountToKeep,
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

    data.displayLimit = 40; // Simulate incremental rendering and scrolling before shrinking.
    scrolledPastCount = 38;
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
    scrolledPastCount = 60;
    const expandedSongs = data.currentResults.slice();
    assert.equal(controller.refreshRecommendedDisplay(), false, "cards scrolled past and one viewport below stay");
    assert.deepEqual(data.currentResults, expandedSongs);
    assert.equal(data.currentResults.length, 108);
    assert.equal(data.displayLimit, 108);
    assert.deepEqual(data.currentResults.slice(0, 48), firstRecommendedSongs);
    assert.equal(scrollCount, 1);
    assert.equal(updateCount, 3);

    scrolledPastCount = 20;
    assert.equal(controller.refreshRecommendedDisplay(), true, "only cards below one viewport are removed");
    assert.deepEqual(data.currentResults, expandedSongs.slice(0, 68));
    assert.equal(data.displayLimit, 68);
    assert.equal(updateCount, 4);

    scrolledPastCount = 0;
    resultCountToKeep = 60;
    assert.equal(controller.refreshRecommendedDisplay(), true, "cards on screen or the playing card stay");
    assert.deepEqual(data.currentResults, expandedSongs.slice(0, 60));
    assert.equal(data.displayLimit, 60);
    assert.equal(updateCount, 5);

    resultCountToKeep = 0;
    assert.equal(controller.refreshRecommendedDisplay(), true, "the top of the list returns to the viewport count");
    assert.deepEqual(data.currentResults, firstRecommendedSongs);
    assert.equal(data.displayLimit, 48);
    assert.equal(scrollCount, 1);
    assert.equal(updateCount, 6);

    ui.el.searchBox.value = "おすすめ1";
    recommendedDisplayCount = 120;
    initialDisplayCount = 120;
    assert.equal(controller.refreshRecommendedDisplay(), true, "resize uses the committed mode without collecting inputs");
    assert.equal(data.currentResults.length, 120);
    assert.deepEqual(data.currentResults.slice(0, 108), expandedSongs);
    assert.equal(updateCount, 7);
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
        const data: AppDataState = {
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
        };
        const defaultFormats = ["配信", "歌みた", "ショート"];
        let recommendedDisplayCount = 1;
        const controller = createSearchControllerForTest({
            data,
            ui,
            constants,
            defaultFormats,
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
    const data: AppDataState = {
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
    };
    const defaultFormats = ["配信", "歌みた", "ショート"];
    let recommendedDisplayCount = 20;
    let updateCount = 0;
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants,
        defaultFormats,
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

test("createSearchController: conditions are read from the state, not from the inputs", () => {
    const rows = [
        makeRow({ songKey: "march", title: "March Song", dateKey: 20240331, isRelay: true }),
        makeRow({ songKey: "april", title: "April Song", dateKey: 20240401, isRelay: true }),
        makeRow({ songKey: "december", title: "December Song", dateKey: 20241231 }),
        makeRow({ songKey: "next-year", title: "Next Year Song", dateKey: 20250101, isRelay: true })
    ];
    const data: AppDataState = { allSongsRaw: rows, bookmarks: {}, activeBookmark: null, currentResults: [], displayLimit: 0 };
    // 入力欄のモックを置かず、状態だけを書き換える。
    const ui = createSearchUiState({
        el: { resultCount: { innerText: "" } },
        selectedFormats: new Set(["配信"])
    });
    const controller = createSearchControllerForTest({
        data,
        ui,
        constants: { RANDOM_DISPLAY_COUNT: 10, MIN_PERFORMANCE_FOR_RANDOM: 1, RESULT_DISPLAY_BATCH_SIZE: 30 },
        defaultFormats: ["配信"],
        callbacks: createSearchCallbacks()
    });

    // 年月だけの開始日は月の最初の日、年だけの終了日は年の最後の日として扱う。
    ui.search.conditions.dateFrom = "2024-04";
    ui.search.conditions.dateTo = "2024";
    controller.search();
    assert.deepEqual(data.currentResults.map((row) => row.songKey), ["april", "december"]);
    assert.deepEqual(controller.getSearchState(), {
        queryRaw: "",
        collabHostOnly: false,
        collabGuestOnly: false,
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: 20240401,
        dateToKey: 20241231,
        hasDateFilter: true
    });

    ui.search.conditions.booleanFilters = { ...ui.search.conditions.booleanFilters, relayOnly: true };
    controller.search();
    assert.deepEqual(data.currentResults.map((row) => row.songKey), ["april"]);

    // 検索語は、前後の空白を除いて使う。
    ui.search.conditions.dateFrom = "";
    ui.search.conditions.dateTo = "";
    ui.search.conditions.query = "  next year  ";
    controller.search();
    assert.deepEqual(data.currentResults.map((row) => row.songKey), ["next-year"]);
    assert.equal(ui.el.resultCount.innerText, "1 件がヒット");
});
