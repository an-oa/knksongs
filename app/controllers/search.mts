/**
 * 検索を担う controller。
 *
 * 検索 UI から条件を集めて検索語を解析し (../lib/search-query)、入力の誤りを表示する。
 * 条件に応じて、通常の検索・選択中のブックマーク内の検索・条件なしのおすすめ表示の
 * いずれかで結果を決め (../lib/search-filters, ../lib/search-recommendation)、
 * data.currentResults と表示件数を更新する。おすすめは表示領域の大きさに合わせて増減する。
 *
 * 描画・件数表示・スクロールは callbacks 経由で行う。
 * 実行タイミングは ./search-coordinator.mts、検索条件の保存は ./storage.mts が担当する。
 */
import { filterSongsByCriteria } from "../lib/search-filters.mjs";
import { isValidEmptySearchQuery, parseSearchQuery } from "../lib/search-query.mjs";
import type { ParsedSearchQuery } from "../lib/search-query.mjs";
import { pickRecommendedSongsWithCache } from "../lib/search-recommendation.mjs";
import {
    collectSearchBooleanFilterState,
    hasSelectedSearchBooleanFilterState
} from "../lib/search-boolean-filters.mjs";
import type { SearchBooleanFilterElements } from "../lib/search-boolean-filters.mjs";
import { resolveSongRefs } from "../lib/song-lookup.mjs";
import { validateSearchQueryInput } from "../ui/search-query-validation.mjs";
import type { ResultCountSummary } from "../lib/ui-text.mjs";

import type {
    AppDataState,
    SearchUiRuntimeState,
    LookupUiRuntimeState,
    SiteLanguageUiRuntimeState
} from "../state.types";
import type { createDateFilterController } from "../ui/date/filter.mjs";

type SearchControllerInput = {
    data: AppDataState;
    ui: {
        el: {
            searchBox?: Parameters<typeof validateSearchQueryInput>[0];
            searchBoxError?: Parameters<typeof validateSearchQueryInput>[1];
        } & SearchBooleanFilterElements;
        search: Pick<SearchUiRuntimeState, "selectedFormats" | "recommendedCache">;
        lookup: LookupUiRuntimeState;
        language: SiteLanguageUiRuntimeState;
    };
    searchFiltersController: {
        areAllFormatsSelected: () => boolean;
    };
    dateFilterController: Pick<ReturnType<typeof createDateFilterController>, "getPartialDateRange">;
    constants: {
        RANDOM_DISPLAY_COUNT: number;
        MIN_PERFORMANCE_FOR_RANDOM: number;
        RESULT_DISPLAY_BATCH_SIZE: number;
    };
    callbacks: {
        updateDisplay: () => void;
        /** 結果一覧の上の件数表示に、確定した検索結果の件数を出す。 */
        showResultCount: (summary: ResultCountSummary) => void;
        scrollResultsPaneToTop: () => void;
        getRecommendedDisplayCount?: () => number;
        /** 画面の上端より上へ過ぎた結果カードの数を返す。おすすめを減らすときに残す範囲を決める。 */
        getScrolledPastResultCount?: () => number;
        /** おすすめを減らすときに必ず残す結果カードの数を返す。画面に見えているカードや再生中のカードまでを含める。 */
        getResultCountToKeep?: () => number;
        getInitialDisplayCount?: (defaultCount: number) => number;
        /** 検索結果を反映した後に、件数以外の結果の概要を更新する。 */
        onResultsApplied?: () => void;
    };
};

type SearchInput = {
    searchState: SearchState;
    parsedQuery: ParsedSearchQuery;
};

type SearchOutcome = {
    mode: "recommended" | "search" | "bookmark";
    results: Song[];
    displayLimit: number;
    /** 結果一覧の上の件数表示。言語を切り替えたときに作り直すため、文言ではなく内容で持つ。 */
    summary: ResultCountSummary;
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
    // 未指定のときは、すべてのカードを過ぎたものとして扱い、縮小してもおすすめを減らさない。
    const getScrolledPastResultCount = callbacks.getScrolledPastResultCount || (() => data.currentResults.length);
    const getResultCountToKeep = callbacks.getResultCountToKeep || (() => 0);
    // 確定時の結果とモードを保持する。追加表示後の上限は data.displayLimit を参照する。
    let committedOutcome: SearchOutcome | null = null;

    /**
     * 検索入力の収集から結果反映までの処理を行う。
     */
    function search(): void {
        const searchInput = collectSearchInput();
        validateSearchQueryInput(ui.el.searchBox, ui.el.searchBoxError, searchInput.parsedQuery, ui.language.current);
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
     * @param outcome 確定した検索結果
     */
    function applySearchOutcome(outcome: SearchOutcome): void {
        data.currentResults = outcome.results;
        data.displayLimit = outcome.displayLimit;
        committedOutcome = outcome;
        callbacks.showResultCount(outcome.summary);
        updateDisplay();
        callbacks.onResultsApplied?.();
    }

    /**
     * 現在の UI 入力から検索条件オブジェクトを生成する。
     * @returns {SearchState}
     */
    function getSearchState(): SearchState {
        const fromRange = dateFilterController.getPartialDateRange("from");
        const toRange = dateFilterController.getPartialDateRange("to");
        return {
            queryRaw: ui.el.searchBox?.value.trim() ?? "",
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
                    { kind: "bookmark", name: bookmark.name, count: results.length },
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
        return buildIncrementalSearchOutcome(results, { kind: "search", count: results.length });
    }

    /**
     * 段階表示用の件数上限を含む検索結果オブジェクトを作る。
     * @param results 表示する曲
     * @param summary 件数表示の内容
     * @param mode 確定する検索モード
     * @returns 検索結果
     */
    function buildIncrementalSearchOutcome(
        results: Song[],
        summary: ResultCountSummary,
        mode: "search" | "bookmark" = "search"
    ): SearchOutcome {
        return {
            mode,
            results,
            displayLimit: Math.min(results.length, getInitialDisplayLimit(RESULT_DISPLAY_BATCH_SIZE)),
            summary
        };
    }

    /** 初期描画件数を画面サイズに合わせ、未指定・不正値の場合は従来の件数を使う。 */
    function getInitialDisplayLimit(defaultCount: number): number {
        const count = callbacks.getInitialDisplayCount?.(defaultCount);
        return typeof count === "number" && Number.isFinite(count) && count >= 1
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

    /**
     * callback から受け取った件数を、0 以上の整数にそろえる。
     * @param count callback が返した件数
     * @returns 0 以上の整数。数でなければ 0
     */
    function toResultCount(count: number): number {
        return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    }

    /** 選曲件数と描画上限を個別に決め、リサイズ時は残すと決めた件数までの選曲・追加表示を保つ。 */
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
            summary: { kind: "recommended" }
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
     * 確定済みのおすすめ結果を、今の表示領域に合わせて増減する。
     * 狭まったときは、画面より上へ過ぎたカードと、そこから画面 1 つ分を残し、それより下だけを減らす。
     * 画面に見えているカードと再生中のカードは、この目安より後ろにあっても残す。
     * 選曲は cache の先頭から取るので、増減しても並びは変わらない。
     * 検索待機中の抑制は呼び出し元の検索 coordinator が担う。
     * リサイズ追随用のため、検索結果ペインのスクロール位置は維持する。
     * @returns 表示を更新したら true
     */
    function refreshRecommendedDisplay(): boolean {
        if (committedOutcome?.mode !== "recommended") return false;
        const keptResultCount = Math.min(
            data.currentResults.length,
            Math.max(
                toResultCount(getScrolledPastResultCount()) + getRecommendedResultCount(),
                toResultCount(getResultCountToKeep())
            )
        );
        const outcome = buildRecommendedOutcome(keptResultCount, Math.min(data.displayLimit, keptResultCount));
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
        areAllFormatsSelected: searchFiltersController.areAllFormatsSelected
    };
}
