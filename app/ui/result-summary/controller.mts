import { SEARCH_BOOLEAN_FILTER_KEYS } from "../../lib/search-boolean-filters.mjs";
import type { SearchBooleanFilterKey } from "../../lib/search-boolean-filters.mjs";
import { getUiText } from "../../lib/ui-text.mjs";
import type { AppUiElements, SiteLanguageUiRuntimeState } from "../../state.types.mjs";
import type { DateSelectKind } from "../date/filter.mjs";

/** 概要行に表示する適用中の条件 1 件。 */
type ResultConditionChip = {
    /** 再描画の間で同じ要素を使い続けるための条件の識別子。 */
    key: string;
    label: string;
    remove: () => void;
};

type ResultSummaryControllerInput = {
    ui: {
        el: Pick<AppUiElements, "searchBox" | "resultConditions" | "resultClearAll">;
        language: SiteLanguageUiRuntimeState;
    };
    /** 現在の検索条件を読み取る。概要行は入力要素を直接変更しない。 */
    conditions: {
        getQuery: () => string;
        getDateValue: (kind: DateSelectKind) => string;
        /** 選択中の動画の種類を、既定の並び順で返す。 */
        getSelectedFormats: () => string[];
        areAllFormatsSelected: () => boolean;
        isBooleanFilterEnabled: (key: SearchBooleanFilterKey) => boolean;
        isBookmarkActive: () => boolean;
    };
    /** 条件の解除。いずれも状態更新・UI 同期の後に、検索と保存を 1 回ずつ即時に行う。 */
    actions: {
        clearSearchQuery: () => void;
        clearDateFilter: (kind: DateSelectKind) => void;
        resetFormatFilters: () => void;
        clearBooleanFilter: (key: SearchBooleanFilterKey) => void;
        clearSearch: () => void;
    };
};

/**
 * 結果一覧の上に、適用中の検索条件をチップで表示し、個別・一括で解除できるようにする。
 * 解除は検索を即時に確定するため、解除後のフォーカス移動も同じ操作の中で完結させる。
 * @param {ResultSummaryControllerInput} input
 */
export function createResultSummaryController({ ui, conditions, actions }: ResultSummaryControllerInput) {
    // 条件ごとのチップ要素。通常の再描画では同じ要素を使い、フォーカスや入力位置を保つ。
    const chipItems = new Map<string, HTMLLIElement>();
    // 直近の描画で並べたチップ。クリック時はここから最新の解除処理と位置を引く。
    let renderedChips: ResultConditionChip[] = [];

    /**
     * 現在の検索条件から、概要行に並べる条件チップをサイトの言語の文言で集める。
     * @returns 概要行に並べる条件チップ
     */
    function collectConditionChips(): ResultConditionChip[] {
        const chips: ResultConditionChip[] = [];
        const text = getUiText(ui.language.current);
        const query = conditions.getQuery().trim();
        if (query) {
            chips.push({ key: "query", label: text.chips.query(query), remove: actions.clearSearchQuery });
        }
        (["from", "to"] as const).forEach((kind) => {
            const value = conditions.getDateValue(kind);
            if (!value) return;
            chips.push({
                key: `date-${kind}`,
                label: kind === "from" ? text.chips.dateFrom(value) : text.chips.dateTo(value),
                remove: () => actions.clearDateFilter(kind)
            });
        });
        if (!conditions.areAllFormatsSelected()) {
            const selectedLabels = conditions.getSelectedFormats().map(text.formatFilter);
            chips.push({
                key: "formats",
                label: text.chips.formats(selectedLabels),
                remove: actions.resetFormatFilters
            });
        }
        SEARCH_BOOLEAN_FILTER_KEYS.forEach((key) => {
            if (!conditions.isBooleanFilterEnabled(key)) return;
            chips.push({ key, label: text.booleanFilters[key], remove: () => actions.clearBooleanFilter(key) });
        });
        return chips;
    }

    /**
     * 条件チップのボタンを返す。li の直下に 1 つだけ置く。
     * @param {HTMLLIElement} item
     * @returns {HTMLElement | null}
     */
    function getChipButton(item: HTMLLIElement): HTMLElement | null {
        const button = item.querySelector(".result-condition-chip");
        return button instanceof HTMLElement ? button : null;
    }

    /**
     * 指定した条件のチップ要素を作る。表示名は描画のたびに updateChipItem で反映する。
     * @param {string} key
     * @returns {HTMLLIElement}
     */
    function createChipItem(key: string): HTMLLIElement {
        const item = document.createElement("li");
        item.className = "result-condition";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "result-condition-chip";
        button.dataset.conditionKey = key;
        const label = document.createElement("span");
        label.className = "result-condition-chip-label";
        const removeMark = document.createElement("span");
        removeMark.className = "result-condition-chip-remove";
        removeMark.setAttribute("aria-hidden", "true");
        removeMark.textContent = "×";
        button.append(label, removeMark);
        button.addEventListener("click", () => removeCondition(key));
        item.append(button);
        return item;
    }

    /**
     * チップの表示名と読み上げ名を更新する。長い表示名は CSS で省略するため title に全文を残す。
     * @param item チップの要素
     * @param chip 表示する条件
     */
    function updateChipItem(item: HTMLLIElement, chip: ResultConditionChip): void {
        const button = getChipButton(item);
        const label = button?.querySelector(".result-condition-chip-label");
        if (!button || !label) return;
        label.textContent = chip.label;
        button.title = chip.label;
        button.setAttribute("aria-label", getUiText(ui.language.current).chips.remove(chip.label));
    }

    /**
     * 指定した条件を解除し、残ったチップ・検索窓の順でフォーカスを移す。
     * @param {string} key
     */
    function removeCondition(key: string): void {
        const index = renderedChips.findIndex((chip) => chip.key === key);
        const chip = renderedChips[index];
        if (!chip) return;
        chip.remove();
        focusAfterRemoval(index);
    }

    /**
     * 解除操作の直後に、同じ位置に近いチップ、なければ検索窓へフォーカスを移す。
     * @param {number} index 解除したチップの位置
     */
    function focusAfterRemoval(index: number): void {
        const remaining = renderedChips
            .map((chip) => chipItems.get(chip.key))
            .filter((item): item is HTMLLIElement => Boolean(item));
        const next = remaining.length > 0
            ? getChipButton(remaining[Math.min(index, remaining.length - 1)])
            : ui.el.searchBox ?? null;
        next?.focus();
    }

    /**
     * 適用中の条件と一括解除ボタンを描き直す。既存のチップは要素を保ったまま更新する。
     */
    function render(): void {
        const list = ui.el.resultConditions;
        if (!list) return;
        const chips = collectConditionChips();
        const nextKeys = new Set(chips.map((chip) => chip.key));
        chipItems.forEach((item, key) => {
            if (nextKeys.has(key)) return;
            list.removeChild(item);
            chipItems.delete(key);
        });
        // 条件の並び順は固定のため、既存要素は動かさず、新しいチップだけを所定の位置へ差し込む。
        chips.forEach((chip, index) => {
            let item = chipItems.get(chip.key);
            if (!item) {
                item = createChipItem(chip.key);
                chipItems.set(chip.key, item);
            }
            updateChipItem(item, chip);
            const current = list.children[index] ?? null;
            if (current !== item) list.insertBefore(item, current);
        });
        renderedChips = chips;
        const clearAll = ui.el.resultClearAll;
        if (clearAll) clearAll.hidden = chips.length === 0 && !conditions.isBookmarkActive();
    }

    /**
     * 一括解除ボタンのイベントを設定する。解除後は検索窓へフォーカスを移す。
     */
    function setup(): void {
        ui.el.resultClearAll?.addEventListener("click", () => {
            actions.clearSearch();
            ui.el.searchBox?.focus();
        });
    }

    return {
        setup,
        render
    };
}
