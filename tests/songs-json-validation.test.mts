import test from "node:test";
import assert from "node:assert/strict";
import {
    buildSongsJsonDocument,
    buildSongsJsonMetaPayload
} from "../app/lib/songs-json.mts";
import type { SongsJsonDocument } from "../app/lib/songs-json.mts";
import { createSongsContentHash } from "../scripts/songs-content-hash.mts";
import { validateSongsJsonArtifacts } from "../scripts/songs-json-artifact.mts";
import { createSongFixture } from "./fixtures/song.mts";

const GENERATED_AT = "2026-08-14T00:00:00.000Z";

/**
 * JSON成果物検証用のsongs.jsonとsongs-meta.jsonを作る。
 */
function makeArtifacts(songs: Song[]) {
    const contentHash = createSongsContentHash(songs);
    return {
        songsJson: JSON.stringify(buildSongsJsonDocument(songs, contentHash, GENERATED_AT)),
        metaJson: JSON.stringify(buildSongsJsonMetaPayload(contentHash, GENERATED_AT)),
        contentHash
    };
}

test("songs json artifacts: accept matching derived files", () => {
    const artifacts = makeArtifacts([createSongFixture()]);
    assert.equal(validateSongsJsonArtifacts(artifacts.songsJson, artifacts.metaJson), 1);
});

test("songs json artifacts: reject mismatched metadata hashes", () => {
    const artifacts = makeArtifacts([createSongFixture()]);
    const mismatchedMeta = JSON.stringify(buildSongsJsonMetaPayload(
        "sha256:different",
        GENERATED_AT
    ));
    assert.throws(
        () => validateSongsJsonArtifacts(artifacts.songsJson, mismatchedMeta),
        /songs\.json and songs-meta\.json contentHash values must match/
    );
});

test("songs json artifacts: reject hashes that do not represent the songs array", () => {
    const contentHash = "sha256:not-the-song-content";
    const songsJson = JSON.stringify(buildSongsJsonDocument(
        [createSongFixture()],
        contentHash,
        GENERATED_AT
    ));
    const metaJson = JSON.stringify(buildSongsJsonMetaPayload(contentHash, GENERATED_AT));
    assert.throws(
        () => validateSongsJsonArtifacts(songsJson, metaJson),
        /contentHash must match the serialized songs array/
    );
});

test("songs json artifacts: reject structurally incomplete tables even when hashes match", () => {
    const artifacts = makeArtifacts([createSongFixture()]);
    const document: { songs: Partial<SongsJsonDocument["songs"][number]>[] } = JSON.parse(artifacts.songsJson);
    delete document.songs[0].date;

    assert.throws(
        () => validateSongsJsonArtifacts(JSON.stringify(document), artifacts.metaJson),
        /songs\[0\]\.date is required/
    );
});

test("songs json artifacts: reject tables that are not split the generated way", () => {
    const first = createSongFixture();
    const resung = createSongFixture({
        date: "2026/04/01",
        dateKey: 20260401,
        archiveId: "archive-2",
        videoId: "xyz123def45",
        songKey: "xyz123def45::1",
        url: "https://www.youtube.com/watch?v=xyz123def45&t=20s"
    });
    const other = createSongFixture({
        archiveOrder: 2,
        songKey: "abc123def45::2",
        title: "Other",
        titleNorm: "other",
        url: "https://www.youtube.com/watch?v=abc123def45&t=300s"
    });
    const artifacts = makeArtifacts([resung, other, first]);
    const document: SongsJsonDocument = JSON.parse(artifacts.songsJson);
    assert.deepEqual(document.songInfos.map((songInfo) => songInfo.songInfoKey), [first.songKey, other.songKey]);
    const [firstInfo, otherInfo] = document.songInfos;
    const rejects = (changed: Partial<SongsJsonDocument>, message: string) => assert.throws(
        () => validateSongsJsonArtifacts(JSON.stringify({ ...document, ...changed }), artifacts.metaJson),
        /songInfos and songs must match the tables generated from the joined songs/,
        message
    );

    // どれも曲行へは戻せて、戻した内容の hash も合う。分け方だけが生成規則と違う。
    rejects({ songInfos: [otherInfo, firstInfo] }, "the song infos are not in the order of the first singing");
    rejects({
        songInfos: [...document.songInfos, { ...firstInfo, songInfoKey: "unused00000::1", title: "Unused" }]
    }, "a song info is not used by any song");
    rejects({
        songInfos: [{ ...firstInfo, songInfoKey: resung.songKey }, otherInfo],
        songs: document.songs.map((row) => (
            row.songInfoKey === first.songKey ? { ...row, songInfoKey: resung.songKey } : row
        ))
    }, "the key is not the first singing");
    rejects({
        songInfos: [...document.songInfos, { ...firstInfo, songInfoKey: resung.songKey }],
        songs: document.songs.map((row) => (
            row.songKey === resung.songKey ? { ...row, songInfoKey: resung.songKey } : row
        ))
    }, "the same song info is written twice");
    assert.equal(validateSongsJsonArtifacts(artifacts.songsJson, artifacts.metaJson), 3);
});

test("songs json artifacts: reject unsupported schemas in either derived file", () => {
    const artifacts = makeArtifacts([]);
    const invalidMeta = JSON.stringify({
        schemaVersion: 999,
        contentHash: artifacts.contentHash,
        generatedAt: GENERATED_AT
    });
    assert.throws(
        () => validateSongsJsonArtifacts(artifacts.songsJson, invalidMeta),
        /unsupported songs json schema/
    );
});

test("songs json artifacts: reject mismatched generated timestamps", () => {
    const songs = [createSongFixture()];
    const contentHash = createSongsContentHash(songs);
    const songsJson = JSON.stringify(buildSongsJsonDocument(songs, contentHash, GENERATED_AT));
    const metaJson = JSON.stringify(buildSongsJsonMetaPayload(
        contentHash,
        "2026-08-15T00:00:00.000Z"
    ));

    assert.throws(
        () => validateSongsJsonArtifacts(songsJson, metaJson),
        /generatedAt values must match/
    );
});

test("songs json artifacts: reject older schemas", () => {
    const songs = [createSongFixture()];
    const contentHash = createSongsContentHash(songs);
    const songsJson = JSON.stringify({ schemaVersion: 1, contentHash, songs });
    const metaJson = JSON.stringify({ schemaVersion: 1, contentHash });

    assert.throws(
        () => validateSongsJsonArtifacts(songsJson, metaJson),
        /unsupported songs json schema/
    );
});
