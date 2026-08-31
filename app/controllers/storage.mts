import {
    exportBookmarksAsJsonText as buildBookmarkExportJsonText,
    parseBookmarkImportText as parseBookmarkImportJsonText
} from "../lib/storage/bookmark-transfer.mjs";
import {
    buildStoredSearchStatePayload,
    parseStoredSearchStatePayload
} from "../lib/storage/search-state-schema.mjs";
import { collectSearchBooleanFilterState } from "../lib/search-boolean-filters.mjs";
import type {
    BookmarkLoadResult,
    BookmarkSaveFailure,
    BookmarkSaveResult
} from "./bookmark-persistence.mjs";
import type {
    AppDataState,
    AppUiState,
    AppUiElements,
    BookmarkRecord
} from "../state.types";

type StorageDataState = Pick<AppDataState, "allSongsRaw" | "bookmarks" | "activeBookmark">;

type StorageUiElements = Pick<AppUiElements, "searchBox"> & Record<string, Element | null | undefined>;

type StorageUiState = Pick<AppUiState, "search" | "date"> & {
    el: StorageUiElements;
};

type StorageConstants = {
    SEARCH_STATE_KEY: string;
    DEFAULT_FORMATS?: string[];
    BOOKMARK_STORAGE_VERSION?: number;
    MAX_BOOKMARK_COUNT?: number;
    MAX_SONGS_PER_BOOKMARK?: number;
    MAX_BOOKMARK_NAME_LENGTH?: number;
};

type StorageSearchFiltersController = {
    getSelectedFormatValues: () => string[];
    applyStoredFilterState: (payload: Record<string, unknown>) => void;
};

type StorageCallbacks = {
    getDateSelectValue: (kind: string) => string;
    applyPendingDateValues: () => void;
    renderBookmarks: () => void;
    cancelScheduledSearch: () => void;
    scheduleSearch: (options?: { immediate?: boolean }) => void;
};

type StorageActionResult = {
    ok: boolean;
    reason?: string;
    name?: string;
    id?: string;
    changed?: boolean;
    text?: string;
    bookmarks?: Record<string, BookmarkRecord>;
    bookmarkCount?: number;
    songCount?: number;
    limit?: number;
    bookmarkName?: string;
    version?: number;
};

type StorageControllerInput = {
    data: StorageDataState;
    ui: StorageUiState;
    searchFiltersController: StorageSearchFiltersController;
    bookmarkPersistenceController: {
        loadBookmarksFromStorage: () => BookmarkLoadResult;
        saveBookmarks: (bookmarks?: Record<string, BookmarkRecord>) => BookmarkSaveResult;
        replaceBookmarksFromConfirmedImport: (
            bookmarks: Record<string, BookmarkRecord>
        ) => BookmarkSaveResult;
    };
    constants: StorageConstants;
    callbacks: StorageCallbacks;
};

/**
 * ブックマークと検索状態の保存・復元を扱うストレージコントローラーを作成する。
 * @param {StorageControllerInput} input
 */
export function createStorageController({
    data,
    ui,
    searchFiltersController,
    bookmarkPersistenceController,
    constants,
    callbacks
}: StorageControllerInput) {
    const searchUiState = ui.search;
    const dateUi = ui.date;
    const {
        SEARCH_STATE_KEY,
        DEFAULT_FORMATS = [],
        BOOKMARK_STORAGE_VERSION = 1,
        MAX_BOOKMARK_COUNT = Number.POSITIVE_INFINITY,
        MAX_SONGS_PER_BOOKMARK = Number.POSITIVE_INFINITY,
        MAX_BOOKMARK_NAME_LENGTH = Number.POSITIVE_INFINITY
    } = constants;
    const {
        loadBookmarksFromStorage,
        saveBookmarks,
        replaceBookmarksFromConfirmedImport
    } = bookmarkPersistenceController;
    const {
        getDateSelectValue,
        applyPendingDateValues,
        renderBookmarks,
        cancelScheduledSearch,
        scheduleSearch
    } = callbacks;
    let preservedUnsupportedActiveBookmarkId: string | null = null;
    /**
     * 成功時の共通レスポンスを組み立てる。
     * @param {Partial<StorageActionResult> | undefined} [extra]
     * @returns {StorageActionResult}
     */
    function buildActionOk(extra: Partial<StorageActionResult> | undefined = undefined): StorageActionResult {
        return { ok: true, ...(extra || {}) };
    }

    /**
     * 失敗理由付きの共通レスポンスを組み立てる。
     * @param {string} reason
     * @param {Partial<StorageActionResult> | undefined} [extra]
     * @returns {StorageActionResult}
     */
    function buildActionFail(
        reason: string,
        extra: Partial<StorageActionResult> | undefined = undefined
    ): StorageActionResult {
        return { ok: false, reason, ...(extra || {}) };
    }

    /**
     * 永続化層の保存失敗をブックマーク操作の失敗結果へ変換する。
     * @param result 保存失敗の内容
     */
    function buildBookmarkSaveFailure(result: BookmarkSaveFailure): StorageActionResult {
        return buildActionFail(
            result.reason,
            "version" in result ? { version: result.version } : undefined
        );
    }

    /**
     * ブックマーク名を検証し、保存用に前後空白を除いた文字列を返す。
     * @param {unknown} bookmarkName
     * @returns {StorageActionResult}
     */
    function validateBookmarkName(bookmarkName: unknown): StorageActionResult {
        if (typeof bookmarkName !== "string") return buildActionFail("invalid_name_type");
        const trimmedName = bookmarkName.trim();
        if (!trimmedName) return buildActionFail("empty_name");
        if (trimmedName.length > MAX_BOOKMARK_NAME_LENGTH) {
            return buildActionFail("max_bookmark_name_length", { limit: MAX_BOOKMARK_NAME_LENGTH });
        }
        return buildActionOk({ name: trimmedName });
    }

    /**
     * インポート候補の JSON 文字列を解析し、全置き換え可能なブックマーク情報に整える。
     * @param {unknown} text
     * @returns {StorageActionResult}
     */
    function parseBookmarkImportText(text: unknown): StorageActionResult {
        return parseBookmarkImportJsonText(text, {
            songRows: data.allSongsRaw,
            storageVersion: BOOKMARK_STORAGE_VERSION,
            maxBookmarkCount: MAX_BOOKMARK_COUNT,
            maxSongsPerBookmark: MAX_SONGS_PER_BOOKMARK,
            maxBookmarkNameLength: MAX_BOOKMARK_NAME_LENGTH
        });
    }

    /**
     * 現在のブックマークを JSON エクスポート用文字列へ変換する。
     * @returns {StorageActionResult}
     */
    function exportBookmarksAsJsonText(): StorageActionResult {
        return buildBookmarkExportJsonText(data.bookmarks, BOOKMARK_STORAGE_VERSION);
    }

    /**
     * JSON 文字列からブックマークを全置き換えでインポートする。
     * @param {unknown} text
     * @returns {StorageActionResult}
     */
    function importBookmarksFromJsonText(text: unknown): StorageActionResult {
        const parsed = parseBookmarkImportText(text);
        if (!parsed.ok) return parsed;

        const importedBookmarks = parsed.bookmarks || {};
        const saveResult = replaceBookmarksFromConfirmedImport(importedBookmarks);
        if (saveResult.ok === false) return buildBookmarkSaveFailure(saveResult);

        const previousActiveBookmarkId = data.activeBookmark || preservedUnsupportedActiveBookmarkId;
        data.bookmarks = importedBookmarks;
        const nextActiveBookmarkId = previousActiveBookmarkId &&
            Object.hasOwn(data.bookmarks, previousActiveBookmarkId)
            ? previousActiveBookmarkId
            : null;
        const activeBookmarkWasRemoved = previousActiveBookmarkId !== null && nextActiveBookmarkId === null;
        preservedUnsupportedActiveBookmarkId = null;
        data.activeBookmark = nextActiveBookmarkId;
        if (activeBookmarkWasRemoved) {
            applyActiveBookmark(null);
        } else {
            renderBookmarks();
        }
        if (!activeBookmarkWasRemoved && data.activeBookmark) {
            scheduleSearch({ immediate: true });
        }
        return buildActionOk({
            bookmarkCount: parsed.bookmarkCount,
            songCount: parsed.songCount
        });
    }

    /**
     * 指定ブックマークから曲を削除し、必要なら検索結果を更新する。
     * @param {string} bookmarkId
     * @param {string} songKey
     * @returns {StorageActionResult}
     */
    function removeSongFromBookmark(bookmarkId: string, songKey: string): StorageActionResult {
        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return buildActionFail("bookmark_not_found");

        const songIndex = bookmark.songs.indexOf(songKey);
        if (songIndex <= -1) {
            return buildActionFail("song_not_found");
        }
        const nextSongs = bookmark.songs.slice();
        nextSongs.splice(songIndex, 1);
        const nextBookmarks = {
            ...data.bookmarks,
            [bookmarkId]: { ...bookmark, songs: nextSongs }
        };
        const saveResult = saveBookmarks(nextBookmarks);
        if (saveResult.ok === false) return buildBookmarkSaveFailure(saveResult);
        data.bookmarks = nextBookmarks;
        renderBookmarks();
        if (data.activeBookmark === bookmarkId) {
            scheduleSearch({ immediate: true });
        }
        return buildActionOk({ changed: true });
    }

    /**
     * 指定ブックマークへ曲を追加し、上限や重複を検証して結果を返す。
     * @param {string} bookmarkId
     * @param {string} songKey
     * @returns {StorageActionResult}
     */
    function addSongToBookmark(bookmarkId: string, songKey: string): StorageActionResult {
        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return buildActionFail("bookmark_not_found");
        if (bookmark.songs.includes(songKey)) return buildActionFail("duplicate_song");
        if (bookmark.songs.length >= MAX_SONGS_PER_BOOKMARK) {
            return buildActionFail("max_songs_per_bookmark", { limit: MAX_SONGS_PER_BOOKMARK });
        }
        const nextBookmarks = {
            ...data.bookmarks,
            [bookmarkId]: { ...bookmark, songs: [...bookmark.songs, songKey] }
        };
        const saveResult = saveBookmarks(nextBookmarks);
        if (saveResult.ok === false) return buildBookmarkSaveFailure(saveResult);
        data.bookmarks = nextBookmarks;
        renderBookmarks();
        if (data.activeBookmark === bookmarkId) {
            scheduleSearch({ immediate: true });
        }
        return buildActionOk();
    }

    /**
     * 新規ブックマークを作成する共通処理。
     * @param {unknown} bookmarkName
     * @param {string[]} initialSongs
     * @returns {StorageActionResult}
     */
    function createBookmarkRecord(bookmarkName: unknown, initialSongs: string[]): StorageActionResult {
        if (Object.keys(data.bookmarks).length >= MAX_BOOKMARK_COUNT) {
            return buildActionFail("max_bookmark_count", { limit: MAX_BOOKMARK_COUNT });
        }
        const nameValidation = validateBookmarkName(bookmarkName);
        if (!nameValidation.ok) return nameValidation;
        const now = Date.now();
        const newId = `p_${now}`;
        const nextBookmarks = {
            ...data.bookmarks,
            [newId]: {
                name: nameValidation.name,
                songs: Array.isArray(initialSongs) ? initialSongs.slice() : [],
                createdAt: now
            }
        };
        const saveResult = saveBookmarks(nextBookmarks);
        if (saveResult.ok === false) return buildBookmarkSaveFailure(saveResult);
        data.bookmarks = nextBookmarks;
        renderBookmarks();
        return buildActionOk({ id: newId });
    }

    /**
     * 新規ブックマークを空の状態で作成する。
     * @param {unknown} bookmarkName
     * @returns {StorageActionResult}
     */
    function createBookmark(bookmarkName: unknown): StorageActionResult {
        return createBookmarkRecord(bookmarkName, []);
    }

    /**
     * 新規ブックマークを作成し、指定曲を初期登録する。
     * @param {unknown} bookmarkName
     * @param {string} songKey
     * @returns {StorageActionResult}
     */
    function createBookmarkAndAdd(bookmarkName: unknown, songKey: string): StorageActionResult {
        return createBookmarkRecord(bookmarkName, [songKey]);
    }

    /**
     * ブックマークを削除し、アクティブ状態と表示を更新する。
     * @param {string} bookmarkId
     * @returns {StorageActionResult}
     */
    function deleteBookmark(bookmarkId: string): StorageActionResult {
        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return buildActionFail("bookmark_not_found");
        const wasActive = data.activeBookmark === bookmarkId;
        const nextBookmarks = { ...data.bookmarks };
        delete nextBookmarks[bookmarkId];
        const saveResult = saveBookmarks(nextBookmarks);
        if (saveResult.ok === false) return buildBookmarkSaveFailure(saveResult);
        data.bookmarks = nextBookmarks;
        if (wasActive) {
            applyActiveBookmark(null);
        } else {
            renderBookmarks();
        }
        return buildActionOk({ changed: true });
    }

    /**
     * ブックマーク名を変更して保存し、一覧を再描画する。
     * 変更対象がアクティブな場合は検索結果表示も即時更新する。
     * @param {string} bookmarkId
     * @param {string} newName
     * @returns {StorageActionResult}
     */
    function renameBookmark(bookmarkId: string, newName: string): StorageActionResult {
        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return buildActionFail("bookmark_not_found");
        const nameValidation = validateBookmarkName(newName);
        if (!nameValidation.ok) return nameValidation;

        if (bookmark.name === nameValidation.name) {
            return buildActionOk({ changed: false });
        }

        const nextBookmarks = {
            ...data.bookmarks,
            [bookmarkId]: { ...bookmark, name: nameValidation.name }
        };
        const saveResult = saveBookmarks(nextBookmarks);
        if (saveResult.ok === false) return buildBookmarkSaveFailure(saveResult);
        data.bookmarks = nextBookmarks;
        renderBookmarks();
        if (data.activeBookmark === bookmarkId) {
            scheduleSearch({ immediate: true });
        }
        return buildActionOk({ changed: true });
    }

    /**
     * 保存時の日付条件を、UI適用前は保留値から、適用後はselect要素から取得する。
     * @param {"from" | "to"} kind
     */
    function getDateValueForStorage(kind: "from" | "to"): string {
        if (dateUi.pendingValues) {
            const pendingValue = dateUi.pendingValues[kind];
            return typeof pendingValue === "string" ? pendingValue : "";
        }
        return getDateSelectValue(kind);
    }

    /**
     * 現在の検索条件をローカルストレージへ保存する。
     */
    function saveSearchState(): void {
        try {
            const searchBox = ui.el.searchBox;
            const payload = buildStoredSearchStatePayload({
                query: searchBox && typeof searchBox.value === "string" ? searchBox.value : "",
                ...collectSearchBooleanFilterState(ui),
                dateFrom: getDateValueForStorage("from"),
                dateTo: getDateValueForStorage("to"),
                formats: searchFiltersController.getSelectedFormatValues(),
                activeBookmarkId: data.activeBookmark || preservedUnsupportedActiveBookmarkId
            });
            localStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn("Failed to save search state", e);
        }
    }

    /**
     * アクティブブックマークを変更し、検索状態・一覧表示と検索可能時の結果を同期する。
     * @param {string | null} activeBookmarkId
     */
    function applyActiveBookmark(activeBookmarkId: string | null): void {
        preservedUnsupportedActiveBookmarkId = null;
        data.activeBookmark = activeBookmarkId;
        saveSearchState();
        renderBookmarks();
        if (searchUiState.dataReady) {
            scheduleSearch({ immediate: true });
        } else {
            cancelScheduledSearch();
        }
    }

    /**
     * 指定ブックマークを検索対象として選択する。
     * @param {string} bookmarkId
     * @returns {StorageActionResult}
     */
    function selectActiveBookmark(bookmarkId: string): StorageActionResult {
        if (!Object.hasOwn(data.bookmarks, bookmarkId)) {
            return buildActionFail("bookmark_not_found");
        }
        const changed = data.activeBookmark !== bookmarkId;
        applyActiveBookmark(bookmarkId);
        return buildActionOk({ changed });
    }

    /**
     * ブックマークによる検索対象の限定を解除する。
     * 検索条件の一括クリアからも呼ぶため、未選択でも副作用を同期する。
     * @returns {StorageActionResult}
     */
    function clearActiveBookmark(): StorageActionResult {
        const changed = data.activeBookmark !== null || preservedUnsupportedActiveBookmarkId !== null;
        applyActiveBookmark(null);
        return buildActionOk({ changed });
    }

    /**
     * 保存済み検索条件を UI と state へ復元する。
     */
    function restoreSearchStateFromStorage(bookmarkLoadResult: BookmarkLoadResult): void {
        preservedUnsupportedActiveBookmarkId = null;
        if (!bookmarkLoadResult.supported) data.activeBookmark = null;
        try {
            const raw = localStorage.getItem(SEARCH_STATE_KEY);
            if (!raw) return;
            const parsed = parseStoredSearchStatePayload(raw, {
                defaultFormats: DEFAULT_FORMATS
            });
            const searchBox = ui.el.searchBox;
            if (searchBox && typeof parsed.query === "string") {
                searchBox.value = parsed.query;
            }
            searchFiltersController.applyStoredFilterState(parsed);
            dateUi.pendingValues = {
                from: parsed.dateFrom,
                to: parsed.dateTo
            };
            if (dateUi.bounds) {
                applyPendingDateValues();
            }
            const canValidateActiveBookmark = bookmarkLoadResult.supported;
            const activeBookmarkId = canValidateActiveBookmark && parsed.activeBookmarkId &&
                Object.hasOwn(data.bookmarks, parsed.activeBookmarkId)
                ? parsed.activeBookmarkId
                : null;
            const activeBookmarkWasInvalid = canValidateActiveBookmark &&
                parsed.activeBookmarkId !== null &&
                activeBookmarkId === null;
            preservedUnsupportedActiveBookmarkId = canValidateActiveBookmark
                ? null
                : parsed.activeBookmarkId;
            data.activeBookmark = activeBookmarkId;
            searchUiState.userTouchedQuery = true;
            searchUiState.userTouchedFilters = true;
            searchUiState.hasRestoredSearchState = true;
            if (activeBookmarkWasInvalid) {
                parsed.activeBookmarkId = null;
                localStorage.setItem(
                    SEARCH_STATE_KEY,
                    JSON.stringify(buildStoredSearchStatePayload(parsed))
                );
            }
        } catch (e) {
            console.warn("Failed to restore search state", e);
        }
    }

    /**
     * ブックマークと検索条件を読み込み、参照を照合して一度だけ一覧を描画する。
     */
    function restorePersistedState(): void {
        const bookmarkLoadResult = loadBookmarksFromStorage();
        restoreSearchStateFromStorage(bookmarkLoadResult);
        renderBookmarks();
    }

    return {
        restorePersistedState,
        saveBookmarks,
        exportBookmarksAsJsonText,
        parseBookmarkImportText,
        importBookmarksFromJsonText,
        addSongToBookmark,
        createBookmark,
        createBookmarkAndAdd,
        deleteBookmark,
        renameBookmark,
        saveSearchState,
        selectActiveBookmark,
        clearActiveBookmark,
        removeSongFromBookmark
    };
}
