import { dateKeyToParts, parseDateKey, toDateKey } from "./date-key.mjs";

export type PartialDatePrecision = "year" | "month" | "day";

export type PartialDatePartsInput = {
    year: string;
    month?: string | null;
    day?: string | null;
};

export type PartialDateValue = {
    year: number;
    month: number | null;
    day: number | null;
    precision: PartialDatePrecision;
};

/**
 * 年がグレゴリオ暦のうるう年か判定する。
 * @param {number} year
 */
function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * 指定した年と月の日数を返す。
 * @param {number} year
 * @param {number} month
 */
function getDaysInMonth(year: number, month: number): number {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
    return 31;
}

/**
 * 年・月・日の文字列を、指定精度を保持する部分日付値へ正規化する。
 * @param {PartialDatePartsInput} parts
 * @returns {PartialDateValue | null}
 */
export function normalizePartialDateParts(parts: PartialDatePartsInput): PartialDateValue | null {
    const yearText = parts.year.trim();
    if (!/^\d{4}$/.test(yearText)) return null;
    const yearKey = parseDateKey(`${yearText}-01-01`);
    if (yearKey === null) return null;
    const year = dateKeyToParts(yearKey).year;
    const monthText = (parts.month ?? "").trim();
    if (!monthText) return { year, month: null, day: null, precision: "year" };
    if (!/^\d{1,2}$/.test(monthText)) return null;
    const month = Number(monthText);
    if (month < 1 || month > 12) return null;
    const dayText = (parts.day ?? "").trim();
    if (!dayText) return { year, month, day: null, precision: "month" };
    if (!/^\d{1,2}$/.test(dayText)) return null;
    const key = parseDateKey(`${yearText}-${monthText}-${dayText}`);
    if (key === null) return null;
    const normalized = dateKeyToParts(key);
    return {
        year: normalized.year,
        month: normalized.month,
        day: normalized.day,
        precision: "day"
    };
}

/**
 * 部分日付値を、検索で利用する包含境界の最小・最大日付キーへ変換する。
 * @param value 年・年月・年月日のいずれかの精度を持つ部分日付値
 * @returns 両端を含む日付キーの範囲。値がなければ null
 */
export function getPartialDateKeyRange(
    value: PartialDateValue | null | undefined
): SearchDateRange | null {
    if (!value) return null;
    const { year, month, day } = value;
    if (value.precision === "year" || month === null) {
        return { minKey: toDateKey({ year, month: 1, day: 1 }), maxKey: toDateKey({ year, month: 12, day: 31 }) };
    }
    if (value.precision === "month" || day === null) {
        return {
            minKey: toDateKey({ year, month, day: 1 }),
            maxKey: toDateKey({ year, month, day: getDaysInMonth(year, month) })
        };
    }
    const key = toDateKey({ year, month, day });
    return { minKey: key, maxKey: key };
}

/**
 * 年・年月・年月日の文字列 (YYYY・YYYY-MM・YYYY-MM-DD。区切りは / でもよい) を部分日付値へ解析する。
 * 検索条件の状態と保存データは、日付をこの文字列で持つ。
 * @param text 日付の文字列
 * @returns 部分日付値。空文字や形式に合わない値なら null
 */
export function parsePartialDateText(text: string | null | undefined): PartialDateValue | null {
    if (!text) return null;
    const match = /^(\d{4})(?:[/-](\d{1,2})(?:[/-](\d{1,2}))?)?$/.exec(text.trim());
    if (!match) return null;
    return normalizePartialDateParts({
        year: match[1],
        month: match[2] ?? "",
        day: match[3] ?? ""
    });
}

/**
 * 部分日付値を、精度に応じた YYYY・YYYY-MM・YYYY-MM-DD の文字列にする。
 * @param value 部分日付値
 * @returns 日付の文字列。値がなければ空文字
 */
export function formatPartialDateValue(value: PartialDateValue | null): string {
    if (!value) return "";
    const year = String(value.year).padStart(4, "0");
    if (value.precision === "year" || value.month === null) return year;
    const month = String(value.month).padStart(2, "0");
    if (value.precision === "month" || value.day === null) return `${year}-${month}`;
    return `${year}-${month}-${String(value.day).padStart(2, "0")}`;
}
