import test from "node:test";
import assert from "node:assert/strict";
import { createSearchFiltersController } from "../app/ui/search-filters/controller.mts";
import { installFakeDom, invokeListener } from "./test-helpers.mts";
import type { SiteLanguage } from "../app/lib/site-language.mts";

/** 選択状態を持つ形式チェックボックスのモックを作る。 */
function createFormatCheckbox(value: string, checked = false) {
    return { value, checked };
}

/** 形式と真偽値フィルターの状態を作る。 */
function createSearchFiltersUiState() {
    const formatCheckboxes = [
        createFormatCheckbox("配信"),
        createFormatCheckbox("歌みた"),
        createFormatCheckbox("ショート")
    ];
    const formatsList = {
        querySelectorAll: (selector: string) => {
            assert.equal(selector, 'input[type="checkbox"]');
            return formatCheckboxes;
        }
    };
    return {
        el: {
            collabHostOnly: { checked: true },
            collabGuestOnly: { checked: true },
            relayOnly: { checked: true },
            harmonyOnly: { checked: true },
            formatsList
        },
        search: {
            selectedFormats: new Set(["ショート"]),
            conditions: {
                booleanFilters: { collabHostOnly: true, collabGuestOnly: true, relayOnly: true, harmonyOnly: true }
            }
        },
        formatCheckboxes,
        language: { current: "ja" as SiteLanguage }
    };
}

test("createSearchFiltersController: resets the filter state to defaults and shows it in the inputs", () => {
    const ui = createSearchFiltersUiState();
    const controller = createSearchFiltersController({
        ui,
        defaultFormats: ["配信", "歌みた"]
    });
    let resetDateCallCount = 0;
    controller.renderFilterOptions();

    controller.resetFiltersToDefault({
        resetDateSelects: () => {
            resetDateCallCount += 1;
        }
    });

    assert.deepEqual(ui.search.conditions.booleanFilters, {
        collabHostOnly: false,
        collabGuestOnly: false,
        relayOnly: false,
        harmonyOnly: false
    });
    assert.equal(ui.el.collabHostOnly.checked, false);
    assert.equal(ui.el.collabGuestOnly.checked, false);
    assert.equal(ui.el.relayOnly.checked, false);
    assert.equal(ui.el.harmonyOnly.checked, false);
    assert.deepEqual(Array.from(ui.search.selectedFormats), ["配信", "歌みた"]);
    assert.deepEqual(ui.formatCheckboxes.map((checkbox) => checkbox.checked), [true, true, false]);
    // 日付範囲は日付 controller が状態と選択欄の両方を戻すので、処理を任せるだけにする。
    assert.equal(resetDateCallCount, 1);
});

test("createSearchFiltersController: restores stored formats, dropping unknown and duplicate values", () => {
    const ui = createSearchFiltersUiState();
    const controller = createSearchFiltersController({
        ui,
        defaultFormats: ["配信", "歌みた", "ショート", "切り抜き", "収録"]
    });
    controller.renderFilterOptions();

    controller.applySelectedFormats(["歌みた", "未知の形態", "歌みた", "配信"]);
    assert.deepEqual(controller.getSelectedFormatValues(), ["歌みた", "配信"]);
    assert.deepEqual(ui.formatCheckboxes.map((checkbox) => checkbox.checked), [true, true, false]);
    assert.equal(controller.areAllFormatsSelected(), false);

    // 選べる形態が 1 つも残らない保存値と、配列でない保存値は、既定 (すべて) に戻す。
    controller.applySelectedFormats(["未知の形態"]);
    assert.deepEqual(controller.getSelectedFormatValues(), ["配信", "歌みた", "ショート", "切り抜き", "収録"]);
    controller.applySelectedFormats(null);
    assert.equal(controller.areAllFormatsSelected(), true);
    assert.deepEqual(ui.formatCheckboxes.map((checkbox) => checkbox.checked), [true, true, true]);
    // 動画の種類の復元は、真偽値フィルターの状態に触らない。
    assert.equal(ui.search.conditions.booleanFilters.relayOnly, true);
});

test("createSearchFiltersController: sets up format filter options", () => {
    const restoreDom = installFakeDom();
    try {
        const formatsList = document.createElement("div");
        const ui = {
            el: {
                collabHostOnly: { checked: false },
                collabGuestOnly: { checked: false },
                relayOnly: { checked: false },
                harmonyOnly: { checked: false },
                formatsList
            },
            search: {
                selectedFormats: new Set<string>(),
                conditions: {
                    booleanFilters: { collabHostOnly: false, collabGuestOnly: false, relayOnly: false, harmonyOnly: false }
                }
            },
            language: { current: "ja" as SiteLanguage }
        };
        const controller = createSearchFiltersController({
            ui,
            defaultFormats: ["配信", "歌みた"]
        });
        let filterChangeCount = 0;

        controller.setupFilterOptions({
            onFilterChange: () => {
                filterChangeCount += 1;
            }
        });

        assert.equal(formatsList.childElementCount, 2);
        assert.deepEqual(controller.getSelectedFormatValues(), ["配信", "歌みた"]);
        const labels = formatsList.querySelectorAll("label");
        const firstFormatCheckbox = labels[0].querySelector("input");
        const secondFormatCheckbox = labels[1].querySelector("input");
        assert.ok(firstFormatCheckbox);
        assert.ok(secondFormatCheckbox);
        assert.equal(labels[0].htmlFor, "format-filter-0");
        assert.equal(firstFormatCheckbox.id, "format-filter-0");
        assert.equal(labels[1].htmlFor, "format-filter-1");
        assert.equal(secondFormatCheckbox.id, "format-filter-1");
        assert.equal(
            firstFormatCheckbox.getAttribute("autocomplete"),
            "off",
            "the browser must not restore the checkbox against the state"
        );

        secondFormatCheckbox.checked = false;
        invokeListener(secondFormatCheckbox, "change", { target: secondFormatCheckbox });

        assert.deepEqual(controller.getSelectedFormatValues(), ["配信"]);
        assert.equal(filterChangeCount, 1);

        controller.setupFilterOptions({
            onFilterChange: () => {
                throw new Error("should not register duplicate listeners");
            }
        });

        assert.equal(formatsList.childElementCount, 2);
    } finally {
        restoreDom();
    }
});
