import {
    createDefaultSearchBooleanFilters,
    renderSearchBooleanFilters
} from "../../lib/search-boolean-filters.mjs";
import type { SearchBooleanFilterElements } from "../../lib/search-boolean-filters.mjs";
import { renderSearchFormatOptions, syncSearchFormatCheckboxes, updateSearchFormatLabels } from "./formats.mjs";
import type { SearchFormatOptionsList } from "./formats.mjs";
import { getUiText } from "../../lib/ui-text.mjs";
import type {
    SearchConditionsState,
    SearchUiRuntimeState,
    SiteLanguageUiRuntimeState
} from "../../state.types";

type SearchFiltersSearchState = Pick<SearchUiRuntimeState, "selectedFormats"> & {
    /** 検索条件のうち真偽値フィルター。既定へ戻すときに書き換える。 */
    conditions: Pick<SearchConditionsState, "booleanFilters">;
};

type SearchFiltersUiState = {
    el: { formatsList?: SearchFormatOptionsList | null } & SearchBooleanFilterElements;
    search: SearchFiltersSearchState;
    /** 形態の選択肢の名前に使う言語。 */
    language: SiteLanguageUiRuntimeState;
};

type SearchFilterChangeOptions = {
    onFilterChange?: (event: Event) => void;
};

type SearchFormatChangeOptions = {
    onFormatChange?: (event: Event) => void;
};

type SearchFilterResetOptions = {
    resetDateSelects?: () => void;
};

type SearchFiltersControllerInput = {
    ui: SearchFiltersUiState;
    defaultFormats?: string[];
};

/**
 * 検索条件 UI の個別 filter controller を束ねる facade を作成する。
 * 動画の種類の選択肢の描画と選択状態、絞り込み全体を既定へ戻す処理を受け持つ。
 */
export function createSearchFiltersController({ ui, defaultFormats = [] }: SearchFiltersControllerInput) {
    const searchUiState = ui.search;

    /**
     * フォーマット選択 state を Set として取得する。
     * @returns {Set<string>}
     */
    function getSelectedFormats(): Set<string> {
        if (!(searchUiState.selectedFormats instanceof Set)) {
            searchUiState.selectedFormats = new Set();
        }
        return searchUiState.selectedFormats;
    }

    /**
     * 形態の値から、サイトの言語で選択肢に出す名前を返す。
     * @param format 形態の値
     * @returns 選択肢に出す名前
     */
    function getFormatLabel(format: string): string {
        return getUiText(ui.language.current).formatFilter(format);
    }

    /**
     * 検索条件 UI の選択肢を描画する。
     * @param options 形態の選択が変わったときの処理
     */
    function renderFilterOptions(options?: SearchFormatChangeOptions): void {
        renderSearchFormatOptions({
            selectedFormats: getSelectedFormats(),
            formatsList: ui.el.formatsList,
            defaultFormats,
            getLabel: getFormatLabel,
            onChange: options && options.onFormatChange
        });
    }

    /**
     * 形態の選択肢の名前を、今の言語で書き直す。
     */
    function refreshFormatLabels(): void {
        updateSearchFormatLabels(ui.el.formatsList, getFormatLabel);
    }

    /**
     * 検索条件 UI の選択肢を描画し、filter 共通の変更イベントを設定する。
     * @param {{ onFilterChange?: (event: Event) => void } | undefined} options
     */
    function setupFilterOptions(options?: SearchFilterChangeOptions): void {
        const onFilterChange = options && options.onFilterChange;
        renderFilterOptions({ onFormatChange: onFilterChange });
    }

    /**
     * 選択中フォーマットを保存用の配列として返す。
     * @returns {string[]}
     */
    function getSelectedFormatValues(): string[] {
        return Array.from(getSelectedFormats());
    }

    /**
     * 選択中フォーマットを既定値に戻す。
     */
    function setSelectedFormatsToDefault(): void {
        const selectedFormats = getSelectedFormats();
        selectedFormats.clear();
        defaultFormats.forEach((format) => selectedFormats.add(format));
    }

    /**
     * 正規化済みの保存値からフォーマット選択を復元し、チェックボックスへ映す。
     * @param formats 保存値の形態の一覧。配列でなければ既定の選択にする
     */
    function applySelectedFormats(formats: unknown): void {
        const selectedFormats = getSelectedFormats();
        const allowedFormats = new Set(defaultFormats);
        const storedFormats = Array.isArray(formats) ? formats : defaultFormats;
        selectedFormats.clear();
        storedFormats.forEach((format) => {
            if (!allowedFormats.has(format) || selectedFormats.has(format)) return;
            selectedFormats.add(format);
        });
        if (selectedFormats.size === 0) {
            defaultFormats.forEach((format) => selectedFormats.add(format));
        }
        syncFormatCheckboxesFromState();
    }

    /**
     * state上のフォーマット選択状態をチェックボックスへ同期する。
     */
    function syncFormatCheckboxesFromState(): void {
        syncSearchFormatCheckboxes({
            selectedFormats: getSelectedFormats(),
            formatsList: ui.el.formatsList
        });
    }

    /**
     * 既定フォーマットがすべて選択されているか判定する。
     * @returns {boolean}
     */
    function areAllFormatsSelected(): boolean {
        const selectedFormats = getSelectedFormats();
        return defaultFormats.every((format) => selectedFormats.has(format));
    }

    /**
     * 検索フィルタを既定状態へ戻す。真偽値フィルターと動画の種類は状態を戻して入力欄へ映し、
     * 日付範囲は渡された処理 (日付 controller) に任せる。
     * @param options 日付範囲を未選択へ戻す処理
     */
    function resetFiltersToDefault(options?: SearchFilterResetOptions): void {
        searchUiState.conditions.booleanFilters = createDefaultSearchBooleanFilters();
        renderSearchBooleanFilters(ui, searchUiState.conditions.booleanFilters);
        if (options && typeof options.resetDateSelects === "function") {
            options.resetDateSelects();
        }
        setSelectedFormatsToDefault();
        syncFormatCheckboxesFromState();
    }

    return {
        setupFilterOptions,
        renderFilterOptions,
        refreshFormatLabels,
        getSelectedFormatValues,
        setSelectedFormatsToDefault,
        applySelectedFormats,
        syncFormatCheckboxesFromState,
        areAllFormatsSelected,
        resetFiltersToDefault
    };
}
