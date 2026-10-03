import test from "node:test";
import assert from "node:assert/strict";
import { createSearchUiActions } from "../app/ui/core/search-actions.mts";

test("search actions: clear resets conditions before delegating active bookmark cleanup", () => {
    const calls = {
        filterReset: 0,
        dateReset: 0,
        cancelSearch: 0,
        directSearch: 0,
        directSave: 0,
        activeBookmarkClear: 0,
        queryAtActiveBookmarkClear: null as string | null,
        filterResetAtActiveBookmarkClear: 0
    };
    const ui = {
        el: {
            searchBox: { value: "群青" },
            searchBoxError: null
        }
    };
    const search = {
        dataReady: true,
        userTouchedQuery: true,
        userTouchedFilters: true
    };
    const dateFilterController = {
        resetDateSelects() {
            calls.dateReset += 1;
        },
        hasDateSelection() {
            return false;
        }
    };
    const searchCoordinator = {
        cancelScheduledSearch() {
            calls.cancelSearch += 1;
        },
        scheduleSearch() {
            calls.directSearch += 1;
        }
    };
    const storageController = {
        saveSearchState() {
            calls.directSave += 1;
        },
        clearActiveBookmark() {
            calls.activeBookmarkClear += 1;
            calls.queryAtActiveBookmarkClear = ui.el.searchBox.value;
            calls.filterResetAtActiveBookmarkClear = calls.filterReset;
        }
    };
    const controller = createSearchUiActions({
        ui,
        search,
        searchFiltersController: {
            resetFiltersToDefault({ resetDateSelects }) {
                calls.filterReset += 1;
                resetDateSelects();
            },
            syncFormatCheckboxesFromState() {},
            needsFilterReset() {
                return false;
            }
        },
        dateFilterController,
        searchCoordinator,
        storageController
    });

    controller.clearSearch();

    assert.equal(ui.el.searchBox.value, "");
    assert.equal(search.userTouchedQuery, false);
    assert.equal(calls.filterReset, 1);
    assert.equal(calls.dateReset, 1);
    assert.equal(calls.cancelSearch, 1);
    assert.equal(calls.activeBookmarkClear, 1);
    assert.equal(calls.queryAtActiveBookmarkClear, "");
    assert.equal(calls.filterResetAtActiveBookmarkClear, 1);
    assert.equal(calls.directSearch, 0);
    assert.equal(calls.directSave, 0);
});

test("search actions: query and filters are both synchronized before a single search", () => {
    const ui = { el: { searchBox: { value: "stale query" } } };
    const search = { dataReady: true, userTouchedQuery: false, userTouchedFilters: false };
    let filtersNeedReset = true;
    let dateSelected = true;
    const calls: string[] = [];
    const controller = createSearchUiActions({
        ui,
        search,
        searchFiltersController: {
            syncFormatCheckboxesFromState: () => { calls.push("sync formats"); },
            needsFilterReset: () => filtersNeedReset,
            resetFiltersToDefault: ({ resetDateSelects }) => {
                filtersNeedReset = false;
                resetDateSelects();
            }
        },
        dateFilterController: {
            resetDateSelects: () => { dateSelected = false; },
            hasDateSelection: () => dateSelected
        },
        searchCoordinator: {
            cancelScheduledSearch: () => {},
            scheduleSearch: (options) => {
                assert.equal(ui.el.searchBox.value, "");
                assert.equal(filtersNeedReset, false);
                assert.equal(dateSelected, false);
                assert.deepEqual(options, { immediate: true });
                calls.push("search");
            }
        },
        storageController: { saveSearchState: () => {}, clearActiveBookmark: () => {} }
    });
    controller.syncSearchUI();
    assert.deepEqual(calls, ["sync formats", "search"]);
});
