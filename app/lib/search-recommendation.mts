import { isGuestStreamRole } from "./stream-role.mjs";
import {
    isOriginalSongFormat,
    isShortFormat,
    isStreamFormat,
    isUtamitaEquivalentFormat
} from "./song-format.mjs";

/** 条件未指定時に表示するおすすめ曲のキャッシュ。 */
export type RecommendedSearchCache = {
    /** 抽出済みのおすすめ曲。 */
    songs: Song[];
    /** この cache で抽出済みとして扱える要求件数。欠損時は実際の曲数まで下げる。 */
    requestedCount: number;
};

type RecommendedCacheSelectionOptions = {
    count: number;
    minPerformanceCount: number;
    currentCache?: RecommendedSearchCache | null;
};

type RecommendedCacheSelectionResult = {
    songs: Song[];
    cache: RecommendedSearchCache;
};

type RecommendedSongGroupEntry = {
    rows: Song[];
    utamitaRows: Song[];
    orisongRows: Song[];
    streamRows: Song[];
    shortRows: Song[];
};

type RecommendedSongGroup = {
    key: string;
    latestRows: Song[];
};

type RecommendedCacheReconcileOptions = {
    minPerformanceCount: number;
};

/**
 * おすすめ表示に使う曲一覧を抽選して返す。
 * @param songs 抽選元の曲配列
 * @param options 抽選件数と通常曲に必要な歌唱回数
 * @returns 抽選したおすすめ曲
 */
export function pickRecommendedSongs(
    songs: Song[],
    { count, minPerformanceCount }: { count: number; minPerformanceCount: number }
): Song[] {
    const groups = buildRecommendedGroups(songs, minPerformanceCount);
    return selectRecommendedSongs(groups, count);
}

/**
 * 既存 cache を尊重しながら、おすすめ表示に必要な曲一覧と次の cache state を返す。
 * @param {Song[]} songs
 * @param {RecommendedCacheSelectionOptions} options
 * @returns {RecommendedCacheSelectionResult}
 */
export function pickRecommendedSongsWithCache(
    songs: Song[],
    {
        count,
        minPerformanceCount,
        currentCache = null
    }: RecommendedCacheSelectionOptions
): RecommendedCacheSelectionResult {
    const cachedSongs = getRecommendedCacheSongs(currentCache);
    if (cachedSongs && getRecommendedCacheRequestedCount(currentCache) >= count) {
        return {
            songs: cachedSongs.slice(0, count),
            cache: currentCache as RecommendedSearchCache
        };
    }
    const nextSongs = cachedSongs
        ? expandRecommendedCache(songs, cachedSongs, count, minPerformanceCount)
        : pickRecommendedSongs(songs, { count, minPerformanceCount });
    return {
        songs: nextSongs,
        cache: createRecommendedCacheState(nextSongs, count)
    };
}

/**
 * 最新の曲データへ切り替える際、既存おすすめの曲順を保ちながら無効な行だけ補修する。
 * N回条件は新規抽選時の入場条件とし、一度選ばれた曲は有効な行が残る限り維持する。
 * @param songs 最新の曲配列
 * @param currentCache 現在表示に使っているおすすめcache
 * @param options おすすめ候補の入場条件
 * @returns 最新データへ参照を更新したおすすめcache
 */
export function reconcileRecommendedSearchCache(
    songs: Song[],
    currentCache: RecommendedSearchCache | null | undefined,
    { minPerformanceCount }: RecommendedCacheReconcileOptions
): RecommendedSearchCache | null {
    const cachedSongs = getRecommendedCacheSongs(currentCache);
    if (!cachedSongs || !currentCache) return null;

    const dedupedRows = collapseRecommendedRowsByArchive(songs);
    const groups = groupRecommendedRowsBySong(dedupedRows);
    const rowsBySongKey = new Map(dedupedRows.map((row) => [row.songKey, row]));
    const usedGroupKeys = new Set<string>();
    const nextSlots: Array<Song | null> = cachedSongs.map((cachedRow) => {
        const exactRow = rowsBySongKey.get(cachedRow.songKey) || null;
        const groupKey = exactRow
            ? getRecommendedSongKey(exactRow)
            : getRecommendedSongKey(cachedRow);
        const entry = groups.get(groupKey);
        if (!entry || usedGroupKeys.has(groupKey)) return null;

        const retainedRow = exactRow || pickReplacementRowFromSameGroup(entry, cachedRow, minPerformanceCount);
        if (!retainedRow) return null;
        usedGroupKeys.add(groupKey);
        return retainedRow;
    });

    const replacementGroups = collectEligibleRecommendedGroups(groups, minPerformanceCount)
        .filter((group) => !usedGroupKeys.has(group.key));
    shuffleInPlace(replacementGroups);
    for (let index = 0; index < nextSlots.length; index++) {
        if (nextSlots[index]) continue;
        const replacementGroup = replacementGroups.pop();
        if (!replacementGroup) continue;
        const replacementRow = pickRandomEntry(replacementGroup.latestRows);
        if (!replacementRow) continue;
        nextSlots[index] = replacementRow;
        usedGroupKeys.add(replacementGroup.key);
    }

    const nextSongs = nextSlots.filter((row): row is Song => row !== null);
    return createRecommendedCacheState(
        nextSongs,
        Math.min(getRecommendedCacheRequestedCount(currentCache), nextSongs.length)
    );
}

/**
 * cache と要求件数を同じ lifecycle で扱うおすすめ cache state を作る。
 * @param {Song[]} songs
 * @param {number} requestedCount
 * @returns {RecommendedSearchCache}
 */
function createRecommendedCacheState(
    songs: Song[],
    requestedCount: number
): RecommendedSearchCache {
    return {
        songs,
        requestedCount
    };
}

/**
 * 現在のおすすめ cache から曲配列を返す。
 * @param {RecommendedSearchCache | null | undefined} cache
 * @returns {Song[] | null}
 */
function getRecommendedCacheSongs(cache: RecommendedSearchCache | null | undefined): Song[] | null {
    return cache && Array.isArray(cache.songs) ? cache.songs : null;
}

/**
 * 現在のおすすめ cache が満たしている要求件数を返す。
 * @param {RecommendedSearchCache | null | undefined} cache
 * @returns {number}
 */
function getRecommendedCacheRequestedCount(cache: RecommendedSearchCache | null | undefined): number {
    if (!cache || !Number.isFinite(cache.requestedCount)) return 0;
    return cache.requestedCount;
}

/**
 * 既存 cache の並びを保ったまま、不足分だけ新しいおすすめ候補で補う。
 * @param {Song[]} songs
 * @param {Song[]} currentCache
 * @param {number} count
 * @param {number} minPerformanceCount
 * @returns {Song[]}
 */
function expandRecommendedCache(
    songs: Song[],
    currentCache: Song[],
    count: number,
    minPerformanceCount: number
): Song[] {
    const nextCache = currentCache.slice();
    const usedKeys = new Set(nextCache.map((row) => getRecommendedSongKey(row)));
    const picked = pickRecommendedSongs(songs, {
        count: count + currentCache.length,
        minPerformanceCount
    });
    for (const row of picked) {
        const key = getRecommendedSongKey(row);
        if (usedKeys.has(key)) continue;
        nextCache.push(row);
        usedKeys.add(key);
        if (nextCache.length >= count) break;
    }
    return nextCache;
}

/**
 * おすすめ抽選に使う曲グループを構築する。
 * @param songs 抽選元の曲配列
 * @param minPerformanceCount 通常曲に必要な歌唱回数
 * @returns 新規抽選可能なおすすめグループ
 */
function buildRecommendedGroups(songs: Song[], minPerformanceCount: number): RecommendedSongGroup[] {
    const dedupedRows = collapseRecommendedRowsByArchive(songs);
    const groups = groupRecommendedRowsBySong(dedupedRows);
    return collectEligibleRecommendedGroups(groups, minPerformanceCount);
}

/**
 * 曲グループから、新規おすすめへ入場できるグループだけを抽出する。
 * @param groups 曲同一性キーごとの候補行
 * @param minPerformanceCount 通常曲に必要な歌唱回数
 * @returns 新規抽選可能なおすすめグループ
 */
function collectEligibleRecommendedGroups(
    groups: Map<string, RecommendedSongGroupEntry>,
    minPerformanceCount: number
): RecommendedSongGroup[] {
    const result: RecommendedSongGroup[] = [];
    for (const [key, entry] of groups.entries()) {
        if (!isRecommendedGroupEligible(entry, minPerformanceCount)) continue;
        const latestRows = pickRecommendedLatestRows(entry, minPerformanceCount);
        if (latestRows.length === 0) continue;
        result.push({ key, latestRows });
    }
    return result;
}

/**
 * 同一アーカイブ内の候補を最新行へ集約する。
 * @param songs 抽選元の曲配列
 * @returns 同一曲・同一アーカイブ単位に集約した行
 */
function collapseRecommendedRowsByArchive(songs: Song[]): Song[] {
    const songRowsByArchive = new Map<string, Song>();
    for (const row of songs) {
        if (isGuestStreamRole(row.streamRole)) continue;
        if (!isRecommendedCountFormat(row.format)) continue;
        const archiveKey = getRecommendedSongArchiveKey(row);
        const existing = songRowsByArchive.get(archiveKey);
        if (!existing || isHigherArchiveOrder(row, existing)) {
            songRowsByArchive.set(archiveKey, row);
        }
    }
    return Array.from(songRowsByArchive.values());
}

/**
 * 曲同一性キーで候補をグループ化し形式別に分類する。
 * @param rows アーカイブ単位に集約した曲配列
 * @returns 曲同一性キーごとの候補行
 */
function groupRecommendedRowsBySong(rows: Song[]): Map<string, RecommendedSongGroupEntry> {
    const groups = new Map<string, RecommendedSongGroupEntry>();
    for (const row of rows) {
        const key = getRecommendedSongKey(row);
        if (!groups.has(key)) {
            groups.set(key, { rows: [], utamitaRows: [], orisongRows: [], streamRows: [], shortRows: [] });
        }
        const entry = groups.get(key) as RecommendedSongGroupEntry;
        entry.rows.push(row);
        if (isUtamitaEquivalentFormat(row.format)) entry.utamitaRows.push(row);
        if (isOriginalSongFormat(row.format)) entry.orisongRows.push(row);
        if (isStreamFormat(row.format)) entry.streamRows.push(row);
        if (isShortFormat(row.format)) entry.shortRows.push(row);
    }
    return groups;
}

/**
 * おすすめ候補グループが抽選対象かどうかを判定する。
 * オリ曲が含まれる曲は1回でも候補に含める。
 * @param entry 同一曲の候補行
 * @param minPerformanceCount 通常曲に必要な歌唱回数
 * @returns 新規おすすめへ入場できるか
 */
function isRecommendedGroupEligible(
    entry: RecommendedSongGroupEntry,
    minPerformanceCount: number
): boolean {
    if (entry.rows.length >= minPerformanceCount) return true;
    return entry.orisongRows.length > 0;
}

/**
 * 優先ルールに従ってグループから採用候補行を選ぶ。
 * @param entry 同一曲の候補行
 * @param minPerformanceCount 通常曲に必要な歌唱回数
 * @returns 表示候補として優先する行
 */
function pickRecommendedLatestRows(
    entry: RecommendedSongGroupEntry,
    minPerformanceCount: number
): Song[] {
    if (entry.utamitaRows.length > 0) {
        return entry.utamitaRows.slice(0, 1);
    }
    if (entry.streamRows.length > 0) {
        return entry.streamRows.slice(0, minPerformanceCount);
    }
    if (entry.shortRows.length > 0) {
        return entry.shortRows.slice(0, minPerformanceCount);
    }
    return [];
}

/**
 * 表示していた行がなくなった場合に、同じ曲の有効な別行を選ぶ。
 * 同じアーカイブの代表行が残っていれば優先し、それ以外は既存の形式優先規則を使う。
 * @param entry 最新データ上の同一曲グループ
 * @param cachedRow 以前表示していた行
 * @param minPerformanceCount 通常曲に必要な歌唱回数
 * @returns 同じ曲の代替行
 */
function pickReplacementRowFromSameGroup(
    entry: RecommendedSongGroupEntry,
    cachedRow: Song,
    minPerformanceCount: number
): Song | null {
    const sameArchiveRow = entry.rows.find((row) => row.archiveId === cachedRow.archiveId);
    if (sameArchiveRow) return sameArchiveRow;
    return pickRandomEntry(pickRecommendedLatestRows(entry, minPerformanceCount));
}

/**
 * 候補グループからランダム抽出して表示曲を決定する。
 * @param groups 新規抽選可能なおすすめグループ
 * @param count 抽選件数
 * @returns グループごとに1行を選んだおすすめ曲
 */
function selectRecommendedSongs(groups: RecommendedSongGroup[], count: number): Song[] {
    const pickedGroups = shuffleInPlace(groups.slice()).slice(0, count);
    return pickedGroups.flatMap((group) => {
        const row = pickRandomEntry(group.latestRows);
        return row ? [row] : [];
    });
}

/**
 * 配列を Fisher-Yates 法でインプレースシャッフルする。
 * @param list 並べ替える配列
 * @returns 同じ配列参照
 */
function shuffleInPlace<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/**
 * 配列からランダムに 1 件選択する。
 * @param list 抽選元の配列
 * @returns 抽選した要素、または空配列の場合はnull
 */
function pickRandomEntry<T>(list: T[]): T | null {
    if (list.length === 0) return null;
    const idx = Math.floor(Math.random() * list.length);
    return list[idx];
}

/**
 * おすすめ抽選で使う同一曲判定用の正規化キーを生成する。
 * cache 拡張時も同じ単位で重複除外するため export している。
 * @param row 曲行
 * @returns 曲同一性キー
 */
export function getRecommendedSongKey(row: Song): string {
    return [
        row.titleNorm || "",
        row.artistNorm || "",
        row.titleYomiNorm || "",
        row.artistYomiNorm || ""
    ].join("|||");
}

/**
 * 曲キーとアーカイブ ID を組み合わせた集約キーを生成する。
 * @param row 曲行
 * @returns 曲とアーカイブの集約キー
 */
function getRecommendedSongArchiveKey(row: Song): string {
    return `${getRecommendedSongKey(row)}|||${row.archiveId || ""}`;
}

/**
 * 候補行のarchiveOrderが現在行より大きいかを判定する。
 * 同値の場合は先に走査したCSV上側の行を代表として残す。
 * @param candidate 比較候補行
 * @param current 現在の代表行
 * @returns 比較候補を代表行にするか
 */
function isHigherArchiveOrder(candidate: Song, current: Song): boolean {
    const candidateOrder = candidate.archiveOrder ?? -1;
    const currentOrder = current.archiveOrder ?? -1;
    return candidateOrder > currentOrder;
}

/**
 * おすすめ集計対象の形式かどうかを判定する。
 * @param format 曲形式
 * @returns おすすめ集計対象か
 */
function isRecommendedCountFormat(format: unknown): boolean {
    return isStreamFormat(format) || isUtamitaEquivalentFormat(format) || isShortFormat(format);
}
