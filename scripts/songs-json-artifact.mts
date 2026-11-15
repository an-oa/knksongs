import {
    parseSongsJsonMetaPayload,
    parseSongsJsonPayload,
    SONGS_JSON_SCHEMA_VERSION,
    toSongsJsonDocument
} from "#app/lib/songs-json";
import type { SongsJsonPayload } from "#app/lib/songs-json";
import { createSongsContentHash } from "./songs-content-hash.mts";

/**
 * songs.json の 2 つの表が、曲行へ戻した内容から生成規則どおりに分け直した表と同じかを判定する。
 * 読み込みは、曲行へ戻せる表なら受け付ける。使われない行、最初の歌唱ではないキー、並び順の違いは、ここで見つける。
 * @param songsJsonText songs.jsonの内容
 * @param songsPayload songs.jsonを読み込んで検証した内容
 * @returns 生成規則どおりなら true
 */
function hasGeneratedSongTables(songsJsonText: string, songsPayload: SongsJsonPayload): boolean {
    const written: { songInfos?: unknown; songs?: unknown } = JSON.parse(songsJsonText);
    const generated = toSongsJsonDocument(songsPayload);
    return JSON.stringify([written.songInfos, written.songs]) === JSON.stringify([generated.songInfos, generated.songs]);
}

/**
 * CSVから生成した2つのJSON成果物について、スキーマ、contentHash、生成日時、表の分け方の整合性を検証する。
 * 曲データの意味的品質はマスターCSVの変換時に検証済みのため、ここでは再判定しない。
 * @param songsJsonText songs.jsonの内容
 * @param songsMetaJsonText songs-meta.jsonの内容
 * @returns 収録曲数
 */
export function validateSongsJsonArtifacts(songsJsonText: string, songsMetaJsonText: string): number {
    const songsPayload = parseSongsJsonPayload(songsJsonText);
    const metaPayload = parseSongsJsonMetaPayload(songsMetaJsonText);
    const issues = [];
    if (
        songsPayload.schemaVersion !== SONGS_JSON_SCHEMA_VERSION ||
        metaPayload.schemaVersion !== SONGS_JSON_SCHEMA_VERSION
    ) {
        issues.push("songs.json and songs-meta.json must use the current schemaVersion");
    }
    if (songsPayload.contentHash !== metaPayload.contentHash) {
        issues.push("songs.json and songs-meta.json contentHash values must match");
    }
    if (songsPayload.generatedAt !== metaPayload.generatedAt) {
        issues.push("songs.json and songs-meta.json generatedAt values must match");
    }
    const calculatedContentHash = createSongsContentHash(songsPayload.songs);
    if (songsPayload.contentHash !== calculatedContentHash) {
        issues.push("songs.json contentHash must match the serialized songs array");
    }
    if (!hasGeneratedSongTables(songsJsonText, songsPayload)) {
        issues.push("songs.json songInfos and songs must match the tables generated from the joined songs");
    }
    if (issues.length > 0) {
        throw new Error(`songs json artifact validation failed:\n${issues.join("\n")}`);
    }
    return songsPayload.songs.length;
}
