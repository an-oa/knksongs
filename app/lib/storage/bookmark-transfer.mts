import {
    buildStoredBookmarksPayload,
    migrateLegacyBookmarkSongRefsToCurrent,
    parseStoredBookmarksPayload
} from "./bookmark-schema.mjs";

/** ファイル読み込みと JSON 解析の前に適用する UTF-8 バイト数の上限。 */
export const MAX_BOOKMARK_IMPORT_BYTES = 1_000_000;

/** 巨大な文字列の複製を避けながら、インポート上限をUTF-8バイト数で確認する。 */
function isWithinBookmarkImportSize(text: string): boolean {
    return text.length <= MAX_BOOKMARK_IMPORT_BYTES &&
        new TextEncoder().encode(text).byteLength <= MAX_BOOKMARK_IMPORT_BYTES;
}

type BookmarkImportEntry = {
    name: string;
    songs: string[];
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

/** インポート上限に達した理由と、その理由に対応する補足情報。 */
type BookmarkImportLimitFailure =
    | { ok: false; reason: "max_bookmark_count" | "max_bookmark_name_length"; limit: number }
    | { ok: false; reason: "max_songs_per_bookmark"; limit: number; bookmarkName: string };

/** インポート失敗時に呼び出し元へ返す理由別の結果。 */
type BookmarkImportFailure =
    | BookmarkImportLimitFailure
    | { ok: false; reason: "invalid_text" | "invalid_json" | "invalid_bookmark_file" }
    | { ok: false; reason: "max_import_file_size"; limit: number }
    | { ok: false; reason: "unsupported_version"; version: number };

/** 検証済みブックマーク、または理由で判別できるインポート失敗。 */
type BookmarkImportResult =
    | {
        ok: true;
        bookmarks: ReturnType<typeof buildStoredBookmarksPayload>["bookmarks"];
        bookmarkCount: number;
        songCount: number;
    }
    | BookmarkImportFailure;

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
 */
function validateBookmarkImportLimits(
    bookmarks: Record<string, BookmarkImportEntry>,
    limits: BookmarkImportLimits | undefined
): { ok: true } | BookmarkImportLimitFailure {
    const maxBookmarkCount = typeof limits?.maxBookmarkCount === "number" && Number.isFinite(limits.maxBookmarkCount)
        ? limits.maxBookmarkCount
        : Number.POSITIVE_INFINITY;
    const maxSongsPerBookmark = typeof limits?.maxSongsPerBookmark === "number" && Number.isFinite(limits.maxSongsPerBookmark)
        ? limits.maxSongsPerBookmark
        : Number.POSITIVE_INFINITY;
    const maxBookmarkNameLength = typeof limits?.maxBookmarkNameLength === "number" && Number.isFinite(limits.maxBookmarkNameLength)
        ? limits.maxBookmarkNameLength
        : Number.POSITIVE_INFINITY;
    const bookmarkEntries = Object.entries(bookmarks);
    if (bookmarkEntries.length > maxBookmarkCount) {
        return { ok: false, reason: "max_bookmark_count", limit: maxBookmarkCount };
    }
    for (const [, bookmark] of bookmarkEntries) {
        if (typeof bookmark.name === "string" && bookmark.name.length > maxBookmarkNameLength) {
            return { ok: false, reason: "max_bookmark_name_length", limit: maxBookmarkNameLength };
        }
        const songs = Array.isArray(bookmark.songs) ? bookmark.songs : [];
        if (songs.length > maxSongsPerBookmark) {
            return {
                ok: false,
                reason: "max_songs_per_bookmark",
                limit: maxSongsPerBookmark,
                bookmarkName: bookmark.name
            };
        }
    }
    return { ok: true };
}

/**
 * インポート候補の JSON 文字列を解析し、全置き換え可能なブックマーク情報に整える。
 */
export function parseBookmarkImportText(
    text: unknown,
    options: BookmarkImportOptions
): BookmarkImportResult {
    if (typeof text !== "string") return { ok: false, reason: "invalid_text" };
    if (!isWithinBookmarkImportSize(text)) {
        return { ok: false, reason: "max_import_file_size", limit: MAX_BOOKMARK_IMPORT_BYTES };
    }

    let raw;
    try {
        raw = JSON.parse(text);
    } catch {
        return { ok: false, reason: "invalid_json" };
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, reason: "invalid_bookmark_file" };
    }

    const payload = raw as { bookmarks?: unknown };
    const isVersionedPayload = Object.prototype.hasOwnProperty.call(payload, "bookmarks");
    const rawBookmarkMap = isVersionedPayload ? payload.bookmarks : raw;
    const rawEntryCount = rawBookmarkMap && typeof rawBookmarkMap === "object" && !Array.isArray(rawBookmarkMap)
        ? Object.keys(rawBookmarkMap).length
        : 0;
    if (isVersionedPayload && (!rawBookmarkMap || typeof rawBookmarkMap !== "object" || Array.isArray(rawBookmarkMap))) {
        return { ok: false, reason: "invalid_bookmark_file" };
    }

    const parsed = parseStoredBookmarksPayload(raw, options.storageVersion);
    if (!parsed.supported) {
        return { ok: false, reason: "unsupported_version", version: parsed.version };
    }
    const bookmarks = parsed.bookmarks;
    const bookmarkCount = Object.keys(bookmarks).length;
    if ((!isVersionedPayload || rawEntryCount > 0) && bookmarkCount === 0) {
        return { ok: false, reason: "invalid_bookmark_file" };
    }

    const songRows = Array.isArray(options?.songRows) ? options.songRows : [];
    if (songRows.length > 0) {
        migrateLegacyBookmarkSongRefsToCurrent({
            bookmarks,
            songRows
        });
    }

    const limitCheck = validateBookmarkImportLimits(bookmarks, options);
    if (limitCheck.ok === false) return limitCheck;
    // 旧形式の正規化・曲参照移行で増えた分も確認し、取り込み直後の再入出力を可能にする。
    if (!isWithinBookmarkImportSize(JSON.stringify({ version: options.storageVersion, bookmarks }))) {
        return { ok: false, reason: "max_import_file_size", limit: MAX_BOOKMARK_IMPORT_BYTES };
    }

    return {
        ok: true,
        bookmarks,
        bookmarkCount,
        songCount: countBookmarkSongs(bookmarks)
    };
}

/**
 * 現在のブックマークを JSON エクスポート用文字列へ変換する。
 * 整形でインポート上限を超える場合は、再取り込みできるよう空白と末尾改行を省く。
 */
export function exportBookmarksAsJsonText(
    bookmarks: unknown,
    version: number
): { ok: true; text: string; bookmarkCount: number; songCount: number } {
    const safeBookmarks = bookmarks && typeof bookmarks === "object" ? bookmarks : {};
    const payload = buildStoredBookmarksPayload(safeBookmarks, version);
    const formattedText = `${JSON.stringify(payload, null, 2)}\n`;
    return {
        ok: true,
        text: isWithinBookmarkImportSize(formattedText) ? formattedText : JSON.stringify(payload),
        bookmarkCount: Object.keys(payload.bookmarks).length,
        songCount: countBookmarkSongs(payload.bookmarks)
    };
}
