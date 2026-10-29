/**
 * 検索の実行タイミングを管理する controller。
 *
 * 即時実行と debounce 付き実行を切り替え、予約済み検索の取り消しを受け持つ。
 * 検索の予約中は、おすすめ表示の増減を止めて確定済みの結果を保つ。
 * 検索そのものは渡された searchController に任せる。
 */
type SearchCoordinatorInput = {
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
    debounceMs,
    searchController
}: SearchCoordinatorInput) {
    let debounceId: ReturnType<typeof setTimeout> | null = null;

    /**
     * 保留中の検索タイマーを解除し、未予約状態へ戻す。
     */
    function cancelScheduledSearch(): void {
        if (debounceId === null) return;
        clearTimeout(debounceId);
        debounceId = null;
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
        if (debounceId !== null) return false;
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
        debounceId = setTimeout(() => {
            debounceId = null;
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
