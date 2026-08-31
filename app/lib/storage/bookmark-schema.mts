import {
    buildSongReferenceIndex,
    getBookmarkSongRef,
    normalizeLegacySongRefToCurrent,
    type SongIdentityRow
} from "../song-identity.mjs";

type StoredBookmarkRecord = {
    name: string;
    createdAt: number;
    songs: string[];
};

type ParsedStoredBookmarksPayload =
    | {
        supported: true;
        version: number;
        bookmarks: Record<string, StoredBookmarkRecord>;
    }
    | {
        supported: false;
        version: number;
    };

type RawBookmarkRecord = {
    name?: unknown;
    createdAt?: unknown;
    songs?: unknown;
};

type BookmarkMigrationInput = {
    bookmarks?: Record<string, { songs?: unknown }>;
    songRows?: SongIdentityRow[];
};

type BookmarkMigrationChange = {
    bookmarkId: string;
    before: unknown[];
    after: string[];
};

/**
 * 保存済みブックマーク構造を検証し、利用可能な形へ整形する。
 * 保存 payload の正規化境界を単体テストするため export している。
 * @param {*} raw
 * 復元不能な旧数値参照は実行時モデルへ持ち込まず除外する。
 * @returns {Record<string, { name: string, createdAt: number, songs: string[] }>}
 */
export function sanitizeBookmarks(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const sanitized: Record<string, StoredBookmarkRecord> = {};
    for (const [id, bookmark] of Object.entries(raw as Record<string, RawBookmarkRecord>)) {
        if (!bookmark || typeof bookmark !== "object" || Array.isArray(bookmark)) continue;
        const name = typeof bookmark.name === "string" ? bookmark.name.trim() : "";
        if (!name) continue;
        const createdAt = Number.isFinite(bookmark.createdAt) ? Number(bookmark.createdAt) : 0;
        const songs: string[] = [];
        const seen = new Set<string>();
        const rawSongs = Array.isArray(bookmark.songs) ? bookmark.songs : [];
        rawSongs.forEach((ref) => {
            if (typeof ref !== "string") return;
            const normalized = ref.trim();
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            songs.push(normalized);
        });
        sanitized[id] = { name, createdAt, songs };
    }
    return sanitized;
}

/**
 * 保存済みブックマーク payload を解析し、対応済み version の本体だけを取り出す。
 * 現行より新しい version は未知フィールドを失わないよう正規化せず、未対応として返す。
 * @param raw 保存済み payload
 * @param currentVersion 現在対応している schema version
 */
export function parseStoredBookmarksPayload(
    raw: unknown,
    currentVersion: number
): ParsedStoredBookmarksPayload {
    const maxSupportedVersion = Number.isFinite(currentVersion)
        ? Number(currentVersion)
        : 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { supported: true, version: 1, bookmarks: {} };
    }
    const payload = raw as { version?: unknown, bookmarks?: unknown };
    const version = Number.isFinite(payload.version) ? Number(payload.version) : 1;
    if (version > maxSupportedVersion) {
        return { supported: false, version };
    }
    if (Object.prototype.hasOwnProperty.call(payload, "bookmarks")) {
        return {
            supported: true,
            version,
            bookmarks: sanitizeBookmarks(payload.bookmarks)
        };
    }
    return {
        supported: true,
        version: 1,
        bookmarks: sanitizeBookmarks(raw)
    };
}

/**
 * 現行形式のブックマーク保存 payload を組み立てる。
 * @param {*} bookmarks
 * @param {number} version
 * @returns {{ version: number, bookmarks: * }}
 */
export function buildStoredBookmarksPayload(bookmarks, version) {
    return { version, bookmarks: sanitizeBookmarks(bookmarks) };
}

/**
 * 旧文字列形式のブックマーク曲IDを現行の bookmarkSongKey へ移行する。
 * 安定して復元できない旧数値参照は実行時モデルへ持ち込まず除外する。
 * @param {{ bookmarks: Record<string, *>, songRows: Array<*> }} input
 * @returns {{ updated: boolean, changedBookmarkIds: string[], changes: BookmarkMigrationChange[] }}
 */
export function migrateLegacyBookmarkSongRefsToCurrent(input: BookmarkMigrationInput) {
    const bookmarks: Record<string, { songs?: unknown }> =
        input && input.bookmarks && typeof input.bookmarks === "object"
            ? input.bookmarks
            : {};
    const songRows = Array.isArray(input && input.songRows) ? input.songRows : [];
    const referenceIndex = buildSongReferenceIndex(songRows);
    const changedBookmarkIds: string[] = [];
    const changes: BookmarkMigrationChange[] = [];

    let updated = false;
    Object.entries(bookmarks).forEach(([bookmarkId, bookmark]) => {
        const nextSongs: string[] = [];
        const seen = new Set<string>();
        const rawBookmarkSongs = bookmark.songs;
        const prevSongs: unknown[] = Array.isArray(rawBookmarkSongs) ? rawBookmarkSongs : [];
        prevSongs.forEach((ref) => {
            let normalized: string | null = null;
            if (typeof ref === "string") {
                const trimmedRef = ref.trim();
                if (referenceIndex.bookmarkSongKeys.has(trimmedRef)) normalized = trimmedRef;
                else if (referenceIndex.songByKey.has(trimmedRef)) {
                    const row = referenceIndex.songByKey.get(trimmedRef);
                    normalized = getBookmarkSongRef(row) || null;
                } else if (referenceIndex.bookmarkKeyByLegacyKey.has(trimmedRef)) {
                    normalized = referenceIndex.bookmarkKeyByLegacyKey.get(trimmedRef) || null;
                } else {
                    const converted = normalizeLegacySongRefToCurrent(trimmedRef);
                    if (converted && referenceIndex.songByKey.has(converted)) {
                        const row = referenceIndex.songByKey.get(converted);
                        normalized = getBookmarkSongRef(row) || null;
                    } else normalized = trimmedRef;
                }
            }
            if (normalized === null) return;
            if (seen.has(normalized)) return;
            seen.add(normalized);
            nextSongs.push(normalized);
        });
        if (prevSongs.length !== nextSongs.length || prevSongs.some((ref, idx) => ref !== nextSongs[idx])) {
            bookmark.songs = nextSongs;
            updated = true;
            changedBookmarkIds.push(bookmarkId);
            changes.push({ bookmarkId, before: prevSongs, after: nextSongs });
        }
    });

    return { updated, changedBookmarkIds, changes };
}
