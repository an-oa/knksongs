import type { SearchConditionsState, SiteLanguageUiRuntimeState } from "../../state.types";
import { isHtmlElement } from "../../lib/dom-utils.mjs";
import {
    SEARCH_BOOLEAN_FILTER_KEYS,
    getSearchBooleanFilterElement,
    renderSearchBooleanFilters
} from "../../lib/search-boolean-filters.mjs";
import type { SearchBooleanFilterElements, SearchBooleanFilterKey } from "../../lib/search-boolean-filters.mjs";
import { parseSearchQuery } from "../../lib/search-query.mjs";
import {
    clearSearchQueryValidation,
    clearSearchQueryValidationIfValid,
    validateSearchQueryInput
} from "../search-query-validation.mjs";
import type { DateSelectKind } from "../date/filter.mjs";

type SearchScheduleOptions = {
    immediate?: boolean;
};

type SearchActionEventOptions = Event | SearchScheduleOptions;

type SearchActionsDateFilterController = {
    resetDateSelects: () => void;
    renderDateSelection: () => void;
    commitDateSelectionClear: (kind: DateSelectKind) => void;
};

type SearchActionsSearchCoordinator = {
    cancelScheduledSearch: () => void;
    scheduleSearch: (options?: SearchScheduleOptions) => void;
};

type SearchActionsSearchFiltersController = {
    resetFiltersToDefault: (options: { resetDateSelects: () => void }) => void;
    setSelectedFormatsToDefault: () => void;
    syncFormatCheckboxesFromState: () => void;
};

type SearchActionsStorageController = {
    saveSearchState: () => void;
    clearActiveBookmark: () => void;
};

type SearchUiActionsInput = {
    ui: { el: {
        searchBox?: Parameters<typeof clearSearchQueryValidation>[0];
        searchBoxError?: Parameters<typeof clearSearchQueryValidation>[1];
        clearBtn?: Pick<HTMLButtonElement, "addEventListener"> | null;
    } & SearchBooleanFilterElements;
    /** 検索語のエラーの文言に使う言語。 */
    language: SiteLanguageUiRuntimeState; };
    search: {
        /** 検索条件のうち、検索語と真偽値フィルター。入力欄の操作を受けて書き換える。 */
        conditions: Pick<SearchConditionsState, "query" | "booleanFilters">;
    };
    searchFiltersController: SearchActionsSearchFiltersController;
    dateFilterController: SearchActionsDateFilterController;
    searchCoordinator: SearchActionsSearchCoordinator;
    storageController: SearchActionsStorageController;
};

/**
 * 検索窓・真偽値フィルターの操作を検索条件の状態へ書き、検索の予約と保存につなぐ。
 * 条件のリセットと、検索条件の状態を入力欄へ映す処理も束ねる。
 * 入力欄は状態を映すだけにし、状態と入力欄のどちらが正しいかを後から突き合わせる処理は持たない。
 * @param input 検索条件の状態と入力欄、日付・検索実行・保存の各 controller
 */
export function createSearchUiActions({
    ui,
    search,
    searchFiltersController,
    dateFilterController,
    searchCoordinator,
    storageController
}: SearchUiActionsInput) {
    const conditions = search.conditions;

    /**
     * 保留中の検索デバウンスタイマーを解除する。
     */
    function clearSearchDebounce(): void {
        searchCoordinator.cancelScheduledSearch();
    }

    /**
     * 検索条件の状態に持つ検索語を、検索窓へ映す。
     * 値が同じなら書き込まず、入力やかな漢字変換の途中の検索窓に触らない。
     */
    function renderSearchQuery(): void {
        const searchBox = ui.el.searchBox;
        if (searchBox && searchBox.value !== conditions.query) searchBox.value = conditions.query;
    }

    /**
     * 検索条件の状態のうち、検索窓・真偽値フィルター・動画の種類を入力欄へ映す。
     * ブラウザがフォームの値を復元して入力欄だけが変わっても、状態の値へ戻す。
     * 日付の選択欄は選択肢を作り直すので、ここでは触らない。
     */
    function refreshConditionInputs(): void {
        renderSearchQuery();
        renderSearchBooleanFilters(ui, conditions.booleanFilters);
        searchFiltersController.syncFormatCheckboxesFromState();
    }

    /**
     * 検索条件の状態を、検索窓・絞り込み・日付のすべての入力欄へ映す。保存済みの条件を復元した後に使う。
     */
    function renderConditions(): void {
        refreshConditionInputs();
        dateFilterController.renderDateSelection();
    }

    /**
     * 検索語を空に戻し、検索窓と検索語のエラー表示へ映す。
     */
    function resetSearchQuery(): void {
        conditions.query = "";
        renderSearchQuery();
        clearSearchQueryValidation(ui.el.searchBox, ui.el.searchBoxError);
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
     * 検索語と絞り込みを何も指定していない状態へ戻し、選択中のブックマークも解除する。
     * 予約済みの検索は取り消す。検索と保存は、ブックマークの解除が 1 回ずつ行う。
     */
    function clearSearch(): void {
        clearSearchDebounce();
        resetSearchQuery();
        resetSearchFilters();
        storageController.clearActiveBookmark();
    }

    /**
     * 絞り込みの変更を受けて、検索を予約し、検索条件を保存する。
     * 変更した値は、呼び出す前に検索条件の状態へ書いておく。
     * @param options immediate が true なら待たずに検索する。イベントを渡されたときは待ってから検索する
     */
    function commitFilterChange(options?: SearchActionEventOptions): void {
        const scheduleOptions = options && "immediate" in options ? options : undefined;
        searchCoordinator.scheduleSearch(scheduleOptions);
        storageController.saveSearchState();
    }

    /**
     * 検索窓の入力を検索条件の状態へ書き、検索を予約して保存する。
     * @param query 検索窓に入力されている検索語
     */
    function commitQueryChange(query: string): void {
        conditions.query = query;
        searchCoordinator.scheduleSearch();
        storageController.saveSearchState();
    }

    /**
     * 検索語だけを解除し、検索と保存を 1 回ずつ即時に行う。
     */
    function clearSearchQuery(): void {
        clearSearchDebounce();
        resetSearchQuery();
        searchCoordinator.scheduleSearch({ immediate: true });
        storageController.saveSearchState();
    }

    /**
     * 指定側の日付範囲だけを解除する。検索と保存は日付 controller の変更通知で 1 回ずつ行う。
     * @param kind 解除する側
     */
    function clearDateFilter(kind: DateSelectKind): void {
        dateFilterController.commitDateSelectionClear(kind);
    }

    /**
     * 動画の種類の選択を既定 (すべて) に戻し、UI 同期後に検索と保存を 1 回ずつ行う。
     */
    function resetFormatFilters(): void {
        searchFiltersController.setSelectedFormatsToDefault();
        searchFiltersController.syncFormatCheckboxesFromState();
        commitFilterChange({ immediate: true });
    }

    /**
     * 真偽値フィルターの選択を検索条件の状態へ書き、チェックボックスへ映す。
     * @param key フィルターのキー
     * @param isSelected 選択するなら true
     */
    function setBooleanFilter(key: SearchBooleanFilterKey, isSelected: boolean): void {
        conditions.booleanFilters = { ...conditions.booleanFilters, [key]: isSelected };
        renderSearchBooleanFilters(ui, conditions.booleanFilters);
    }

    /**
     * 指定した真偽値フィルターだけを解除し、検索と保存を 1 回ずつ行う。
     * @param key 解除するフィルターのキー
     */
    function clearBooleanFilter(key: SearchBooleanFilterKey): void {
        setBooleanFilter(key, false);
        commitFilterChange({ immediate: true });
    }

    /**
     * 検索語・真偽値フィルター・条件クリアボタンの操作を受け付ける。
     * 検索語とフィルターの要素は値の読み書きに必要な形だけを型で受け取るため、
     * イベントを付ける前に実際の要素かを確かめる。
     */
    function setupSearchFormHandlers(): void {
        SEARCH_BOOLEAN_FILTER_KEYS.forEach((key) => {
            const checkbox = getSearchBooleanFilterElement(ui, key);
            if (!checkbox || !isHtmlElement(checkbox)) return;
            checkbox.addEventListener("change", () => {
                setBooleanFilter(key, checkbox.checked);
                commitFilterChange();
            });
        });
        const searchBox = ui.el.searchBox;
        if (searchBox && isHtmlElement(searchBox)) {
            searchBox.addEventListener("input", () => {
                clearSearchQueryValidationIfValid(ui.el.searchBox, ui.el.searchBoxError);
                commitQueryChange(searchBox.value);
            });
            searchBox.addEventListener("blur", () => {
                validateCurrentQuery();
            });
        }
        ui.el.clearBtn?.addEventListener("click", clearSearch);
    }

    /**
     * 検索条件の状態に持つ検索語を検証し、誤りがあれば検索窓の下に出す。
     */
    function validateCurrentQuery(): void {
        validateSearchQueryInput(
            ui.el.searchBox,
            ui.el.searchBoxError,
            parseSearchQuery(conditions.query),
            ui.language.current
        );
    }

    /**
     * 表示中の検索語のエラーを、今の言語の文言で書き直す。エラーを表示していなければ何もしない。
     */
    function refreshQueryValidationMessage(): void {
        if (ui.el.searchBoxError?.hidden !== false) return;
        validateCurrentQuery();
    }

    return {
        refreshQueryValidationMessage,
        refreshConditionInputs,
        renderConditions,
        clearSearch,
        clearSearchQuery,
        clearDateFilter,
        resetFormatFilters,
        clearBooleanFilter,
        commitFilterChange,
        setupSearchFormHandlers
    };
}
