import {
    exportBookmarksAsJsonText as buildBookmarkExportJsonText,
    parseBookmarkImportText as parseBookmarkImportJsonText
} from "../lib/storage/bookmark-transfer.mjs";
import {
    buildStoredSearchStatePayload,
    parseStoredSearchStatePayload
} from "../lib/storage/search-state-schema.mjs";
import type { SearchBooleanFilterElements } from "../lib/search-boolean-filters.mjs";
import { collectSearchBooleanFilterState } from "../lib/search-boolean-filters.mjs";
import { getBookmarkSongRef } from "../lib/song-identity.mjs";
import type {
    BookmarkLoadResult,
    BookmarkSaveFailure,
    BookmarkSaveResult
} from "./bookmark-persistence.mjs";
import type {
    AppDataState,
    AppUiState,
    BookmarkRecord
} from "../state.types";

type StorageDataState = Pick<AppDataState, "allSongsRaw" | "bookmarks" | "activeBookmark" | "currentResults">;

type StorageUiElements = { searchBox?: Pick<HTMLInputElement, "value"> | null } &
    SearchBooleanFilterElements & Record<string, unknown>;

type StorageUiState = {
    el: StorageUiElements;
    search: Pick<AppUiState["search"],
        "dataReady" | "userTouchedQuery" | "userTouchedFilters" | "hasRestoredSearchState"
    >;
    date: Pick<AppUiState["date"], "bounds" | "pendingValues">;
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
    updateDisplay: () => void;
    cancelScheduledSearch: () => void;
    scheduleSearch: (options?: { immediate?: boolean }) => void;
};

/** 保存・入力検証・インポートの失敗理由を保持する。 */
export type StorageActionFailure =
    | BookmarkSaveFailure
    | Extract<ReturnType<typeof parseBookmarkImportJsonText>, { ok: false }>
    | { ok: false; reason: "invalid_name_type" | "empty_name" | "bookmark_not_found" | "song_not_found" | "duplicate_song" }
    | { ok: false; reason: "max_songs_per_bookmark"; limit: number };

/** 各操作に必要な成功時の値と、理由付きの失敗を区別する。 */
export type StorageActionResult<Success extends { ok: true } = { ok: true }> = Success | StorageActionFailure;

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
        updateDisplay,
        cancelScheduledSearch,
        scheduleSearch
    } = callbacks;
    let preservedUnsupportedActiveBookmarkId: string | null = null;

    /** 保存成功後にブックマークを確定し、選択状態・一覧・検索を一度だけ同期する。 */
    function commitBookmarkChange(
        nextBookmarks: Record<string, BookmarkRecord>,
        options?: { affectedBookmarkId?: string; isImport?: boolean; reorderedResults?: Song[] }
    ): BookmarkSaveResult {
        const saveResult = options?.isImport
            ? replaceBookmarksFromConfirmedImport(nextBookmarks)
            : saveBookmarks(nextBookmarks);
        if (saveResult.ok === false) return saveResult;

        const previousActiveBookmarkId = data.activeBookmark ||
            (options?.isImport ? preservedUnsupportedActiveBookmarkId : null);
        data.bookmarks = nextBookmarks;
        if (options?.reorderedResults) {
            data.currentResults.splice(0, data.currentResults.length, ...options.reorderedResults);
        }
        if (options?.isImport) preservedUnsupportedActiveBookmarkId = null;
        const nextActiveBookmarkId = previousActiveBookmarkId && Object.hasOwn(nextBookmarks, previousActiveBookmarkId)
            ? previousActiveBookmarkId
            : null;
        data.activeBookmark = nextActiveBookmarkId;
        if (previousActiveBookmarkId !== null && nextActiveBookmarkId === null) {
            applyActiveBookmark(null);
        } else {
            renderBookmarks();
            if (options?.reorderedResults) {
                updateDisplay();
            } else if (nextActiveBookmarkId && (options?.isImport || nextActiveBookmarkId === options?.affectedBookmarkId)) {
                scheduleSearch({ immediate: true });
            }
        }
        return saveResult;
    }

    /**
     * ブックマーク名を検証し、保存用に前後空白を除いた文字列を返す。
     * @param {unknown} bookmarkName
     */
    function validateBookmarkName(bookmarkName: unknown):
        | { ok: true; name: string }
        | { ok: false; reason: "invalid_name_type" | "empty_name" }
        | { ok: false; reason: "max_bookmark_name_length"; limit: number } {
        if (typeof bookmarkName !== "string") return { ok: false, reason: "invalid_name_type" };
        const trimmedName = bookmarkName.trim();
        if (!trimmedName) return { ok: false, reason: "empty_name" };
        if (trimmedName.length > MAX_BOOKMARK_NAME_LENGTH) {
            return { ok: false, reason: "max_bookmark_name_length", limit: MAX_BOOKMARK_NAME_LENGTH };
        }
        return { ok: true, name: trimmedName };
    }

    /**
     * インポート候補の JSON 文字列を解析し、全置き換え可能なブックマーク情報に整える。
     * @param {unknown} text
     */
    function parseBookmarkImportText(text: unknown) {
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
     */
    function exportBookmarksAsJsonText() {
        return buildBookmarkExportJsonText(data.bookmarks, BOOKMARK_STORAGE_VERSION);
    }

    /**
     * JSON 文字列からブックマークを全置き換えでインポートする。
     * @param {unknown} text
     */
    function importBookmarksFromJsonText(text: unknown): StorageActionResult<{ ok: true; bookmarkCount: number; songCount: number }> {
        const parsed = parseBookmarkImportText(text);
        if (parsed.ok === false) return parsed;

        const saveResult = commitBookmarkChange(parsed.bookmarks, { isImport: true });
        if (saveResult.ok === false) return saveResult;
        return {
            ok: true,
            bookmarkCount: parsed.bookmarkCount,
            songCount: parsed.songCount
        };
    }

    /**
     * 指定ブックマークから曲を削除し、必要なら検索結果を更新する。
     * @param {string} bookmarkId
     * @param {string} songKey
     */
    function removeSongFromBookmark(bookmarkId: string, songKey: string): StorageActionResult<{ ok: true; changed: boolean }> {
        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return { ok: false, reason: "bookmark_not_found" };

        const songIndex = bookmark.songs.indexOf(songKey);
        if (songIndex <= -1) {
            return { ok: false, reason: "song_not_found" };
        }
        const nextSongs = bookmark.songs.slice();
        nextSongs.splice(songIndex, 1);
        const nextBookmarks = {
            ...data.bookmarks,
            [bookmarkId]: { ...bookmark, songs: nextSongs }
        };
        const saveResult = commitBookmarkChange(nextBookmarks, { affectedBookmarkId: bookmarkId });
        if (saveResult.ok === false) return saveResult;
        return { ok: true, changed: true };
    }

    /**
     * 指定ブックマークへ曲を追加し、上限や重複を検証して結果を返す。
     * @param {string} bookmarkId
     * @param {string} songKey
     */
    function addSongToBookmark(bookmarkId: string, songKey: string): StorageActionResult<{ ok: true }> {
        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return { ok: false, reason: "bookmark_not_found" };
        if (bookmark.songs.includes(songKey)) return { ok: false, reason: "duplicate_song" };
        if (bookmark.songs.length >= MAX_SONGS_PER_BOOKMARK) {
            return { ok: false, reason: "max_songs_per_bookmark", limit: MAX_SONGS_PER_BOOKMARK };
        }
        const nextBookmarks = {
            ...data.bookmarks,
            [bookmarkId]: { ...bookmark, songs: [...bookmark.songs, songKey] }
        };
        const saveResult = commitBookmarkChange(nextBookmarks, { affectedBookmarkId: bookmarkId });
        if (saveResult.ok === false) return saveResult;
        return { ok: true };
    }

    /**
     * 新規ブックマークを作成する共通処理。
     * @param {unknown} bookmarkName
     * @param {string[]} initialSongs
     */
    function createBookmarkRecord(bookmarkName: unknown, initialSongs: string[]): StorageActionResult<{ ok: true; id: string }> {
        if (Object.keys(data.bookmarks).length >= MAX_BOOKMARK_COUNT) {
            return { ok: false, reason: "max_bookmark_count", limit: MAX_BOOKMARK_COUNT };
        }
        const nameValidation = validateBookmarkName(bookmarkName);
        if (nameValidation.ok === false) return nameValidation;
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
        const saveResult = commitBookmarkChange(nextBookmarks);
        if (saveResult.ok === false) return saveResult;
        return { ok: true, id: newId };
    }

    /**
     * 新規ブックマークを空の状態で作成する。
     * @param {unknown} bookmarkName
     */
    function createBookmark(bookmarkName: unknown): StorageActionResult<{ ok: true; id: string }> {
        return createBookmarkRecord(bookmarkName, []);
    }

    /**
     * 新規ブックマークを作成し、指定曲を初期登録する。
     * @param {unknown} bookmarkName
     * @param {string} songKey
     */
    function createBookmarkAndAdd(bookmarkName: unknown, songKey: string): StorageActionResult<{ ok: true; id: string }> {
        return createBookmarkRecord(bookmarkName, [songKey]);
    }

    /**
     * ブックマークを削除し、アクティブ状態と表示を更新する。
     * @param {string} bookmarkId
     */
    function deleteBookmark(bookmarkId: string): StorageActionResult<{ ok: true; changed: boolean }> {
        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return { ok: false, reason: "bookmark_not_found" };
        const nextBookmarks = { ...data.bookmarks };
        delete nextBookmarks[bookmarkId];
        const saveResult = commitBookmarkChange(nextBookmarks, { affectedBookmarkId: bookmarkId });
        if (saveResult.ok === false) return saveResult;
        return { ok: true, changed: true };
    }

    /**
     * ブックマーク名を変更して保存し、一覧を再描画する。
     * 変更対象がアクティブな場合は検索結果表示も即時更新する。
     * @param {string} bookmarkId
     * @param {unknown} newName
     */
    function renameBookmark(bookmarkId: string, newName: unknown): StorageActionResult<{ ok: true; changed: boolean }> {
        const bookmark = data.bookmarks[bookmarkId];
        if (!bookmark) return { ok: false, reason: "bookmark_not_found" };
        const nameValidation = validateBookmarkName(newName);
        if (nameValidation.ok === false) return nameValidation;

        if (bookmark.name === nameValidation.name) {
            return { ok: true, changed: false };
        }

        const nextBookmarks = {
            ...data.bookmarks,
            [bookmarkId]: { ...bookmark, name: nameValidation.name }
        };
        const saveResult = commitBookmarkChange(nextBookmarks, { affectedBookmarkId: bookmarkId });
        if (saveResult.ok === false) return saveResult;
        return { ok: true, changed: true };
    }

    /** 表示中の曲だけを移動し、非表示曲の位置を保ってアクティブブックマークの順序を確定する。 */
    function moveSongInActiveBookmark(fromSongKey: string, toSongKey: string): StorageActionResult<{ ok: true; changed: boolean }> {
        const bookmarkId = data.activeBookmark;
        const bookmark = bookmarkId ? data.bookmarks[bookmarkId] : null;
        if (!bookmarkId || !bookmark) return { ok: false, reason: "bookmark_not_found" };
        const fromIndex = data.currentResults.findIndex((song) => song.songKey === fromSongKey);
        const toIndex = data.currentResults.findIndex((song) => song.songKey === toSongKey);
        if (fromIndex === -1 || toIndex === -1) return { ok: false, reason: "song_not_found" };
        if (fromIndex === toIndex) return { ok: true, changed: false };

        const nextResults = data.currentResults.slice();
        const [movedItem] = nextResults.splice(fromIndex, 1);
        nextResults.splice(toIndex, 0, movedItem);
        const orderedKeys = nextResults.map((row) => getBookmarkSongRef(row)).filter(Boolean);
        const reorderSet = new Set(orderedKeys);
        let visibleIndex = 0;
        const nextSongs = bookmark.songs.map((songKey) => (
            reorderSet.has(songKey) ? orderedKeys[visibleIndex++] ?? songKey : songKey
        ));
        if (nextSongs.every((songKey, index) => songKey === bookmark.songs[index])) {
            return { ok: true, changed: false };
        }
        const saveResult = commitBookmarkChange({
            ...data.bookmarks,
            [bookmarkId]: { ...bookmark, songs: nextSongs }
        }, { affectedBookmarkId: bookmarkId, reorderedResults: nextResults });
        if (saveResult.ok === false) return saveResult;
        return { ok: true, changed: true };
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
     */
    function selectActiveBookmark(bookmarkId: string): StorageActionResult<{ ok: true; changed: boolean }> {
        if (!Object.hasOwn(data.bookmarks, bookmarkId)) {
            return { ok: false, reason: "bookmark_not_found" };
        }
        const changed = data.activeBookmark !== bookmarkId;
        applyActiveBookmark(bookmarkId);
        return { ok: true, changed };
    }

    /**
     * ブックマークによる検索対象の限定を解除する。
     * 検索条件の一括クリアからも呼ぶため、未選択でも副作用を同期する。
     */
    function clearActiveBookmark(): StorageActionResult<{ ok: true; changed: boolean }> {
        const changed = data.activeBookmark !== null || preservedUnsupportedActiveBookmarkId !== null;
        applyActiveBookmark(null);
        return { ok: true, changed };
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
        removeSongFromBookmark,
        moveSongInActiveBookmark
    };
}
