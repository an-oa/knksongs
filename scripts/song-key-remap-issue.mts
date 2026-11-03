#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildSongKeyRemapIssueBody, findSongKeyRemaps } from "./lib/song-key-remaps.mts";

/**
 * 必須の環境変数を読む。空なら失敗させる。
 * @param name 環境変数の名前
 * @returns 環境変数の値
 */
function readRequiredEnv(name: string): string {
    const value = process.env[name] || "";
    if (!value) throw new Error(`${name} is required`);
    return value;
}

/**
 * 更新前後の songs.json を比べ、別の歌唱を指すようになったキーがあれば Issue の本文をファイルに書く。
 * 見つからなければファイルを書かない。workflow はファイルの有無で Issue を作るかを決める。
 * @param options 比べる2つの songs.json、本文の書き出し先、本文に載せる commit と workflow run の URL
 * @returns 見つかったキーの数
 */
export async function writeSongKeyRemapIssueBody(options: {
    previousSongsJsonPath: string;
    currentSongsJsonPath: string;
    issueBodyPath: string;
    commitUrl: string;
    runUrl: string;
}): Promise<number> {
    const [previousText, currentText] = await Promise.all([
        readFile(options.previousSongsJsonPath, "utf8"),
        readFile(options.currentSongsJsonPath, "utf8")
    ]);
    const remaps = findSongKeyRemaps(previousText, currentText);
    if (remaps.length === 0) return 0;
    const body = buildSongKeyRemapIssueBody(remaps, { commitUrl: options.commitUrl, runUrl: options.runUrl });
    await writeFile(options.issueBodyPath, `${body}\n`, "utf8");
    return remaps.length;
}

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entryPointUrl) {
    try {
        const count = await writeSongKeyRemapIssueBody({
            previousSongsJsonPath: readRequiredEnv("PREVIOUS_SONGS_JSON"),
            currentSongsJsonPath: readRequiredEnv("CURRENT_SONGS_JSON"),
            issueBodyPath: readRequiredEnv("ISSUE_BODY_PATH"),
            commitUrl: readRequiredEnv("COMMIT_URL"),
            runUrl: readRequiredEnv("RUN_URL")
        });
        console.log(count === 0
            ? "No bookmark keys moved to other songs"
            : `${count} bookmark key(s) moved to other songs`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
