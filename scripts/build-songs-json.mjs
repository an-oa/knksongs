#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsvToSongs } from "../_build/app/lib/csv-parser.mjs";
import {
    buildSongsJsonMetaPayload,
    buildSongsJsonPayload,
    parseSongsJsonMetaPayload
} from "../_build/app/lib/songs-json.mjs";
import { PUBLIC_CSV_URL } from "../_build/app/config.mjs";
import { createSongsContentHash } from "./songs-content-hash.mjs";
import { validateSongsJsonArtifacts } from "./songs-json-artifact.mjs";

const DEFAULT_OUTPUT_PATH = "data/songs.json";
const DEFAULT_META_OUTPUT_PATH = "data/songs-meta.json";

/**
 * CLI 引数を CSV 入力元と JSON 出力先へ変換する。
 * @param {string[]} args
 * @returns {{ inputPath: string, outputPath: string, metaOutputPath: string, sourceUrl: string }}
 */
function parseArgs(args) {
    const options = {
        inputPath: "",
        outputPath: DEFAULT_OUTPUT_PATH,
        metaOutputPath: DEFAULT_META_OUTPUT_PATH,
        sourceUrl: PUBLIC_CSV_URL
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        if (arg === "--input") {
            if (!next) throw new Error("--input requires a file path");
            options.inputPath = next;
            i++;
            continue;
        }
        if (arg === "--output") {
            if (!next) throw new Error("--output requires a file path");
            options.outputPath = next;
            i++;
            continue;
        }
        if (arg === "--meta-output") {
            if (!next) throw new Error("--meta-output requires a file path");
            options.metaOutputPath = next;
            i++;
            continue;
        }
        if (arg === "--url") {
            if (!next) throw new Error("--url requires a CSV URL");
            options.sourceUrl = next;
            i++;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}

/**
 * CSV テキストをローカルファイルまたは公開URLから読み込む。
 * @param {{ inputPath: string, sourceUrl: string }} options
 * @returns {Promise<string>}
 */
async function loadCsvText(options) {
    if (options.inputPath) {
        return readFile(resolve(options.inputPath), "utf8");
    }
    const response = await fetch(options.sourceUrl, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`CSV fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
}

/**
 * 曲データを安定したJSON文字列へ変換する。
 * @param {*} payload
 * @returns {string}
 */
function stringifyPayload(payload) {
    return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * 既存成果物とcontentHashが同じ場合は生成日時を引き継ぎ、差分がある場合だけ更新する。
 * @param {{ metaOutputPath: string, now?: () => Date }} options
 * @param {string} contentHash
 * @returns {Promise<string>}
 */
async function resolveGeneratedAt(options, contentHash) {
    try {
        const existingMetaText = await readFile(resolve(options.metaOutputPath), "utf8");
        const existingMeta = parseSongsJsonMetaPayload(existingMetaText);
        if (existingMeta.contentHash === contentHash && existingMeta.generatedAt) {
            return existingMeta.generatedAt;
        }
    } catch {
        // 初回生成や旧・不正なmetaの場合は現在時刻から現行schemaの成果物を作る。
    }
    return (options.now?.() ?? new Date()).toISOString();
}

/**
 * CSV から曲データJSONを生成してファイルへ保存する。
 * @param {{ inputPath: string, outputPath: string, metaOutputPath: string, sourceUrl: string, now?: () => Date }} options
 * @returns {Promise<number>}
 */
export async function buildSongsJson(options) {
    const csvText = await loadCsvText(options);
    const songs = parseCsvToSongs(csvText);
    const contentHash = createSongsContentHash(songs);
    const generatedAt = await resolveGeneratedAt(options, contentHash);
    const songsJsonText = stringifyPayload(buildSongsJsonPayload(songs, contentHash, generatedAt));
    const songsMetaJsonText = stringifyPayload(buildSongsJsonMetaPayload(contentHash, generatedAt));
    validateSongsJsonArtifacts(songsJsonText, songsMetaJsonText);
    await mkdir(dirname(resolve(options.outputPath)), { recursive: true });
    await mkdir(dirname(resolve(options.metaOutputPath)), { recursive: true });
    await Promise.all([
        writeFile(resolve(options.outputPath), songsJsonText, "utf8"),
        writeFile(resolve(options.metaOutputPath), songsMetaJsonText, "utf8")
    ]);
    return songs.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const count = await buildSongsJson(options);
        console.log(`Generated ${options.outputPath} and ${options.metaOutputPath} (${count} songs)`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
