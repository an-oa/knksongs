import { dateKeyToParts, toDateKey } from "../../lib/date-key.mjs";
import { isHtmlElement } from "../../lib/dom-utils.mjs";
import {
    formatPartialDateValue,
    getPartialDateKeyRange,
    normalizePartialDateParts,
    parsePartialDateText
} from "../../lib/partial-date.mjs";
import type { PartialDateValue } from "../../lib/partial-date.mjs";
import type {
    AppUiElements,
    DateUiRuntimeState,
    SearchConditionsState,
    SiteLanguageUiRuntimeState
} from "../../state.types";
import { getUiText } from "../../lib/ui-text.mjs";

/** 日付範囲の開始側と終了側。日付の入力・保存・条件表示で共通に使う。 */
export type DateSelectKind = "from" | "to";

type DateSelectParts = {
    year: string;
    month: string;
    day: string;
};

type DateSelectElements = {
    year: HTMLSelectElement | null | undefined;
    month: HTMLSelectElement | null | undefined;
    day: HTMLSelectElement | null | undefined;
};

type DateFilterUiElements = Pick<
    AppUiElements,
    "dateFromYear" |
    "dateFromMonth" |
    "dateFromDay" |
    "dateToYear" |
    "dateToMonth" |
    "dateToDay" |
    "clearDateFromBtn" |
    "clearDateToBtn"
>;

type DateFilterUiState = {
    el: DateFilterUiElements;
    date: DateUiRuntimeState;
    /** 検索条件のうち日付範囲。選択欄で選んだ値をここへ書き、ここの値を選択欄へ映す。 */
    search: { conditions: Pick<SearchConditionsState, "dateFrom" | "dateTo"> };
    /** 日付の選択欄の先頭(未選択)に出す文言の言語。 */
    language: SiteLanguageUiRuntimeState;
};

/**
 * 日付フィルタ UI の初期化・同期・補正を扱うコントローラーを作成する。
 * 日付範囲の正は検索条件の状態 (ui.search.conditions) に置く。選択肢は曲データの読み込み後に決まるので、
 * それまでは状態に持つ値を選択欄へ映せず、読み込み後に映す。選択欄を変えたときは、補正を終えた値を状態へ書く。
 */
export function createDateFilterController({ ui, onDateSelectionChange }: {
    ui: DateFilterUiState;
    onDateSelectionChange?: () => void;
}) {
    const dateUi = ui.date;
    const conditions = ui.search.conditions;

    /**
     * 日付の選択欄の先頭(未選択)に出す文言を、サイトの言語で返す。
     * @returns 年・月・日の未選択の文言
     */
    function getDateSelectText() {
        return getUiText(ui.language.current).dateSelect;
    }

    /**
     * 描画済みの日付の選択欄の、先頭(未選択)の文言を今の言語で書き直す。選択中の値は変えない。
     */
    function refreshDateSelectPlaceholders(): void {
        const text = getDateSelectText();
        ([
            [ui.el.dateFromYear, text.year],
            [ui.el.dateToYear, text.year],
            [ui.el.dateFromMonth, text.month],
            [ui.el.dateToMonth, text.month],
            [ui.el.dateFromDay, text.day],
            [ui.el.dateToDay, text.day]
        ] as const).forEach(([select, placeholder]) => {
            const empty = select?.querySelector('option[value=""]');
            if (empty) empty.textContent = placeholder;
        });
    }

    /**
     * 開始または終了側の日付セレクト値を取得する。
     * @param kind 値を読む側
     * @returns 年・月・日のセレクト値
     */
    function getDateSelectParts(kind: DateSelectKind): DateSelectParts {
        const elements = getDateSelectElements(kind);
        const year = elements.year?.value ?? "";
        const month = elements.month?.value ?? "";
        const day = elements.day?.value ?? "";
        return { year, month, day };
    }

    /**
     * 開始または終了側の日付セレクト要素一式を返す。
     * @param kind 要素を取り出す側
     */
    function getDateSelectElements(kind: DateSelectKind): DateSelectElements {
        const isFrom = kind === "from";
        return {
            year: isFrom ? ui.el.dateFromYear : ui.el.dateToYear,
            month: isFrom ? ui.el.dateFromMonth : ui.el.dateToMonth,
            day: isFrom ? ui.el.dateFromDay : ui.el.dateToDay
        };
    }

    /**
     * 検索条件の状態に持つ日付を返す。
     * @param kind 値を読む側
     * @returns YYYY・YYYY-MM・YYYY-MM-DD のいずれか。未選択なら空文字列
     */
    function getDateSelectValue(kind: DateSelectKind): string {
        return kind === "from" ? conditions.dateFrom : conditions.dateTo;
    }

    /**
     * 日付セレクトで選んでいる値を、精度に応じた文字列で読む。
     * @param kind 値を読む側
     * @returns YYYY・YYYY-MM・YYYY-MM-DD のいずれか。未選択なら空文字列
     */
    function readDateSelectValue(kind: DateSelectKind): string {
        return formatPartialDateValue(normalizePartialDateParts(getDateSelectParts(kind)));
    }

    /**
     * 日付セレクトで選んでいる値を、検索条件の状態へ書く。
     * 選択肢がまだない (曲データの読み込み前) ときは、選択欄が状態を表せないので書かない。
     */
    function storeDateSelection(): void {
        if (!dateUi.bounds) return;
        conditions.dateFrom = readDateSelectValue("from");
        conditions.dateTo = readDateSelectValue("to");
    }

    /**
     * 完全年月日の部分日付値から日付キーを返す。
     * @param value 日付セレクトから読んだ部分日付値
     * @returns 日付キー。年月日がそろっていなければ null
     */
    function getCompleteDateSelectKey(value: PartialDateValue | null): number | null {
        if (!value || value.precision !== "day" || value.month === null || value.day === null) return null;
        return toDateKey({ year: value.year, month: value.month, day: value.day });
    }

    /**
     * 日付文字列をセレクト UI へ反映する。
     * @param kind 反映する側
     * @param value YYYY・YYYY-MM・YYYY-MM-DD のいずれかの日付文字列
     */
    function applyDateSelectValue(kind: DateSelectKind, value: string | null | undefined): void {
        const dateValue = parsePartialDateText(value);
        if (!dateValue) return;
        const {
            year: yearSelect,
            month: monthSelect,
            day: daySelect
        } = getDateSelectElements(kind);
        if (!yearSelect || !monthSelect || !daySelect) return;
        yearSelect.value = String(dateValue.year);
        monthSelect.value = "";
        daySelect.value = "";
        syncDateSelectOptions(kind);
        if (dateValue.precision === "year" || dateValue.month === null) return;
        monthSelect.value = String(dateValue.month).padStart(2, "0");
        daySelect.value = "";
        syncDateSelectOptions(kind);
        if (dateValue.precision === "month" || dateValue.day === null) return;
        daySelect.value = String(dateValue.day).padStart(2, "0");
        syncDateSelectOptions(kind);
    }

    /**
     * 日付範囲を未選択に戻し、日付セレクトを全クリアして選択肢を同期する。
     */
    function resetDateSelects(): void {
        conditions.dateFrom = "";
        conditions.dateTo = "";
        (["from", "to"] as const).forEach((kind) => {
            clearDateSelectGroup(kind);
        });
        syncDateSelectOptions();
    }

    /**
     * 指定側の日付を未選択に戻し、日付セレクトをクリアして選択肢を同期する。
     * @param kind クリアする側
     */
    function resetDateSelectGroup(kind: DateSelectKind): void {
        if (kind === "from") conditions.dateFrom = "";
        else conditions.dateTo = "";
        clearDateSelectGroup(kind);
        syncDateSelectOptions();
        storeDateSelection();
    }

    /**
     * 指定側の日付セレクトの値をクリアする。
     * @param kind 値を消す側
     */
    function clearDateSelectGroup(kind: DateSelectKind): void {
        const { year, month, day } = getDateSelectElements(kind);
        if (year) year.value = "";
        if (month) month.value = "";
        if (day) day.value = "";
    }

    /**
     * 部分指定を含む日付入力から最小/最大キー範囲を求める。
     * @param kind 範囲を求める側
     * @returns 日付キーの範囲。未選択なら null
     */
    function getPartialDateRange(kind: DateSelectKind): SearchDateRange | null {
        return getPartialDateKeyRange(normalizePartialDateParts(getDateSelectParts(kind)));
    }

    /**
     * 反対側入力を考慮した選択可能日付範囲を計算する。
     * @param {DateSelectKind} kind
     * @returns {SearchDateRange | null}
     */
    function getConstrainedBounds(kind: DateSelectKind): SearchDateRange | null {
        if (!dateUi.bounds) return null;
        let minKey = dateUi.bounds.minKey;
        let maxKey = dateUi.bounds.maxKey;
        const otherKind = kind === "from" ? "to" : "from";
        const otherRange = getPartialDateRange(otherKind);
        if (otherRange) {
            if (kind === "to") {
                minKey = Math.max(minKey, otherRange.minKey);
            } else {
                maxKey = Math.min(maxKey, otherRange.maxKey);
            }
        }
        if (minKey > maxKey) {
            if (kind === "to") minKey = maxKey;
            else maxKey = minKey;
        }
        return { minKey, maxKey };
    }

    /**
     * 日付境界に基づいて年/月/日セレクトを初期化する。
     * @param {SearchDateRange} bounds
     */
    function initDateSelects(bounds: SearchDateRange): void {
        const { minKey, maxKey } = bounds;
        const minParts = dateKeyToParts(minKey);
        const maxParts = dateKeyToParts(maxKey);
        const years = [];
        for (let y = minParts.year; y <= maxParts.year; y++) {
            years.push(String(y));
        }
        buildSelectOptions(ui.el.dateFromYear, years, getDateSelectText().year);
        buildSelectOptions(ui.el.dateToYear, years, getDateSelectText().year);
        buildSelectOptions(ui.el.dateFromMonth, [], getDateSelectText().month);
        buildSelectOptions(ui.el.dateToMonth, [], getDateSelectText().month);
        buildSelectOptions(ui.el.dateFromDay, [], getDateSelectText().day);
        buildSelectOptions(ui.el.dateToDay, [], getDateSelectText().day);
        syncDateSelectOptions();
        renderDateSelection();
    }

    /**
     * 年/月ごとの利用可能日を引ける日付インデックスを作る。
     * @param {Song[]} songs
     * @returns {Map<string, number[]>}
     */
    function buildDateIndex(songs: Song[]): Map<string, number[]> {
        const index = new Map<string, Set<number>>();
        for (const row of songs) {
            if (!row.dateKey) continue;
            const { year, month, day } = dateKeyToParts(row.dateKey);
            const key = `${year}-${String(month).padStart(2, "0")}`;
            let days = index.get(key);
            if (!days) {
                days = new Set<number>();
                index.set(key, days);
            }
            days.add(day);
        }
        const normalized = new Map<string, number[]>();
        for (const [key, set] of index.entries()) {
            normalized.set(key, Array.from(set).sort((a, b) => a - b));
        }
        return normalized;
    }

    /**
     * 指定した年/月で選択可能な日一覧を返す。
     * @param {string} year
     * @param {string} month
     * @returns {number[]}
     */
    function getAvailableDays(year: string, month: string): number[] {
        if (!dateUi.index) return [];
        const key = `${year}-${month}`;
        return dateUi.index.get(key) || [];
    }

    /**
     * セレクト要素の選択肢を再構築する。
     * @param {HTMLSelectElement | null | undefined} select
     * @param {string[]} values
     * @param {string} placeholder
     */
    function buildSelectOptions(
        select: HTMLSelectElement | null | undefined,
        values: string[],
        placeholder: string
    ): void {
        if (!select) return;
        const current = select.value;
        const fragment = document.createDocumentFragment();
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = placeholder;
        fragment.appendChild(empty);
        values.forEach((val) => {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = val;
            fragment.appendChild(opt);
        });
        select.replaceChildren(fragment);
        if (values.includes(current)) {
            select.value = current;
        } else {
            select.value = "";
        }
    }

    /**
     * 現在の境界と選択値に合わせて日付セレクト候補を同期する。
     * @param kind 同期する側。省略すると両側を同期する
     */
    function syncDateSelectOptions(kind?: DateSelectKind): void {
        const dateBounds = dateUi.bounds;
        if (!dateBounds) return;
        const targets = kind ? [kind] : (["from", "to"] as const);
        targets.forEach((k) => {
            const bounds = getConstrainedBounds(k) || dateBounds;
            const {
                year: yearSelect,
                month: monthSelect,
                day: daySelect
            } = getDateSelectElements(k);
            if (!yearSelect || !monthSelect || !daySelect) return;
            const minParts = dateKeyToParts(bounds.minKey);
            const maxParts = dateKeyToParts(bounds.maxKey);
            const years = buildNumberRange(minParts.year, maxParts.year).map((y) => String(y));
            buildSelectOptions(yearSelect, years, getDateSelectText().year);
            const selectedYear = yearSelect.value;
            const minMonth = selectedYear === String(minParts.year) ? minParts.month : 1;
            const maxMonth = selectedYear === String(maxParts.year) ? maxParts.month : 12;
            const months = selectedYear ? buildNumberRange(minMonth, maxMonth).map((m) => String(m).padStart(2, "0")) : [];
            buildSelectOptions(monthSelect, months, getDateSelectText().month);
            const monthVal = monthSelect.value;
            if (!selectedYear || !monthVal) {
                buildSelectOptions(daySelect, [], getDateSelectText().day);
                return;
            }
            const monthNum = Number(monthVal);
            const availableDays = getAvailableDays(selectedYear, monthVal);
            if (availableDays.length === 0) {
                buildSelectOptions(daySelect, [], getDateSelectText().day);
                return;
            }
            let minDay = availableDays[0];
            let maxDay = availableDays[availableDays.length - 1];
            if (selectedYear === String(minParts.year) && monthNum === minParts.month) minDay = Math.max(minDay, minParts.day);
            if (selectedYear === String(maxParts.year) && monthNum === maxParts.month) maxDay = Math.min(maxDay, maxParts.day);
            const days = availableDays
                .filter((d) => d >= minDay && d <= maxDay)
                .map((d) => String(d).padStart(2, "0"));
            buildSelectOptions(daySelect, days, getDateSelectText().day);
        });
    }

    /**
     * 検索条件の状態に持つ日付範囲を、日付セレクトへ映す。
     * 選択肢がまだない (曲データの読み込み前) ときは何もせず、読み込み後に映す。
     * 選択肢にない値は選べないので、映した後に選択欄の値を状態へ書き戻して揃える。
     */
    function renderDateSelection(): void {
        if (!dateUi.bounds) return;
        const { dateFrom, dateTo } = conditions;
        (["from", "to"] as const).forEach((kind) => {
            clearDateSelectGroup(kind);
        });
        syncDateSelectOptions();
        if (dateFrom) applyDateSelectValue("from", dateFrom);
        if (dateTo) applyDateSelectValue("to", dateTo);
        storeDateSelection();
    }

    /**
     * 開始値から終了値までの連番配列を生成する。
     * @param {number} start
     * @param {number} end
     * @returns {number[]}
     */
    function buildNumberRange(start: number, end: number): number[] {
        const list = [];
        for (let i = start; i <= end; i++) list.push(i);
        return list;
    }

    /**
     * 日付キーを `YYYY-MM-DD` 形式へ整形する。
     * @param key 整形する日付キー
     */
    function formatDateKeyForInput(key: number): string {
        return formatPartialDateValue({ ...dateKeyToParts(key), precision: "day" });
    }

    /**
     * 曲一覧から日付境界を計算し、日付 UI へ反映する。検索条件の状態に持つ日付範囲も選択欄へ映す。
     * @param songs 読み込んだ曲一覧
     * @returns 選択可能な日付範囲。日付を持つ曲がなければ null
     */
    function applyDateInputRange(songs: Song[]): SearchDateRange | null {
        const fromElements = getDateSelectElements("from");
        const toElements = getDateSelectElements("to");
        if (!hasCompleteDateSelectElements(fromElements) || !hasCompleteDateSelectElements(toElements)) return null;
        let minKey: number | null = null;
        let maxKey: number | null = null;
        for (const row of songs) {
            if (!row.dateKey) continue;
            if (minKey === null || row.dateKey < minKey) minKey = row.dateKey;
            if (maxKey === null || row.dateKey > maxKey) maxKey = row.dateKey;
        }
        if (minKey === null || maxKey === null) return null;
        const bounds = { minKey, maxKey };
        dateUi.bounds = bounds;
        dateUi.index = buildDateIndex(songs);
        initDateSelects(bounds);
        return bounds;
    }

    /**
     * 日付入力を許容範囲内に収め、完全日付同士の前後関係を補正する。補正した値は検索条件の状態へ書く。
     * @param minKey 選択できる最小の日付キー
     * @param maxKey 選択できる最大の日付キー
     */
    function clampDateInputsToBounds(minKey: number, maxKey: number): void {
        const fromElements = getDateSelectElements("from");
        const toElements = getDateSelectElements("to");
        if (!hasCompleteDateSelectElements(fromElements) || !hasCompleteDateSelectElements(toElements)) return;
        const clampKey = (key: number | null): number | null => {
            if (key === null) return null;
            if (key < minKey) return minKey;
            if (key > maxKey) return maxKey;
            return key;
        };
        const currentFromValue = normalizePartialDateParts(getDateSelectParts("from"));
        const currentToValue = normalizePartialDateParts(getDateSelectParts("to"));
        const currentFromKey = getCompleteDateSelectKey(currentFromValue);
        const currentToKey = getCompleteDateSelectKey(currentToValue);
        const fromKey = clampKey(currentFromKey);
        let toKey = clampKey(currentToKey);
        if (fromKey !== null && toKey !== null && fromKey > toKey) {
            toKey = fromKey;
        }
        if (fromKey !== null && fromKey !== currentFromKey) applyDateSelectValue("from", formatDateKeyForInput(fromKey));
        if (toKey !== null && toKey !== currentToKey) applyDateSelectValue("to", formatDateKeyForInput(toKey));
        storeDateSelection();
    }

    /**
     * 年・月・日のセレクト要素がすべて揃っているかを返す。
     * @param {DateSelectElements} elements
     */
    function hasCompleteDateSelectElements(elements: DateSelectElements): boolean {
        return Boolean(elements.year && elements.month && elements.day);
    }

    /**
     * 日付境界がある場合に入力値の範囲補正を行う。
     */
    function clampDateInputsIfNeeded(): void {
        if (!dateUi.bounds) return;
        clampDateInputsToBounds(dateUi.bounds.minKey, dateUi.bounds.maxKey);
    }

    /** 入力変更に伴う下位値・上下限・候補の補正を終え、検索条件の状態へ書いてから確定を通知する。 */
    function commitDateInputChange(target: HTMLSelectElement, options?: { resetDependentValues?: boolean }): void {
        if (!isHtmlElement(target) || !Object.values(ui.el).includes(target)) return;
        if (options?.resetDependentValues) {
            for (const kind of ["from", "to"] as const) {
                const { year, month, day } = getDateSelectElements(kind);
                if (target === year && month) month.value = "";
                if ((target === year || target === month) && day) day.value = "";
            }
        }
        clampDateInputsIfNeeded();
        syncDateSelectOptions();
        storeDateSelection();
        onDateSelectionChange?.();
    }

    /** 指定側の日付をクリアし、候補を同期してから確定を通知する。 */
    function commitDateSelectionClear(kind: DateSelectKind): void {
        resetDateSelectGroup(kind);
        onDateSelectionChange?.();
    }

    /**
     * 年か月を選んだら、同じ側の次のセレクトへフォーカスを移す。
     * @param target 値が変わったセレクト
     */
    function moveDateFocusIfNeeded(target: HTMLSelectElement): void {
        for (const kind of ["from", "to"] as const) {
            const { year, month, day } = getDateSelectElements(kind);
            if (target === year && target.value) {
                month?.focus();
                return;
            }
            if (target === month && target.value) {
                day?.focus();
                return;
            }
        }
    }

    /**
     * 日付セレクトとクリアボタンの操作を受け付ける。
     * iOS 系の WebKit では、年か月を変えたときに下位の値を消し、選択肢を作り直す間は is-updating を付ける。
     * それ以外の環境では、選んだ値に応じて次のセレクトへフォーカスを移す。
     * @param options 実行環境が iOS 系の WebKit かを返す関数
     */
    function setupDateSelectHandlers({ isIOSWebKit }: { isIOSWebKit: () => boolean }): void {
        const { dateFromYear, dateFromMonth, dateFromDay, dateToYear, dateToMonth, dateToDay } = ui.el;
        [dateFromYear, dateFromMonth, dateFromDay, dateToYear, dateToMonth, dateToDay].forEach((element) => {
            if (!element) return;
            element.addEventListener("change", () => {
                const isIOS = isIOSWebKit();
                const group = element.closest(".date-select-group");
                const isYearChange = element === dateFromYear || element === dateToYear;
                const isMonthChange = element === dateFromMonth || element === dateToMonth;
                if (isIOS && group && (isYearChange || isMonthChange)) {
                    group.classList.add("is-updating");
                } else {
                    moveDateFocusIfNeeded(element);
                }
                commitDateInputChange(element, { resetDependentValues: isIOS });
                if (isIOS && group && (isYearChange || isMonthChange)) {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            group.classList.remove("is-updating");
                        });
                    });
                }
            });
        });
        ([["from", ui.el.clearDateFromBtn], ["to", ui.el.clearDateToBtn]] as const).forEach(([kind, button]) => {
            if (!button) return;
            button.addEventListener("click", () => {
                commitDateSelectionClear(kind);
            });
        });
    }

    return {
        refreshDateSelectPlaceholders,
        getDateSelectValue,
        applyDateSelectValue,
        resetDateSelects,
        resetDateSelectGroup,
        getPartialDateRange,
        syncDateSelectOptions,
        renderDateSelection,
        applyDateInputRange,
        clampDateInputsToBounds,
        clampDateInputsIfNeeded,
        commitDateInputChange,
        commitDateSelectionClear,
        setupDateSelectHandlers
    };
}
