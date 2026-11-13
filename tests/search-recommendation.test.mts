import test from "node:test";
import assert from "node:assert/strict";
import {
    pickRecommendedSongs,
    pickRecommendedSongsWithCache
} from "../app/lib/search-recommendation.mts";
import { normalizeForSearch } from "../app/lib/search-normalization.mts";
import { createSearchSongFixtureFactory } from "./fixtures/search-song.mts";

const makeRow = createSearchSongFixtureFactory();

test("pickRecommendedSongs: prefers 歌みた rows over 配信 and ショート for the same song", () => {
    const rows = [
        makeRow({ archiveId: "a1", title: "群青", artist: "A", format: "配信" }),
        makeRow({ archiveId: "a2", title: "群青", artist: "A", format: "ショート" }),
        makeRow({ archiveId: "a3", title: "群青", artist: "A", format: "歌みた" })
    ];

    const picked = pickRecommendedSongs(rows, { count: 10, minPerformanceCount: 2 });

    assert.equal(picked.length, 1);
    assert.equal(picked[0].format, "歌みた");
});

test("pickRecommendedSongs: excludes ゲスト rows from recommendation candidates", () => {
    const rows = [
        makeRow({ archiveId: "a1", title: "群青", artist: "A", format: "配信", streamRole: "ゲスト" }),
        makeRow({ archiveId: "a2", title: "群青", artist: "A", format: "配信", streamRole: "ゲスト" }),
        makeRow({ archiveId: "a3", title: "群青", artist: "A", format: "配信", streamRole: "ゲスト" }),
        makeRow({ archiveId: "a4", title: "青空", artist: "B", format: "配信" }),
        makeRow({ archiveId: "a5", title: "青空", artist: "B", format: "配信" })
    ];

    const picked = pickRecommendedSongs(rows, { count: 10, minPerformanceCount: 2 });

    assert.equal(picked.length, 1);
    assert.equal(picked[0].titleNorm, normalizeForSearch("青空"));
    assert.notEqual(picked[0].streamRole, "ゲスト");
});

test("pickRecommendedSongs: keeps the latest row within the same archive", () => {
    const rows = [
        makeRow({ archiveId: "a1", archiveOrder: 1, title: "群青", artist: "A", format: "配信" }),
        makeRow({ archiveId: "a1", archiveOrder: 2, title: "群青", artist: "A", format: "配信" }),
        makeRow({ archiveId: "a2", archiveOrder: 1, title: "群青", artist: "A", format: "配信" })
    ];
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
        const picked = pickRecommendedSongs(rows, { count: 10, minPerformanceCount: 2 });

        assert.equal(picked.length, 1);
        assert.equal(picked[0].archiveId, "a1");
        assert.equal(picked[0].archiveOrder, 2);
    } finally {
        Math.random = originalRandom;
    }
});

test("pickRecommendedSongs: keeps the upper CSV row when archive order is duplicated", () => {
    const upperRow = makeRow({
        archiveId: "a1",
        archiveOrder: 2,
        songKey: "upper::2",
        title: "群青",
        artist: "A"
    });
    const rows = [
        upperRow,
        makeRow({
            archiveId: "a1",
            archiveOrder: 2,
            songKey: "lower::2",
            title: "群青",
            artist: "A"
        }),
        makeRow({ archiveId: "a2", archiveOrder: 1, title: "群青", artist: "A" })
    ];
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
        const picked = pickRecommendedSongs(rows, { count: 10, minPerformanceCount: 2 });

        assert.equal(picked[0], upperRow);
    } finally {
        Math.random = originalRandom;
    }
});

test("pickRecommendedSongsWithCache: fills an empty recommendation cache", () => {
    const restoredRows = [1, 2, 3].map((index) => makeRow({
        songKey: `b${index}::1`,
        archiveId: `b${index}`,
        title: "復帰曲",
        artist: "B"
    }));

    const result = pickRecommendedSongsWithCache(restoredRows, {
        count: 1,
        minPerformanceCount: 3,
        currentCache: { songs: [], requestedCount: 0 }
    });

    assert.equal(result.songs.length, 1);
    assert.equal(result.songs[0].titleNorm, normalizeForSearch("復帰曲"));
    assert.equal(result.cache.requestedCount, 1);
});
