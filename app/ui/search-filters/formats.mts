import { isHtmlElement } from "../../lib/dom-utils.mjs";

const FORMAT_CHECKBOX_SELECTOR = 'input[type="checkbox"]';
const FORMAT_LABEL_SELECTOR = ".format-filter-label";

type SearchFormatCheckbox = {
    value: string;
    checked: boolean;
};

type SearchFormatCheckboxList = {
    querySelectorAll: (selector: string) => Iterable<Element | SearchFormatCheckbox> | ArrayLike<Element | SearchFormatCheckbox>;
};

export type SearchFormatOptionsList = SearchFormatCheckboxList & {
    childElementCount?: number;
    appendChild?: (node: Node) => Node;
};

type SearchFormatOptionsInput = {
    selectedFormats: Set<string>;
    formatsList?: SearchFormatOptionsList | null;
    defaultFormats: string[];
    /** 形態の値から、選択肢に出す名前を返す。 */
    getLabel: (format: string) => string;
    onChange?: (event: Event) => void;
};

type SearchFormatSyncInput = {
    selectedFormats: Set<string>;
    formatsList?: SearchFormatCheckboxList | null;
};

/**
 * フォーマットフィルタのチェックボックス UI を構築する。
 * 選択肢の名前は、言語を切り替えたときに updateSearchFormatLabels で書き直せるよう span に入れる。
 * @param input 選択状態・描画先・既定の形態・選択肢の名前・変更時の処理
 * @returns 選択肢を描画した場合は true
 */
export function renderSearchFormatOptions(input: SearchFormatOptionsInput): boolean {
    const {
        selectedFormats,
        formatsList,
        defaultFormats,
        getLabel,
        onChange
    } = input;
    if (!formatsList || (formatsList.childElementCount ?? 0) > 0) return false;
    if (selectedFormats.size === 0) {
        defaultFormats.forEach((format) => selectedFormats.add(format));
    }
    const appendChild = formatsList.appendChild;
    if (typeof document === "undefined" || typeof appendChild !== "function") {
        syncSearchFormatCheckboxes({ selectedFormats, formatsList });
        return false;
    }
    defaultFormats.forEach((format, index) => {
        const label = document.createElement("label");
        label.className = "checkbox-item";
        const checkbox = document.createElement("input");
        checkbox.id = `format-filter-${index}`;
        checkbox.type = "checkbox";
        checkbox.value = format;
        // 選択状態は検索条件の状態から映すので、ブラウザには再読み込み時に復元させない。
        checkbox.setAttribute("autocomplete", "off");
        label.htmlFor = checkbox.id;
        checkbox.addEventListener("change", (event) => {
            if (checkbox.checked) selectedFormats.add(checkbox.value);
            else selectedFormats.delete(checkbox.value);
            if (typeof onChange === "function") onChange(event);
        });
        const name = document.createElement("span");
        name.className = "format-filter-label";
        name.setAttribute("data-format", format);
        name.textContent = getLabel(format);
        label.append(checkbox, " ", name);
        appendChild.call(formatsList, label);
    });
    syncSearchFormatCheckboxes({ selectedFormats, formatsList });
    return true;
}

/**
 * state上のフォーマット選択状態をチェックボックスへ同期する。
 * @param {{
 *   selectedFormats: Set<string>,
 *   formatsList?: { querySelectorAll: (selector: string) => Iterable<{ value: string, checked: boolean }> } | null
 * }} input
 */
export function syncSearchFormatCheckboxes(input: SearchFormatSyncInput): void {
    const { selectedFormats, formatsList } = input;
    if (!formatsList) return;
    const formatCheckboxes = Array.from(formatsList.querySelectorAll(FORMAT_CHECKBOX_SELECTOR)) as SearchFormatCheckbox[];
    formatCheckboxes.forEach((checkbox) => {
        checkbox.checked = selectedFormats.has(checkbox.value);
    });
}

/**
 * 描画済みの形態の選択肢の名前を書き直す。言語を切り替えたときに使い、選択状態は変えない。
 * @param formatsList 形態の選択肢を並べた要素
 * @param getLabel 形態の値から、選択肢に出す名前を返す関数
 */
export function updateSearchFormatLabels(
    formatsList: SearchFormatCheckboxList | null | undefined,
    getLabel: (format: string) => string
): void {
    if (!formatsList) return;
    Array.from(formatsList.querySelectorAll(FORMAT_LABEL_SELECTOR)).forEach((name) => {
        if (!isHtmlElement(name)) return;
        const format = name.getAttribute("data-format");
        if (format !== null) name.textContent = getLabel(format);
    });
}
