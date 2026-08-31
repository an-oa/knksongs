import test from "node:test";
import assert from "node:assert/strict";
import { createSongsDataSource } from "../_build/app/lib/songs-data-source.mjs";
import { createLegacyLocalStorageSongsJsonCacheAdapter } from "../_build/app/lib/storage/songs-json-cache.mjs";
import { buildSongsJsonMetaPayload, buildSongsJsonPayload } from "../_build/app/lib/songs-json.mjs";

const GENERATED_AT = "2026-08-14T00:00:00.000Z";

/**
 * data sourceテスト用のlocalStorageを作る。
 * @returns {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void }}
 */
function createFakeLocalStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

/**
 * data sourceテスト用のテキストキャッシュを作る。
 * @param {string | null} initialValue 初期値
 */
function createFakeTextCacheStore(initialValue = null) {
    let value = initialValue;
    let removeCount = 0;
    return {
        async getText() {
            return value;
        },
        async setText(nextValue) {
            value = String(nextValue);
            return true;
        },
        async removeText() {
            value = null;
            removeCount += 1;
        },
        peek() {
            return value;
        },
        getRemoveCount() {
            return removeCount;
        }
    };
}

/**
 * data sourceテスト用の最小CSVを返す。
 * @returns {string}
 */
function createValidCsv() {
    return [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "archive-1,2026/03/11,,縦,全体,配信,,,1,KING,Kanaria feat. GUMI,キング,カナリアフィーチャリンググミ,https://www.youtube.com/watch?v=abc123def45&t=10s,0:09:41,"
    ].join("\n");
}

/**
 * data sourceテスト用のJSON文字列を返す。
 * @param {string} songKey 曲識別子
 * @param {string} contentHash 内容hash
 * @param {string} generatedAt 生成日時
 * @returns {string}
 */
function createSongsJson(
    songKey,
    contentHash = `sha256:${songKey}`,
    generatedAt = GENERATED_AT
) {
    const archiveId = songKey.split("::")[0] || "json-archive";
    return JSON.stringify(buildSongsJsonPayload([
        {
            date: "2026/03/11",
            dateKey: 20260311,
            archiveId,
            archiveOrder: 1,
            videoId: "abc123def45",
            songKey,
            bookmarkSongKey: "abc123def45::1",
            legacySongKey: `${songKey}::https://www.youtube.com/watch?v=abc123def45&t=10s`,
            format: "配信",
            streamRole: "",
            videoOrientation: "vertical",
            isRelay: false,
            isHarmony: false,
            title: "KING",
            artist: "Kanaria feat. GUMI",
            titleYomi: "キング",
            artistYomi: "カナリアフィーチャリンググミ",
            url: "https://www.youtube.com/watch?v=abc123def45&t=10s",
            endSeconds: 581,
            titleNorm: "king",
            artistNorm: "kanaria feat. gumi",
            titleYomiNorm: "キング",
            artistYomiNorm: "カナリアフィーチャリンググミ"
        }
    ], contentHash, generatedAt));
}

/**
 * 直前schemaのキャッシュ確認用JSON文字列を返す。
 * @param {string} songKey 曲識別子
 * @param {string} contentHash 内容hash
 * @returns {string}
 */
function createPreviousSchemaSongsJson(songKey, contentHash) {
    const payload = JSON.parse(createSongsJson(songKey, contentHash));
    payload.schemaVersion -= 1;
    payload.songs.forEach((song, index) => {
        song.sourceIndex = index;
    });
    return JSON.stringify(payload);
}

/**
 * data sourceテスト用のJSONメタ情報を返す。
 * @param {string} contentHash 内容hash
 * @param {string} generatedAt 生成日時
 * @returns {string}
 */
function createSongsMetaJson(contentHash, generatedAt = GENERATED_AT) {
    return JSON.stringify(buildSongsJsonMetaPayload(contentHash, generatedAt));
}

/**
 * fetchテスト用の成功responseを返す。
 * @param {string} body response本文
 */
function createResponse(body) {
    return {
        ok: true,
        async text() {
            return body;
        }
    };
}

/**
 * fetchテスト用の失敗responseを返す。
 */
function createFailedResponse() {
    return {
        ok: false,
        async text() {
            throw new Error("should not read failed response body");
        }
    };
}

/**
 * fetch呼び出しを、タイムアウトsignalを含む公開上の取得条件として比較する。
 * @param {Array<[string, RequestInit & { priority?: string }]>} actual 実際のfetch呼び出し
 * @param {Array<[string, { cache: RequestCache, priority?: string }]>} expected 期待するfetch呼び出し
 */
function assertFetchCalls(actual, expected) {
    assert.deepEqual(
        actual.map(([url, options]) => [url, {
            cache: options.cache,
            priority: options.priority,
            hasAbortSignal: options.signal instanceof AbortSignal
        }]),
        expected.map(([url, options]) => [url, {
            cache: options.cache,
            priority: options.priority,
            hasAbortSignal: true
        }])
    );
}

/**
 * abortされるまで応答しないfetchを返す。
 * @returns {(url: string, options: RequestInit) => Promise<never>}
 */
function createPendingFetch() {
    return (_url, options) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
            reject(options.signal.reason);
        }, { once: true });
    });
}

/**
 * 初期スナップショットを収集し、キャッシュだった場合だけ更新APIを別途実行する。
 * @param {*} dataSource
 * @param {object[]} results
 * @returns {Promise<boolean>}
 */
async function collectInitialAndRefreshSnapshots(dataSource, results) {
    const initialSnapshot = await dataSource.loadInitialSnapshot();
    if (!initialSnapshot) return false;
    results.push(initialSnapshot);
    if (initialSnapshot.source === "cache") {
        const refreshedSnapshot = await dataSource.refreshSnapshot(initialSnapshot);
        if (refreshedSnapshot) results.push(refreshedSnapshot);
    }
    return true;
}

test("songs data source: network csv is used without creating a runtime csv cache", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const csv = createValidCsv();
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            return createResponse(csv);
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicCsvUrl: "https://example.test/songs.csv"
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["https://example.test/songs.csv", { cache: "no-store" }]
        ]);
        assert.equal(results[0].source, "network");
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: network json success stores json and skips csv", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const songsJson = createSongsJson("json-archive::1");
        const songsJsonCache = createFakeTextCacheStore();
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            return createResponse(songsJson);
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [["data/songs.json", { cache: "no-cache" }]]);
        assert.equal(songsJsonCache.peek(), songsJson);
        assert.equal(results[0].source, "network");
        assert.equal(results[0].songs[0].songKey, "json-archive::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: structurally invalid network json is not cached and falls back to csv", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const invalidPayload = JSON.parse(createSongsJson("invalid-archive::1"));
        delete invalidPayload.songs[0].title;
        const songsJsonCache = createFakeTextCacheStore();
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs.json") return createResponse(JSON.stringify(invalidPayload));
            return createResponse(createValidCsv());
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs.json", { cache: "no-cache" }],
            ["https://example.test/songs.csv", { cache: "no-store" }]
        ]);
        assert.equal(songsJsonCache.peek(), null);
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: matching meta hash uses cached json without fetching the body", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const cachedJson = createSongsJson("cached-archive::1", "sha256:cached");
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            return createResponse(createSongsMetaJson("sha256:cached", "2026-08-15T00:00:00.000Z"));
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [[
            "data/songs-meta.json",
            { cache: "no-cache", priority: "low" }
        ]]);
        assert.equal(results[0].source, "cache");
        assert.equal(results[0].songs[0].songKey, "cached-archive::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: newer meta refreshes an older cached json", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const cachedJson = createSongsJson(
            "cached-archive::1",
            "sha256:cached",
            "2026-08-13T00:00:00.000Z"
        );
        const freshJson = createSongsJson(
            "fresh-archive::1",
            "sha256:fresh",
            "2026-08-14T00:00:00.000Z"
        );
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs-meta.json") {
                return createResponse(createSongsMetaJson("sha256:fresh"));
            }
            return createResponse(freshJson);
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs-meta.json", { cache: "no-cache", priority: "low" }],
            ["data/songs.json", { cache: "no-cache", priority: "low" }]
        ]);
        assert.equal(songsJsonCache.peek(), freshJson);
        assert.equal(results.length, 2);
        assert.equal(results[0].source, "cache");
        assert.equal(results[0].songs[0].songKey, "cached-archive::1");
        assert.equal(results[1].source, "network");
        assert.equal(results[1].songs[0].songKey, "fresh-archive::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: cached json newer than meta is accepted without fetching the body", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const cachedJson = createSongsJson(
            "cached-archive::1",
            "sha256:newer-cache",
            "2026-08-15T00:00:00.000Z"
        );
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            return createResponse(createSongsMetaJson(
                "sha256:older-meta",
                "2026-08-14T00:00:00.000Z"
            ));
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [[
            "data/songs-meta.json",
            { cache: "no-cache", priority: "low" }
        ]]);
        assert.equal(results[0].source, "cache");
        assert.equal(results[0].songs[0].songKey, "cached-archive::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: meta fetch failure still tries network json", async () => {
    const previousFetch = globalThis.fetch;
    const previousConsoleWarn = console.warn;
    try {
        const cachedJson = createSongsJson(
            "cached-archive::1",
            "sha256:cached",
            "2026-08-13T00:00:00.000Z"
        );
        const freshJson = createSongsJson(
            "fresh-archive::1",
            "sha256:fresh",
            "2026-08-14T00:00:00.000Z"
        );
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const fetchUrls = [];
        const warnings = [];
        console.warn = (...args) => warnings.push(args);
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs-meta.json") return createFailedResponse();
            return createResponse(freshJson);
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs-meta.json", { cache: "no-cache", priority: "low" }],
            ["data/songs.json", { cache: "no-cache", priority: "low" }]
        ]);
        assert.equal(songsJsonCache.peek(), freshJson);
        assert.equal(results.length, 2);
        assert.equal(results[0].source, "cache");
        assert.equal(results[0].songs[0].songKey, "cached-archive::1");
        assert.equal(results[1].source, "network");
        assert.equal(results[1].songs[0].songKey, "fresh-archive::1");
        assert.match(String(warnings[0]?.[0]), /曲データJSONメタ情報の確認に失敗しました/);
    } finally {
        globalThis.fetch = previousFetch;
        console.warn = previousConsoleWarn;
    }
});

test("songs data source: meta fetch failure does not replace newer cache with older network json", async () => {
    const previousFetch = globalThis.fetch;
    const previousConsoleWarn = console.warn;
    try {
        const cachedJson = createSongsJson(
            "cached-archive::1",
            "sha256:newer-cache",
            "2026-08-15T00:00:00.000Z"
        );
        const olderJson = createSongsJson(
            "older-network::1",
            "sha256:older-network",
            "2026-08-14T00:00:00.000Z"
        );
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const fetchUrls = [];
        console.warn = () => {};
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs-meta.json") return createFailedResponse();
            return createResponse(olderJson);
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs-meta.json", { cache: "no-cache", priority: "low" }],
            ["data/songs.json", { cache: "no-cache", priority: "low" }]
        ]);
        assert.equal(songsJsonCache.peek(), cachedJson);
        assert.equal(results[0].source, "cache");
        assert.equal(results[0].songs[0].songKey, "cached-archive::1");
    } finally {
        globalThis.fetch = previousFetch;
        console.warn = previousConsoleWarn;
    }
});

test("songs data source: json failure uses valid json cache before network csv", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const cachedJson = createSongsJson(
            "cached-archive::1",
            "sha256:cached",
            "2026-08-13T00:00:00.000Z"
        );
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs-meta.json") {
                return createResponse(createSongsMetaJson("sha256:fresh"));
            }
            return createFailedResponse();
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs-meta.json", { cache: "no-cache", priority: "low" }],
            ["data/songs.json", { cache: "no-cache", priority: "low" }]
        ]);
        assert.equal(songsJsonCache.peek(), cachedJson);
        assert.equal(results[0].source, "cache");
        assert.equal(results[0].songs[0].songKey, "cached-archive::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: json newer than stale meta is accepted and cached", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const newerJson = createSongsJson(
            "newer-archive::1",
            "sha256:newer",
            "2026-08-15T00:00:00.000Z"
        );
        const songsJsonCache = createFakeTextCacheStore();
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs-meta.json") {
                return createResponse(createSongsMetaJson(
                    "sha256:older",
                    "2026-08-14T00:00:00.000Z"
                ));
            }
            return createResponse(newerJson);
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs-meta.json", { cache: "no-cache" }],
            ["data/songs.json", { cache: "no-cache" }]
        ]);
        assert.equal(songsJsonCache.peek(), newerJson);
        assert.equal(results[0].songs[0].songKey, "newer-archive::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: json older than meta is not cached and falls back to csv", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const olderJson = createSongsJson(
            "older-archive::1",
            "sha256:older",
            "2026-08-13T00:00:00.000Z"
        );
        const songsJsonCache = createFakeTextCacheStore();
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs-meta.json") {
                return createResponse(createSongsMetaJson(
                    "sha256:newer",
                    "2026-08-14T00:00:00.000Z"
                ));
            }
            if (url === "data/songs.json") return createResponse(olderJson);
            return createResponse(createValidCsv());
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs-meta.json", { cache: "no-cache" }],
            ["data/songs.json", { cache: "no-cache" }],
            ["https://example.test/songs.csv", { cache: "no-store" }]
        ]);
        assert.equal(songsJsonCache.peek(), null);
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: equal timestamps with mismatched hashes are rejected", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const inconsistentJson = createSongsJson("inconsistent::1", "sha256:json");
        const songsJsonCache = createFakeTextCacheStore();
        globalThis.fetch = async (url) => {
            if (url === "data/songs-meta.json") {
                return createResponse(createSongsMetaJson("sha256:meta"));
            }
            if (url === "data/songs.json") return createResponse(inconsistentJson);
            return createResponse(createValidCsv());
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assert.equal(songsJsonCache.peek(), null);
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: older schema cache is removed and handled as a cache miss", async () => {
    const previousFetch = globalThis.fetch;
    const previousConsoleWarn = console.warn;
    try {
        const legacyJson = createPreviousSchemaSongsJson("legacy-archive::1", "sha256:legacy");
        const freshJson = createSongsJson("fresh-archive::1", "sha256:fresh");
        const songsJsonCache = createFakeTextCacheStore(legacyJson);
        const fetchUrls = [];
        console.warn = () => {};
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs-meta.json") {
                return createResponse(createSongsMetaJson("sha256:fresh"));
            }
            return createResponse(freshJson);
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs-meta.json", { cache: "no-cache" }],
            ["data/songs.json", { cache: "no-cache" }]
        ]);
        assert.equal(songsJsonCache.peek(), freshJson);
        assert.equal(songsJsonCache.getRemoveCount(), 1);
        assert.equal(results[0].source, "network");
        assert.equal(results[0].songs[0].songKey, "fresh-archive::1");
    } finally {
        globalThis.fetch = previousFetch;
        console.warn = previousConsoleWarn;
    }
});

test("songs data source: older schema network json is not cached and falls back to csv", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const legacyJson = createPreviousSchemaSongsJson("legacy-network::1", "sha256:legacy");
        const songsJsonCache = createFakeTextCacheStore();
        globalThis.fetch = async (url) => {
            if (url === "data/songs.json") return createResponse(legacyJson);
            return createResponse(createValidCsv());
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assert.equal(songsJsonCache.peek(), null);
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: invalid cached json is removed before network fallback", async () => {
    const previousFetch = globalThis.fetch;
    const previousConsoleWarn = console.warn;
    try {
        const songsJsonCache = createFakeTextCacheStore("not json");
        console.warn = () => {};
        globalThis.fetch = async (url) => {
            if (url === "data/songs.json") return createFailedResponse();
            return createResponse(createValidCsv());
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assert.equal(songsJsonCache.getRemoveCount(), 1);
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
        console.warn = previousConsoleWarn;
    }
});

test("songs data source: legacy localStorage json is migrated into the json cache", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const storage = createFakeLocalStorage();
        const cachedJson = createSongsJson("legacy-archive::1", "sha256:legacy");
        const primarySongsJsonCache = createFakeTextCacheStore();
        const songsJsonCache = createLegacyLocalStorageSongsJsonCacheAdapter({
            cache: primarySongsJsonCache,
            legacyKey: "cachedSongsJson",
            storage
        });
        storage.setItem("cachedSongsJson", cachedJson);
        globalThis.fetch = async (url) => {
            assert.equal(url, "data/songs-meta.json");
            return createResponse(createSongsMetaJson("sha256:legacy"));
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assert.equal(primarySongsJsonCache.peek(), cachedJson);
        assert.equal(storage.getItem("cachedSongsJson"), null);
        assert.equal(results[0].source, "cache");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: failed json without cache falls back to network csv", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const fetchUrls = [];
        globalThis.fetch = async (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs.json") return createFailedResponse();
            return createResponse(createValidCsv());
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache: createFakeTextCacheStore()
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs.json", { cache: "no-cache" }],
            ["https://example.test/songs.csv", { cache: "no-store" }]
        ]);
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: all network failures without json cache return false", async () => {
    const previousFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => createFailedResponse();
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache: createFakeTextCacheStore()
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), false);
        assert.deepEqual(results, []);
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: initial cache load does not wait for the separate refresh request", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const cachedJson = createSongsJson("cached-archive::1", "sha256:cached");
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        let resolveMeta;
        globalThis.fetch = () => new Promise((resolve) => {
            resolveMeta = () => resolve(createResponse(
                createSongsMetaJson("sha256:cached", "2026-08-15T00:00:00.000Z")
            ));
        });
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        });

        const initialSnapshot = await dataSource.loadInitialSnapshot();

        assert.equal(initialSnapshot.source, "cache");
        assert.equal(initialSnapshot.songs[0].songKey, "cached-archive::1");

        const refreshPromise = dataSource.refreshSnapshot(initialSnapshot);
        await new Promise((resolve) => setImmediate(resolve));
        resolveMeta();
        assert.equal(await refreshPromise, null);
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: stalled json request times out before falling back to network csv", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const fetchUrls = [];
        const pendingFetch = createPendingFetch();
        globalThis.fetch = (url, options) => {
            fetchUrls.push([url, options]);
            if (url === "data/songs.json") return pendingFetch(url, options);
            return Promise.resolve(createResponse(createValidCsv()));
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache: createFakeTextCacheStore(),
            songsJsonResponseTimeoutMs: 10,
            csvResponseTimeoutMs: 50
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assertFetchCalls(fetchUrls, [
            ["data/songs.json", { cache: "no-cache" }],
            ["https://example.test/songs.csv", { cache: "no-store" }]
        ]);
        assert.equal(results.length, 1);
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: slow json body may finish after the response timeout", async () => {
    const previousFetch = globalThis.fetch;
    try {
        const songsJson = createSongsJson("slow-json::1");
        const songsJsonCache = createFakeTextCacheStore();
        globalThis.fetch = (_url, options) => Promise.resolve({
            ok: true,
            text() {
                return new Promise((resolve, reject) => {
                    const timerId = setTimeout(() => resolve(songsJson), 20);
                    options.signal.addEventListener("abort", () => {
                        clearTimeout(timerId);
                        reject(options.signal.reason);
                    }, { once: true });
                });
            }
        });
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache,
            songsJsonResponseTimeoutMs: 10,
            songsJsonBodyTimeoutMs: 50,
            csvResponseTimeoutMs: 10,
            csvBodyTimeoutMs: 50
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assert.equal(results.length, 1);
        assert.equal(results[0].songs[0].songKey, "slow-json::1");
        assert.equal(songsJsonCache.peek(), songsJson);
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("songs data source: stalled json body times out before falling back to network csv", async () => {
    const previousFetch = globalThis.fetch;
    try {
        globalThis.fetch = (url, options) => {
            if (url !== "data/songs.json") {
                return Promise.resolve(createResponse(createValidCsv()));
            }
            return Promise.resolve({
                ok: true,
                text() {
                    return new Promise((_resolve, reject) => {
                        options.signal.addEventListener("abort", () => {
                            reject(options.signal.reason);
                        }, { once: true });
                    });
                }
            });
        };
        const results = [];
        const dataSource = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache: createFakeTextCacheStore(),
            songsJsonResponseTimeoutMs: 50,
            songsJsonBodyTimeoutMs: 10,
            csvResponseTimeoutMs: 50,
            csvBodyTimeoutMs: 50
        });

        assert.equal(await collectInitialAndRefreshSnapshots(dataSource, results), true);

        assert.equal(results.length, 1);
        assert.equal(results[0].songs[0].songKey, "archive-1::1");
    } finally {
        globalThis.fetch = previousFetch;
    }
});
