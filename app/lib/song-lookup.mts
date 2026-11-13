import type { LookupUiRuntimeState } from "../state.types";
import { buildSongByKeyMap } from "./song-identity.mjs";

/**
 * 曲参照用の検索マップが最新の曲配列を指しているかを返す。
 */
function hasCurrentSongLookupMaps(
    lookupUi: LookupUiRuntimeState,
    songRows: Song[]
): boolean {
    return lookupUi.songLookupSourceRef === songRows && lookupUi.songMapByKey instanceof Map;
}

/**
 * 曲参照用の検索マップを必要時に再構築する。
 * 本番コードでは検索/ブックマーク通知の参照解決から使い、境界条件を単体テストするため export している。
 */
export function ensureSongLookupMaps(
    lookupUi: LookupUiRuntimeState,
    songRows: Song[]
): void {
    const rows = Array.isArray(songRows) ? songRows : [];
    if (hasCurrentSongLookupMaps(lookupUi, rows)) return;

    lookupUi.songMapByKey = buildSongByKeyMap(rows);
    lookupUi.songLookupSourceRef = rows;
}

/**
 * 曲参照 (songKey) から曲データを返す。
 * 旧形式の参照は解決しない。ブックマークを読み込んだ後の移行で、songKey へ書き換えてある。
 */
export function resolveSongRef(
    lookupUi: LookupUiRuntimeState,
    songRows: Song[],
    songRef: string | null | undefined
): Song | null {
    ensureSongLookupMaps(lookupUi, songRows);
    if (typeof songRef === "string") {
        return lookupUi.songMapByKey.get(songRef) || null;
    }
    return null;
}

/**
 * ブックマーク内の曲参照配列を曲データ配列へ解決する。
 */
export function resolveSongRefs(
    lookupUi: LookupUiRuntimeState,
    songRows: Song[],
    songRefs: string[] | null | undefined
): Song[] {
    const refs = Array.isArray(songRefs) ? songRefs : [];
    const resolvedSongs: Song[] = [];
    refs.forEach((songRef) => {
        const song = resolveSongRef(lookupUi, songRows, songRef);
        if (song) resolvedSongs.push(song);
    });
    return resolvedSongs;
}
