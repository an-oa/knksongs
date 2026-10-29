/**
 * ブックマーク操作と検索条件の保存・復元を担う controller。
 *
 * ブックマークの作成・改名・削除、曲の追加・削除・並べ替え、検索対象としての選択、
 * エクスポート・インポートを受け持ち、件数・曲数・名前の長さの上限もここで検証する。
 * 検索条件は localStorage へ保存・復元する (../lib/storage/search-state-schema)。
 * ブックマーク本体の読み書きは ./bookmark-persistence.mts、
 * ファイルの解析と統合は ../lib/storage/bookmark-transfer に任せる。
 *
 * 操作の結果は StorageActionResult で返す。一覧の再描画・結果の更新・検索の予約は
 * callbacks 経由で行い、失敗の表示は呼び出し元の UI が行う。
 */
import {
    buildBookmarkImportPreviewEntries,
    exportBookmarksAsJsonText as buildBookmarkExportJsonText,
    mergeImportedBookmarks,
    parseBookmarkImportText as parseBookmarkImportJsonText
} from "../lib/storage/bookmark-transfer.mjs";
import type { BookmarkImportPreviewEntry } from "../lib/storage/bookmark-transfer.mjs";
import {
    buildStoredSearchStatePayload,
    parseStoredSearchStatePayload
} from "../lib/storage/search-state-schema.mjs";
import type { SearchBooleanFilterElements } from "../lib/search-boolean-filters.mjs";
import { collectSearchBooleanFilterState } from "../lib/search-boolean-filters.mjs";
import { getBookmarkSongRef } from "../lib/song-identity.mjs";
import type { DateSelectKind } from "../ui/date/filter.mjs";
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
    SearchBooleanFilterElements;

type StorageUiState = {
    el: StorageUiElements;
    search: Pick<AppUiState["search"],
        "dataReady" | "userTouchedQuery" | "userTouchedFilters" | "hasRestoredSearchState"
    >;
    date: Pick<AppUiState["date"], "bounds" | "pendingValues">;
};

type StorageConstants = {
    SEARCH_STATE_KEY: string;
    DEFAULT_FORMATS: string[];
    BOOKMARK_STORAGE_VERSION: number;
    MAX_BOOKMARK_COUNT: number;
    MAX_SONGS_PER_BOOKMARK: number;
    MAX_BOOKMARK_NAME_LENGTH: number;
};

type StorageSearchFiltersController = {
    getSelectedFormatValues: () => string[];
    applyStoredFilterState: (payload: Record<string, unknown>) => void;
};

type StorageCallbacks = {
    getDateSelectValue: (kind: DateSelectKind) => string;
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
    | Extract<ReturnType<typeof mergeImportedBookmarks>, { ok: false }>
    | { ok: false; reason: "invalid_name_type" | "empty_name" | "bookmark_not_found" | "song_not_found" | "duplicate_song" }
    | { ok: false; reason: "max_songs_per_bookmark"; limit: number }
    | { ok: false; reason: "songs_not_ready" };

/** 各操作に必要な成功時の値と、理由付きの失敗を区別する。 */
export type StorageActionResult<Success extends { ok: true } = { ok: true }> = Success | StorageActionFailure;

/** インポート確認画面に出すファイルの内容と、手元の状態。 */
export type BookmarkImportPreview = {
    ok: true;
    /** ファイル内のブックマークを作成日時順に並べ、手元との関係を添えたもの。 */
    entries: BookmarkImportPreviewEntry[];
    /** ファイル内のブックマーク数。 */
    bookmarkCount: number;
    /** ファイル内の曲数の合計。 */
    songCount: number;
    /** 手元のブックマーク数。 */
    currentBookmarkCount: number;
    /** 手元に置けるブックマーク数の上限。 */
    maxBookmarkCount: number;
    /** 追加・上書きを妨げる保存データの状態。全体の置換はこの状態でも行える。 */
    mergeBlocker: BookmarkSaveFailure | null;
};

type StorageControllerInput = {
    data: StorageDataState;
    ui: StorageUiState;
    searchFiltersController: StorageSearchFiltersController;
    bookmarkPersistenceController: {
        loadBookmarksFromStorage: () => BookmarkLoadResult;
        saveBookmarks: (bookmarks?: Record<string, BookmarkRecord>) => BookmarkSaveResult;
        findBookmarkSaveBlocker: () => BookmarkSaveFailure | null;
        replaceBookmarksFromConfirmedImport: (
            bookmarks: Record<string, BookmarkRecord>
        ) => BookmarkSaveResult;
    };
    constants: StorageConstants;
    callbacks: StorageCallbacks;
};

/**
 * ブックマークと検索状態の保存・復元を扱うストレージコントローラーを作成する。
 * @param input 保存対象の state と UI、保存形式と上限の定数、保存後に呼ぶ callback
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
        DEFAULT_FORMATS,
        BOOKMARK_STORAGE_VERSION,
        MAX_BOOKMARK_COUNT,
        MAX_SONGS_PER_BOOKMARK,
        MAX_BOOKMARK_NAME_LENGTH
    } = constants;
    const {
        loadBookmarksFromStorage,
        saveBookmarks,
        findBookmarkSaveBlocker,
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
     * インポート候補の JSON 文字列を解析し、検証と曲参照の移行を済ませたブックマーク情報に整える。
     * 確認画面・選択取り込み・全体の置換が共通で通る入口なので、
     * 旧形式の曲参照を移行できる曲データの読み込み後だけ受け付ける。
     * @param text ファイルから読み込んだ文字列
     */
    function parseBookmarkImportText(text: unknown) {
        if (!searchUiState.dataReady) return { ok: false, reason: "songs_not_ready" } as const;
        return parseBookmarkImportJsonText(text, {
            songRows: data.allSongsRaw,
            storageVersion: BOOKMARK_STORAGE_VERSION,
            maxBookmarkCount: MAX_BOOKMARK_COUNT,
            maxSongsPerBookmark: MAX_SONGS_PER_BOOKMARK,
            maxBookmarkNameLength: MAX_BOOKMARK_NAME_LENGTH
        });
    }

    /**
     * インポート確認画面に出す候補を、手元のブックマークと照合して返す。
     * @param text ファイルから読み込んだ文字列
     */
    function previewBookmarkImport(text: unknown): StorageActionResult<BookmarkImportPreview> {
        const parsed = parseBookmarkImportText(text);
        if (parsed.ok === false) return parsed;
        return {
            ok: true,
            entries: buildBookmarkImportPreviewEntries(data.bookmarks, parsed.bookmarks),
            bookmarkCount: parsed.bookmarkCount,
            songCount: parsed.songCount,
            currentBookmarkCount: Object.keys(data.bookmarks).length,
            maxBookmarkCount: MAX_BOOKMARK_COUNT,
            mergeBlocker: findBookmarkSaveBlocker()
        };
    }

    /**
     * 指定したブックマークを JSON エクスポート用文字列へ変換する。省略時はすべてを対象にする。
     * @param bookmarkIds 書き出すブックマークの ID。渡した順にファイルへ並べる。
     */
    function exportBookmarksAsJsonText(bookmarkIds?: readonly string[]) {
        const bookmarks = bookmarkIds
            ? Object.fromEntries(bookmarkIds
                .filter((bookmarkId) => Object.hasOwn(data.bookmarks, bookmarkId))
                .map((bookmarkId) => [bookmarkId, data.bookmarks[bookmarkId]] as const))
            : data.bookmarks;
        return buildBookmarkExportJsonText(bookmarks, BOOKMARK_STORAGE_VERSION);
    }

    /**
     * 今あるブックマークをすべて削除し、JSON 文字列の内容で置換する。
     * 利用者の確認後に呼ぶ前提で、未対応の新しい形式の保存データも置換する。
     * @param text ファイルから読み込んだ文字列
     */
    function replaceAllBookmarksFromJsonText(text: unknown): StorageActionResult<{ ok: true; bookmarkCount: number; songCount: number }> {
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
     * JSON 文字列から選んだブックマークだけを取り込む。同じ ID は上書きし、新しい ID は追加する。
     * 全体の置換と違い、新しい形式の保存データや別タブの変更を通常の保存と同じ検査で守る。
     * @param text ファイルから読み込んだ文字列
     * @param bookmarkIds 取り込むファイル内のブックマーク ID
     */
    function importSelectedBookmarksFromJsonText(
        text: unknown,
        bookmarkIds: readonly string[]
    ): StorageActionResult<{ ok: true; addedCount: number; updatedCount: number }> {
        const parsed = parseBookmarkImportText(text);
        if (parsed.ok === false) return parsed;
        const merged = mergeImportedBookmarks({
            current: data.bookmarks,
            imported: parsed.bookmarks,
            selectedIds: bookmarkIds,
            storageVersion: BOOKMARK_STORAGE_VERSION,
            maxBookmarkCount: MAX_BOOKMARK_COUNT
        });
        if (merged.ok === false) return merged;
        if (merged.addedIds.length === 0 && merged.updatedIds.length === 0) {
            return { ok: true, addedCount: 0, updatedCount: 0 };
        }

        const activeBookmarkId = data.activeBookmark;
        const saveResult = commitBookmarkChange(merged.bookmarks, {
            affectedBookmarkId: activeBookmarkId && merged.updatedIds.includes(activeBookmarkId)
                ? activeBookmarkId
                : undefined
        });
        if (saveResult.ok === false) return saveResult;
        return {
            ok: true,
            addedCount: merged.addedIds.length,
            updatedCount: merged.updatedIds.length
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
     * @param kind 値を読む側
     */
    function getDateValueForStorage(kind: DateSelectKind): string {
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
        previewBookmarkImport,
        replaceAllBookmarksFromJsonText,
        importSelectedBookmarksFromJsonText,
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
