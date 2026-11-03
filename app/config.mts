/**
 * 曲データの取得 URL と、ブラウザに保存するキャッシュの key。
 *
 * ブラウザのアプリだけでなく、Node で動く曲 JSON の生成スクリプトと E2E テストからも読む。
 * そのため、import しても何の処理も走らない、定数だけの module にしている。
 *
 * 曲データの取得を始める処理は ./startup-data.mts に置き、ここへ混ぜない。
 * 混ぜると、Node から読んだ時点でブラウザ用の取得処理 (fetch や localStorage) が走ってしまう。
 */
export const PUBLIC_SONGS_JSON_URL = "data/songs.json";
export const PUBLIC_SONGS_META_URL = "data/songs-meta.json";
export const PUBLIC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR-cSDIsEc3sqIOkmiuuSeaUKmNb2gBvM_NoH8-Se5ZrosaSOdMhPo3RuvxhZirUPJ_ll8PGnbRnJeF/pub?gid=457223586&single=true&output=csv";
export const SONGS_JSON_CACHE_KEY = "cachedSongsJson";
// CSVキャッシュ廃止後に、既存ユーザーの保存領域を掃除するためだけに残すkey。
export const LEGACY_CSV_CACHE_KEY = "cachedCsv";
export const CSV_CACHE_KEY = "cachedCsvV2";
