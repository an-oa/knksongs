import test from "node:test";
import assert from "node:assert/strict";
import { createDateFilterController } from "../_build/app/ui/date/filter.mjs";
import { normalizeForSearch } from "../_build/app/lib/search-normalization.mjs";
import { installFakeDom } from "./test-helpers.mjs";

let autoSongId = 0;

/**
 * 日付コントローラー検証用の UI 状態を作る。
 * @returns {*}
 */
function createDateUiState() {
    return {
        el: {
            dateFromYear: document.createElement("select"),
            dateFromMonth: document.createElement("select"),
            dateFromDay: document.createElement("select"),
            dateToYear: document.createElement("select"),
            dateToMonth: document.createElement("select"),
            dateToDay: document.createElement("select")
        },
        date: {
            bounds: null,
            index: null,
            pendingValues: null
        }
    };
}

function makeRow(input) {
    const title = input.title ?? "";
    const artist = input.artist ?? "";
    const titleYomi = input.titleYomi ?? "";
    const artistYomi = input.artistYomi ?? "";
    const songKey = input.songKey ?? `song-${++autoSongId}`;
    return {
        archiveId: input.archiveId ?? "",
        archiveOrder: input.archiveOrder ?? 1,
        songKey,
        bookmarkSongKey: input.bookmarkSongKey ?? songKey,
        dateKey: input.dateKey ?? null,
        format: input.format ?? "配信",
        streamRole: input.streamRole ?? "",
        isRelay: !!input.isRelay,
        isHarmony: !!input.isHarmony,
        titleNorm: normalizeForSearch(title),
        artistNorm: normalizeForSearch(artist),
        titleYomiNorm: normalizeForSearch(titleYomi),
        artistYomiNorm: normalizeForSearch(artistYomi)
    };
}

/**
 * セレクト要素の option 値一覧を返す。
 * @param {*} select
 */
function getSelectValues(select) {
    return select.children.map((option) => option.value);
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

test("createDateFilterController: getDateSelectValue returns partial date values", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });

        ui.el.dateFromYear.value = "2024";
        assert.equal(controller.getDateSelectValue("from"), "2024");

        ui.el.dateFromMonth.value = "02";
        assert.equal(controller.getDateSelectValue("from"), "2024-02");

        ui.el.dateFromDay.value = "10";
        assert.equal(controller.getDateSelectValue("from"), "2024-02-10");
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: applyDateSelectValue restores partial date values", () => {
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

        assert.equal(controller.getDateSelectValue("from"), "2024-02");
        assert.equal(ui.el.dateFromDay.value, "");
        assert.equal(controller.getDateSelectValue("to"), "2024");
        assert.equal(ui.el.dateToMonth.value, "");
        assert.equal(ui.el.dateToDay.value, "");

        controller.applyDateSelectValue("from", "2024-02-10");
        controller.applyDateSelectValue("from", "2024-02");
        assert.equal(controller.getDateSelectValue("from"), "2024-02");
        assert.equal(ui.el.dateFromDay.value, "");

        controller.applyDateSelectValue("to", "2024-03-05");
        controller.applyDateSelectValue("to", "2024");
        assert.equal(controller.getDateSelectValue("to"), "2024");
        assert.equal(ui.el.dateToMonth.value, "");
        assert.equal(ui.el.dateToDay.value, "");
    } finally {
        restoreDom();
    }
});

test("createDateFilterController: reapplying date bounds preserves complete selections", () => {
    const restoreDom = installFakeDom();
    try {
        const ui = createDateUiState();
        const controller = createDateFilterController({ ui });
        const rows = [
            makeRow({ dateKey: 20250315 }),
            makeRow({ dateKey: 20250420 })
        ];

        controller.applyDateInputRange(rows);
        controller.applyDateSelectValue("from", "2025-03-15");
        controller.applyDateSelectValue("to", "2025-04-20");

        controller.applyDateInputRange(rows);

        assert.equal(controller.getDateSelectValue("from"), "2025-03-15");
        assert.equal(controller.getDateSelectValue("to"), "2025-04-20");
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

        assert.equal(controller.getDateSelectValue("from"), "2024-02");
        assert.equal(ui.el.dateFromDay.value, "");
        assert.deepEqual(controller.getPartialDateRange("from"), {
            minKey: 20240201,
            maxKey: 20240229
        });

        controller.resetDateSelects();
        controller.applyDateSelectValue("to", "2024-02-15");

        assert.equal(controller.getDateSelectValue("to"), "2024-02");
        assert.equal(ui.el.dateToDay.value, "");
        assert.deepEqual(controller.getPartialDateRange("to"), {
            minKey: 20240201,
            maxKey: 20240229
        });
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
        assert.equal(controller.getDateSelectValue("to"), "2024");

        ui.el.dateToMonth.value = "02";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(controller.getDateSelectValue("to"), "2024-02");

        ui.el.dateToDay.value = "15";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(controller.getDateSelectValue("to"), "2024-02-15");

        controller.resetDateSelects();
        controller.applyDateSelectValue("to", "2024-03-05");

        ui.el.dateFromYear.value = "2024";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(controller.getDateSelectValue("from"), "2024");

        ui.el.dateFromMonth.value = "02";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(controller.getDateSelectValue("from"), "2024-02");

        ui.el.dateFromDay.value = "10";
        controller.clampDateInputsIfNeeded();
        controller.syncDateSelectOptions();
        assert.equal(controller.getDateSelectValue("from"), "2024-02-10");
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

        assert.equal(controller.getDateSelectValue("from"), "2024-03-05");
        assert.equal(controller.getDateSelectValue("to"), "2024-03-05");
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

test("createDateFilterController: applyPendingDateValues restores selections and clears pending state", () => {
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
        ui.date.pendingValues = {
            from: "2024-02-10",
            to: "2024-03-05"
        };

        controller.applyPendingDateValues();

        assert.equal(controller.getDateSelectValue("from"), "2024-02-10");
        assert.equal(controller.getDateSelectValue("to"), "2024-03-05");
        assert.equal(ui.date.pendingValues, null);
    } finally {
        restoreDom();
    }
});
