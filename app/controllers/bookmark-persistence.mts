import {
    buildStoredBookmarksPayload,
    migrateLegacyBookmarkSongRefsToCurrent,
    parseStoredBookmarksPayload
} from "../lib/storage/bookmark-schema.mjs";
import type { AppDataState, BookmarkRecord } from "../state.types";

export type BookmarkSaveFailure =
    | {
        ok: false;
        reason: "unsupported_storage_version";
        version: number;
    }
    | {
        ok: false;
        reason: "storage_reload_required";
    }
    | {
        ok: false;
        reason: "storage_write_failed";
    };

export type BookmarkSaveResult = { ok: true } | BookmarkSaveFailure;

export type BookmarkLoadResult =
    | { supported: true }
    | {
        supported: false;
        reason: "unsupported_storage_version";
        version: number;
    };

type BookmarkPersistenceInput = {
    data: Pick<AppDataState, "allSongsRaw" | "bookmarks">;
    constants: {
        storageKey: string;
        storageVersion: number;
    };
};

/**
 * ブックマーク本体の読込・保存と、曲データ反映後の参照移行を扱う controller を作成する。
 */
export function createBookmarkPersistenceController({
    data,
    constants
}: BookmarkPersistenceInput) {
    const { storageKey, storageVersion } = constants;
    let loadedStorageVersion = storageVersion;
    let recoverableMalformedStorageText: string | null = null;
    let bookmarkStorageSnapshot: string | null | undefined = null;

    /**
     * ブックマーク移行デバッグログの有効状態を返す。
     */
    function isBookmarkMigrationDebugEnabled(): boolean {
        try {
            if (window.__KNK_DEBUG_BOOKMARK_MIGRATION__ === true) return true;
            return localStorage.getItem("debugBookmarkMigration") === "true";
        } catch {
            return false;
        }
    }

    /**
     * ブックマーク移行まわりのデバッグログを出力する。
     * @param message ログ本文
     * @param details 付加情報
     */
    function debugBookmarkMigration(message: string, details?: unknown): void {
        if (!isBookmarkMigrationDebugEnabled()) return;
        if (details === undefined) {
            console.debug("[bookmark-migration]", message);
            return;
        }
        console.debug("[bookmark-migration]", message, details);
    }

    /**
     * 保存候補の基礎となった保存データと現在値が一致しなければ、再読込要求を返す。
     * @param stored 現在の保存データ。未保存の場合はnull。
     */
    function getBookmarkStorageSnapshotFailure(
        stored: string | null
    ): BookmarkSaveFailure | null {
        if (bookmarkStorageSnapshot === stored) return null;
        return { ok: false, reason: "storage_reload_required" };
    }

    /**
     * 通常保存の直前に現在の保存データを再検査し、別タブが書いた将来形式を保護する。
     * 起動時に読み込めなかった破損データは、同じ文字列が残っている場合だけ復旧のため置換する。
     * 現在値が読込・保存成功時のsnapshotと異なる場合は、対応形式でも再読込を求める。
     */
    function inspectCurrentStorageBeforeWrite(): BookmarkSaveFailure | null {
        let stored: string | null;
        try {
            stored = localStorage.getItem(storageKey);
        } catch (error) {
            console.error("Failed to inspect bookmarks before saving", error);
            return { ok: false, reason: "storage_write_failed" };
        }
        if (!stored) {
            recoverableMalformedStorageText = null;
            return getBookmarkStorageSnapshotFailure(null);
        }

        let rawPayload: unknown;
        try {
            rawPayload = JSON.parse(stored);
        } catch (error) {
            if (stored !== recoverableMalformedStorageText) {
                console.error("Failed to parse bookmarks before saving", error);
                return { ok: false, reason: "storage_write_failed" };
            }
            debugBookmarkMigration("malformed bookmarks payload will be replaced", { error });
            return null;
        }

        const parsed = parseStoredBookmarksPayload(rawPayload, storageVersion);
        recoverableMalformedStorageText = null;
        if (parsed.supported) return getBookmarkStorageSnapshotFailure(stored);

        debugBookmarkMigration("unsupported future bookmarks payload detected before save", {
            storedVersion: parsed.version,
            currentVersion: storageVersion
        });
        return {
            ok: false,
            reason: "unsupported_storage_version",
            version: parsed.version
        };
    }

    /**
     * 指定したブックマークを保存し、成功後に保存 version の状態を更新する。
     * @param bookmarks 保存候補
     * @param allowUnsupportedFutureOverwrite 確認済みインポートによる将来形式の置換を許可するか
     */
    function writeBookmarks(
        bookmarks: Record<string, BookmarkRecord>,
        allowUnsupportedFutureOverwrite: boolean
    ): BookmarkSaveResult {
        if (!allowUnsupportedFutureOverwrite) {
            const inspectionFailure = inspectCurrentStorageBeforeWrite();
            if (inspectionFailure) {
                debugBookmarkMigration("bookmark save skipped for protected storage", inspectionFailure);
                return inspectionFailure;
            }
        }
        try {
            const stored = JSON.stringify(buildStoredBookmarksPayload(bookmarks, storageVersion));
            localStorage.setItem(storageKey, stored);
            loadedStorageVersion = storageVersion;
            recoverableMalformedStorageText = null;
            bookmarkStorageSnapshot = stored;
            return { ok: true };
        } catch (error) {
            console.error("Failed to save bookmarks", error);
            return { ok: false, reason: "storage_write_failed" };
        }
    }

    /**
     * 現在または指定されたブックマークを現行 schema でローカルストレージへ保存する。
     * @param bookmarks 保存候補。省略時は現在の state を保存する。
     */
    function saveBookmarks(
        bookmarks: Record<string, BookmarkRecord> = data.bookmarks
    ): BookmarkSaveResult {
        return writeBookmarks(bookmarks, false);
    }

    /**
     * 利用者が置換を確認したインポート内容を保存し、未対応の将来形式を明示的に置き換える。
     * @param bookmarks 確認済みのインポート内容
     */
    function replaceBookmarksFromConfirmedImport(
        bookmarks: Record<string, BookmarkRecord>
    ): BookmarkSaveResult {
        return writeBookmarks(bookmarks, true);
    }

    /**
     * ブックマークをローカルストレージから state へ読み込む。
     */
    function loadBookmarksFromStorage(): BookmarkLoadResult {
        loadedStorageVersion = storageVersion;
        recoverableMalformedStorageText = null;
        bookmarkStorageSnapshot = undefined;
        let stored: string | null;
        try {
            stored = localStorage.getItem(storageKey);
        } catch (error) {
            console.error("Failed to load bookmarks", error);
            data.bookmarks = {};
            return { supported: true };
        }
        if (!stored) {
            data.bookmarks = {};
            bookmarkStorageSnapshot = null;
            return { supported: true };
        }

        let rawPayload: unknown;
        try {
            rawPayload = JSON.parse(stored);
        } catch (error) {
            console.error("Failed to load bookmarks", error);
            data.bookmarks = {};
            recoverableMalformedStorageText = stored;
            return { supported: true };
        }

        const parsed = parseStoredBookmarksPayload(rawPayload, storageVersion);
        loadedStorageVersion = parsed.version;
        if (!parsed.supported) {
            data.bookmarks = {};
            debugBookmarkMigration("unsupported future bookmarks payload preserved", {
                storedVersion: parsed.version,
                currentVersion: storageVersion
            });
            return {
                supported: false,
                reason: "unsupported_storage_version",
                version: parsed.version
            };
        }
        data.bookmarks = parsed.bookmarks;
        bookmarkStorageSnapshot = stored;
        debugBookmarkMigration("loaded bookmarks payload", {
            storedVersion: parsed.version,
            bookmarkCount: Object.keys(parsed.bookmarks).length
        });
        return { supported: true };
    }

    /**
     * 読み込み済み曲データを使い、旧参照形式のブックマーク曲IDを現行形式へ移行する。
     */
    function migrateLegacyBookmarkSongRefs(): void {
        debugBookmarkMigration("start bookmark ref migration", {
            storedVersion: loadedStorageVersion,
            targetVersion: storageVersion,
            bookmarkCount: Object.keys(data.bookmarks).length,
            songRowCount: Array.isArray(data.allSongsRaw) ? data.allSongsRaw.length : 0
        });
        if (bookmarkStorageSnapshot === undefined || loadedStorageVersion > storageVersion) {
            debugBookmarkMigration("bookmark ref migration skipped", {
                changedBookmarkIds: [],
                currentVersion: loadedStorageVersion
            });
            return;
        }
        const requiresVersionUpgrade = loadedStorageVersion < storageVersion;
        const nextBookmarks: Record<string, BookmarkRecord> = {};
        Object.entries(data.bookmarks).forEach(([bookmarkId, bookmark]) => {
            nextBookmarks[bookmarkId] = { ...bookmark, songs: bookmark.songs.slice() };
        });
        const migration = migrateLegacyBookmarkSongRefsToCurrent({
            bookmarks: nextBookmarks,
            songRows: data.allSongsRaw
        });
        migration.changes.forEach((change) => {
            debugBookmarkMigration("bookmark refs migrated", change);
        });
        if (!migration.updated && !requiresVersionUpgrade) {
            debugBookmarkMigration("bookmark ref migration skipped", {
                changedBookmarkIds: [],
                currentVersion: loadedStorageVersion
            });
            return;
        }
        const saveResult = saveBookmarks(nextBookmarks);
        if (!saveResult.ok) {
            debugBookmarkMigration("failed to save migrated bookmarks payload", saveResult);
            return;
        }
        data.bookmarks = nextBookmarks;
        debugBookmarkMigration("saved migrated bookmarks payload", {
            changedBookmarkIds: migration.changedBookmarkIds,
            upgradedVersion: storageVersion
        });
    }

    return {
        loadBookmarksFromStorage,
        saveBookmarks,
        replaceBookmarksFromConfirmedImport,
        migrateLegacyBookmarkSongRefs
    };
}
