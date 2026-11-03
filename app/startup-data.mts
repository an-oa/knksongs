/**
 * 曲データの初回取得を、UI のコードより先に始めるための module (ブラウザ専用)。
 *
 * startup.mts が最初に読み、import した時点で取得が始まる。startup.mts はその完了を待たずに
 * bootstrap.mts を読み込むので、曲データと UI のコードの取得が並行して進む。
 * bootstrap.mts は、ここで始めた取得の結果を Promise として受け取る。
 * 取得の実処理は ./lib/browser-songs-data-source.mts、URL とキャッシュ key は ./config.mts にある。
 *
 * bootstrap.mts へ統合しない。統合すると、bootstrap のファイルを取得して評価し終えるまで曲データの取得が始まらない。
 * HTML の modulepreload は bootstrap のコードを先に取得するが実行はしないため、取得を始めるのはこの module の役目になる。
 */
import {
    PUBLIC_SONGS_JSON_URL,
    PUBLIC_SONGS_META_URL,
    PUBLIC_CSV_URL,
    SONGS_JSON_CACHE_KEY,
    LEGACY_CSV_CACHE_KEY,
    CSV_CACHE_KEY
} from "./config.mjs";
import { createBrowserSongsDataSource } from "./lib/browser-songs-data-source.mjs";

// UI module の取得・初期化と並行して開始し、bootstrap でも同じ Promise を利用する。
const songsDataSource = createBrowserSongsDataSource({
    publicSongsJsonUrl: PUBLIC_SONGS_JSON_URL,
    publicSongsMetaUrl: PUBLIC_SONGS_META_URL,
    publicCsvUrl: PUBLIC_CSV_URL,
    songsJsonCacheKey: SONGS_JSON_CACHE_KEY,
    obsoleteCsvCacheKey: CSV_CACHE_KEY,
    obsoleteLegacyCsvCacheKey: LEGACY_CSV_CACHE_KEY
});

export const initialSongsSnapshot = songsDataSource.loadInitialSnapshot().catch((error: unknown) => {
    // UI の到着前に失敗しても未処理の rejection を残さず、読込エラー表示へ渡す。
    console.error("曲データの初期読み込みに失敗しました", error);
    return null;
});
