import test from "node:test";
import assert from "node:assert/strict";
import { createFakeTextCacheStore } from "./fixtures/text-cache.mts";
import { createFakeLocalStorage } from "./fixtures/local-storage.mts";
import {
    createLegacyLocalStorageSongsJsonCacheAdapter,
    createLegacyLocalStorageTextCacheAdapter
} from "../app/lib/storage/songs-json-cache.mts";

test("songs json cache adapter: reads legacy text without writing until explicitly accepted", async () => {
    const storage = createFakeLocalStorage();
    const cache = createFakeTextCacheStore();
    const adapter = createLegacyLocalStorageSongsJsonCacheAdapter({
        cache,
        legacyKey: "cachedSongsJson",
        storage
    });

    storage.setItem("cachedSongsJson", "{\"songs\":[]}");

    assert.equal(await adapter.getText(), null);
    assert.equal(adapter.getLegacyText(), "{\"songs\":[]}");
    assert.equal(cache.peek(), null);
    assert.equal(storage.getItem("cachedSongsJson"), "{\"songs\":[]}");
    const legacyText = adapter.getLegacyText();
    assert.ok(legacyText !== null);
    await adapter.setText(legacyText);
    assert.equal(cache.peek(), "{\"songs\":[]}");
    assert.equal(storage.getItem("cachedSongsJson"), null);
});

test("songs json cache adapter: retains legacy localStorage text when primary save fails", async (t) => {
    const storage = createFakeLocalStorage();
    const cache = createFakeTextCacheStore();
    const warnings = t.mock.method(console, "warn", () => {});
    const save = t.mock.method(cache, "setText", async () => {
        throw new Error("quota exceeded");
    });
    const adapter = createLegacyLocalStorageSongsJsonCacheAdapter({
        cache,
        legacyKey: "cachedSongsJson",
        storage
    });

    storage.setItem("cachedSongsJson", "{\"songs\":[\"old\"]}");

    assert.equal(await adapter.setText("{\"songs\":[\"fresh\"]}"), false);
    assert.equal(save.mock.callCount(), 1);
    assert.equal(cache.peek(), null);
    assert.equal(storage.getItem("cachedSongsJson"), "{\"songs\":[\"old\"]}");
    assert.match(String(warnings.mock.calls[0]?.arguments[0]), /曲データJSONキャッシュを保存できませんでした/);
});

test("songs json cache adapter: keeps legacy localStorage text when migration save fails", async (t) => {
    const storage = createFakeLocalStorage();
    const warnings = t.mock.method(console, "warn", () => {});
    const cache = createFakeTextCacheStore();
    t.mock.method(cache, "getText", async () => {
        throw new Error("IndexedDB is not available");
    });
    t.mock.method(cache, "setText", async () => {
        throw new Error("IndexedDB is not available");
    });
    const adapter = createLegacyLocalStorageSongsJsonCacheAdapter({
        cache,
        legacyKey: "cachedSongsJson",
        storage
    });

    storage.setItem("cachedSongsJson", "{\"songs\":[\"legacy\"]}");

    assert.equal(await adapter.getText(), null);
    assert.equal(adapter.getLegacyText(), "{\"songs\":[\"legacy\"]}");
    const legacyText = adapter.getLegacyText();
    assert.ok(legacyText !== null);
    assert.equal(await adapter.setText(legacyText), false);
    assert.equal(storage.getItem("cachedSongsJson"), "{\"songs\":[\"legacy\"]}");
    assert.match(String(warnings.mock.calls[0]?.arguments[0]), /曲データJSONキャッシュを読み込めませんでした/);
    assert.match(String(warnings.mock.calls[1]?.arguments[0]), /曲データJSONキャッシュを保存できませんでした/);
});

test("text cache adapter: migrates multiple legacy localStorage keys into primary cache", async () => {
    const storage = createFakeLocalStorage();
    const cache = createFakeTextCacheStore();
    const adapter = createLegacyLocalStorageTextCacheAdapter({
        cache,
        legacyKeys: ["cachedCsvV2", "cachedCsv"],
        storage,
        label: "CSVキャッシュ"
    });

    storage.setItem("cachedCsv", "legacy,csv");

    assert.equal(await adapter.getText(), null);
    assert.equal(adapter.getLegacyText(), "legacy,csv");
    assert.equal(cache.peek(), null);
    const legacyText = adapter.getLegacyText();
    assert.ok(legacyText !== null);
    await adapter.setText(legacyText);
    assert.equal(cache.peek(), "legacy,csv");
    assert.equal(storage.getItem("cachedCsvV2"), null);
    assert.equal(storage.getItem("cachedCsv"), null);
});

test("text cache adapter: setText success clears legacy localStorage keys", async () => {
    const storage = createFakeLocalStorage();
    const cache = createFakeTextCacheStore();
    const adapter = createLegacyLocalStorageTextCacheAdapter({
        cache,
        legacyKeys: ["cachedCsvV2", "cachedCsv"],
        storage,
        label: "CSVキャッシュ"
    });

    storage.setItem("cachedCsvV2", "current,csv");
    storage.setItem("cachedCsv", "legacy,csv");

    assert.equal(await adapter.setText("fresh,csv"), true);
    assert.equal(cache.peek(), "fresh,csv");
    assert.equal(storage.getItem("cachedCsvV2"), null);
    assert.equal(storage.getItem("cachedCsv"), null);
});

test("text cache adapter: setTextIf saves only when the stored value may be replaced, and clears legacy keys only then", async (t) => {
    const storage = createFakeLocalStorage();
    const cache = createFakeTextCacheStore("stored");
    const adapter = createLegacyLocalStorageTextCacheAdapter({
        cache,
        legacyKeys: ["cachedCsvV2", "cachedCsv"],
        storage,
        label: "CSVキャッシュ"
    });
    storage.setItem("cachedCsvV2", "current,csv");
    storage.setItem("cachedCsv", "legacy,csv");

    // 判定には、現行の cache に保存済みの値を渡す。置き換えないと判定されたら、何も変えない。
    const seen: (string | null)[] = [];
    assert.equal(await adapter.setTextIf("fresh", (current) => { seen.push(current); return false; }), false);
    assert.deepEqual(seen, ["stored"]);
    assert.equal(cache.peek(), "stored");
    assert.equal(storage.getItem("cachedCsvV2"), "current,csv");
    assert.equal(storage.getItem("cachedCsv"), "legacy,csv");

    assert.equal(await adapter.setTextIf("fresh", (current) => current === "stored"), true);
    assert.equal(cache.peek(), "fresh");
    assert.equal(storage.getItem("cachedCsvV2"), null);
    assert.equal(storage.getItem("cachedCsv"), null);

    // 保存に失敗したときは、例外にせず false を返す。
    t.mock.method(console, "warn", () => {});
    t.mock.method(cache, "setTextIf", async () => { throw new Error("IndexedDB write failed"); });
    assert.equal(await adapter.setTextIf("newest", () => true), false);
    assert.equal(cache.peek(), "fresh");
});

test("text cache adapter: removeText clears primary and all legacy cache entries", async () => {
    const storage = createFakeLocalStorage();
    const cache = createFakeTextCacheStore("cached,csv");
    const adapter = createLegacyLocalStorageTextCacheAdapter({
        cache,
        legacyKeys: ["cachedCsvV2", "cachedCsv"],
        storage,
        label: "CSVキャッシュ"
    });
    storage.setItem("cachedCsvV2", "current,csv");
    storage.setItem("cachedCsv", "legacy,csv");

    await adapter.removeText();

    assert.equal(cache.peek(), null);
    assert.equal(storage.getItem("cachedCsvV2"), null);
    assert.equal(storage.getItem("cachedCsv"), null);
});
