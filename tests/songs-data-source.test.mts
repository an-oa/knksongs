import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createFakeTextCacheStore } from "./fixtures/text-cache.mts";
import { createFakeLocalStorage } from "./fixtures/local-storage.mts";
import { createSongFixture } from "./fixtures/song.mts";
import type { SongsSnapshot } from "../app/lib/songs-data-source.mts";
import type { SongsJsonPayload } from "../app/lib/songs-json.mts";
import { createSongsDataSource } from "../app/lib/songs-data-source.mts";
import { createLegacyLocalStorageSongsJsonCacheAdapter } from "../app/lib/storage/songs-json-cache.mts";
import { buildSongsJsonMetaPayload, buildSongsJsonPayload } from "../app/lib/songs-json.mts";

const GENERATED_AT = "2026-08-14T00:00:00.000Z";

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
    songKey: string,
    contentHash = `sha256:${songKey}`,
    generatedAt = GENERATED_AT
) {
    const archiveId = songKey.split("::")[0] || "json-archive";
    return JSON.stringify(buildSongsJsonPayload([
        createSongFixture({
            archiveId,
            songKey,
            legacySongKey: `${songKey}::https://www.youtube.com/watch?v=abc123def45&t=10s`
        })
    ], contentHash, generatedAt));
}

/**
 * 直前schemaのキャッシュ確認用JSON文字列を返す。
 * @param {string} songKey 曲識別子
 * @param {string} contentHash 内容hash
 * @returns {string}
 */
function createPreviousSchemaSongsJson(songKey: string, contentHash: string) {
    const payload: SongsJsonPayload = JSON.parse(createSongsJson(songKey, contentHash));
    payload.schemaVersion -= 1;
    payload.songs = payload.songs.map((song, sourceIndex) => ({ ...song, sourceIndex }));
    return JSON.stringify(payload);
}

/**
 * data sourceテスト用のJSONメタ情報を返す。
 * @param {string} contentHash 内容hash
 * @param {string} generatedAt 生成日時
 * @returns {string}
 */
function createSongsMetaJson(contentHash: string, generatedAt = GENERATED_AT) {
    return JSON.stringify(buildSongsJsonMetaPayload(contentHash, generatedAt));
}

/** 成功responseを作る。本文の遅延・失敗を検証するときは読み取り関数を指定する。 */
function createResponse(body: string | (() => Promise<string>)): Response {
    return typeof body === "string"
        ? new Response(body)
        : Object.assign(new Response(), { text: body });
}

/** HTTPエラー応答と本文読み取りのスパイを作る。呼び出し回数はテスト本体で検証する。 */
function createFailedResponse(t: TestContext) {
    const response = new Response("service unavailable", { status: 503 });
    const readText = t.mock.method(response, "text");
    return { response, readText };
}

/** Node の汎用モックAPIへ渡す前に、fetchの引数と戻り値の型を確認する。 */
function mockFetch(t: TestContext, implementation: typeof fetch) {
    return t.mock.method(globalThis, "fetch", implementation);
}

/**
 * fetch呼び出しを、タイムアウトsignalを含む公開上の取得条件として比較する。
 * @param fetchMock 呼び出しを記録したfetchモック
 * @param expected 期待するfetch呼び出し
 */
function assertFetchCalls(
    fetchMock: ReturnType<typeof mockFetch>,
    expected: [string, Pick<RequestInit, "cache" | "priority">][]
) {
    assert.deepEqual(
        fetchMock.mock.calls.map(({ arguments: [url, options] }) => [url, {
            cache: options?.cache,
            priority: options?.priority,
            hasAbortSignal: options?.signal instanceof AbortSignal
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
 */
function createPendingFetch(): (...args: Parameters<typeof fetch>) => Promise<never> {
    return (_url, options) => new Promise((_resolve, reject) => {
        const signal = options?.signal;
        assert.ok(signal);
        signal.addEventListener("abort", () => {
            reject(signal.reason);
        }, { once: true });
    });
}

test("songs data source: network csv is used without creating a runtime csv cache", async (t) => {
    const csv = createValidCsv();
    const fetchMock = mockFetch(t, async () => {
        return createResponse(csv);
    });
    const dataSource = createSongsDataSource({
        publicCsvUrl: "https://example.test/songs.csv"
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["https://example.test/songs.csv", { cache: "no-store" }]
    ]);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

test("songs data source: network json success stores json and skips csv", async (t) => {
    const songsJson = createSongsJson("json-archive::1");
    const songsJsonCache = createFakeTextCacheStore();
    const fetchMock = mockFetch(t, async () => {
        return createResponse(songsJson);
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [["data/songs.json", { cache: "no-cache" }]]);
    assert.equal(songsJsonCache.peek(), songsJson);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].songKey, "json-archive::1");
});

for (const saveResult of ["success", "false", "reject"]) {
    test(`songs data source: initial snapshot does not wait for cache save (${saveResult})`, async (t) => {
        const jsonText = createSongsJson("public::1", "sha256:public");
        const cache = createFakeTextCacheStore();
        let savedText: string | undefined;
        const { promise: save, resolve: resolveSave, reject: rejectSave } = Promise.withResolvers<boolean>();
        t.mock.method(cache, "setText", (text: string) => {
            savedText = text;
            return save;
        });
        const warnings = t.mock.method(console, "warn", () => {});
        const fetchMock = mockFetch(t, async () => createResponse(jsonText));
        let snapshot: SongsSnapshot | null | undefined;
        const loading = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache: cache
        }).loadInitialSnapshot().then((value) => { snapshot = value; });
        try {
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(savedText, jsonText, "saves the received text without serializing songs again");
            assert.equal(snapshot?.source, "network", "storage may still be pending when data is ready");
            assert.equal(snapshot.songs[0].songKey, "public::1");
        } finally {
            if (saveResult === "reject") rejectSave(new Error("storage failed"));
            else resolveSave(saveResult === "success");
            await loading;
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.equal(fetchMock.mock.callCount(), 1, "a failed save does not trigger CSV fallback");
        assert.equal(warnings.mock.callCount(), saveResult === "reject" ? 1 : 0);
    });
}

test("songs data source: structurally invalid network json is not cached and falls back to csv", async (t) => {
    const invalidPayload: { songs: Partial<Song>[] } = JSON.parse(createSongsJson("invalid-archive::1"));
    delete invalidPayload.songs[0].title;
    const songsJsonCache = createFakeTextCacheStore();
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs.json") return createResponse(JSON.stringify(invalidPayload));
        return createResponse(createValidCsv());
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs.json", { cache: "no-cache" }],
        ["https://example.test/songs.csv", { cache: "no-store" }]
    ]);
    assert.equal(songsJsonCache.peek(), null);
    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

test("songs data source: unsafe links in network and cached JSON fall back to validated CSV", async (t) => {
    const payload: SongsJsonPayload = JSON.parse(createSongsJson("unsafe-archive::1", "sha256:unsafe"));
    payload.songs[0].url = "javascript:alert(1)";
    payload.songs[0].legacySongKey = "unsafe-archive::1::javascript:alert(1)";
    const unsafeJson = JSON.stringify(payload);
    const songsJsonCache = createFakeTextCacheStore(unsafeJson);
    t.mock.method(console, "warn", () => {});
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") return createResponse(createSongsMetaJson("sha256:unsafe"));
        if (url === "data/songs.json") return createResponse(unsafeJson);
        return createResponse(createValidCsv());
    });
    const snapshot = await createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();

    assert.ok(snapshot);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].url, "https://www.youtube.com/watch?v=abc123def45&t=10s");
    assert.equal(songsJsonCache.peek(), null);
    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }],
        ["https://example.test/songs.csv", { cache: "no-store" }]
    ]);
});

test("songs data source: matching meta hash uses cached json without fetching the body", async (t) => {
    const cachedJson = createSongsJson("cached-archive::1", "sha256:cached");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    const fetchMock = mockFetch(t, async () => {
        return createResponse(createSongsMetaJson("sha256:cached", "2026-08-15T00:00:00.000Z"));
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [[
        "data/songs-meta.json",
        { cache: "no-cache" }
    ]]);
    assert.equal(snapshot.source, "cache");
    assert.equal(snapshot.songs[0].songKey, "cached-archive::1");
});

test("songs data source: newer public json is used for the initial snapshot", async (t) => {
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
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") {
            return createResponse(createSongsMetaJson("sha256:fresh"));
        }
        return createResponse(freshJson);
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }]
    ]);
    assert.equal(songsJsonCache.peek(), freshJson);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].songKey, "fresh-archive::1");
});

test("songs data source: older public json replaces a newer cache when hashes differ", async (t) => {
    const cachedJson = createSongsJson("cached-archive::1", "sha256:newer-cache", "2026-08-15T00:00:00.000Z");
    const publicJson = createSongsJson("public-archive::1", "sha256:public");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    const fetchMock = mockFetch(t, async (url) => {
        return createResponse(url === "data/songs-meta.json"
            ? createSongsMetaJson("sha256:public")
            : publicJson);
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }]
    ]);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].songKey, "public-archive::1");
    assert.equal(songsJsonCache.peek(), publicJson);
});

test("songs data source: meta fetch failure still tries network json", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
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
    const warnings = t.mock.method(console, "warn", () => {});
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") return failedResponse;
        return createResponse(freshJson);
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.equal(readText.mock.callCount(), 0, "HTTP error bodies must not be read");
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }]
    ]);
    assert.equal(songsJsonCache.peek(), freshJson);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].songKey, "fresh-archive::1");
    assert.match(String(warnings.mock.calls[0]?.arguments[0]), /曲データJSONメタ情報の確認に失敗しました/);
});

test("songs data source: meta fetch failure still allows older public json to replace a newer cache", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
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
    t.mock.method(console, "warn", () => {});
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") return failedResponse;
        return createResponse(olderJson);
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.equal(readText.mock.callCount(), 0, "HTTP error bodies must not be read");
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }]
    ]);
    assert.equal(songsJsonCache.peek(), olderJson);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].songKey, "older-network::1");
});

test("songs data source: json failure uses valid json cache before network csv", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
    const cachedJson = createSongsJson(
        "cached-archive::1",
        "sha256:cached",
        "2026-08-13T00:00:00.000Z"
    );
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") {
            return createResponse(createSongsMetaJson("sha256:fresh"));
        }
        return failedResponse;
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.equal(readText.mock.callCount(), 0, "HTTP error bodies must not be read");
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }]
    ]);
    assert.equal(songsJsonCache.peek(), cachedJson);
    assert.equal(snapshot.source, "cache");
    assert.equal(snapshot.songs[0].songKey, "cached-archive::1");
});

test("songs data source: json newer than stale meta is accepted and cached", async (t) => {
    const newerJson = createSongsJson(
        "newer-archive::1",
        "sha256:newer",
        "2026-08-15T00:00:00.000Z"
    );
    const songsJsonCache = createFakeTextCacheStore();
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") {
            return createResponse(createSongsMetaJson(
                "sha256:older",
                "2026-08-14T00:00:00.000Z"
            ));
        }
        return createResponse(newerJson);
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }]
    ]);
    assert.equal(songsJsonCache.peek(), newerJson);
    assert.equal(snapshot.songs[0].songKey, "newer-archive::1");
});

test("songs data source: json older than meta is not cached and falls back to csv", async (t) => {
    const olderJson = createSongsJson(
        "older-archive::1",
        "sha256:older",
        "2026-08-13T00:00:00.000Z"
    );
    const songsJsonCache = createFakeTextCacheStore();
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") {
            return createResponse(createSongsMetaJson(
                "sha256:newer",
                "2026-08-14T00:00:00.000Z"
            ));
        }
        if (url === "data/songs.json") return createResponse(olderJson);
        return createResponse(createValidCsv());
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }],
        ["https://example.test/songs.csv", { cache: "no-store" }]
    ]);
    assert.equal(songsJsonCache.peek(), null);
    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

test("songs data source: equal timestamps with mismatched hashes are rejected", async (t) => {
    const inconsistentJson = createSongsJson("inconsistent::1", "sha256:json");
    const songsJsonCache = createFakeTextCacheStore();
    mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") {
            return createResponse(createSongsMetaJson("sha256:meta"));
        }
        if (url === "data/songs.json") return createResponse(inconsistentJson);
        return createResponse(createValidCsv());
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assert.equal(songsJsonCache.peek(), null);
    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

test("songs data source: older schema cache is replaced without a competing delete", async (t) => {
    const legacyJson = createPreviousSchemaSongsJson("legacy-archive::1", "sha256:legacy");
    const freshJson = createSongsJson("fresh-archive::1", "sha256:fresh");
    const songsJsonCache = createFakeTextCacheStore(legacyJson);
    t.mock.method(console, "warn", () => {});
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs-meta.json") {
            return createResponse(createSongsMetaJson("sha256:fresh"));
        }
        return createResponse(freshJson);
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs-meta.json", { cache: "no-cache" }],
        ["data/songs.json", { cache: "no-cache" }]
    ]);
    assert.equal(songsJsonCache.peek(), freshJson);
    assert.equal(songsJsonCache.getRemoveCount(), 0);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].songKey, "fresh-archive::1");
});

test("songs data source: older schema network json is not cached and falls back to csv", async (t) => {
    const legacyJson = createPreviousSchemaSongsJson("legacy-network::1", "sha256:legacy");
    const songsJsonCache = createFakeTextCacheStore();
    mockFetch(t, async (url) => {
        if (url === "data/songs.json") return createResponse(legacyJson);
        return createResponse(createValidCsv());
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assert.equal(songsJsonCache.peek(), null);
    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

test("songs data source: invalid cached json is removed after public JSON fails", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
    const songsJsonCache = createFakeTextCacheStore("not json");
    t.mock.method(console, "warn", () => {});
    mockFetch(t, async (url) => {
        if (url === "data/songs.json") return failedResponse;
        return createResponse(createValidCsv());
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.equal(readText.mock.callCount(), 0, "HTTP error bodies must not be read");
    assert.ok(snapshot);

    assert.equal(songsJsonCache.getRemoveCount(), 1);
    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

test("songs data source: legacy localStorage json is migrated into the json cache", async (t) => {
    const storage = createFakeLocalStorage();
    const cachedJson = createSongsJson("legacy-archive::1", "sha256:legacy");
    const primarySongsJsonCache = createFakeTextCacheStore();
    const songsJsonCache = createLegacyLocalStorageSongsJsonCacheAdapter({
        cache: primarySongsJsonCache,
        legacyKey: "cachedSongsJson",
        storage
    });
    storage.setItem("cachedSongsJson", cachedJson);
    const fetchMock = mockFetch(t, async () => {
        return createResponse(createSongsMetaJson("sha256:legacy"));
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [["data/songs-meta.json", { cache: "no-cache" }]]);
    assert.equal(primarySongsJsonCache.peek(), cachedJson);
    assert.equal(storage.getItem("cachedSongsJson"), null);
    assert.equal(snapshot.source, "cache");
});

test("songs data source: failed json without cache falls back to network csv", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
    const fetchMock = mockFetch(t, async (url) => {
        if (url === "data/songs.json") return failedResponse;
        return createResponse(createValidCsv());
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache: createFakeTextCacheStore()
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.equal(readText.mock.callCount(), 0, "HTTP error bodies must not be read");
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs.json", { cache: "no-cache" }],
        ["https://example.test/songs.csv", { cache: "no-store" }]
    ]);
    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

test("songs data source: all network failures without json cache return null", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
    mockFetch(t, async () => failedResponse);
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache: createFakeTextCacheStore()
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.equal(readText.mock.callCount(), 0, "HTTP error bodies must not be read");
    assert.equal(snapshot, null);
});

test("songs data source: initial cache display waits for public meta confirmation", async (t) => {
    const cachedJson = createSongsJson("cached-archive::1", "sha256:cached");
    const { promise: meta, resolve: resolveMeta } = Promise.withResolvers<Response>();
    const fetchMock = mockFetch(t, () => meta);
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache: createFakeTextCacheStore(cachedJson)
    });
    let settled = false;
    const initialPromise = dataSource.loadInitialSnapshot().then((snapshot) => {
        settled = true;
        return snapshot;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assertFetchCalls(fetchMock, [["data/songs-meta.json", { cache: "no-cache" }]]);
    resolveMeta(createResponse(createSongsMetaJson("sha256:cached")));
    const snapshot = await initialPromise;
    assert.ok(snapshot);
    assert.equal(snapshot.source, "cache");
    assert.equal(snapshot.songs[0].songKey, "cached-archive::1");
});

test("songs data source: stalled json request times out before falling back to network csv", async (t) => {
    const pendingFetch = createPendingFetch();
    const fetchMock = mockFetch(t, (url, options) => {
        if (url === "data/songs.json") return pendingFetch(url, options);
        return Promise.resolve(createResponse(createValidCsv()));
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache: createFakeTextCacheStore(),
        songsJsonResponseTimeoutMs: 10,
        csvResponseTimeoutMs: 50
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs.json", { cache: "no-cache" }],
        ["https://example.test/songs.csv", { cache: "no-store" }]
    ]);
    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

test("songs data source: slow json body may finish after the response timeout", async (t) => {
    const songsJson = createSongsJson("slow-json::1");
    const songsJsonCache = createFakeTextCacheStore();
    mockFetch(t, async (_url, options) => {
        const signal = options?.signal;
        assert.ok(signal);
        return createResponse(() => new Promise((resolve, reject) => {
            const timerId = setTimeout(() => resolve(songsJson), 20);
            signal.addEventListener("abort", () => {
                clearTimeout(timerId);
                reject(signal.reason);
            }, { once: true });
        }));
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache,
        songsJsonResponseTimeoutMs: 10,
        songsJsonBodyTimeoutMs: 50,
        csvResponseTimeoutMs: 10,
        csvBodyTimeoutMs: 50
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assert.equal(snapshot.songs[0].songKey, "slow-json::1");
    assert.equal(songsJsonCache.peek(), songsJson);
});

test("songs data source: stalled json body times out before falling back to network csv", async (t) => {
    mockFetch(t, (url, options) => {
        if (url !== "data/songs.json") {
            return Promise.resolve(createResponse(createValidCsv()));
        }
        return Promise.resolve(createResponse(() => createPendingFetch()(url, options)));
    });
    const dataSource = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache: createFakeTextCacheStore(),
        songsJsonResponseTimeoutMs: 50,
        songsJsonBodyTimeoutMs: 10,
        csvResponseTimeoutMs: 50,
        csvBodyTimeoutMs: 50
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assert.equal(snapshot.songs[0].songKey, "archive-1::1");
});

for (const invalidKind of ["malformed", "older-than-meta", "same-time-different-hash"]) {
    test(`songs data source: ${invalidKind} public json preserves valid cache`, async (t) => {
        const cachedJson = createSongsJson("cached::1", "sha256:cached");
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const publicJson = invalidKind === "malformed" ? "not json" : createSongsJson(
            "public::1", "sha256:public",
            invalidKind === "older-than-meta" ? "2026-08-13T00:00:00.000Z" : GENERATED_AT
        );
        const urls: Parameters<typeof fetch>[0][] = [];
        mockFetch(t, async (url) => {
            urls.push(url);
            return createResponse(url === "data/songs-meta.json"
                ? createSongsMetaJson("sha256:meta") : publicJson);
        });
        const snapshot = await createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        }).loadInitialSnapshot();
        assert.ok(snapshot);
        assert.equal(snapshot.source, "cache");
        assert.equal(snapshot.songs[0].songKey, "cached::1");
        assert.equal(songsJsonCache.peek(), cachedJson);
        assert.deepEqual(urls, ["data/songs-meta.json", "data/songs.json"]);
    });
}

/** 仮想時計とPromiseの継続を進め、段階をまたぐ通信期限を検証する。 */
function createNetworkClock(t: TestContext) {
    let now = 0;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(performance, "now", () => now);
    return async (milliseconds: number) => {
        now += milliseconds;
        t.mock.timers.tick(milliseconds);
        await new Promise((resolve) => setImmediate(resolve));
    };
}

test("songs data source: meta and json response/body share the default five second deadline", async (t) => {
    const tick = createNetworkClock(t);
    const cachedJson = createSongsJson("cached::1", "sha256:cached");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    const urls: Parameters<typeof fetch>[0][] = [];
    let jsonSignal: AbortSignal | undefined;
    const { promise: body, resolve: releaseBody, reject: rejectBody } = Promise.withResolvers<string>();
    mockFetch(t, (url, options) => {
        urls.push(url);
        if (url === "data/songs-meta.json") {
            return new Promise((resolve) => setTimeout(() => resolve(createResponse(
                () => new Promise((resolveBody) => setTimeout(
                    () => resolveBody(createSongsMetaJson("sha256:public")), 1000
                ))
            )), 1000));
        }
        const signal = options?.signal;
        assert.ok(signal);
        jsonSignal = signal;
        return new Promise((resolve) => setTimeout(() => resolve(createResponse(() => {
            signal.addEventListener("abort", () => rejectBody(signal.reason), { once: true });
            return body;
        })), 1000));
    });
    let settled = false;
    const loading = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot().then((snapshot) => {
        settled = true;
        return snapshot;
    });
    await tick(0);
    await tick(1000); // meta response
    await tick(1000); // meta body
    await tick(1000); // json response
    await tick(1999);
    assert.equal(settled, false);
    assert.ok(jsonSignal);
    assert.equal(jsonSignal.aborted, false);
    await tick(1);
    const snapshot = await loading;
    assert.ok(snapshot);
    assert.equal(jsonSignal.aborted, true);
    assert.equal(snapshot.source, "cache");
    assert.equal(snapshot.songs[0].songKey, "cached::1");
    releaseBody(createSongsJson("public::1", "sha256:public"));
    await tick(30_000);
    assert.equal(songsJsonCache.peek(), cachedJson);
    assert.deepEqual(urls, ["data/songs-meta.json", "data/songs.json"]);
});

for (const phase of ["response", "body"]) {
    test(`songs data source: meta ${phase} exhausting the deadline prevents a json request`, async (t) => {
        const tick = createNetworkClock(t);
        t.mock.method(console, "warn", () => {});
        const cachedJson = createSongsJson("cached::1", "sha256:cached");
        const urls: Parameters<typeof fetch>[0][] = [];
        let signal: AbortSignal | null | undefined;
        mockFetch(t, (url, options) => {
            urls.push(url);
            signal = options?.signal;
            const pending = () => createPendingFetch()(url, options);
            return phase === "response" ? pending() : Promise.resolve(createResponse(pending));
        });
        const loading = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache: createFakeTextCacheStore(cachedJson),
            songsMetaResponseTimeoutMs: 10_000
        }).loadInitialSnapshot();
        await tick(0);
        await tick(5000);
        const snapshot = await loading;
        assert.ok(snapshot);
        assert.equal(snapshot.source, "cache");
        assert.ok(signal);
        assert.equal(signal.aborted, true);
        assert.deepEqual(urls, ["data/songs-meta.json"]);
    });
}

test("songs data source: late successful body is rejected even before the timeout callback runs", async (t) => {
    let now = 0;
    t.mock.method(performance, "now", () => now);
    const cachedJson = createSongsJson("cached::1", "sha256:cached");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    let signal: AbortSignal | null | undefined;
    mockFetch(t, async (_url, options) => {
        signal = options?.signal;
        return createResponse(async () => {
            now = 5001;
            return createSongsJson("public::1", "sha256:public");
        });
    });
    const snapshot = await createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();
    assert.ok(snapshot);
    assert.equal(snapshot.source, "cache");
    assert.ok(signal);
    assert.equal(signal.aborted, true);
    assert.equal(songsJsonCache.peek(), cachedJson);
});

test("songs data source: no cache keeps parallel requests and allows a body beyond five seconds", async (t) => {
    const tick = createNetworkClock(t);
    const urls: Parameters<typeof fetch>[0][] = [];
    const { promise: metaBody, resolve: releaseMeta } = Promise.withResolvers<string>();
    const publicJson = createSongsJson("public::1", "sha256:public");
    mockFetch(t, async (url) => {
        urls.push(url);
        return createResponse(() => url === "data/songs-meta.json"
            ? metaBody
            : new Promise((resolve) => setTimeout(() => resolve(publicJson), 6000)));
    });
    const loading = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache: createFakeTextCacheStore()
    }).loadInitialSnapshot();
    await tick(0);
    assert.deepEqual(urls, ["data/songs-meta.json", "data/songs.json"]);
    releaseMeta(createSongsMetaJson("sha256:public"));
    await tick(0);
    await tick(6000);
    const snapshot = await loading;
    assert.ok(snapshot);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].songKey, "public::1");
});

for (const updated of [false, true]) {
    test(`songs data source: legacy read starts meta before saving and only persists the accepted JSON (updated=${updated})`, async (t) => {
        const legacy = createSongsJson("legacy::1", "sha256:legacy");
        const current = createSongsJson("current::1", "sha256:current");
        const storage = createFakeLocalStorage();
        storage.setItem("legacy", legacy);
        const primary = createFakeTextCacheStore();
        const writes: string[] = [];
        const { promise: save, resolve: finishSave } = Promise.withResolvers<boolean>();
        t.mock.method(primary, "setText", (text: string): Promise<boolean> => {
            writes.push(text);
            return save;
        });
        const cache = createLegacyLocalStorageSongsJsonCacheAdapter({ cache: primary, storage, legacyKey: "legacy" });
        const { promise: meta, resolve: releaseMeta } = Promise.withResolvers<Response>();
        const fetchMock = mockFetch(t, async (url) => {
            if (url === "meta") return meta;
            return createResponse(current);
        });
        const loading = createSongsDataSource({ publicSongsJsonUrl: "json", publicSongsMetaUrl: "meta", publicCsvUrl: "csv", songsJsonCache: cache }).loadInitialSnapshot();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(fetchMock.mock.calls.map(({ arguments: args }) => args[0]), ["meta"]);
        assert.deepEqual(writes, [], "reading legacy data must not queue a migration write");
        releaseMeta(createResponse(createSongsMetaJson(updated ? "sha256:current" : "sha256:legacy")));
        let snapshot: SongsSnapshot | null | undefined;
        const settled = loading.then((value) => { snapshot = value; });
        await new Promise((resolve) => setImmediate(resolve));
        try {
            assert.equal(snapshot?.source, updated ? "network" : "cache");
            assert.deepEqual(fetchMock.mock.calls.map(({ arguments: args }) => args[0]), updated ? ["meta", "json"] : ["meta"]);
            assert.deepEqual(writes, [updated ? current : legacy]);
            assert.equal(storage.getItem("legacy"), legacy, "keep legacy until save succeeds");
        } finally {
            finishSave(true);
            await settled;
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.equal(storage.getItem("legacy"), null);
        assert.equal(primary.getRemoveCount(), 0);
    });
}

for (const networkSucceeds of [false, true]) {
    test(`songs data source: invalid cache cleanup never blocks loading or races a replacement (network=${networkSucceeds})`, async (t) => {
        const { response: failedResponse, readText } = createFailedResponse(t);
        t.mock.method(console, "warn", () => {});
        const cache = createFakeTextCacheStore("invalid JSON");
        const { promise: deleted, resolve: releaseDelete } = Promise.withResolvers<void>();
        const deletion = t.mock.method(cache, "removeText", () => deleted);
        const current = createSongsJson("current::1");
        const deleteCountsAtJsonFetch: number[] = [];
        mockFetch(t, async (url) => {
            if (url === "json") deleteCountsAtJsonFetch.push(deletion.mock.callCount());
            return url === "json"
                ? (networkSucceeds ? createResponse(current) : failedResponse)
                : createResponse(createValidCsv());
        });
        let snapshot: SongsSnapshot | null | undefined;
        const loading = createSongsDataSource({ publicSongsJsonUrl: "json", publicCsvUrl: "csv", songsJsonCache: cache })
            .loadInitialSnapshot().then((value) => { snapshot = value; });
        await new Promise((resolve) => setImmediate(resolve));
        try {
            assert.equal(readText.mock.callCount(), 0, "HTTP error bodies must not be read");
            assert.ok(snapshot, "a pending delete must not delay initial data");
            assert.deepEqual(deleteCountsAtJsonFetch, [0], "public fetch begins before cleanup");
            assert.equal(deletion.mock.callCount(), networkSucceeds ? 0 : 1);
            if (networkSucceeds) assert.equal(cache.peek(), current);
        } finally {
            releaseDelete();
            await loading;
        }
    });
}
