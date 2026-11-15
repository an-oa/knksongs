import test from "node:test";
import assert from "node:assert/strict";
import {
    buildSongsJsonDocument,
    buildSongsJsonMetaPayload,
    compareSongsJsonArtifactFreshness,
    parseSongsJsonMetaPayload,
    parseSongsJsonPayload,
    SONGS_JSON_SCHEMA_VERSION,
    toSongsJsonDocument
} from "../app/lib/songs-json.mts";
import type { SongsJsonDocument } from "../app/lib/songs-json.mts";
import { splitSongInfoTables } from "../app/lib/song-info-tables.mts";
import { createSongFixture } from "./fixtures/song.mts";

const GENERATED_AT = "2026-08-14T00:00:00.000Z";

/**
 * 曲行を検証せずに、songs.json に書く形にする。
 * 読み込みが不正な内容を拒否することを確かめるテストで、検証する builder を通さずに不正な内容を作るために使う。
 * @param songs 曲行。不正な値を含んでよい
 * @returns songs.json に書く形
 */
function createUnvalidatedDocument(songs: Song[]): SongsJsonDocument {
    return {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: "sha256:test",
        generatedAt: GENERATED_AT,
        ...splitSongInfoTables(songs)
    };
}

test("songs json: builds two tables and parses them back into the same songs", () => {
    const first = createSongFixture();
    const resung = createSongFixture({
        date: "2026/04/01",
        dateKey: 20260401,
        archiveId: "archive-2",
        videoId: "xyz123def45",
        songKey: "xyz123def45::1",
        url: "https://www.youtube.com/watch?v=xyz123def45&t=20s"
    });
    // 曲行は新しい順に並ぶ。
    const songs = [resung, first];
    const contentHash = "sha256:test";
    const document = buildSongsJsonDocument(songs, contentHash, GENERATED_AT);
    assert.equal(document.schemaVersion, SONGS_JSON_SCHEMA_VERSION);
    assert.equal(document.contentHash, contentHash);
    assert.equal(document.generatedAt, GENERATED_AT);
    // 同じ曲の情報は 1 行にまとまり、曲行は曲名などを持たずにキーで指す。
    assert.deepEqual(document.songInfos.map((songInfo) => [songInfo.songInfoKey, songInfo.title]), [[first.songKey, "KING"]]);
    assert.deepEqual(document.songs.map((row) => [row.songKey, row.songInfoKey]), [
        [resung.songKey, first.songKey],
        [first.songKey, first.songKey]
    ]);
    assert.ok(!("title" in document.songs[0]));

    const parsed = parseSongsJsonPayload(JSON.stringify(document));
    assert.deepEqual(parsed, {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash,
        generatedAt: GENERATED_AT,
        songs
    });
    // contentHash は曲行の配列を文字列にして計算するので、項目の順番まで同じに戻す。
    assert.equal(JSON.stringify(parsed.songs), JSON.stringify(songs));
    assert.deepEqual(toSongsJsonDocument(parsed), document);
});

test("songs json: accepts nullable date and end fields with empty orientation", () => {
    const song = createSongFixture({
        dateKey: null,
        endSeconds: null,
        videoOrientation: ""
    });
    const document = buildSongsJsonDocument([song], "sha256:test", GENERATED_AT);

    assert.deepEqual(parseSongsJsonPayload(JSON.stringify(document)).songs, [song]);
});

test("songs json: accepts supported HTTPS YouTube URL forms", () => {
    for (const url of [
        "https://youtube.com/watch?v=abc123def45",
        "https://www.youtube.com/watch?v=abc123def45&t=10s",
        "https://m.youtube.com/watch?v=abc123def45&start=10",
        "https://youtu.be/abc123def45?t=10s",
        "https://www.youtube.com/shorts/abc123def45",
        "https://www.youtube.com/live/abc123def45"
    ]) {
        const song = createSongFixture({ url });
        const document = buildSongsJsonDocument([song], "sha256:test", GENERATED_AT);
        assert.deepEqual(parseSongsJsonPayload(JSON.stringify(document)).songs, [song], url);
    }
});

test("songs json: rejects unsafe protocols and unsupported YouTube hosts", () => {
    const cases: [url: string, expected: RegExp][] = [
        ["javascript:alert(1)", /url protocol must be https:/],
        ["data:text/html,<script>alert(1)</script>", /url protocol must be https:/],
        ["http://www.youtube.com/watch?v=abc123def45", /url protocol must be https:/],
        ["ftp://www.youtube.com/watch?v=abc123def45", /url protocol must be https:/],
        ["https://youtube.com.evil.example/watch?v=abc123def45", /url host must be a supported YouTube host/],
        ["https://www.youtube.com@evil.example/watch?v=abc123def45", /url host must be a supported YouTube host/],
        ["//www.youtube.com/watch?v=abc123def45", /url must be an absolute https: YouTube URL/]
    ];
    for (const [url, expected] of cases) {
        const song = createSongFixture({ url });
        const document = createUnvalidatedDocument([song]);
        assert.throws(() => parseSongsJsonPayload(JSON.stringify(document)), expected, url);
        assert.throws(() => buildSongsJsonDocument([song], "sha256:test", GENERATED_AT), expected, url);
    }
});

test("songs json: rejects invalid URL video IDs and negative start seconds", () => {
    const cases: [url: string, expected: RegExp][] = [
        ["https://www.youtube.com/watch?v=short", /extracted videoId must match/],
        ["https://youtu.be/abc123def45/extra", /extracted videoId must match/],
        ["https://www.youtube.com/watch?v=abc123def45&t=-1", /startSeconds must be a finite number/]
    ];
    for (const [url, expected] of cases) {
        const document = createUnvalidatedDocument([createSongFixture({ url })]);
        assert.throws(() => parseSongsJsonPayload(JSON.stringify(document)), expected, url);
    }
});

test("songs json: rejects stored video IDs that disagree with the URL", () => {
    const document = createUnvalidatedDocument([
        createSongFixture({ videoId: "xyz123def45", songKey: "xyz123def45::1" })
    ]);
    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify(document)),
        /songs\[0\]\.videoId must equal the videoId extracted from url/
    );
});

test("songs json: rejects table rows and songs missing any required field", () => {
    const document = createUnvalidatedDocument([createSongFixture()]);
    for (const table of ["songInfos", "songs"] as const) {
        for (const fieldName of Object.keys(document[table][0])) {
            const incompleteEntry: Record<string, unknown> = { ...document[table][0] };
            delete incompleteEntry[fieldName];

            assert.throws(
                () => parseSongsJsonPayload(JSON.stringify({ ...document, [table]: [incompleteEntry] })),
                new RegExp(`${table}\\[0\\]\\.${fieldName} is required`),
                `${table}.${fieldName}`
            );
        }
    }

    // JSON を書く前の曲行も、全項目を持つことを確かめる。
    const validSong = createSongFixture();
    for (const fieldName of Object.keys(validSong)) {
        const incompleteSong: Record<string, unknown> = { ...validSong };
        delete incompleteSong[fieldName];

        assert.throws(
            () => buildSongsJsonDocument([incompleteSong], "sha256:test", GENERATED_AT),
            new RegExp(`songs\\[0\\]\\.${fieldName} is required`),
            fieldName
        );
    }
});

test("songs json: rejects non-object table rows and invalid field types", () => {
    const document = createUnvalidatedDocument([createSongFixture()]);
    const [songInfo] = document.songInfos;
    const [row] = document.songs;
    const cases: [tables: { songInfos?: unknown[]; songs?: unknown[] }, expected: RegExp][] = [
        [{ songs: [null] }, /songs\[0\] must be an object/],
        [{ songInfos: [null] }, /songInfos\[0\] must be an object/],
        [{ songInfos: [{ ...songInfo, title: 42 }] }, /songInfos\[0\]\.title must be a string/],
        [{ songInfos: [{ ...songInfo, songInfoKey: 1 }] }, /songInfos\[0\]\.songInfoKey must be a string/],
        [{ songs: [{ ...row, songInfoKey: null }] }, /songs\[0\]\.songInfoKey must be a string/],
        [{ songs: [{ ...row, dateKey: "20260311" }] }, /songs\[0\]\.dateKey must be a finite number or null/],
        [{ songs: [{ ...row, archiveOrder: null }] }, /songs\[0\]\.archiveOrder must be an integer/],
        [{ songs: [{ ...row, isRelay: 0 }] }, /songs\[0\]\.isRelay must be a boolean/],
        [{ songs: [{ ...row, videoOrientation: "square" }] }, /songs\[0\]\.videoOrientation must be one of/]
    ];

    for (const [tables, expected] of cases) {
        assert.throws(() => parseSongsJsonPayload(JSON.stringify({ ...document, ...tables })), expected);
    }
});

test("songs json: rejects fields outside the current table schemas", () => {
    const document = createUnvalidatedDocument([createSongFixture()]);

    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify({ ...document, songs: [{ ...document.songs[0], sourceIndex: 12 }] })),
        /songs\[0\]\.sourceIndex is not allowed/
    );
    // 曲の情報は曲の情報の表にだけ書ける。曲行に残っていれば、表に分ける前の形として拒否する。
    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify({ ...document, songs: [{ ...document.songs[0], title: "KING" }] })),
        /songs\[0\]\.title is not allowed/
    );
    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify({ ...document, songInfos: [{ ...document.songInfos[0], url: "" }] })),
        /songInfos\[0\]\.url is not allowed/
    );
});

test("songs json: rejects payloads without either table", () => {
    const document = createUnvalidatedDocument([createSongFixture()]);

    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify({ ...document, songInfos: undefined })),
        /requires a songInfos array/
    );
    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify({ ...document, songs: undefined })),
        /requires a songs array/
    );
});

test("songs json: rejects tables that cannot be joined back into songs", () => {
    const document = createUnvalidatedDocument([createSongFixture()]);
    const [songInfo] = document.songInfos;

    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify({ ...document, songInfos: [] })),
        /songs\[0\]\.songInfoKey "abc123def45::1" is not in songInfos/
    );
    // 同じキーの行が 2 つあると、曲行がどちらを指すのかが決まらない。
    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify({ ...document, songInfos: [songInfo, { ...songInfo, title: "Other" }] })),
        /songInfos\[1\]\.songInfoKey "abc123def45::1" duplicates .*songInfos\[0\]\.songInfoKey/
    );
});

test("songs json: reads tables that can be joined even when they are not split the generated way", () => {
    const song = createSongFixture();
    const document = createUnvalidatedDocument([song]);
    // どの曲行からも指されない行。表示には困らないので読み込みは受け付け、生成した成果物の検証で拒否する。
    const unused = { ...document.songInfos[0], songInfoKey: "unused00000::1", title: "Unused" };

    assert.deepEqual(
        parseSongsJsonPayload(JSON.stringify({ ...document, songInfos: [...document.songInfos, unused] })).songs,
        [song]
    );
});

test("songs json: rejects duplicate song keys and duplicate archive positions", () => {
    const first = createSongFixture();
    // 同じ動画の同じ歌唱順。アーカイブが違っても、曲キーが重なる。
    const duplicateSongKey = createSongFixture({
        archiveId: "archive-2",
        title: "Retake"
    });
    // 同じアーカイブの同じ歌唱順。動画が違うので、曲キーは重ならない。
    const duplicateArchiveOrder = createSongFixture({
        videoId: "xyz123def45",
        songKey: "xyz123def45::1",
        url: "https://www.youtube.com/watch?v=xyz123def45&t=10s"
    });

    assert.throws(
        () => buildSongsJsonDocument([first, duplicateSongKey], "sha256:test", GENERATED_AT),
        /songs\[1\]\.songKey "abc123def45::1" duplicates .*songs\[0\]\.songKey/
    );
    assert.throws(
        () => buildSongsJsonDocument([first, duplicateArchiveOrder], "sha256:test", GENERATED_AT),
        /songs\[1\] archiveId and archiveOrder "archive-1::1" duplicate .*songs\[0\]/
    );
});

test("songs json: rejects unknown keys even when the field count matches", () => {
    for (const unknownField of ["sourceIndex", "constructor", "__proto__"]) {
        const song: Partial<Song> = createSongFixture();
        delete song.title;
        Object.defineProperty(song, unknownField, { value: "unexpected", enumerable: true });
        assert.throws(
            () => buildSongsJsonDocument([song], "sha256:test", GENERATED_AT),
            new RegExp(`songs\\[0\\]\\.${unknownField} is not allowed`)
        );
    }
});

test("songs json: required fields must be own properties regardless of their prototype", () => {
    const song: Partial<Song> = createSongFixture();
    delete song.title;
    Object.setPrototypeOf(song, { title: "Inherited title" });
    assert.throws(
        () => buildSongsJsonDocument([song], "sha256:test", GENERATED_AT),
        /songs\[0\]\.title is required/
    );
});

test("songs json: validates each field type regardless of property order", () => {
    const song = createSongFixture();
    const reversedSong = Object.fromEntries(Object.entries(song).reverse());
    const document = buildSongsJsonDocument([reversedSong], "sha256:test", GENERATED_AT);
    // 入力の項目の順番によらず、読み込んだ曲行の項目は決まった順番になる。
    assert.equal(JSON.stringify(parseSongsJsonPayload(JSON.stringify(document)).songs), JSON.stringify([song]));
    for (const field of Object.keys(song)) {
        assert.throws(
            () => buildSongsJsonDocument([{ ...reversedSong, [field]: {} }], "sha256:test", GENERATED_AT),
            new RegExp(`songs\\[0\\]\\.${field} must be`)
        );
    }
});

test("songs json: builder rejects structurally incomplete songs", () => {
    assert.throws(
        () => buildSongsJsonDocument(
            [{ songKey: "archive-1::1" }],
            "sha256:test",
            GENERATED_AT
        ),
        /songs\[0\]\.date is required/
    );
});

test("songs json: builds and parses meta payload", () => {
    const contentHash = "sha256:test";
    const payload = buildSongsJsonMetaPayload(contentHash, GENERATED_AT);
    assert.equal(payload.schemaVersion, SONGS_JSON_SCHEMA_VERSION);
    assert.equal(payload.contentHash, contentHash);
    assert.equal(payload.generatedAt, GENERATED_AT);
    assert.deepEqual(parseSongsJsonMetaPayload(JSON.stringify(payload)), {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash,
        generatedAt: GENERATED_AT
    });
});

test("songs json: rejects payload and meta from older schema versions", () => {
    const legacyPayload = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION - 1,
        contentHash: "sha256:legacy",
        generatedAt: GENERATED_AT,
        songs: [createSongFixture()]
    };

    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify(legacyPayload)),
        /unsupported songs json schema/
    );
    assert.throws(
        () => parseSongsJsonMetaPayload(JSON.stringify(legacyPayload)),
        /unsupported songs json schema/
    );
});

test("songs json: compares hashes before generated timestamps", () => {
    const older: import("../app/lib/songs-json.mts").SongsJsonArtifactMetadata = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: "sha256:same",
        generatedAt: "2026-08-13T00:00:00.000Z"
    };
    const newer: import("../app/lib/songs-json.mts").SongsJsonArtifactMetadata = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: "sha256:same",
        generatedAt: "2026-08-15T00:00:00.000Z"
    };

    assert.equal(compareSongsJsonArtifactFreshness(older, newer), "same-content");
});

test("songs json: compares generated timestamps only for mismatched hashes", () => {
    const reference: import("../app/lib/songs-json.mts").SongsJsonArtifactMetadata = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: "sha256:reference",
        generatedAt: GENERATED_AT
    };

    assert.equal(compareSongsJsonArtifactFreshness({
        ...reference,
        contentHash: "sha256:newer",
        generatedAt: "2026-08-15T00:00:00.000Z"
    }, reference), "candidate-newer");
    assert.equal(compareSongsJsonArtifactFreshness({
        ...reference,
        contentHash: "sha256:older",
        generatedAt: "2026-08-13T00:00:00.000Z"
    }, reference), "candidate-older");
    assert.equal(compareSongsJsonArtifactFreshness({
        ...reference,
        contentHash: "sha256:conflict"
    }, reference), "incomparable");
});

test("songs json: rejects unsupported schema versions", () => {
    const payload = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION + 1,
        contentHash: "sha256:test",
        songs: []
    };
    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify(payload)),
        /unsupported songs json schema/
    );
});

test("songs json: rejects unwrapped arrays", () => {
    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify([])),
        /payload must be an object/
    );
});

test("songs json: rejects payloads without content hash", () => {
    const payload = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        generatedAt: GENERATED_AT,
        songs: []
    };
    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify(payload)),
        /requires a contentHash/
    );
});

test("songs json: rejects missing or non-canonical generated timestamps", () => {
    for (const generatedAt of [undefined, "2026-08-14", "2026-08-14T09:00:00+09:00"]) {
        const payload = {
            schemaVersion: SONGS_JSON_SCHEMA_VERSION,
            contentHash: "sha256:test",
            generatedAt,
            songs: []
        };
        assert.throws(
            () => parseSongsJsonPayload(JSON.stringify(payload)),
            /generatedAt/
        );
    }
});
