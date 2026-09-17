import type { SearchUiRuntimeState } from "../state.types";

type SearchCoordinatorInput = {
    search: Pick<SearchUiRuntimeState, "debounceId">;
    debounceMs: number;
    searchController: {
        search: () => void;
        refreshRecommendedDisplay: () => boolean;
    };
};

/**
 * 検索の即時実行とデバウンスを管理する。
 */
export function createSearchCoordinator({
    search,
    debounceMs,
    searchController
}: SearchCoordinatorInput) {
    /**
     * 保留中の検索タイマーを解除し、未予約状態へ戻す。
     */
    function cancelScheduledSearch(): void {
        if (!search.debounceId) return;
        clearTimeout(search.debounceId);
        search.debounceId = 0;
    }

    /**
     * 現在の曲データで検索を実行する。
     */
    function runSearch(): void {
        cancelScheduledSearch();
        searchController.search();
    }

    /** 検索待機中は確定済み結果を保持し、それ以外はおすすめ表示の拡張を委譲する。 */
    function refreshRecommendedDisplay(): boolean {
        if (search.debounceId) return false;
        return searchController.refreshRecommendedDisplay();
    }

    /**
     * デバウンス付きで検索を予約し、必要時は即時実行する。
     * @param options 検索予約方法
     */
    function scheduleSearch(options?: { immediate?: boolean }): void {
        cancelScheduledSearch();
        if (options?.immediate) {
            runSearch();
            return;
        }
        search.debounceId = setTimeout(() => {
            search.debounceId = 0;
            runSearch();
        }, debounceMs);
    }

    return {
        cancelScheduledSearch,
        scheduleSearch,
        refreshRecommendedDisplay,
        search: runSearch
    };
}
