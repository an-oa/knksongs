import test from "node:test";
import assert from "node:assert/strict";
import { createSearchUiActions } from "../app/ui/core/search-actions.mts";
import { createInitialSearchConditions } from "../app/state.mts";
import { installFakeDom, invokeListener } from "./test-helpers.mts";
import type { SiteLanguage } from "../app/lib/site-language.mts";

/**
 * search actions が委譲する controller を、呼び出し順を記録するモックとして作る。
 * @param calls 呼び出し名を追記する配列
 * @param options hasScheduledSearch が true なら、予約済みの検索があるものとして前倒しに応じる
 */
function createRecordingDependencies(calls: string[], options: { hasScheduledSearch?: boolean } = {}): Pick<
    Parameters<typeof createSearchUiActions>[0],
    "searchFiltersController" | "dateFilterController" | "searchCoordinator" | "storageController"
> {
    return {
        searchFiltersController: {
            resetFiltersToDefault: ({ resetDateSelects }) => {
                calls.push("reset filters");
                resetDateSelects();
            },
            setSelectedFormatsToDefault: () => { calls.push("default formats"); },
            syncFormatCheckboxesFromState: () => { calls.push("sync formats"); }
        },
        dateFilterController: {
            resetDateSelects: () => { calls.push("reset dates"); },
            renderDateSelection: () => { calls.push("render dates"); },
            commitDateSelectionClear: (kind) => { calls.push(`clear date ${kind}`); }
        },
        searchCoordinator: {
            cancelScheduledSearch: () => { calls.push("cancel"); },
            scheduleSearch: (scheduleOptions) => {
                calls.push(`search ${scheduleOptions?.immediate ? "immediate" : "debounced"}`);
            },
            flushScheduledSearch: () => {
                calls.push("flush");
                return Boolean(options.hasScheduledSearch);
            }
        },
        storageController: {
            saveSearchState: () => { calls.push("save"); },
            clearActiveBookmark: () => { calls.push("clear bookmark"); }
        }
    };
}

/**
 * 検索語と真偽値フィルターを指定済みの状態と、それを映した入力欄のモックで、search actions を作る。
 * 入力欄は値の読み書きだけを持つので、イベントを使わない操作の検証に使う。
 */
function createRecordingActions() {
    const calls: string[] = [];
    const ui = {
        el: {
            searchBox: { value: "群青" },
            searchBoxError: null,
            relayOnly: { checked: true },
            harmonyOnly: { checked: true }
        },
        language: { current: "ja" as SiteLanguage }
    };
    const search = {
        conditions: {
            ...createInitialSearchConditions(),
            query: "群青",
            booleanFilters: { collabHostOnly: false, collabGuestOnly: false, relayOnly: true, harmonyOnly: true }
        }
    };
    const controller = createSearchUiActions({
        ui,
        search,
        ...createRecordingDependencies(calls)
    });
    return { calls, ui, search, controller };
}

/**
 * 偽の DOM の入力欄で、イベントを受ける search actions を作る。
 * @param options hasScheduledSearch が true なら、予約済みの検索があるものとして前倒しに応じる
 */
function createFormActions(options: { hasScheduledSearch?: boolean } = {}) {
    const calls: string[] = [];
    const ui = {
        el: {
            searchBox: document.createElement("input"),
            searchBoxError: document.createElement("p"),
            clearBtn: document.createElement("button"),
            collabHostOnly: document.createElement("input"),
            collabGuestOnly: document.createElement("input"),
            relayOnly: document.createElement("input"),
            harmonyOnly: document.createElement("input")
        },
        language: { current: "ja" as SiteLanguage }
    };
    ui.el.searchBoxError.hidden = true;
    const search = { conditions: createInitialSearchConditions() };
    const controller = createSearchUiActions({
        ui,
        search,
        ...createRecordingDependencies(calls, options)
    });
    controller.setupSearchFormHandlers();
    return { calls, ui, search, controller };
}

test("search actions: clear resets the conditions and their inputs before delegating active bookmark cleanup", () => {
    const { calls, ui, search, controller } = createRecordingActions();

    controller.clearSearch();

    assert.equal(search.conditions.query, "");
    assert.equal(ui.el.searchBox.value, "");
    // 検索の予約を取り消し、条件を戻してから、ブックマークの解除 (検索と保存を行う) へ渡す。
    assert.deepEqual(calls, ["cancel", "reset filters", "reset dates", "clear bookmark"]);
});

test("search actions: clearing one condition updates the state and its input before a single immediate search and save", () => {
    const query = createRecordingActions();
    query.controller.clearSearchQuery();
    assert.equal(query.search.conditions.query, "");
    assert.equal(query.ui.el.searchBox.value, "");
    assert.deepEqual(query.calls, ["cancel", "search immediate", "save"]);

    const formats = createRecordingActions();
    formats.controller.resetFormatFilters();
    assert.deepEqual(formats.calls, ["default formats", "sync formats", "search immediate", "save"]);

    const flag = createRecordingActions();
    flag.controller.clearBooleanFilter("relayOnly");
    assert.deepEqual(flag.search.conditions.booleanFilters, {
        collabHostOnly: false,
        collabGuestOnly: false,
        relayOnly: false,
        harmonyOnly: true
    });
    assert.equal(flag.ui.el.relayOnly.checked, false);
    assert.equal(flag.ui.el.harmonyOnly.checked, true);
    assert.deepEqual(flag.calls, ["search immediate", "save"]);

    const date = createRecordingActions();
    date.controller.clearDateFilter("to");
    assert.deepEqual(date.calls, ["clear date to"]);
});

test("search actions: the state is shown in every input after restoring, and only in cheap inputs when the page comes back", () => {
    const { calls, ui, search, controller } = createRecordingActions();
    // ブラウザがフォームの値を復元して、入力欄だけが状態と違う値になった場合。
    ui.el.searchBox.value = "復元された古い検索語";
    ui.el.relayOnly.checked = false;
    ui.el.harmonyOnly.checked = false;

    controller.refreshConditionInputs();
    assert.equal(ui.el.searchBox.value, "群青");
    assert.equal(ui.el.relayOnly.checked, true);
    assert.equal(ui.el.harmonyOnly.checked, true);
    assert.equal(search.conditions.query, "群青", "the state is not changed by the inputs");
    // 日付の選択欄は選択肢を作り直すので、画面へ戻るたびには触らない。
    assert.deepEqual(calls.splice(0), ["sync formats"]);

    controller.renderConditions();
    assert.deepEqual(calls, ["sync formats", "render dates"]);
});

test("search actions: an input that already shows the state is not written again", () => {
    const calls: string[] = [];
    let writeCount = 0;
    let value = "群青";
    const searchBox = {
        get value() { return value; },
        set value(next: string) {
            writeCount += 1;
            value = next;
        }
    };
    const controller = createSearchUiActions({
        ui: { el: { searchBox, searchBoxError: null }, language: { current: "ja" as SiteLanguage } },
        search: { conditions: { ...createInitialSearchConditions(), query: "群青" } },
        ...createRecordingDependencies(calls)
    });

    // 入力やかな漢字変換の途中の検索窓へ同じ値を書くと、入力位置や変換が崩れることがある。
    controller.refreshConditionInputs();
    assert.equal(writeCount, 0);
});

test("search actions: typing and toggling write the state, then search after a pause and save", () => {
    const restoreDom = installFakeDom();
    try {
        const { calls, ui, search, controller } = createFormActions();

        ui.el.relayOnly.checked = true;
        invokeListener(ui.el.relayOnly, "change", { target: ui.el.relayOnly });
        assert.deepEqual(search.conditions.booleanFilters, {
            collabHostOnly: false,
            collabGuestOnly: false,
            relayOnly: true,
            harmonyOnly: false
        });
        assert.deepEqual(calls.splice(0), ["search debounced", "save"]);

        ui.el.searchBox.value = "since:2024-13";
        invokeListener(ui.el.searchBox, "input", { target: ui.el.searchBox });
        assert.equal(search.conditions.query, "since:2024-13");
        assert.deepEqual(calls.splice(0), ["search debounced", "save"]);
        assert.equal(ui.el.searchBoxError.hidden, true, "an error is not shown while typing");

        invokeListener(ui.el.searchBox, "blur", { target: ui.el.searchBox });
        assert.equal(ui.el.searchBoxError.hidden, false);
        assert.equal(ui.el.searchBox.getAttribute("aria-invalid"), "true");
        assert.deepEqual(calls, []);

        // 言語が変わったら、表示中のエラーを書き直す。
        ui.language.current = "en";
        controller.refreshQueryValidationMessage();
        assert.match(ui.el.searchBoxError.textContent ?? "", /^Enter a real date/);
        ui.language.current = "ja";

        ui.el.searchBox.value = "since:2024-12";
        invokeListener(ui.el.searchBox, "input", { target: ui.el.searchBox });
        assert.equal(search.conditions.query, "since:2024-12");
        assert.equal(ui.el.searchBoxError.hidden, true);
        assert.equal(ui.el.searchBox.getAttribute("aria-invalid"), null);
        assert.deepEqual(calls.splice(0), ["search debounced", "save"]);

        invokeListener(ui.el.clearBtn, "click", {});
        assert.equal(search.conditions.query, "");
        assert.equal(ui.el.searchBox.value, "");
        assert.deepEqual(calls, ["cancel", "reset filters", "reset dates", "clear bookmark"]);
    } finally {
        restoreDom();
    }
});

test("search actions: Enter runs the waiting search at once and keeps focus where a mouse is the main pointer", () => {
    const restoreDom = installFakeDom();
    try {
        const { calls, ui } = createFormActions({ hasScheduledSearch: true });
        ui.el.searchBox.focus();

        invokeListener(ui.el.searchBox, "keydown", { key: "a" });
        assert.deepEqual(calls, []);

        invokeListener(ui.el.searchBox, "keydown", { key: "Enter" });
        assert.deepEqual(calls, ["flush"]);
        assert.equal(document.activeElement, ui.el.searchBox);
    } finally {
        restoreDom();
    }
});

test("search actions: Enter also closes the on-screen keyboard where a finger is the main pointer", () => {
    const restoreDom = installFakeDom();
    try {
        restoreDom.window.matchMedia = (query?: string) => ({ matches: query === "(pointer: coarse)" });
        const { calls, ui } = createFormActions();
        ui.el.searchBox.focus();

        invokeListener(ui.el.searchBox, "keydown", { key: "Enter" });
        assert.deepEqual(calls, ["flush"]);
        assert.equal(document.activeElement, null, "the search box gives up focus");
    } finally {
        restoreDom();
    }
});

test("search actions: Enter that confirms a kana conversion is not treated as the end of the input", () => {
    const restoreDom = installFakeDom();
    try {
        restoreDom.window.matchMedia = (query?: string) => ({ matches: query === "(pointer: coarse)" });
        const { calls, ui } = createFormActions({ hasScheduledSearch: true });
        ui.el.searchBox.focus();

        invokeListener(ui.el.searchBox, "keydown", { key: "Enter", isComposing: true });
        invokeListener(ui.el.searchBox, "keydown", { key: "Enter", keyCode: 229 });
        assert.deepEqual(calls, []);
        assert.equal(document.activeElement, ui.el.searchBox);
    } finally {
        restoreDom();
    }
});
