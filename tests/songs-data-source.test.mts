import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createFakeTextCacheStore } from "./fixtures/text-cache.mts";
import { createFakeLocalStorage } from "./fixtures/local-storage.mts";
import { createSongFixture } from "./fixtures/song.mts";
import type { SongsSnapshot } from "../app/lib/songs-data-source.mts";
import type { SongsJsonDocument } from "../app/lib/songs-json.mts";
import { createSongsDataSource } from "../app/lib/songs-data-source.mts";
import { createLegacyLocalStorageSongsJsonCacheAdapter } from "../app/lib/storage/songs-json-cache.mts";
import {
    buildSongsJsonDocument,
    buildSongsJsonMetaPayload,
    SONGS_JSON_SCHEMA_VERSION
} from "../app/lib/songs-json.mts";

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
 * data sourceテスト用のJSON文字列を返す。曲は 1 つで、どの取得元の曲かを archiveId で見分ける。
 * @param archiveId 曲の archiveId
 * @param contentHash 内容hash
 * @param generatedAt 生成日時
 * @returns 曲データJSONの文字列
 */
function createSongsJson(
    archiveId: string,
    contentHash = `sha256:${archiveId}`,
    generatedAt = GENERATED_AT
) {
    return JSON.stringify(buildSongsJsonDocument([createSongFixture({ archiveId })], contentHash, generatedAt));
}

/**
 * 直前schemaのキャッシュ確認用JSON文字列を返す。
 * 直前schemaは、曲の情報を表に分けず、曲行ごとに全項目を書いていた。
 * @param archiveId 曲の archiveId
 * @param contentHash 内容hash
 * @returns 直前schemaの曲データJSONの文字列
 */
function createPreviousSchemaSongsJson(archiveId: string, contentHash: string) {
    return JSON.stringify({
        schemaVersion: SONGS_JSON_SCHEMA_VERSION - 1,
        contentHash,
        generatedAt: GENERATED_AT,
        songs: [createSongFixture({ archiveId })]
    });
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
    assert.equal(snapshot.songs[0].archiveId, "archive-1");
});

test("songs data source: network json success stores json and skips csv", async (t) => {
    const songsJson = createSongsJson("json-archive");
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
    assert.equal(snapshot.songs[0].archiveId, "json-archive");
});

for (const saveResult of ["success", "false", "reject"]) {
    test(`songs data source: initial snapshot does not wait for cache save (${saveResult})`, async (t) => {
        const jsonText = createSongsJson("public", "sha256:public");
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
            assert.equal(snapshot.songs[0].archiveId, "public");
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
    const invalidPayload: { songInfos: Partial<SongsJsonDocument["songInfos"][number]>[] } = JSON.parse(
        createSongsJson("invalid-archive")
    );
    delete invalidPayload.songInfos[0].title;
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
    assert.equal(snapshot.songs[0].archiveId, "archive-1");
});

test("songs data source: unsafe links in network and cached JSON fall back to validated CSV", async (t) => {
    const payload: SongsJsonDocument = JSON.parse(createSongsJson("unsafe-archive", "sha256:unsafe"));
    payload.songs[0].url = "javascript:alert(1)";
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
    const cachedJson = createSongsJson("cached-archive", "sha256:cached");
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
    assert.equal(snapshot.songs[0].archiveId, "cached-archive");
});

test("songs data source: newer public json is used for the initial snapshot", async (t) => {
    const cachedJson = createSongsJson(
        "cached-archive",
        "sha256:cached",
        "2026-08-13T00:00:00.000Z"
    );
    const freshJson = createSongsJson(
        "fresh-archive",
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
    assert.equal(snapshot.songs[0].archiveId, "fresh-archive");
});

test("songs data source: older public json replaces a newer cache when hashes differ", async (t) => {
    const cachedJson = createSongsJson("cached-archive", "sha256:newer-cache", "2026-08-15T00:00:00.000Z");
    const publicJson = createSongsJson("public-archive", "sha256:public");
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
    assert.equal(snapshot.songs[0].archiveId, "public-archive");
    assert.equal(songsJsonCache.peek(), publicJson);
});

test("songs data source: meta fetch failure still tries network json", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
    const cachedJson = createSongsJson(
        "cached-archive",
        "sha256:cached",
        "2026-08-13T00:00:00.000Z"
    );
    const freshJson = createSongsJson(
        "fresh-archive",
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
    assert.equal(snapshot.songs[0].archiveId, "fresh-archive");
    assert.match(String(warnings.mock.calls[0]?.arguments[0]), /曲データJSONメタ情報の確認に失敗しました/);
});

test("songs data source: meta fetch failure still allows older public json to replace a newer cache", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
    const cachedJson = createSongsJson(
        "cached-archive",
        "sha256:newer-cache",
        "2026-08-15T00:00:00.000Z"
    );
    const olderJson = createSongsJson(
        "older-network",
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
    assert.equal(snapshot.songs[0].archiveId, "older-network");
});

test("songs data source: json failure uses valid json cache before network csv", async (t) => {
    const { response: failedResponse, readText } = createFailedResponse(t);
    const cachedJson = createSongsJson(
        "cached-archive",
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
    assert.equal(snapshot.songs[0].archiveId, "cached-archive");
});

test("songs data source: json newer than stale meta is accepted and cached", async (t) => {
    const newerJson = createSongsJson(
        "newer-archive",
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
    assert.equal(snapshot.songs[0].archiveId, "newer-archive");
});

test("songs data source: json older than meta is not cached and falls back to csv", async (t) => {
    const olderJson = createSongsJson(
        "older-archive",
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
    assert.equal(snapshot.songs[0].archiveId, "archive-1");
});

test("songs data source: equal timestamps with mismatched hashes are rejected", async (t) => {
    const inconsistentJson = createSongsJson("inconsistent", "sha256:json");
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
    assert.equal(snapshot.songs[0].archiveId, "archive-1");
});

test("songs data source: older schema cache is replaced without a competing delete", async (t) => {
    const legacyJson = createPreviousSchemaSongsJson("legacy-archive", "sha256:legacy");
    const freshJson = createSongsJson("fresh-archive", "sha256:fresh");
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
    assert.equal(snapshot.songs[0].archiveId, "fresh-archive");
});

test("songs data source: older schema network json is not cached and falls back to csv", async (t) => {
    const legacyJson = createPreviousSchemaSongsJson("legacy-network", "sha256:legacy");
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
    assert.equal(snapshot.songs[0].archiveId, "archive-1");
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
    assert.equal(snapshot.songs[0].archiveId, "archive-1");
});

test("songs data source: legacy localStorage json is migrated into the json cache", async (t) => {
    const storage = createFakeLocalStorage();
    const cachedJson = createSongsJson("legacy-archive", "sha256:legacy");
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
    assert.equal(snapshot.songs[0].archiveId, "archive-1");
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
    const cachedJson = createSongsJson("cached-archive", "sha256:cached");
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
    assert.equal(snapshot.songs[0].archiveId, "cached-archive");
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
        uncachedSongsJsonResponseTimeoutMs: 10,
        csvResponseTimeoutMs: 50
    });

    const snapshot = await dataSource.loadInitialSnapshot();
    assert.ok(snapshot);

    assertFetchCalls(fetchMock, [
        ["data/songs.json", { cache: "no-cache" }],
        ["https://example.test/songs.csv", { cache: "no-store" }]
    ]);
    assert.equal(snapshot.songs[0].archiveId, "archive-1");
});

test("songs data source: without a cache the json response may take longer than the cached-path limit", async (t) => {
    const tick = createNetworkClock(t);
    const publicJson = createSongsJson("public", "sha256:public");
    const urls: Parameters<typeof fetch>[0][] = [];
    mockFetch(t, (url) => {
        urls.push(url);
        // キャッシュがあるときの response 期限 (2 秒) より遅く、キャッシュがないときの期限 (10 秒) より早く応答する。
        return new Promise((resolve) => setTimeout(() => resolve(createResponse(publicJson)), 9000));
    });
    const loading = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache: createFakeTextCacheStore()
    }).loadInitialSnapshot();
    await tick(0);
    await tick(9000);
    const snapshot = await loading;
    assert.ok(snapshot);
    assert.equal(snapshot.source, "network");
    assert.equal(snapshot.songs[0].archiveId, "public");
    assert.deepEqual(urls, ["data/songs.json"], "the csv fallback is not started while the json is still expected");
});

test("songs data source: slow json body may finish after the response timeout", async (t) => {
    const songsJson = createSongsJson("slow-json");
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

    assert.equal(snapshot.songs[0].archiveId, "slow-json");
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

    assert.equal(snapshot.songs[0].archiveId, "archive-1");
});

for (const invalidKind of ["malformed", "older-than-meta", "same-time-different-hash"]) {
    test(`songs data source: ${invalidKind} public json preserves valid cache`, async (t) => {
        const cachedJson = createSongsJson("cached", "sha256:cached");
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const publicJson = invalidKind === "malformed" ? "not json" : createSongsJson(
            "public", "sha256:public",
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
        assert.equal(snapshot.songs[0].archiveId, "cached");
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
    const cachedJson = createSongsJson("cached", "sha256:cached");
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
    assert.equal(snapshot.source, "cache");
    assert.equal(snapshot.songs[0].archiveId, "cached");
    // 表示はキャッシュへ切り替えるが、取得は中断しない。後から届いた本文は次回の表示用に保存する。
    assert.equal(jsonSignal.aborted, false);
    assert.equal(songsJsonCache.peek(), cachedJson);
    const publicJson = createSongsJson("public", "sha256:public");
    releaseBody(publicJson);
    await tick(0);
    assert.equal(songsJsonCache.peek(), publicJson);
    assert.equal(snapshot.songs[0].archiveId, "cached", "the shown data is not swapped");
    assert.deepEqual(urls, ["data/songs-meta.json", "data/songs.json"]);
});

test("songs data source: a json response slower than the cached-path limit still refreshes the cache for the next visit", async (t) => {
    const tick = createNetworkClock(t);
    const cachedJson = createSongsJson("cached", "sha256:cached");
    const publicJson = createSongsJson("public", "sha256:public");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    let jsonSignal: AbortSignal | null | undefined;
    mockFetch(t, (url, options) => {
        if (url === "data/songs-meta.json") {
            return Promise.resolve(createResponse(createSongsMetaJson("sha256:public")));
        }
        jsonSignal = options?.signal;
        // response の期限 (2 秒) にも、全体の期限 (5 秒) にも間に合わない。
        return new Promise((resolve) => setTimeout(() => resolve(createResponse(publicJson)), 8000));
    });
    const loading = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();
    await tick(0);
    await tick(2000);
    const snapshot = await loading;
    assert.ok(snapshot);
    assert.equal(snapshot.source, "cache", "the cache is shown as soon as the response limit passes");
    assert.equal(songsJsonCache.peek(), cachedJson);

    await tick(6000);
    assert.ok(jsonSignal);
    assert.equal(jsonSignal.aborted, false);
    assert.equal(songsJsonCache.peek(), publicJson);
});

test("songs data source: a late json does not roll back a newer cache that another tab saved in the meantime", async (t) => {
    const tick = createNetworkClock(t);
    const cachedJson = createSongsJson("cached", "sha256:cached", "2026-08-01T00:00:00.000Z");
    const olderPublicJson = createSongsJson("older", "sha256:older", "2026-08-02T00:00:00.000Z");
    const newerPublicJson = createSongsJson("newer", "sha256:newer", "2026-08-03T00:00:00.000Z");
    // 同じブラウザのタブは、同じキャッシュを共有する。
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    mockFetch(t, (url) => {
        // このタブが取得を始めた時点で公開されていた内容。本文は、表示の期限に間に合わない。
        if (url === "data/songs-meta.json") {
            return Promise.resolve(createResponse(createSongsMetaJson("sha256:older", "2026-08-02T00:00:00.000Z")));
        }
        return new Promise((resolve) => setTimeout(() => resolve(createResponse(olderPublicJson)), 8000));
    });
    const loading = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();
    await tick(0);
    await tick(2000);
    const snapshot = await loading;
    assert.ok(snapshot);
    assert.equal(snapshot.source, "cache");

    // 待っている間に公開内容が更新され、後から開いた別のタブが、その新しい JSON を保存した。
    await songsJsonCache.setText(newerPublicJson);

    // 遅れて届いた古い JSON は、取得を始めた時点の meta とは整合するが、保存済みのキャッシュより古い。
    await tick(6000);
    assert.equal(songsJsonCache.peek(), newerPublicJson);
});

const LATE_PUBLIC_JSON = createSongsJson("late", "sha256:late", "2026-08-02T00:00:00.000Z");

for (const { cacheOnArrival, cached, isReplaced } of [
    { cacheOnArrival: "an older one", cached: createSongsJson("cached", "sha256:cached", "2026-08-01T00:00:00.000Z"), isReplaced: true },
    { cacheOnArrival: "none, because it was removed", cached: null, isReplaced: true },
    { cacheOnArrival: "one that cannot be read", cached: createPreviousSchemaSongsJson("stale", "sha256:stale"), isReplaced: true },
    { cacheOnArrival: "the same content, saved by another tab", cached: LATE_PUBLIC_JSON, isReplaced: false },
    { cacheOnArrival: "the same content of an older generation", cached: createSongsJson("late", "sha256:late", "2026-08-01T12:00:00.000Z"), isReplaced: true },
    { cacheOnArrival: "the same content of a newer generation, confirmed by another tab", cached: createSongsJson("late", "sha256:late", "2026-08-03T00:00:00.000Z"), isReplaced: false },
    { cacheOnArrival: "a newer one, saved by another tab", cached: createSongsJson("newer", "sha256:newer", "2026-08-03T00:00:00.000Z"), isReplaced: false }
]) {
    test(`songs data source: a late json ${isReplaced ? "replaces" : "leaves"} the cache when the cache is ${cacheOnArrival}`, async (t) => {
        const tick = createNetworkClock(t);
        const songsJsonCache = createFakeTextCacheStore(createSongsJson("cached", "sha256:cached", "2026-08-01T00:00:00.000Z"));
        const replace = t.mock.method(songsJsonCache, "setTextIf");
        mockFetch(t, (url) => {
            if (url === "data/songs-meta.json") {
                return Promise.resolve(createResponse(createSongsMetaJson("sha256:late", "2026-08-02T00:00:00.000Z")));
            }
            return new Promise((resolve) => setTimeout(() => resolve(createResponse(LATE_PUBLIC_JSON)), 8000));
        });
        const loading = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        }).loadInitialSnapshot();
        await tick(0);
        await tick(2000);
        assert.equal((await loading)?.source, "cache");

        // 遅れた JSON が届くまでの間に、キャッシュがこの状態になっている。
        if (cached === null) await songsJsonCache.removeText();
        else await songsJsonCache.setText(cached);
        await tick(6000);

        // 保存するかどうかは、届いた時点で保存済みの内容を見て決める。
        assert.equal(replace.mock.callCount(), 1);
        assert.equal(await replace.mock.calls[0].result, isReplaced);
        assert.equal(songsJsonCache.peek(), isReplaced ? LATE_PUBLIC_JSON : cached);
    });
}

// CSV を元の内容へ戻して再生成すると、内容 (hash) は前と同じで、生成日時だけが新しくなる。A(t1) → B(t2) → A(t3)。
const CONTENT_A_FIRST = createSongsJson("content-a", "sha256:content-a", "2026-08-01T00:00:00.000Z");
const CONTENT_B = createSongsJson("content-b", "sha256:content-b", "2026-08-02T00:00:00.000Z");
const CONTENT_A_REPUBLISHED = createSongsJson("content-a", "sha256:content-a", "2026-08-03T00:00:00.000Z");

test("songs data source: a late json is not saved after the csv was reverted to the cached content and another tab reused the cache", async (t) => {
    const tick = createNetworkClock(t);
    // A(t1) がキャッシュにある。同じブラウザのタブは、同じキャッシュを共有する。
    const songsJsonCache = createFakeTextCacheStore(CONTENT_A_FIRST);
    let published = { meta: createSongsMetaJson("sha256:content-b", "2026-08-02T00:00:00.000Z"), json: CONTENT_B };
    const urls: Parameters<typeof fetch>[0][] = [];
    mockFetch(t, (url) => {
        urls.push(url);
        if (url === "data/songs-meta.json") return Promise.resolve(createResponse(published.meta));
        // 本文は、表示の期限に間に合わない。届くのは、取得を始めた時点で公開されていた内容。
        const { json } = published;
        return new Promise((resolve) => setTimeout(() => resolve(createResponse(json)), 8000));
    });
    const openTab = () => createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();

    // 最初のタブが、公開中の B(t2) を取得し始める。
    const firstTab = openTab();
    await tick(0);
    await tick(2000);
    assert.equal((await firstTab)?.source, "cache");

    // 待っている間に CSV が A へ戻されて再生成され、A(t3) が公開される。その後で別のタブを開く。
    published = { meta: createSongsMetaJson("sha256:content-a", "2026-08-03T00:00:00.000Z"), json: CONTENT_A_REPUBLISHED };
    const secondTab = await openTab();
    await tick(0);
    // 別のタブは、公開中の meta の hash が保存済みの A と一致するので、本文を取らずにキャッシュを使う。
    assert.equal(secondTab?.source, "cache");
    assert.equal(secondTab?.songs[0].archiveId, "content-a");
    assert.deepEqual(urls, ["data/songs-meta.json", "data/songs.json", "data/songs-meta.json"]);
    // そのとき、公開し直された生成日時をキャッシュに残す。
    assert.equal(songsJsonCache.peek(), CONTENT_A_REPUBLISHED);

    // 最初のタブに B(t2) が遅れて届く。取得を始めた時点の meta とは整合するが、保存済みの A(t3) より古い。
    await tick(6000);
    assert.equal(songsJsonCache.peek(), CONTENT_A_REPUBLISHED);
    assert.deepEqual(urls, ["data/songs-meta.json", "data/songs.json", "data/songs-meta.json"], "saving needs no further request");
});

for (const { generation, metaGeneratedAt, cachedAfterwards, saveCount } of [
    { generation: "a newer generation", metaGeneratedAt: "2026-08-03T00:00:00.000Z", cachedAfterwards: CONTENT_A_REPUBLISHED, saveCount: 1 },
    { generation: "the same generation", metaGeneratedAt: "2026-08-01T00:00:00.000Z", cachedAfterwards: CONTENT_A_FIRST, saveCount: 0 },
    // 公開される生成日時が古くなることは、現行の生成・公開の経路では起きない。起きても、確かめた世代を後ろへ戻さない。
    { generation: "an older generation", metaGeneratedAt: "2026-07-31T00:00:00.000Z", cachedAfterwards: CONTENT_A_FIRST, saveCount: 0 }
]) {
    test(`songs data source: reusing the cache ${saveCount ? "records" : "does not write"} when the public meta shows ${generation} of the same content`, async (t) => {
        const songsJsonCache = createFakeTextCacheStore(CONTENT_A_FIRST);
        const save = t.mock.method(songsJsonCache, "setText");
        const saveIf = t.mock.method(songsJsonCache, "setTextIf");
        const fetchMock = mockFetch(t, async () => createResponse(createSongsMetaJson("sha256:content-a", metaGeneratedAt)));
        const snapshot = await createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        }).loadInitialSnapshot();
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(snapshot?.source, "cache");
        assert.equal(snapshot?.songs[0].archiveId, "content-a");
        assertFetchCalls(fetchMock, [["data/songs-meta.json", { cache: "no-cache" }]]);
        assert.equal(save.mock.callCount(), 0);
        assert.equal(saveIf.mock.callCount(), saveCount);
        assert.equal(songsJsonCache.peek(), cachedAfterwards);
    });
}

test("songs data source: a generation confirmed while reusing the cache replaces an older json that another tab saved late", async (t) => {
    const songsJsonCache = createFakeTextCacheStore(CONTENT_A_FIRST);
    const { promise: metaResponse, resolve: releaseMeta } = Promise.withResolvers<Response>();
    mockFetch(t, () => metaResponse);
    const loading = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();
    // このタブが A(t1) のキャッシュを読み終え、公開 meta を待っている。
    await new Promise((resolve) => setImmediate(resolve));

    // その間に、別のタブへ遅れて届いた B(t2) が保存される。保存済みの A(t1) より新しいので、保存は通る。
    await songsJsonCache.setText(CONTENT_B);

    // 公開中の内容は、戻された A(t3) だった。このタブは読み込んであった A を表示し、A(t3) をキャッシュに残す。
    releaseMeta(createResponse(createSongsMetaJson("sha256:content-a", "2026-08-03T00:00:00.000Z")));
    const snapshot = await loading;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(snapshot?.source, "cache");
    assert.equal(snapshot?.songs[0].archiveId, "content-a");
    assert.equal(songsJsonCache.peek(), CONTENT_A_REPUBLISHED);
});

test("songs data source: legacy localStorage json is migrated with the newer generation that the public meta shows", async (t) => {
    const storage = createFakeLocalStorage();
    const primarySongsJsonCache = createFakeTextCacheStore();
    const songsJsonCache = createLegacyLocalStorageSongsJsonCacheAdapter({
        cache: primarySongsJsonCache,
        legacyKey: "cachedSongsJson",
        storage
    });
    storage.setItem("cachedSongsJson", CONTENT_A_FIRST);
    const fetchMock = mockFetch(t, async () => createResponse(createSongsMetaJson("sha256:content-a", "2026-08-03T00:00:00.000Z")));

    const snapshot = await createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(snapshot?.source, "cache");
    assertFetchCalls(fetchMock, [["data/songs-meta.json", { cache: "no-cache" }]]);
    assert.equal(primarySongsJsonCache.peek(), CONTENT_A_REPUBLISHED);
    assert.equal(storage.getItem("cachedSongsJson"), null);
});

test("songs data source: a line where meta and json each answer in three seconds still refreshes the cache for the next visit", async (t) => {
    const tick = createNetworkClock(t);
    t.mock.method(console, "warn", () => {});
    const cachedJson = createSongsJson("cached", "sha256:cached", "2026-08-01T00:00:00.000Z");
    const publicJson = createSongsJson("public", "sha256:public", "2026-08-02T00:00:00.000Z");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    const urls: Parameters<typeof fetch>[0][] = [];
    // どの要求も、応答まで 3 秒かかる。待つ側が中断したら、その時点で失敗する。
    mockFetch(t, (url, options) => {
        urls.push(url);
        const body = url === "data/songs-meta.json" ? createSongsMetaJson("sha256:public", "2026-08-02T00:00:00.000Z") : publicJson;
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => resolve(createResponse(body)), 3000);
            options?.signal?.addEventListener("abort", () => {
                clearTimeout(timeoutId);
                reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
        });
    });
    const openPage = () => createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();

    const firstVisit = openPage();
    await tick(0);
    await tick(2000); // meta の応答を待つ期限 (2 秒) が切れ、JSON の取得を始める。
    await tick(2000); // JSON の応答を待つ期限 (2 秒) が切れ、キャッシュで表示する。
    assert.equal((await firstVisit)?.songs[0].archiveId, "cached");
    assert.equal(songsJsonCache.peek(), cachedJson);
    await tick(1000); // JSON が、取得を始めてから 3 秒で届く。
    // 保存の前に通信を挟まないので、同じ回線でも保存できる。
    assert.equal(songsJsonCache.peek(), publicJson);
    assert.deepEqual(urls, ["data/songs-meta.json", "data/songs.json"]);

    // 次の訪問では、保存された新しい内容を表示する。
    const secondVisit = openPage();
    await tick(0);
    await tick(2000);
    await tick(2000);
    assert.equal((await secondVisit)?.songs[0].archiveId, "public");
});

test("songs data source: a late json that cannot be saved is reported and does not disturb the page", async (t) => {
    const tick = createNetworkClock(t);
    const warn = t.mock.method(console, "warn", () => {});
    const cachedJson = createSongsJson("cached", "sha256:cached", "2026-08-01T00:00:00.000Z");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    const storageError = new Error("the storage is full");
    t.mock.method(songsJsonCache, "setTextIf", async () => { throw storageError; });
    mockFetch(t, (url) => {
        if (url === "data/songs-meta.json") {
            return Promise.resolve(createResponse(createSongsMetaJson("sha256:late", "2026-08-02T00:00:00.000Z")));
        }
        return new Promise((resolve) => setTimeout(() => resolve(createResponse(LATE_PUBLIC_JSON)), 8000));
    });
    const loading = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();
    await tick(0);
    await tick(2000);
    assert.equal((await loading)?.source, "cache");

    await tick(6000);
    assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [["曲データJSONキャッシュを保存できませんでした", storageError]]);
    assert.equal(songsJsonCache.peek(), cachedJson);
});

test("songs data source: the background json download is given up after its own limit", async (t) => {
    const tick = createNetworkClock(t);
    const cachedJson = createSongsJson("cached", "sha256:cached");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    let jsonSignal: AbortSignal | null | undefined;
    mockFetch(t, (url, options) => {
        if (url === "data/songs-meta.json") {
            return Promise.resolve(createResponse(createSongsMetaJson("sha256:public")));
        }
        jsonSignal = options?.signal;
        return createPendingFetch()(url, options);
    });
    const loading = createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicSongsMetaUrl: "data/songs-meta.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();
    await tick(0);
    await tick(2000);
    const snapshot = await loading;
    assert.ok(snapshot);
    assert.equal(snapshot.source, "cache");

    await tick(57_999);
    assert.ok(jsonSignal);
    assert.equal(jsonSignal.aborted, false);
    await tick(1);
    assert.equal(jsonSignal.aborted, true);
    assert.equal(songsJsonCache.peek(), cachedJson);
});

for (const invalidKind of ["malformed", "older-than-meta"]) {
    test(`songs data source: a late ${invalidKind} json does not replace the cache`, async (t) => {
        const tick = createNetworkClock(t);
        const cachedJson = createSongsJson("cached", "sha256:cached");
        const songsJsonCache = createFakeTextCacheStore(cachedJson);
        const lateJson = invalidKind === "malformed"
            ? "not json"
            : createSongsJson("public", "sha256:public", "2026-08-13T00:00:00.000Z");
        mockFetch(t, (url) => {
            if (url === "data/songs-meta.json") {
                return Promise.resolve(createResponse(createSongsMetaJson("sha256:meta")));
            }
            return new Promise((resolve) => setTimeout(() => resolve(createResponse(lateJson)), 8000));
        });
        const loading = createSongsDataSource({
            publicSongsJsonUrl: "data/songs.json",
            publicSongsMetaUrl: "data/songs-meta.json",
            publicCsvUrl: "https://example.test/songs.csv",
            songsJsonCache
        }).loadInitialSnapshot();
        await tick(0);
        await tick(2000);
        const snapshot = await loading;
        assert.ok(snapshot);
        assert.equal(snapshot.source, "cache");

        await tick(6000);
        assert.equal(songsJsonCache.peek(), cachedJson);
    });
}

for (const phase of ["response", "body"]) {
    test(`songs data source: meta ${phase} exhausting the deadline prevents a json request`, async (t) => {
        const tick = createNetworkClock(t);
        t.mock.method(console, "warn", () => {});
        const cachedJson = createSongsJson("cached", "sha256:cached");
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

test("songs data source: a body that arrives after the deadline is not shown even before the timeout callback runs", async (t) => {
    let now = 0;
    t.mock.method(performance, "now", () => now);
    const cachedJson = createSongsJson("cached", "sha256:cached");
    const publicJson = createSongsJson("public", "sha256:public");
    const songsJsonCache = createFakeTextCacheStore(cachedJson);
    mockFetch(t, async () => {
        return createResponse(async () => {
            now = 5001;
            return publicJson;
        });
    });
    const snapshot = await createSongsDataSource({
        publicSongsJsonUrl: "data/songs.json",
        publicCsvUrl: "https://example.test/songs.csv",
        songsJsonCache
    }).loadInitialSnapshot();
    assert.ok(snapshot);
    assert.equal(snapshot.source, "cache");
    assert.equal(snapshot.songs[0].archiveId, "cached");
    // 表示には使わないが、届いた本文は次回の表示用に保存する。
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(songsJsonCache.peek(), publicJson);
});

test("songs data source: no cache keeps parallel requests and allows a body beyond five seconds", async (t) => {
    const tick = createNetworkClock(t);
    const urls: Parameters<typeof fetch>[0][] = [];
    const { promise: metaBody, resolve: releaseMeta } = Promise.withResolvers<string>();
    const publicJson = createSongsJson("public", "sha256:public");
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
    assert.equal(snapshot.songs[0].archiveId, "public");
});

for (const updated of [false, true]) {
    test(`songs data source: legacy read starts meta before saving and only persists the accepted JSON (updated=${updated})`, async (t) => {
        const legacy = createSongsJson("legacy", "sha256:legacy");
        const current = createSongsJson("current", "sha256:current");
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
        const current = createSongsJson("current");
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
