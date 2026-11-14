import test from "node:test";
import assert from "node:assert/strict";
import {
    createDefaultSearchBooleanFilters,
    getSearchBooleanFilterElement,
    hasSelectedSearchBooleanFilter,
    renderSearchBooleanFilters,
    SEARCH_BOOLEAN_FILTER_KEYS,
    toSearchBooleanFilterState
} from "../app/lib/search-boolean-filters.mts";

/**
 * 検索の真偽値フィルターのチェックボックスのモックを作る。checked への書き込み回数を数える。
 */
function createBooleanFilterUi() {
    const writes: string[] = [];
    /** checked を持ち、書き込まれたキーを記録する要素を作る。 */
    const createCheckbox = (key: string, initial: boolean) => {
        let checked = initial;
        return {
            get checked() { return checked; },
            set checked(value: boolean) {
                writes.push(key);
                checked = value;
            }
        };
    };
    return {
        writes,
        ui: {
            el: {
                collabHostOnly: createCheckbox("collabHostOnly", true),
                collabGuestOnly: createCheckbox("collabGuestOnly", false),
                relayOnly: createCheckbox("relayOnly", true),
                harmonyOnly: createCheckbox("harmonyOnly", false)
            }
        }
    };
}

test("search boolean filters: the default state leaves every shared key unselected", () => {
    assert.deepEqual(SEARCH_BOOLEAN_FILTER_KEYS, [
        "collabHostOnly",
        "collabGuestOnly",
        "relayOnly",
        "harmonyOnly"
    ]);
    const filters = createDefaultSearchBooleanFilters();
    assert.deepEqual(filters, {
        collabHostOnly: false,
        collabGuestOnly: false,
        relayOnly: false,
        harmonyOnly: false
    });
    assert.equal(hasSelectedSearchBooleanFilter(filters), false);
    assert.notEqual(createDefaultSearchBooleanFilters(), filters, "each state gets its own object");
});

test("search boolean filters: a state is built from stored values of unknown shape", () => {
    assert.deepEqual(toSearchBooleanFilterState({ relayOnly: true, harmonyOnly: 1, collabHostOnly: "", collabGuestOnly: null }), {
        collabHostOnly: false,
        collabGuestOnly: false,
        relayOnly: true,
        harmonyOnly: true
    });
    assert.deepEqual(toSearchBooleanFilterState({}), createDefaultSearchBooleanFilters());
    assert.equal(hasSelectedSearchBooleanFilter(toSearchBooleanFilterState({ collabGuestOnly: true })), true);
});

test("search boolean filters: rendering writes the state to the checkboxes that differ", () => {
    const { ui, writes } = createBooleanFilterUi();

    renderSearchBooleanFilters(ui, {
        collabHostOnly: false,
        collabGuestOnly: false,
        relayOnly: true,
        harmonyOnly: true
    });

    assert.equal(ui.el.collabHostOnly.checked, false);
    assert.equal(ui.el.collabGuestOnly.checked, false);
    assert.equal(ui.el.relayOnly.checked, true);
    assert.equal(ui.el.harmonyOnly.checked, true);
    // すでに同じ値の入力欄には書き込まない。
    assert.deepEqual(writes, ["collabHostOnly", "harmonyOnly"]);
});

test("search boolean filters: missing elements are skipped", () => {
    const partialUi = { el: { relayOnly: { checked: false }, harmonyOnly: null } };
    assert.equal(getSearchBooleanFilterElement(partialUi, "relayOnly"), partialUi.el.relayOnly);
    assert.equal(getSearchBooleanFilterElement(partialUi, "harmonyOnly"), null);
    assert.equal(getSearchBooleanFilterElement(partialUi, "collabHostOnly"), null);
    assert.equal(getSearchBooleanFilterElement(null, "relayOnly"), null);

    assert.doesNotThrow(() => renderSearchBooleanFilters(partialUi, {
        ...createDefaultSearchBooleanFilters(),
        relayOnly: true,
        harmonyOnly: true
    }));
    assert.equal(partialUi.el.relayOnly.checked, true);
    assert.doesNotThrow(() => renderSearchBooleanFilters(undefined, createDefaultSearchBooleanFilters()));
});
