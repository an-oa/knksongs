import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSongsJson } from "../scripts/build-songs-json.mts";
import { validateSongsJsonArtifacts } from "../scripts/songs-json-artifact.mts";
import {
    parseSongsJsonMetaPayload,
    parseSongsJsonPayload,
    SONGS_JSON_SCHEMA_VERSION
} from "../app/lib/songs-json.mts";
import type { SongsJsonDocument } from "../app/lib/songs-json.mts";

/**
 * JSON生成スクリプト用のローカルCSVを作る。
 */
function makeCsv(url: string): string {
    return [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        `1,2026/03/11,,横,全体,歌みた,,,1,Song,Artist,ソング,アーティスト,${url},,`
    ].join("\n");
}

test("songs json build: validates CSV-derived songs before replacing either artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "knksongs-build-json-"));
    const inputPath = join(directory, "songs.csv");
    const outputPath = join(directory, "songs.json");
    const metaOutputPath = join(directory, "songs-meta.json");
    try {
        await Promise.all([
            writeFile(inputPath, makeCsv("https://example.com/watch?v=abc123def45"), "utf8"),
            writeFile(outputPath, "existing songs", "utf8"),
            writeFile(metaOutputPath, "existing meta", "utf8")
        ]);

        await assert.rejects(
            buildSongsJson({ inputPath, outputPath, metaOutputPath, sourceUrl: "" }),
            /CSV song data validation failed/
        );
        assert.equal(await readFile(outputPath, "utf8"), "existing songs");
        assert.equal(await readFile(metaOutputPath, "utf8"), "existing meta");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("songs json build: writes matching derived artifacts after CSV validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "knksongs-build-json-"));
    const inputPath = join(directory, "songs.csv");
    const outputPath = join(directory, "songs.json");
    const metaOutputPath = join(directory, "songs-meta.json");
    try {
        await writeFile(
            inputPath,
            makeCsv("https://www.youtube.com/watch?v=abc123def45"),
            "utf8"
        );

        assert.equal(await buildSongsJson({
            inputPath,
            outputPath,
            metaOutputPath,
            sourceUrl: "",
            now: () => new Date("2026-08-14T00:00:00.000Z")
        }), 1);
        const [songsJsonText, songsMetaJsonText] = await Promise.all([
            readFile(outputPath, "utf8"),
            readFile(metaOutputPath, "utf8")
        ]);
        assert.equal(validateSongsJsonArtifacts(songsJsonText, songsMetaJsonText), 1);
        const songsPayload = parseSongsJsonPayload(songsJsonText);
        const metaPayload = parseSongsJsonMetaPayload(songsMetaJsonText);
        assert.equal(songsPayload.schemaVersion, SONGS_JSON_SCHEMA_VERSION);
        assert.equal(songsPayload.generatedAt, "2026-08-14T00:00:00.000Z");
        assert.equal(metaPayload.generatedAt, songsPayload.generatedAt);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("songs json build: writes the song info of a song sung in several streams once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "knksongs-build-json-"));
    const inputPath = join(directory, "songs.csv");
    const outputPath = join(directory, "songs.json");
    const metaOutputPath = join(directory, "songs-meta.json");
    try {
        // シートは新しい配信が上。同じ曲を 2 本の配信で歌い、新しい配信では別の曲も歌っている。
        await writeFile(inputPath, [
            "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
            "2,2026/04/01,,横,全体,配信,,,1,Other,Artist,アザー,アーティスト,https://www.youtube.com/watch?v=newer000001&t=10s,,",
            "2,2026/04/01,,横,全体,配信,,,2,Song,Artist,ソング,アーティスト,https://www.youtube.com/watch?v=newer000001&t=300s,,",
            "1,2026/03/11,,横,全体,配信,,,1,Song,Artist,ソング,アーティスト,https://www.youtube.com/watch?v=older000001&t=10s,,"
        ].join("\n"), "utf8");

        assert.equal(await buildSongsJson({ inputPath, outputPath, metaOutputPath, sourceUrl: "" }), 3);
        const songsJsonText = await readFile(outputPath, "utf8");
        const written: SongsJsonDocument = JSON.parse(songsJsonText);
        // 曲の情報の表は最初に歌われた順で、キーはその曲を最初に歌った曲行の songKey。
        assert.deepEqual(written.songInfos.map((songInfo) => [songInfo.songInfoKey, songInfo.title]), [
            ["older000001::1", "Song"],
            ["newer000001::1", "Other"]
        ]);
        // 曲行の表はシートの行順のままで、曲名などは持たない。
        assert.deepEqual(written.songs.map((row) => [row.songKey, row.songInfoKey]), [
            ["newer000001::1", "newer000001::1"],
            ["newer000001::2", "older000001::1"],
            ["older000001::1", "older000001::1"]
        ]);
        assert.ok(!("title" in written.songs[0]));
        assert.deepEqual(parseSongsJsonPayload(songsJsonText).songs.map((song) => song.title), ["Other", "Song", "Song"]);
        assert.equal(validateSongsJsonArtifacts(songsJsonText, await readFile(metaOutputPath, "utf8")), 3);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("songs json build: preserves generatedAt until the content hash changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "knksongs-build-json-"));
    const inputPath = join(directory, "songs.csv");
    const outputPath = join(directory, "songs.json");
    const metaOutputPath = join(directory, "songs-meta.json");
    try {
        await writeFile(
            inputPath,
            makeCsv("https://www.youtube.com/watch?v=abc123def45"),
            "utf8"
        );
        await buildSongsJson({
            inputPath,
            outputPath,
            metaOutputPath,
            sourceUrl: "",
            now: () => new Date("2026-08-14T00:00:00.000Z")
        });
        await buildSongsJson({
            inputPath,
            outputPath,
            metaOutputPath,
            sourceUrl: "",
            now: () => new Date("2026-08-15T00:00:00.000Z")
        });
        const unchangedMeta = parseSongsJsonMetaPayload(await readFile(metaOutputPath, "utf8"));
        assert.equal(unchangedMeta.generatedAt, "2026-08-14T00:00:00.000Z");

        await writeFile(
            inputPath,
            makeCsv("https://www.youtube.com/watch?v=different01"),
            "utf8"
        );
        await buildSongsJson({
            inputPath,
            outputPath,
            metaOutputPath,
            sourceUrl: "",
            now: () => new Date("2026-08-16T00:00:00.000Z")
        });
        const changedMeta = parseSongsJsonMetaPayload(await readFile(metaOutputPath, "utf8"));
        assert.equal(changedMeta.generatedAt, "2026-08-16T00:00:00.000Z");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
