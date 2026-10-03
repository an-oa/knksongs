import { createStorageController } from "../../app/controllers/storage.mts";
import type { AppDataState } from "../../app/state.types";
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
            el: {},
            search: { dataReady: true, userTouchedQuery: false, userTouchedFilters: false, hasRestoredSearchState: false },
            date: { bounds: null, pendingValues: null }
        },
        searchFiltersController: { getSelectedFormatValues: () => [], applyStoredFilterState: () => {} },
        bookmarkPersistenceController: {
            loadBookmarksFromStorage: () => ({ supported: true }),
            saveBookmarks: (bookmarks = data.bookmarks) => saveBookmarks(bookmarks),
            replaceBookmarksFromConfirmedImport: saveBookmarks
        },
        constants: { SEARCH_STATE_KEY: "reorder-search-state" },
        callbacks: {
            getDateSelectValue: () => "",
            applyPendingDateValues: () => {},
            renderBookmarks: () => {},
            updateDisplay,
            cancelScheduledSearch: () => {},
            scheduleSearch: () => { throw new Error("並べ替えで検索をやり直さない"); }
        }
    });
}
