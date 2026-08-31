import test from "node:test";
import assert from "node:assert/strict";
import {
    buildSongsJsonMetaPayload,
    buildSongsJsonPayload,
    compareSongsJsonArtifactFreshness,
    parseSongsJsonMetaPayload,
    parseSongsJsonPayload,
    SONGS_JSON_SCHEMA_VERSION
} from "../_build/app/lib/songs-json.mjs";
import { createSongFixture } from "./fixtures/song.mjs";

const GENERATED_AT = "2026-08-14T00:00:00.000Z";

test("songs json: builds and parses current schema payload", () => {
    const songs = [createSongFixture()];
    const contentHash = "sha256:test";
    const payload = buildSongsJsonPayload(songs, contentHash, GENERATED_AT);
    assert.equal(payload.schemaVersion, SONGS_JSON_SCHEMA_VERSION);
    assert.equal(payload.contentHash, contentHash);
    assert.equal(payload.generatedAt, GENERATED_AT);
    assert.equal(payload.songs, songs);
    assert.deepEqual(parseSongsJsonPayload(JSON.stringify(payload)), {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash,
        generatedAt: GENERATED_AT,
        songs
    });
});

test("songs json: accepts nullable date and end fields with empty orientation", () => {
    const song = createSongFixture({
        dateKey: null,
        endSeconds: null,
        videoOrientation: ""
    });
    const payload = buildSongsJsonPayload([song], "sha256:test", GENERATED_AT);

    assert.deepEqual(parseSongsJsonPayload(JSON.stringify(payload)).songs, [song]);
});

test("songs json: rejects songs missing any required field", () => {
    const validSong = createSongFixture();
    for (const fieldName of Object.keys(validSong)) {
        const incompleteSong = { ...validSong };
        delete incompleteSong[fieldName];
        const payload = {
            schemaVersion: SONGS_JSON_SCHEMA_VERSION,
            contentHash: "sha256:test",
            generatedAt: GENERATED_AT,
            songs: [incompleteSong]
        };

        assert.throws(
            () => parseSongsJsonPayload(JSON.stringify(payload)),
            new RegExp(`songs\\[0\\]\\.${fieldName} is required`),
            fieldName
        );
    }
});

test("songs json: rejects non-object songs and invalid field types", () => {
    const cases = [
        [null, /songs\[0\] must be an object/],
        [createSongFixture({ title: 42 }), /songs\[0\]\.title must be a string/],
        [createSongFixture({ dateKey: "20260311" }), /songs\[0\]\.dateKey must be a finite number or null/],
        [createSongFixture({ archiveOrder: null }), /songs\[0\]\.archiveOrder must be an integer/],
        [createSongFixture({ isRelay: 0 }), /songs\[0\]\.isRelay must be a boolean/],
        [createSongFixture({ videoOrientation: "square" }), /songs\[0\]\.videoOrientation must be one of/]
    ];

    for (const [song, expected] of cases) {
        const payload = {
            schemaVersion: SONGS_JSON_SCHEMA_VERSION,
            contentHash: "sha256:test",
            generatedAt: GENERATED_AT,
            songs: [song]
        };
        assert.throws(() => parseSongsJsonPayload(JSON.stringify(payload)), expected);
    }
});

test("songs json: rejects fields outside the current Song schema", () => {
    const payload = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: "sha256:test",
        generatedAt: GENERATED_AT,
        songs: [{ ...createSongFixture(), sourceIndex: 12 }]
    };

    assert.throws(
        () => parseSongsJsonPayload(JSON.stringify(payload)),
        /songs\[0\]\.sourceIndex is not allowed/
    );
});

test("songs json: rejects duplicate song and bookmark keys", () => {
    const first = createSongFixture();
    const duplicateSongKey = createSongFixture({
        videoId: "xyz123def45",
        bookmarkSongKey: "xyz123def45::1",
        title: "Retake"
    });
    const duplicateBookmarkKey = createSongFixture({
        archiveId: "archive-2",
        songKey: "archive-2::1",
        legacySongKey: "archive-2::1::https://www.youtube.com/watch?v=abc123def45&t=10s"
    });

    assert.throws(
        () => buildSongsJsonPayload([first, duplicateSongKey], "sha256:test", GENERATED_AT),
        /songs\[1\]\.songKey .* duplicates .*songs\[0\]\.songKey/
    );
    assert.throws(
        () => buildSongsJsonPayload([first, duplicateBookmarkKey], "sha256:test", GENERATED_AT),
        /songs\[1\]\.bookmarkSongKey .* duplicates .*songs\[0\]\.bookmarkSongKey/
    );
});

test("songs json: builder rejects structurally incomplete songs", () => {
    assert.throws(
        () => buildSongsJsonPayload(
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
    const older = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: "sha256:same",
        generatedAt: "2026-08-13T00:00:00.000Z"
    };
    const newer = {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: "sha256:same",
        generatedAt: "2026-08-15T00:00:00.000Z"
    };

    assert.equal(compareSongsJsonArtifactFreshness(older, newer), "same-content");
});

test("songs json: compares generated timestamps only for mismatched hashes", () => {
    const reference = {
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
