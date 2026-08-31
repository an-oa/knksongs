import test from "node:test";
import assert from "node:assert/strict";
import {
    pickRecommendedSongs,
    pickRecommendedSongsWithCache,
    reconcileRecommendedSearchCache
} from "../_build/app/lib/search-recommendation.mjs";
import { normalizeForSearch } from "../_build/app/lib/search-normalization.mjs";

let autoSongId = 0;

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
        bookmarkSongKey: "upper::2",
        title: "群青",
        artist: "A"
    });
    const rows = [
        upperRow,
        makeRow({
            archiveId: "a1",
            archiveOrder: 2,
            bookmarkSongKey: "lower::2",
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

test("reconcileRecommendedSearchCache: keeps an admitted song after its archive count falls below the threshold", () => {
    const cached = makeRow({
        songKey: "a1::1",
        archiveId: "a1",
        title: "群青",
        artist: "A",
        format: "配信"
    });
    const latestCachedRow = makeRow({
        songKey: "a1::1",
        archiveId: "a1",
        title: "群青",
        artist: "A",
        format: "配信"
    });
    const latestRows = [
        latestCachedRow,
        makeRow({ songKey: "a2::1", archiveId: "a2", title: "群青", artist: "A" })
    ];

    const reconciled = reconcileRecommendedSearchCache(
        latestRows,
        { songs: [cached], requestedCount: 1 },
        { minPerformanceCount: 3 }
    );

    assert.equal(reconciled.songs.length, 1);
    assert.equal(reconciled.songs[0], latestCachedRow);
    assert.equal(reconciled.requestedCount, 1);
});

test("reconcileRecommendedSearchCache: replaces a removed archive with the same admitted song below the threshold", () => {
    const cached = makeRow({
        songKey: "a1::1",
        archiveId: "a1",
        title: "群青",
        artist: "A"
    });
    const sameSongRows = [
        makeRow({ songKey: "a2::1", archiveId: "a2", title: "群青", artist: "A" }),
        makeRow({ songKey: "a3::1", archiveId: "a3", title: "群青", artist: "A" })
    ];
    const otherEligibleRows = [1, 2, 3].map((index) => makeRow({
        songKey: `b${index}::1`,
        archiveId: `b${index}`,
        title: "青空",
        artist: "B"
    }));
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
        const reconciled = reconcileRecommendedSearchCache(
            [...sameSongRows, ...otherEligibleRows],
            { songs: [cached], requestedCount: 1 },
            { minPerformanceCount: 3 }
        );

        assert.equal(reconciled.songs.length, 1);
        assert.equal(reconciled.songs[0].titleNorm, normalizeForSearch("群青"));
        assert.notEqual(reconciled.songs[0].songKey, cached.songKey);
    } finally {
        Math.random = originalRandom;
    }
});

test("reconcileRecommendedSearchCache: replaces only a vanished song group and preserves other slots", () => {
    const cachedA = makeRow({ songKey: "a1::1", archiveId: "a1", title: "消えた曲", artist: "A" });
    const cachedB = makeRow({ songKey: "b1::1", archiveId: "b1", title: "残る曲", artist: "B" });
    const latestB = makeRow({ songKey: "b1::1", archiveId: "b1", title: "残る曲", artist: "B" });
    const replacementRows = [1, 2, 3].map((index) => makeRow({
        songKey: `c${index}::1`,
        archiveId: `c${index}`,
        title: "補充曲",
        artist: "C"
    }));
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
        const reconciled = reconcileRecommendedSearchCache(
            [latestB, ...replacementRows],
            { songs: [cachedA, cachedB], requestedCount: 2 },
            { minPerformanceCount: 3 }
        );

        assert.deepEqual(
            reconciled.songs.map((row) => row.titleNorm),
            [normalizeForSearch("補充曲"), normalizeForSearch("残る曲")]
        );
        assert.equal(reconciled.songs[1], latestB);
    } finally {
        Math.random = originalRandom;
    }
});

test("reconcileRecommendedSearchCache: treats guest-only or missing rows as unavailable", () => {
    const cachedA = makeRow({ songKey: "a1::1", archiveId: "a1", title: "群青", artist: "A" });
    const latestRows = [
        makeRow({
            songKey: "a1::1",
            archiveId: "a1",
            title: "群青",
            artist: "A",
            streamRole: "ゲスト"
        }),
        makeRow({ songKey: "a2::1", archiveId: "a2", title: "群青", artist: "A" })
    ];

    const reconciled = reconcileRecommendedSearchCache(
        latestRows,
        { songs: [cachedA], requestedCount: 1 },
        { minPerformanceCount: 3 }
    );

    assert.equal(reconciled.songs.length, 1);
    assert.equal(reconciled.songs[0].songKey, "a2::1");
});

test("reconcileRecommendedSearchCache: keeps a corrected exact songKey even when its identity fields change", () => {
    const cached = makeRow({ songKey: "a1::1", archiveId: "a1", title: "旧表記", artist: "A" });
    const corrected = makeRow({ songKey: "a1::1", archiveId: "a1", title: "新表記", artist: "A" });

    const reconciled = reconcileRecommendedSearchCache(
        [corrected],
        { songs: [cached], requestedCount: 1 },
        { minPerformanceCount: 3 }
    );

    assert.deepEqual(reconciled.songs, [corrected]);
});

test("reconcileRecommendedSearchCache: reduces the list instead of duplicating when no replacement exists", () => {
    const cached = makeRow({ songKey: "a1::1", archiveId: "a1", title: "消えた曲", artist: "A" });

    const reconciled = reconcileRecommendedSearchCache(
        [],
        { songs: [cached], requestedCount: 1 },
        { minPerformanceCount: 3 }
    );

    assert.deepEqual(reconciled.songs, []);
    assert.equal(reconciled.requestedCount, 0);
});

test("pickRecommendedSongsWithCache: refills a recommendation cache after reconciled slots were missing", () => {
    const cached = makeRow({ songKey: "a1::1", archiveId: "a1", title: "消えた曲", artist: "A" });
    const reconciled = reconcileRecommendedSearchCache(
        [],
        { songs: [cached], requestedCount: 1 },
        { minPerformanceCount: 3 }
    );
    const restoredRows = [1, 2, 3].map((index) => makeRow({
        songKey: `b${index}::1`,
        archiveId: `b${index}`,
        title: "復帰曲",
        artist: "B"
    }));

    const result = pickRecommendedSongsWithCache(restoredRows, {
        count: 1,
        minPerformanceCount: 3,
        currentCache: reconciled
    });

    assert.equal(result.songs.length, 1);
    assert.equal(result.songs[0].titleNorm, normalizeForSearch("復帰曲"));
    assert.equal(result.cache.requestedCount, 1);
});
