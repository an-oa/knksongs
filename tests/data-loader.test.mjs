import test from "node:test";
import assert from "node:assert/strict";
import { createDataLoader } from "../_build/app/ui/core/data.mjs";
import { installFakeDom } from "./test-helpers.mjs";

/**
 * data loader テスト用の曲データを返す。
 * @param {string} songKey
 * @returns {*}
 */
function createSong(songKey) {
    const archiveId = songKey.split("::")[0] || "json-archive";
    return {
        date: "2026/03/11",
        dateKey: 20260311,
        archiveId,
        archiveOrder: 1,
        videoId: "abc123",
        songKey,
        bookmarkSongKey: `abc123::${songKey}`,
        legacySongKey: `${songKey}::https://www.youtube.com/watch?v=abc123&t=10s`,
        format: "配信",
        streamRole: "",
        videoOrientation: "vertical",
        isRelay: false,
        isHarmony: false,
        title: "KING",
        artist: "Kanaria feat. GUMI",
        titleYomi: "キング",
        artistYomi: "カナリアフィーチャリンググミ",
        url: "https://www.youtube.com/watch?v=abc123&t=10s",
        endSeconds: 581,
        titleNorm: "king",
        artistNorm: "kanaria feat. gumi",
        titleYomiNorm: "キング",
        artistYomiNorm: "カナリアフィーチャリンググミ"
    };
}

/**
 * data loader テスト用の状態とスパイを作る。
 * @param {*} input
 * @returns {*}
 */
function createDataLoaderHarness(input) {
    const options = input || {};
    const resultCount = document.createElement("div");
    const searchBox = document.createElement("input");
    searchBox.disabled = options.searchBoxDisabled ?? true;

    const data = {
        allSongsRaw: [],
        pendingSongsRaw: null
    };
    const ui = {
        el: {
            resultCount,
            searchBox
        },
        search: {
            recommendedCache: options.recommendedCache ?? { stale: true },
            dataReady: false,
            hasRestoredSearchState: options.hasRestoredSearchState ?? false
        },
        date: {
            pendingValues: options.pendingValues ?? null
        }
    };

    const calls = {
        applyDateInputRangeArgs: [],
        clampDateInputsToBoundsArgs: [],
        refreshSnapshotArgs: []
    };

    const callbacks = {
        applyDateInputRange(songs) {
            calls.applyDateInputRangeArgs.push(songs);
            return options.dateBounds ?? { minKey: 20260311, maxKey: 20260311 };
        },
        clampDateInputsToBounds(minKey, maxKey) {
            calls.clampDateInputsToBoundsArgs.push([minKey, maxKey]);
        }
    };

    return { data, ui, calls, callbacks };
}

/**
 * dataSource から返すスナップショットを指定して data loader を作る。
 * @param {{ initialSnapshot?: object | null, onRefresh?: Function }} options
 * @param {*} harness
 * @returns {*}
 */
function createLoaderWithDataSource(options, harness) {
    return createDataLoader({
        data: harness.data,
        ui: harness.ui,
        constants: {
            minPerformanceCount: 3
        },
        dataSource: {
            async loadInitialSnapshot() {
                return options.initialSnapshot ?? null;
            },
            async refreshSnapshot(reference) {
                harness.calls.refreshSnapshotArgs.push(reference);
                return options.onRefresh ? options.onRefresh(reference) : null;
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
            initialSnapshot: { songs: [song], source: "network", artifact: null }
        }, harness);

        const result = await loader.loadInitialData();

        assert.equal(harness.data.allSongsRaw.length, 1);
        assert.equal(harness.data.allSongsRaw[0], song);
        assert.equal(harness.calls.applyDateInputRangeArgs.length, 1);
        assert.equal(harness.calls.applyDateInputRangeArgs[0], harness.data.allSongsRaw);
        assert.deepEqual(harness.calls.clampDateInputsToBoundsArgs, [[20260311, 20260311]]);
        assert.deepEqual(result, { loaded: true, shouldResetConditions: true });
        assert.deepEqual(harness.calls.refreshSnapshotArgs, []);
        assert.equal(harness.ui.search.recommendedCache, null);
        assert.equal(harness.ui.search.dataReady, true);
        assert.equal(harness.ui.el.searchBox.disabled, false);
    } finally {
        restoreDom();
    }
});

test("data loader: cache source shows cache status and skips reset when pending state exists", async () => {
    const restoreDom = installFakeDom();
    try {
        const harness = createDataLoaderHarness({
            pendingValues: { fromYear: "2026" }
        });
        const loader = createLoaderWithDataSource({
            initialSnapshot: {
                songs: [createSong("cached-archive::1")],
                source: "cache",
                artifact: {}
            }
        }, harness);

        const result = await loader.loadInitialData();

        assert.equal(harness.data.allSongsRaw.length, 1);
        assert.equal(harness.ui.el.resultCount.innerText, "キャッシュを表示中");
        assert.equal(harness.ui.search.dataReady, true);
        assert.equal(harness.ui.el.searchBox.disabled, false);
        assert.deepEqual(result, { loaded: true, shouldResetConditions: false });
        assert.equal(harness.calls.refreshSnapshotArgs.length, 1);
    } finally {
        restoreDom();
    }
});

test("data loader: background refresh waits for the next search before applying new songs", async () => {
    const restoreDom = installFakeDom();
    try {
        const harness = createDataLoaderHarness();
        let resolveRefresh;
        const refreshPromise = new Promise((resolve) => {
            resolveRefresh = resolve;
        });
        const loader = createLoaderWithDataSource({
            initialSnapshot: {
                songs: [createSong("cached-archive::1")],
                source: "cache",
                artifact: {}
            },
            onRefresh() {
                return refreshPromise;
            }
        }, harness);

        const result = await loader.loadInitialData();

        assert.deepEqual(result, { loaded: true, shouldResetConditions: true });
        assert.equal(harness.data.allSongsRaw[0].songKey, "cached-archive::1");
        assert.equal(harness.data.pendingSongsRaw, null);

        resolveRefresh({
            songs: [createSong("fresh-archive::1")],
            source: "network",
            artifact: {}
        });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(harness.data.pendingSongsRaw[0].songKey, "fresh-archive::1");

        assert.equal(loader.commitPendingSnapshot(), true);

        assert.equal(harness.data.allSongsRaw[0].songKey, "fresh-archive::1");
        assert.equal(harness.data.pendingSongsRaw, null);
        assert.equal(loader.commitPendingSnapshot(), false);
    } finally {
        restoreDom();
    }
});

test("data loader: applying pending songs reconciles the existing recommendation cache", async () => {
    const restoreDom = installFakeDom();
    try {
        const cachedSong = createSong("cached-archive::1");
        const freshSong = {
            ...cachedSong,
            url: "https://www.youtube.com/watch?v=abc123&t=20s",
            endSeconds: 600
        };
        const harness = createDataLoaderHarness();
        let resolveRefresh;
        const loader = createLoaderWithDataSource({
            initialSnapshot: { songs: [cachedSong], source: "cache", artifact: {} },
            onRefresh() {
                return new Promise((resolve) => {
                    resolveRefresh = resolve;
                });
            }
        }, harness);

        await loader.loadInitialData();
        harness.ui.search.recommendedCache = {
            songs: [cachedSong],
            requestedCount: 4
        };
        resolveRefresh({ songs: [freshSong], source: "network", artifact: {} });
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(loader.commitPendingSnapshot(), true);

        assert.deepEqual(harness.ui.search.recommendedCache, {
            songs: [freshSong],
            requestedCount: 1
        });
        assert.equal(harness.ui.search.recommendedCache.songs[0], freshSong);
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
        assert.equal(harness.ui.el.resultCount.innerText, "読込エラー");
        assert.equal(harness.ui.search.dataReady, false);
        assert.equal(harness.ui.el.searchBox.disabled, true);
        assert.deepEqual(result, { loaded: false });
    } finally {
        restoreDom();
    }
});
