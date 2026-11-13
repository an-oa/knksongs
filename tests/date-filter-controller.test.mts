import test from "node:test";
import type { DateUiRuntimeState } from "../app/state.types";
import assert from "node:assert/strict";
import { createDateFilterController } from "../app/ui/date/filter.mts";
import { createSearchSongFixtureFactory } from "./fixtures/search-song.mts";
import { installFakeAnimationFrames, installFakeDom, invokeListener } from "./test-helpers.mts";
import type { SiteLanguage } from "../app/lib/site-language.mts";

const makeRow = createSearchSongFixtureFactory();

/**
 * 日付コントローラー検証用の UI 状態を作る。
 * 年月日のセレクトは、実ページと同じく .date-select-group で側ごとにまとめる。
 */
function createDateUiState() {
    const date: DateUiRuntimeState = { bounds: null, index: null };
    /** 検索条件のうち日付範囲。controller は選択欄で選んだ値をここへ書き、ここの値を選択欄へ映す。 */
    const search = { conditions: { dateFrom: "", dateTo: "" } };
    const el = {
        dateFromYear: document.createElement("select"),
        dateFromMonth: document.createElement("select"),
        dateFromDay: document.createElement("select"),
        dateToYear: document.createElement("select"),
        dateToMonth: document.createElement("select"),
        dateToDay: document.createElement("select"),
        clearDateFromBtn: document.createElement("button"),
        clearDateToBtn: document.createElement("button")
    };
    const fromGroup = document.createElement("div");
    fromGroup.className = "date-select-group";
    fromGroup.append(el.dateFromYear, el.dateFromMonth, el.dateFromDay);
    const toGroup = document.createElement("div");
    toGroup.className = "date-select-group";
    toGroup.append(el.dateToYear, el.dateToMonth, el.dateToDay);
    return { el, date, search, fromGroup, language: { current: "ja" as SiteLanguage } };
}

/**
 * 選択欄で選んでいる日付を、YYYY・YYYY-MM・YYYY-MM-DD の文字列で読む。
 * 検索条件の状態ではなく、選択欄そのものの値を確かめるときに使う。
 * @param ui 日付コントローラー検証用の UI 状態
 * @param kind 読む側
 */
function readSelectedDate(ui: ReturnType<typeof createDateUiState>, kind: "from" | "to") {
    const selects = kind === "from"
        ? [ui.el.dateFromYear, ui.el.dateFromMonth, ui.el.dateFromDay]
        : [ui.el.dateToYear, ui.el.dateToMonth, ui.el.dateToDay];
    return selects.map((select) => select.value).filter(Boolean).join("-");
}


/**
 * セレクト要素の option 値一覧を返す。
 */
function getSelectValues(select: HTMLSelectElement) {
    return Array.from(select.querySelectorAll("option"), (option) => option.value);
}

test("createDateFilterController: syncDateSelectOptions constrains end-side options by start-side selection", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        const rows = [
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240215 }),
            makeRow({ dateKey: 20240305 })
        ];

        controller.applyDateInputRange(rows);
        ui.el.dateFromYear.value = "2024";
        controller.syncDateSelectOptions("from");
        ui.el.dateFromMonth.value = "03";
        controller.syncDateSelectOptions("from");
        ui.el.dateToYear.value = "2024";
        controller.syncDateSelectOptions("to");

        assert.deepEqual(getSelectValues(ui.el.dateToMonth), ["", "03"]);

        ui.el.dateToMonth.value = "03";
        controller.syncDateSelectOptions("to");

        assert.deepEqual(getSelectValues(ui.el.dateToDay), ["", "05"]);
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: getDateSelectValue returns the dates held in the conditions state", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        assert.equal(controller.getDateSelectValue("from"), "");
        assert.equal(controller.getDateSelectValue("to"), "");

        ui.search.conditions.dateFrom = "2024-02";
        ui.search.conditions.dateTo = "2024-02-10";
        assert.equal(controller.getDateSelectValue("from"), "2024-02");
        assert.equal(controller.getDateSelectValue("to"), "2024-02-10");

        // 選択欄だけを書き換えても、確定するまでは状態を変えない。
        ui.el.dateFromYear.value = "2025";
        assert.equal(controller.getDateSelectValue("from"), "2024-02");
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: month change commits corrected day candidates before notification", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const committedValues: string[] = [];
        const controller = createDateFilterController({
            ui,
            onDateSelectionChange: () => committedValues.push(controller.getDateSelectValue("from"))
        });
        controller.applyDateInputRange([
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240305 }),
            makeRow({ dateKey: 20240320 })
        ]);
        controller.applyDateSelectValue("from", "2024-02-10");
        ui.el.dateFromMonth.value = "03";

        controller.commitDateInputChange(ui.el.dateFromMonth);

        // 通知を受けた側が読む時点で、補正を終えた値が検索条件の状態に入っている。
        assert.deepEqual(committedValues, ["2024-03"]);
        assert.equal(ui.search.conditions.dateFrom, "2024-03");
        assert.equal(readSelectedDate(ui, "from"), "2024-03");
        assert.deepEqual(getSelectValues(ui.el.dateFromDay), ["", "05", "20"]);
        assert.deepEqual(getSelectValues(ui.el.dateToMonth), [""]);
        controller.commitDateSelectionClear("from");
        assert.deepEqual(committedValues, ["2024-03", ""]);
        assert.equal(ui.search.conditions.dateFrom, "");
        assert.equal(readSelectedDate(ui, "from"), "");
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: applyDateSelectValue shows partial date values in the selects", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        const rows = [
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240215 }),
            makeRow({ dateKey: 20240305 })
        ];

        controller.applyDateInputRange(rows);
        controller.applyDateSelectValue("from", "2024-02");
        controller.applyDateSelectValue("to", "2024");

        assert.equal(readSelectedDate(ui, "from"), "2024-02");
        assert.equal(ui.el.dateFromDay.value, "");
        assert.equal(readSelectedDate(ui, "to"), "2024");
        assert.equal(ui.el.dateToMonth.value, "");
        assert.equal(ui.el.dateToDay.value, "");

        controller.applyDateSelectValue("from", "2024-02-10");
        controller.applyDateSelectValue("from", "2024-02");
        assert.equal(readSelectedDate(ui, "from"), "2024-02");
        assert.equal(ui.el.dateFromDay.value, "");

        controller.applyDateSelectValue("to", "2024-03-05");
        controller.applyDateSelectValue("to", "2024");
        assert.equal(readSelectedDate(ui, "to"), "2024");
        assert.equal(ui.el.dateToMonth.value, "");
        assert.equal(ui.el.dateToDay.value, "");
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: reapplying date bounds keeps the committed selections", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        const rows = [
            makeRow({ dateKey: 20250315 }),
            makeRow({ dateKey: 20250420 })
        ];

        controller.applyDateInputRange(rows);
        // 利用者が選択欄で選んで確定した値は、検索条件の状態に入る。
        ui.el.dateFromYear.value = "2025";
        controller.commitDateInputChange(ui.el.dateFromYear);
        ui.el.dateFromMonth.value = "03";
        controller.commitDateInputChange(ui.el.dateFromMonth);
        ui.el.dateFromDay.value = "15";
        controller.commitDateInputChange(ui.el.dateFromDay);
        ui.search.conditions.dateTo = "2025-04-20";
        controller.renderDateSelection();
        assert.deepEqual(ui.search.conditions, { dateFrom: "2025-03-15", dateTo: "2025-04-20" });

        // 選択肢を作り直しても、状態に持つ値を選択欄へ映し直す。
        controller.applyDateInputRange(rows);

        assert.equal(readSelectedDate(ui, "from"), "2025-03-15");
        assert.equal(readSelectedDate(ui, "to"), "2025-04-20");
        assert.deepEqual(ui.search.conditions, { dateFrom: "2025-03-15", dateTo: "2025-04-20" });
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: applyDateSelectValue rounds unavailable saved days to month precision", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        const rows = [
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240220 }),
            makeRow({ dateKey: 20240305 })
        ];

        controller.applyDateInputRange(rows);
        controller.applyDateSelectValue("from", "2024-02-15");

        assert.equal(readSelectedDate(ui, "from"), "2024-02");
        assert.equal(ui.el.dateFromDay.value, "");
        assert.deepEqual(controller.getPartialDateRange("from"), {
            minKey: 20240201,
            maxKey: 20240229
        });

        controller.resetDateSelects();
        controller.applyDateSelectValue("to", "2024-02-15");

        assert.equal(readSelectedDate(ui, "to"), "2024-02");
        assert.equal(ui.el.dateToDay.value, "");
        assert.deepEqual(controller.getPartialDateRange("to"), {
            minKey: 20240201,
            maxKey: 20240229
        });
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: restored dates that cannot be selected are corrected in the state too", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        // 保存した日 (15 日) の曲がなくなり、範囲外の年も保存されていた場合。
        ui.search.conditions.dateFrom = "2024-02-15";
        ui.search.conditions.dateTo = "2031";

        controller.applyDateInputRange([
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240220 }),
            makeRow({ dateKey: 20240305 })
        ]);

        // 選択欄に出せる値へ丸め、検索と保存が読む状態も選択欄と同じ値にする。
        assert.equal(readSelectedDate(ui, "from"), "2024-02");
        assert.equal(readSelectedDate(ui, "to"), "");
        assert.deepEqual(ui.search.conditions, { dateFrom: "2024-02", dateTo: "" });
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: clampDateInputsIfNeeded preserves partial opposite side with complete dates", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        const rows = [
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240215 }),
            makeRow({ dateKey: 20240305 })
        ];

        controller.applyDateInputRange(rows);
        controller.applyDateSelectValue("from", "2024-02-10");

        ui.el.dateToYear.value = "2024";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(readSelectedDate(ui, "to"), "2024");

        ui.el.dateToMonth.value = "02";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(readSelectedDate(ui, "to"), "2024-02");

        ui.el.dateToDay.value = "15";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(readSelectedDate(ui, "to"), "2024-02-15");

        controller.resetDateSelects();
        controller.applyDateSelectValue("to", "2024-03-05");

        ui.el.dateFromYear.value = "2024";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(readSelectedDate(ui, "from"), "2024");

        ui.el.dateFromMonth.value = "02";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(readSelectedDate(ui, "from"), "2024-02");

        ui.el.dateFromDay.value = "10";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(readSelectedDate(ui, "from"), "2024-02-10");
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: clampDateInputsToBounds clamps and preserves chronological order", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        const rows = [
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240215 }),
            makeRow({ dateKey: 20240305 })
        ];

        controller.applyDateInputRange(rows);
        ui.el.dateFromYear.value = "2024";
        ui.el.dateFromMonth.value = "03";
        ui.el.dateFromDay.value = "05";
        ui.el.dateToYear.value = "2024";
        ui.el.dateToMonth.value = "02";
        ui.el.dateToDay.value = "15";

        controller.clampDateInputsToBounds(20240210, 20240305);

        assert.equal(readSelectedDate(ui, "from"), "2024-03-05");
        assert.equal(readSelectedDate(ui, "to"), "2024-03-05");
        assert.deepEqual(ui.search.conditions, { dateFrom: "2024-03-05", dateTo: "2024-03-05" });
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: clampDateInputsIfNeeded keeps partial year selection", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        const rows = [
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240215 }),
            makeRow({ dateKey: 20240305 })
        ];

        controller.applyDateInputRange(rows);
        ui.el.dateFromYear.value = "2024";

        controller.clampDateInputsIfNeeded();

        assert.equal(ui.el.dateFromYear.value, "2024");
        assert.equal(ui.el.dateFromMonth.value, "");
        assert.equal(ui.el.dateFromDay.value, "");
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: dates restored before the song data arrives are shown once the options exist", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        ui.search.conditions.dateFrom = "2024-02-10";
        ui.search.conditions.dateTo = "2024-03-05";

        // 選択肢がまだないので選択欄には映せないが、状態は消さずに持ち続ける。
        controller.renderDateSelection();
        assert.equal(readSelectedDate(ui, "from"), "");
        assert.deepEqual(ui.search.conditions, { dateFrom: "2024-02-10", dateTo: "2024-03-05" });

        controller.applyDateInputRange([
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240215 }),
            makeRow({ dateKey: 20240305 })
        ]);

        assert.equal(readSelectedDate(ui, "from"), "2024-02-10");
        assert.equal(readSelectedDate(ui, "to"), "2024-03-05");
        assert.deepEqual(ui.search.conditions, { dateFrom: "2024-02-10", dateTo: "2024-03-05" });
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: renderDateSelection replaces what the selects showed with the state", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        controller.applyDateInputRange([
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240305 })
        ]);
        controller.applyDateSelectValue("from", "2024-02-10");
        controller.applyDateSelectValue("to", "2024-03-05");

        // 状態が未選択なら、選択欄に残っていた値も消す。
        ui.search.conditions.dateTo = "2024-03";
        controller.renderDateSelection();

        assert.equal(readSelectedDate(ui, "from"), "");
        assert.equal(readSelectedDate(ui, "to"), "2024-03");
        assert.deepEqual(ui.search.conditions, { dateFrom: "", dateTo: "2024-03" });
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: resetting clears the state even before the options exist", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        ui.search.conditions.dateFrom = "2024-02-10";
        ui.search.conditions.dateTo = "2024-03-05";

        controller.resetDateSelectGroup("to");
        assert.deepEqual(ui.search.conditions, { dateFrom: "2024-02-10", dateTo: "" });

        controller.resetDateSelects();
        assert.deepEqual(ui.search.conditions, { dateFrom: "", dateTo: "" });
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: ios year change clears lower date selects and removes updating class after two frames", () => {
    const restoreDom = installFakeDom();
    const frames = installFakeAnimationFrames();
    try {
        const ui = createDateUiState();
        ui.el.dateFromYear.value = "2026";
        ui.el.dateFromMonth.value = "03";
        ui.el.dateFromDay.value = "11";
        let notificationCount = 0;
        const controller = createDateFilterController({
            ui,
            onDateSelectionChange: () => notificationCount++
        });

        controller.setupDateSelectHandlers({ isIOSWebKit: () => true });
        invokeListener(ui.el.dateFromYear, "change", { target: ui.el.dateFromYear });

        assert.equal(ui.fromGroup.classList.contains("is-updating"), true);
        assert.equal(ui.el.dateFromMonth.value, "");
        assert.equal(ui.el.dateFromDay.value, "");
        assert.equal(notificationCount, 1);
        assert.equal(document.activeElement, null);

        frames.advanceFrame();
        assert.equal(ui.fromGroup.classList.contains("is-updating"), true);
        frames.advanceFrame();
        assert.equal(ui.fromGroup.classList.contains("is-updating"), false);
    } finally {
        frames.cleanup();
        restoreDom();
    }
});

test("createDateFilterController: selecting year or month moves focus to the next select on the same side", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        controller.applyDateInputRange([
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240305 })
        ]);
        controller.setupDateSelectHandlers({ isIOSWebKit: () => false });

        ui.el.dateToYear.value = "2024";
        invokeListener(ui.el.dateToYear, "change", { target: ui.el.dateToYear });
        assert.equal(document.activeElement, ui.el.dateToMonth);

        ui.el.dateToMonth.value = "03";
        invokeListener(ui.el.dateToMonth, "change", { target: ui.el.dateToMonth });
        assert.equal(document.activeElement, ui.el.dateToDay);
        assert.equal(ui.fromGroup.classList.contains("is-updating"), false);

        ui.el.dateFromYear.value = "";
        invokeListener(ui.el.dateFromYear, "change", { target: ui.el.dateFromYear });
        assert.equal(document.activeElement, ui.el.dateToDay);
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: clear buttons clear only their own side", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        let notificationCount = 0;
        const controller = createDateFilterController({
            ui,
            onDateSelectionChange: () => notificationCount++
        });
        controller.applyDateInputRange([
            makeRow({ dateKey: 20240210 }),
            makeRow({ dateKey: 20240305 })
        ]);
        controller.applyDateSelectValue("from", "2024-02-10");
        controller.applyDateSelectValue("to", "2024-03-05");
        controller.setupDateSelectHandlers({ isIOSWebKit: () => false });

        invokeListener(ui.el.clearDateToBtn, "click", {});

        assert.equal(readSelectedDate(ui, "from"), "2024-02-10");
        assert.equal(readSelectedDate(ui, "to"), "");
        assert.deepEqual(ui.search.conditions, { dateFrom: "2024-02-10", dateTo: "" });
        assert.equal(notificationCount, 1);
    } finally {
        restoreDom();
    }
});
