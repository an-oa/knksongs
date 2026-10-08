import test from "node:test";
import assert from "node:assert/strict";
import {
    validateSongsDataQuality,
    validateSongYoutubeFields
} from "../app/lib/songs-data-quality.mts";
import {
    buildBookmarkSongKey,
    buildLegacySongKey,
    buildSongKey
} from "../app/lib/song-identity.mts";
import { createSongFixture } from "./fixtures/song.mts";

/**
 * 正常な曲を基に、検証したい項目へ不正値も指定できる入力候補を作成する。
 */
function makeSong(overrides: Partial<Record<keyof Song, unknown>> = {}) {
    const song = {
        ...createSongFixture(),
        archiveId: "archive-1",
        archiveOrder: 1,
        videoId: "7fOw-4QeB7M",
        title: "Song",
        artist: "Artist",
        url: "https://www.youtube.com/watch?v=7fOw-4QeB7M&t=349s",
        endSeconds: 649,
        ...overrides
    };
    return {
        ...song,
        songKey: buildSongKey(song),
        bookmarkSongKey: buildBookmarkSongKey(song),
        legacySongKey: buildLegacySongKey(song)
    };
}

/**
 * 検証用の曲とCSV行番号を対にした候補を作成する。
 */
function makeCandidate(
    overrides: Partial<Record<keyof Song, unknown>> = {},
    csvRowNumber = 2
): import("../app/lib/songs-data-quality.mts").SongDataQualityCandidate {
    return { song: makeSong(overrides), csvRowNumber };
}

test("songs data quality: accepts valid CSV-derived song data", () => {
    assert.deepEqual(validateSongsDataQuality([makeCandidate()]), []);
});

test("songs data quality: rejects invalid YouTube hosts with the CSV row", () => {
    const issues = validateSongsDataQuality([
        makeCandidate({ url: "https://example.com/watch?v=7fOw-4QeB7M&t=349s" })
    ]);
    assert.match(issues.join("\n"), /url host must be a supported YouTube host/);
    assert.match(issues.join("\n"), /CSV 2行目「Song」/);
});

test("songs data quality: requires HTTPS even on supported YouTube hosts", () => {
    for (const protocol of ["http:", "ftp:"]) {
        const issues = validateSongsDataQuality([
            makeCandidate({ url: `${protocol}//www.youtube.com/watch?v=7fOw-4QeB7M&t=349s` }, 27)
        ]);
        assert.match(issues.join("\n"), /CSV 27行目「Song」: url protocol must be https:/);
    }
});

test("songs data quality: uses transient source row numbers after excluded CSV rows", () => {
    const issues = validateSongsDataQuality([
        makeCandidate({ url: "https://example.com/watch?v=7fOw-4QeB7M&t=349s" }, 27)
    ]);

    assert.match(issues.join("\n"), /CSV 27行目「Song」/);
});

test("songs data quality: rejects invalid extracted video IDs", () => {
    const issues: string[] = [];
    validateSongYoutubeFields(
        makeCandidate({ url: "https://www.youtube.com/watch?v=short&t=349s" }),
        0,
        issues
    );
    assert.match(issues.join("\n"), /extracted videoId must match/);
});

test("songs data quality: rejects empty required text fields", () => {
    const issues = validateSongsDataQuality([
        makeCandidate({ title: " ", artist: "", url: "" })
    ]);
    assert.match(issues.join("\n"), /title must not be empty/);
    assert.match(issues.join("\n"), /artist must not be empty/);
    assert.match(issues.join("\n"), /url must not be empty/);
});

test("songs data quality: rejects invalid start seconds from URL", () => {
    const issues = validateSongsDataQuality([
        makeCandidate({ url: "https://youtu.be/7fOw-4QeB7M?t=-1" })
    ]);
    assert.match(issues.join("\n"), /startSeconds must be a finite number/);
});

test("songs data quality: accepts whole-video bounds and rejects invalid end seconds", () => {
    assert.deepEqual(validateSongsDataQuality([makeCandidate({
        url: "https://youtu.be/7fOw-4QeB7M",
        endSeconds: null
    })]), []);
    assert.match(
        validateSongsDataQuality([makeCandidate({ endSeconds: Number.NaN })]).join("\n"),
        /endSeconds must be a finite number/
    );
    assert.match(
        validateSongsDataQuality([makeCandidate({ endSeconds: 100 })]).join("\n"),
        /endSeconds must be greater than startSeconds/
    );
});

test("songs data quality: requires archiveOrder to be an integer", () => {
    const issues = validateSongsDataQuality([makeCandidate({ archiveOrder: null }, 14)]);

    assert.match(issues.join("\n"), /CSV 14行目「Song」: archiveOrder must be an integer/);
});

test("songs data quality: reports both CSV rows for duplicate song identities", () => {
    const issues = validateSongsDataQuality([
        makeCandidate({}, 12),
        makeCandidate({ title: "Retake" }, 27)
    ]);

    assert.match(issues.join("\n"), /CSV 27行目「Retake」: songKey .* duplicates CSV 12行目「Song」/);
    assert.match(issues.join("\n"), /CSV 27行目「Retake」: bookmarkSongKey .* duplicates CSV 12行目「Song」/);
});
