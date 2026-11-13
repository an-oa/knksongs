import test from "node:test";
import assert from "node:assert/strict";
import { createDataLoader } from "../app/ui/core/data.mts";
import type { SongsSnapshot } from "../app/lib/songs-data-source.mts";
import type { AppUiState } from "../app/state.types";
import type { ResultCountState } from "../app/ui/result-summary/count.mts";
import { createSongFixture } from "./fixtures/song.mts";
import { installFakeDom } from "./test-helpers.mts";

/** data loader テスト用の曲識別子を持つ曲データを返す。 */
function createSong(songKey: string): Song {
    return createSongFixture({
        archiveId: songKey.split("::")[0] || "json-archive",
        videoId: "abc123",
        songKey,
        bookmarkSongKey: `abc123::${songKey}`,
        url: "https://www.youtube.com/watch?v=abc123&t=10s"
    });
}

type DataLoaderHarnessOptions = {
    searchBoxDisabled?: boolean;
    recommendedCache?: AppUiState["search"]["recommendedCache"];
    hasRestoredSearchState?: boolean;
    pendingValues?: AppUiState["date"]["pendingValues"];
    dateBounds?: SearchDateRange;
};

/**
 * data loader テスト用の状態とスパイを作る。
 */
function createDataLoaderHarness(options: DataLoaderHarnessOptions = {}) {
    const searchBox = document.createElement("input");
    searchBox.disabled = options.searchBoxDisabled ?? true;

    const data: Parameters<typeof createDataLoader>[0]["data"] = {
        allSongsRaw: []
    };
    const search: Parameters<typeof createDataLoader>[0]["ui"]["search"] = {
        recommendedCache: options.recommendedCache ?? { songs: [], requestedCount: 1 },
        dataReady: false,
        hasRestoredSearchState: options.hasRestoredSearchState ?? false
    };
    const ui = {
        el: {
            searchBox
        },
        search,
        date: {
            pendingValues: options.pendingValues ?? null
        }
    } satisfies Parameters<typeof createDataLoader>[0]["ui"];

    const calls: {
        applyDateInputRangeArgs: Song[][];
        clampDateInputsToBoundsArgs: [number, number][];
        resultCountStates: ResultCountState[];
    } = {
        applyDateInputRangeArgs: [],
        clampDateInputsToBoundsArgs: [],
        resultCountStates: []
    };

    const callbacks: Parameters<typeof createDataLoader>[0]["callbacks"] = {
        applyDateInputRange(songs) {
            calls.applyDateInputRangeArgs.push(songs);
            return options.dateBounds ?? { minKey: 20260311, maxKey: 20260311 };
        },
        clampDateInputsToBounds(minKey, maxKey) {
            calls.clampDateInputsToBoundsArgs.push([minKey, maxKey]);
        },
        showResultCount(state) {
            calls.resultCountStates.push(state);
        }
    };

    return { data, ui, calls, callbacks };
}

/**
 * dataSource から返すスナップショットを指定して data loader を作る。
 */
function createLoaderWithDataSource(
    options: { initialSnapshot?: SongsSnapshot | null },
    harness: ReturnType<typeof createDataLoaderHarness>
) {
    return createDataLoader({
        data: harness.data,
        ui: harness.ui,
        dataSource: {
            async loadInitialSnapshot() {
                return options.initialSnapshot ?? null;
            }
        },
        callbacks: harness.callbacks
    });
}

test("data loader: loaded songs enable search and report that initial conditions need reset", async () => {
    const restoreDom = installFakeDom();
    try {
        const song = createSong("archive-1::1");
        const harness = createDataLoaderHarness();
        const loader = createLoaderWithDataSource({
            initialSnapshot: { songs: [song], source: "network" }
        }, harness);

        const result = await loader.loadInitialData();

        assert.equal(harness.data.allSongsRaw.length, 1);
        assert.equal(harness.data.allSongsRaw[0], song);
        assert.equal(harness.calls.applyDateInputRangeArgs.length, 1);
        assert.equal(harness.calls.applyDateInputRangeArgs[0], harness.data.allSongsRaw);
        assert.deepEqual(harness.calls.clampDateInputsToBoundsArgs, [[20260311, 20260311]]);
        assert.deepEqual(result, { loaded: true, shouldResetConditions: true });
        assert.equal(harness.ui.search.recommendedCache, null);
        assert.equal(harness.ui.search.dataReady, true);
        assert.equal(harness.ui.el.searchBox.disabled, false);
    } finally {
        restoreDom();
    }
});

test("data loader: cache source skips reset when pending state exists and leaves the count to the search", async () => {
    const restoreDom = installFakeDom();
    try {
        const harness = createDataLoaderHarness({
            pendingValues: { from: "2026-01-01", to: null }
        });
        const loader = createLoaderWithDataSource({
            initialSnapshot: {
                songs: [createSong("cached-archive::1")],
                source: "cache"
            }
        }, harness);

        const result = await loader.loadInitialData();

        assert.equal(harness.data.allSongsRaw.length, 1);
        assert.deepEqual(harness.calls.resultCountStates, [{ kind: "loadingData" }]);
        assert.equal(harness.ui.search.dataReady, true);
        assert.equal(harness.ui.el.searchBox.disabled, false);
        assert.deepEqual(result, { loaded: true, shouldResetConditions: false });
    } finally {
        restoreDom();
    }
});

test("data loader: search stays disabled until the initial public snapshot is ready", async () => {
    const restoreDom = installFakeDom();
    try {
        const harness = createDataLoaderHarness();
        const { promise: snapshot, resolve: resolveSnapshot } = Promise.withResolvers<SongsSnapshot | null>();
        let loadCount = 0;
        const loader = createDataLoader({
            data: harness.data,
            ui: harness.ui,
            callbacks: harness.callbacks,
            dataSource: {
                loadInitialSnapshot() {
                    loadCount += 1;
                    return snapshot;
                }
            }
        });
        const loading = loader.loadInitialData();
        assert.equal(harness.ui.el.searchBox.disabled, true);
        assert.deepEqual(harness.calls.resultCountStates, [{ kind: "loadingData" }]);
        assert.deepEqual(harness.data.allSongsRaw, []);
        const song = createSong("public-archive::1");
        resolveSnapshot({ songs: [song], source: "network" });
        await loading;
        assert.deepEqual(harness.data.allSongsRaw, [song]);
        assert.equal(harness.ui.el.searchBox.disabled, false);
        assert.equal(loadCount, 1);
    } finally {
        restoreDom();
    }
});

test("data loader: failed load shows error and leaves search disabled", async () => {
    const restoreDom = installFakeDom();
    try {
        const harness = createDataLoaderHarness();
        const loader = createLoaderWithDataSource({ initialSnapshot: null }, harness);

        const result = await loader.loadInitialData();

        assert.equal(harness.data.allSongsRaw.length, 0);
        assert.deepEqual(harness.calls.resultCountStates, [{ kind: "loadingData" }, { kind: "loadError" }]);
        assert.equal(harness.ui.search.dataReady, false);
        assert.equal(harness.ui.el.searchBox.disabled, true);
        assert.deepEqual(result, { loaded: false });
    } finally {
        restoreDom();
    }
});
