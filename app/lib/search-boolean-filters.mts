export const SEARCH_BOOLEAN_FILTER_KEYS = [
    "collabHostOnly",
    "collabGuestOnly",
    "relayOnly",
    "harmonyOnly"
] as const;

export type SearchBooleanFilterKey = typeof SEARCH_BOOLEAN_FILTER_KEYS[number];

/** 真偽値フィルターごとの選択状態。検索条件の状態と保存データで同じ形を使う。 */
export type SearchBooleanFilterState = Record<SearchBooleanFilterKey, boolean>;

type SearchBooleanFilterElement = Pick<HTMLInputElement, "checked">;

/** 真偽値フィルターが必要とする最小限の要素。未設置の要素も許容する。 */
export type SearchBooleanFilterElements<FilterElement extends SearchBooleanFilterElement = SearchBooleanFilterElement> =
    Partial<Record<SearchBooleanFilterKey, FilterElement | null>>;

type SearchBooleanFilterUi<FilterElement extends SearchBooleanFilterElement = SearchBooleanFilterElement> = {
    el?: SearchBooleanFilterElements<FilterElement>;
} | null | undefined;

/**
 * すべて未選択の真偽値フィルターの状態を作る。
 * @returns すべて false の選択状態
 */
export function createDefaultSearchBooleanFilters(): SearchBooleanFilterState {
    return {
        collabHostOnly: false,
        collabGuestOnly: false,
        relayOnly: false,
        harmonyOnly: false
    };
}

/**
 * 保存データなど形の分からない値から、真偽値フィルターの状態を作る。項目がなければ未選択にする。
 * @param source 真偽値フィルターの値を持つ可能性のある値
 * @returns 真偽値フィルターの選択状態
 */
export function toSearchBooleanFilterState(source: Partial<Record<SearchBooleanFilterKey, unknown>>): SearchBooleanFilterState {
    return {
        collabHostOnly: Boolean(source.collabHostOnly),
        collabGuestOnly: Boolean(source.collabGuestOnly),
        relayOnly: Boolean(source.relayOnly),
        harmonyOnly: Boolean(source.harmonyOnly)
    };
}

/**
 * 検索 boolean filter に対応する UI 要素を取得する。
 * @param ui 真偽値フィルターの要素を持つ UI
 * @param key フィルターのキー
 * @returns 対応する要素。未設置なら null
 */
export function getSearchBooleanFilterElement<FilterElement extends SearchBooleanFilterElement>(
    ui: SearchBooleanFilterUi<FilterElement>,
    key: SearchBooleanFilterKey
): FilterElement | null {
    if (!ui || !ui.el) return null;
    return ui.el[key] || null;
}

/**
 * 真偽値フィルターの選択状態を、チェックボックスへ映す。
 * 値が同じ要素には書き込まず、利用者の操作中に状態を揺らさない。
 * @param ui 真偽値フィルターの要素を持つ UI
 * @param filters 映す選択状態
 */
export function renderSearchBooleanFilters(ui: SearchBooleanFilterUi, filters: SearchBooleanFilterState): void {
    SEARCH_BOOLEAN_FILTER_KEYS.forEach((key) => {
        const element = getSearchBooleanFilterElement(ui, key);
        if (element && element.checked !== filters[key]) element.checked = filters[key];
    });
}

/**
 * 真偽値フィルターに、選択中の項目があるか判定する。
 * @param filters 真偽値フィルターの選択状態
 * @returns 1 つでも選択していれば true
 */
export function hasSelectedSearchBooleanFilter(filters: SearchBooleanFilterState): boolean {
    return SEARCH_BOOLEAN_FILTER_KEYS.some((key) => filters[key]);
}
