import { filterSongsByCriteria } from "../lib/search-filters.mjs";
import { isValidEmptySearchQuery, parseSearchQuery } from "../lib/search-query.mjs";
import type { ParsedSearchQuery } from "../lib/search-query.mjs";
import { pickRecommendedSongsWithCache } from "../lib/search-recommendation.mjs";
import {
    collectSearchBooleanFilterState,
    hasSelectedSearchBooleanFilterState
} from "../lib/search-boolean-filters.mjs";
import { resolveSongRefs } from "../lib/song-lookup.mjs";
import { validateSearchQueryInput } from "../ui/search-query-validation.mjs";

type SearchOutcome = {
    mode: "recommended" | "search" | "bookmark";
    results: Song[];
    displayLimit: number;
    label: string;
};

/**
 * 検索条件の収集・結果解決・推薦選曲を管理するコントローラーを作成する。
 * @param {SearchControllerInput} input
 */
export function createSearchController({
    data,
    ui,
    searchFiltersController,
    dateFilterController,
    constants,
    callbacks
}: SearchControllerInput) {
    const {
        RANDOM_DISPLAY_COUNT,
        MIN_PERFORMANCE_FOR_RANDOM,
        RESULT_DISPLAY_BATCH_SIZE
    } = constants;
    const searchUiState = ui.search;
    const lookupUi = ui.lookup;
    const updateDisplay = callbacks.updateDisplay;
    const scrollResultsPaneToTop = callbacks.scrollResultsPaneToTop;
    const getRecommendedDisplayCount = callbacks.getRecommendedDisplayCount || (() => RANDOM_DISPLAY_COUNT);
    // 確定時の結果とモードを保持する。追加表示後の上限は data.displayLimit を参照する。
    let committedOutcome: SearchOutcome | null = null;

    /**
     * 検索入力の収集から結果反映までの処理を行う。
     */
    function search(): void {
        const searchInput = collectSearchInput();
        validateSearchQueryInput(ui.el.searchBox, ui.el.searchBoxError, searchInput.parsedQuery);
        const outcome = resolveSearchResults(searchInput.searchState, searchInput.parsedQuery);
        applySearchOutcome(outcome);
        scrollResultsPaneToTop();
    }

    /**
     * 検索実行に必要な入力情報を収集する。
     * @returns {SearchInput}
     */
    function collectSearchInput(): SearchInput {
        const searchState = getSearchState();
        return {
            searchState,
            parsedQuery: parseSearchQuery(searchState.queryRaw)
        };
    }

    /**
     * 検索結果を state と UI へ反映する。
     * @param {SearchOutcome} outcome
     */
    function applySearchOutcome(outcome: SearchOutcome): void {
        data.currentResults = outcome.results;
        data.displayLimit = outcome.displayLimit;
        committedOutcome = outcome;
        if (ui.el.resultCount) ui.el.resultCount.innerText = outcome.label;
        updateDisplay();
    }

    /**
     * 現在の UI 入力から検索条件オブジェクトを生成する。
     * @returns {SearchState}
     */
    function getSearchState(): SearchState {
        const fromRange = dateFilterController.getPartialDateRange("from");
        const toRange = dateFilterController.getPartialDateRange("to");
        return {
            queryRaw: ui.el.searchBox.value.trim(),
            ...collectSearchBooleanFilterState(ui),
            dateFromKey: fromRange ? fromRange.minKey : null,
            dateToKey: toRange ? toRange.maxKey : null,
            hasDateFilter: Boolean(fromRange || toRange)
        };
    }

    /**
     * 条件未指定時のおすすめ表示モードかどうかを判定する。
     * @param {SearchState} searchState
     * @param parsedQuery 解析済み検索語
     * @returns {boolean}
     */
    function isRecommendedMode(searchState: SearchState, parsedQuery: ParsedSearchQuery): boolean {
        return !data.activeBookmark &&
            isValidEmptySearchQuery(parsedQuery) &&
            !hasSelectedSearchBooleanFilterState(searchState) &&
            !searchState.hasDateFilter &&
            searchFiltersController.areAllFormatsSelected();
    }

    /**
     * 通常検索・ブックマーク検索・おすすめ表示を切り替えて結果を作る。
     * @param {SearchState} searchState
     * @param parsedQuery 解析済み検索語
     * @returns {SearchOutcome}
     */
    function resolveSearchResults(searchState: SearchState, parsedQuery: ParsedSearchQuery): SearchOutcome {
        if (data.activeBookmark) {
            const bookmark = data.bookmarks[data.activeBookmark];
            if (bookmark) {
                const bookmarkRows = resolveSongRefs(lookupUi, data.allSongsRaw, bookmark.songs);
                const results = filterSongsByCriteria(
                    bookmarkRows,
                    searchState,
                    searchUiState.selectedFormats,
                    parsedQuery
                );
                return buildIncrementalSearchOutcome(
                    results,
                    `ブックマーク: ${bookmark.name} (${results.length} 件)`,
                    "bookmark"
                );
            }
        }

        if (isRecommendedMode(searchState, parsedQuery)) {
            return buildRecommendedOutcome();
        }

        const results = filterSongsByCriteria(
            data.allSongsRaw,
            searchState,
            searchUiState.selectedFormats,
            parsedQuery
        );
        return buildIncrementalSearchOutcome(results, `${results.length} 件がヒット`);
    }

    /**
     * 段階表示用の件数上限を含む検索結果オブジェクトを作る。
     * @param {Song[]} results
     * @param {string} label
     * @param mode 確定する検索モード
     * @returns {SearchOutcome}
     */
    function buildIncrementalSearchOutcome(
        results: Song[],
        label: string,
        mode: "search" | "bookmark" = "search"
    ): SearchOutcome {
        return {
            mode,
            results,
            displayLimit: Math.min(results.length, getInitialDisplayLimit(RESULT_DISPLAY_BATCH_SIZE)),
            label
        };
    }

    /** 初期描画件数を画面サイズに合わせ、未指定・不正値の場合は従来の件数を使う。 */
    function getInitialDisplayLimit(defaultCount: number): number {
        const count = callbacks.getInitialDisplayCount?.(defaultCount);
        return Number.isFinite(count) && count >= 1
            ? Math.min(defaultCount, Math.floor(count))
            : defaultCount;
    }

    /**
     * おすすめ表示で抽出する件数を、48 件基準と現在の表示領域に合わせて決定する。
     * @returns {number}
     */
    function getRecommendedResultCount(): number {
        const displayCount = getRecommendedDisplayCount();
        const count = Number.isFinite(displayCount) ? Math.floor(displayCount) : RANDOM_DISPLAY_COUNT;
        return Math.max(RANDOM_DISPLAY_COUNT, count);
    }

    /** 選曲件数と描画上限を個別に決め、リサイズ時は既存の選曲・追加表示を保持する。 */
    function buildRecommendedOutcome(retainedResultCount = 0, retainedDisplayLimit = 0): SearchOutcome {
        const recommendedCount = getRecommendedResultCount();
        const results = pickRecommended(Math.max(recommendedCount, retainedResultCount));
        return {
            mode: "recommended",
            results,
            displayLimit: Math.min(results.length, Math.max(
                retainedDisplayLimit,
                getInitialDisplayLimit(recommendedCount)
            )),
            label: "おすすめを表示中"
        };
    }

    /**
     * おすすめ曲をキャッシュ付きで選定して返す。
     * @param {number} count
     * @returns {Song[]}
     */
    function pickRecommended(count: number): Song[] {
        const { songs, cache } = pickRecommendedSongsWithCache(data.allSongsRaw, {
            count,
            minPerformanceCount: MIN_PERFORMANCE_FOR_RANDOM,
            currentCache: searchUiState.recommendedCache
        });
        searchUiState.recommendedCache = cache;
        return songs;
    }

    /**
     * 確定済みのおすすめ結果で件数が増える場合だけ表示を更新する。
     * 検索待機中の抑制は呼び出し元の検索 coordinator が担う。
     * リサイズ追随用のため、検索結果ペインのスクロール位置は維持する。
     * @returns {boolean}
     */
    function refreshRecommendedDisplay(): boolean {
        if (committedOutcome?.mode !== "recommended") return false;
        const outcome = buildRecommendedOutcome(data.currentResults.length, data.displayLimit);
        if (outcome.results.length === data.currentResults.length && outcome.displayLimit === data.displayLimit) {
            return false;
        }
        applySearchOutcome(outcome);
        return true;
    }

    return {
        search,
        refreshRecommendedDisplay,
        getSearchState,
        isRecommendedMode,
        areAllFormatsSelected: searchFiltersController.areAllFormatsSelected,
        areFormatsDefault: searchFiltersController.areFormatsDefault
    };
}
