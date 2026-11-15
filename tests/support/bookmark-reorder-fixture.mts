import { createStorageController } from "../../app/controllers/storage.mts";
import { createInitialSearchConditions } from "../../app/state.mts";
import type { AppDataState } from "../../app/state.types.mts";
import type { BookmarkSaveResult } from "../../app/controllers/bookmark-persistence.mts";

/** 並べ替えの保存成功を描画へ接続し、検索による表示範囲のリセットを検出する。 */
export function createBookmarkReorderFixture({ data, saveBookmarks, updateDisplay }: {
    data: AppDataState;
    saveBookmarks: (bookmarks: AppDataState["bookmarks"]) => BookmarkSaveResult;
    updateDisplay: () => void;
}) {
    return createStorageController({
        data,
        ui: {
            search: { dataReady: true, conditions: createInitialSearchConditions() }
        },
        searchFiltersController: { getSelectedFormatValues: () => [], applySelectedFormats: () => {} },
        bookmarkPersistenceController: {
            loadBookmarksFromStorage: () => ({ supported: true }),
            saveBookmarks: (bookmarks = data.bookmarks) => saveBookmarks(bookmarks),
            findBookmarkSaveBlocker: () => null,
            replaceBookmarksFromConfirmedImport: saveBookmarks
        },
        constants: {
            SEARCH_STATE_KEY: "reorder-search-state",
            DEFAULT_FORMATS: [],
            BOOKMARK_STORAGE_VERSION: 1,
            MAX_BOOKMARK_COUNT: Number.POSITIVE_INFINITY,
            MAX_SONGS_PER_BOOKMARK: Number.POSITIVE_INFINITY,
            MAX_BOOKMARK_NAME_LENGTH: Number.POSITIVE_INFINITY
        },
        callbacks: {
            renderSearchConditions: () => {},
            renderBookmarks: () => {},
            updateDisplay,
            cancelScheduledSearch: () => {},
            scheduleSearch: () => { throw new Error("並べ替えで検索をやり直さない"); }
        }
    });
}
