import type { SearchUiRuntimeState } from "../../state.types";
import { clearSearchQueryValidation } from "../search-query-validation.mjs";

type SearchScheduleOptions = {
    immediate?: boolean;
};

type SearchActionEventOptions = Event | SearchScheduleOptions;

type SearchActionsDateFilterController = {
    resetDateSelects: () => void;
    hasDateSelection: () => boolean;
};

type SearchActionsSearchCoordinator = {
    cancelScheduledSearch: () => void;
    scheduleSearch: (options?: SearchScheduleOptions) => void;
};

type SearchActionsSearchFiltersController = {
    resetFiltersToDefault: (options: { resetDateSelects: () => void }) => void;
    syncFormatCheckboxesFromState: () => void;
    needsFilterReset: (options: { hasDateSelection: () => boolean }) => boolean;
};

type SearchActionsStorageController = {
    saveSearchState: () => void;
    clearActiveBookmark: () => void;
};

type SearchUiActionsInput = {
    ui: { el: {
        searchBox?: Parameters<typeof clearSearchQueryValidation>[0];
        searchBoxError?: Parameters<typeof clearSearchQueryValidation>[1];
    } };
    search: Pick<SearchUiRuntimeState, "dataReady" | "userTouchedQuery" | "userTouchedFilters">;
    searchFiltersController: SearchActionsSearchFiltersController;
    dateFilterController: SearchActionsDateFilterController;
    searchCoordinator: SearchActionsSearchCoordinator;
    storageController: SearchActionsStorageController;
};

/**
 * 日付・検索実行・保存の各 controller を使い、検索 UI のリセット・同期操作を束ねる。
 * @param {SearchUiActionsInput} input
 */
export function createSearchUiActions({
    ui,
    search,
    searchFiltersController,
    dateFilterController,
    searchCoordinator,
    storageController
}: SearchUiActionsInput) {
    /**
     * 保留中の検索デバウンスタイマーを解除する。
     */
    function clearSearchDebounce(): void {
        searchCoordinator.cancelScheduledSearch();
    }

    /**
     * 検索語入力を初期化する。
     */
    function resetSearchQuery(): void {
        if (ui.el.searchBox) ui.el.searchBox.value = "";
        clearSearchQueryValidation(ui.el.searchBox, ui.el.searchBoxError);
        search.userTouchedQuery = false;
    }

    /**
     * フィルタ条件を既定状態へ戻す。
     */
    function resetSearchFilters(): void {
        searchFiltersController.resetFiltersToDefault({
            resetDateSelects: () => dateFilterController.resetDateSelects()
        });
    }

    /**
     * 検索語とフィルタをまとめて初期化し必要なら再検索する。
     * @param {boolean} shouldSearch
     */
    function resetSearchConditions(shouldSearch: boolean): void {
        clearSearchDebounce();
        resetSearchQuery();
        resetSearchFilters();
        if (shouldSearch && search.dataReady) {
            searchCoordinator.scheduleSearch({ immediate: true });
        }
    }

    /**
     * 検索条件とアクティブブックマークをリセットして保存する。
     */
    function clearSearch(): void {
        resetSearchConditions(false);
        storageController.clearActiveBookmark();
    }

    /**
     * フィルタ操作済みフラグを立てて検索・保存を行う。
     * @param {Event | { immediate?: boolean }} [options]
     */
    function markFilterTouched(options?: SearchActionEventOptions): void {
        search.userTouchedFilters = true;
        const scheduleOptions = options && "immediate" in options ? options : undefined;
        searchCoordinator.scheduleSearch(scheduleOptions);
        storageController.saveSearchState();
    }

    /**
     * 検索語操作済みフラグを立てて検索・保存を行う。
     */
    function markQueryTouched(): void {
        search.userTouchedQuery = true;
        searchCoordinator.scheduleSearch();
        storageController.saveSearchState();
    }

    /**
     * 未操作時に検索語の不整合があればリセットする。
     * @returns {boolean}
     */
    function syncSearchQueryIfNeeded(): boolean {
        if (search.userTouchedQuery) return false;
        const searchBox = ui.el.searchBox;
        if (!searchBox || searchBox.value === "") return false;
        resetSearchQuery();
        return true;
    }

    /**
     * 未操作時にフィルタの不整合があればリセットする。
     * @returns {boolean}
     */
    function syncSearchFiltersIfNeeded(): boolean {
        searchFiltersController.syncFormatCheckboxesFromState();
        if (search.userTouchedFilters) return false;
        if (!searchFiltersController.needsFilterReset({
            hasDateSelection: () => dateFilterController.hasDateSelection()
        })) {
            return false;
        }
        resetSearchFilters();
        return true;
    }

    /**
     * 検索語・フィルタ同期の結果に応じて再検索する。
     */
    function syncSearchUI(): void {
        const queryChanged = syncSearchQueryIfNeeded();
        const filtersChanged = syncSearchFiltersIfNeeded();
        const shouldSearch = queryChanged || filtersChanged;
        if (shouldSearch && search.dataReady) {
            searchCoordinator.scheduleSearch({ immediate: true });
        }
    }

    return {
        clearSearch,
        markFilterTouched,
        markQueryTouched,
        clearSearchDebounce,
        resetSearchConditions,
        syncSearchUI
    };
}
