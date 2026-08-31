import {
    buildStoredBookmarksPayload,
    migrateLegacyBookmarkSongRefsToCurrent,
    parseStoredBookmarksPayload
} from "./bookmark-schema.mjs";

type BookmarkImportEntry = {
    name?: string;
    songs?: string[];
};

type BookmarkImportLimits = {
    maxBookmarkCount?: number;
    maxSongsPerBookmark?: number;
    maxBookmarkNameLength?: number;
};

type BookmarkImportOptions = BookmarkImportLimits & {
    songRows?: Array<Record<string, unknown>>;
    storageVersion: number;
};

/**
 * 成功時の共通レスポンスを組み立てる。
 * @template {Record<string, unknown>} T
 * @param {T | undefined} [extra]
 * @returns {{ ok: true } & T}
 */
function buildActionOk<T extends Record<string, unknown>>(extra?: T): { ok: true } & T {
    return { ok: true, ...(extra || {}) } as { ok: true } & T;
}

/**
 * 失敗理由付きの共通レスポンスを組み立てる。
 * @template {Record<string, unknown>} T
 * @param {string} reason
 * @param {T | undefined} [extra]
 * @returns {{ ok: false, reason: string } & T}
 */
function buildActionFail<T extends Record<string, unknown>>(
    reason: string,
    extra?: T
): { ok: false, reason: string } & T {
    return { ok: false, reason, ...(extra || {}) } as { ok: false, reason: string } & T;
}

/**
 * ブックマーク内の合計曲数を数える。
 * @param {Record<string, { songs?: Array<*> }>} bookmarks
 * @returns {number}
 */
function countBookmarkSongs(bookmarks: Record<string, { songs?: unknown }>) {
    return Object.values(bookmarks).reduce((total, bookmark) => {
        return total + (Array.isArray(bookmark.songs) ? bookmark.songs.length : 0);
    }, 0);
}

/**
 * ブックマーク数、名前の長さ、各ブックマーク内の曲数が上限内かを確認する。
 * @param {Record<string, BookmarkImportEntry>} bookmarks
 * @param {BookmarkImportLimits | undefined} limits
 * @returns {{ ok: boolean, reason?: string, limit?: number, bookmarkName?: string }}
 */
function validateBookmarkImportLimits(
    bookmarks: Record<string, BookmarkImportEntry>,
    limits: BookmarkImportLimits | undefined
) {
    const maxBookmarkCount = Number.isFinite(limits && limits.maxBookmarkCount)
        ? limits.maxBookmarkCount
        : Number.POSITIVE_INFINITY;
    const maxSongsPerBookmark = Number.isFinite(limits && limits.maxSongsPerBookmark)
        ? limits.maxSongsPerBookmark
        : Number.POSITIVE_INFINITY;
    const maxBookmarkNameLength = Number.isFinite(limits && limits.maxBookmarkNameLength)
        ? limits.maxBookmarkNameLength
        : Number.POSITIVE_INFINITY;
    const bookmarkEntries = Object.entries(bookmarks);
    if (bookmarkEntries.length > maxBookmarkCount) {
        return buildActionFail("max_bookmark_count", { limit: maxBookmarkCount });
    }
    for (const [, bookmark] of bookmarkEntries) {
        if (typeof bookmark.name === "string" && bookmark.name.length > maxBookmarkNameLength) {
            return buildActionFail("max_bookmark_name_length", { limit: maxBookmarkNameLength });
        }
        const songs = Array.isArray(bookmark.songs) ? bookmark.songs : [];
        if (songs.length > maxSongsPerBookmark) {
            return buildActionFail("max_songs_per_bookmark", {
                limit: maxSongsPerBookmark,
                bookmarkName: bookmark.name
            });
        }
    }
    return buildActionOk();
}

/**
 * インポート候補の JSON 文字列を解析し、全置き換え可能なブックマーク情報に整える。
 * @param {*} text
 * @param {{
 *   songRows?: Array<*>,
 *   storageVersion: number,
 *   maxBookmarkCount?: number,
 *   maxSongsPerBookmark?: number,
 *   maxBookmarkNameLength?: number
 * }} options
 * @returns {{ ok: boolean, reason?: string, bookmarks?: Record<string, *>, bookmarkCount?: number, songCount?: number, limit?: number, bookmarkName?: string }}
 */
export function parseBookmarkImportText(text, options: BookmarkImportOptions) {
    if (typeof text !== "string") return buildActionFail("invalid_text");

    let raw;
    try {
        raw = JSON.parse(text);
    } catch {
        return buildActionFail("invalid_json");
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return buildActionFail("invalid_bookmark_file");
    }

    const payload = raw as { bookmarks?: unknown };
    const isVersionedPayload = Object.prototype.hasOwnProperty.call(payload, "bookmarks");
    const rawBookmarkMap = isVersionedPayload ? payload.bookmarks : raw;
    const rawEntryCount = rawBookmarkMap && typeof rawBookmarkMap === "object" && !Array.isArray(rawBookmarkMap)
        ? Object.keys(rawBookmarkMap).length
        : 0;
    if (isVersionedPayload && (!rawBookmarkMap || typeof rawBookmarkMap !== "object" || Array.isArray(rawBookmarkMap))) {
        return buildActionFail("invalid_bookmark_file");
    }

    const parsed = parseStoredBookmarksPayload(raw, options.storageVersion);
    if (!parsed.supported) {
        return buildActionFail("unsupported_version", { version: parsed.version });
    }
    const bookmarks = parsed.bookmarks;
    const bookmarkCount = Object.keys(bookmarks).length;
    if ((!isVersionedPayload || rawEntryCount > 0) && bookmarkCount === 0) {
        return buildActionFail("invalid_bookmark_file");
    }

    const songRows = Array.isArray(options && options.songRows) ? options.songRows : [];
    if (songRows.length > 0) {
        migrateLegacyBookmarkSongRefsToCurrent({
            bookmarks,
            songRows
        });
    }

    const limitCheck = validateBookmarkImportLimits(bookmarks, options);
    if (!limitCheck.ok) return limitCheck;

    return buildActionOk({
        bookmarks,
        bookmarkCount,
        songCount: countBookmarkSongs(bookmarks)
    });
}

/**
 * 現在のブックマークを JSON エクスポート用文字列へ変換する。
 * @param {Record<string, *>} bookmarks
 * @param {number} version
 * @returns {{ ok: boolean, text: string, bookmarkCount: number, songCount: number }}
 */
export function exportBookmarksAsJsonText(bookmarks, version) {
    const safeBookmarks = bookmarks && typeof bookmarks === "object" ? bookmarks : {};
    const payload = buildStoredBookmarksPayload(safeBookmarks, version);
    return buildActionOk({
        text: `${JSON.stringify(payload, null, 2)}\n`,
        bookmarkCount: Object.keys(payload.bookmarks).length,
        songCount: countBookmarkSongs(payload.bookmarks)
    });
}
