import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { reloadPage } from "../app/lib/page-reload.mts";
import { installFakeDom } from "./test-helpers.mts";

/**
 * 先読みを指定した module を持つページを偽の DOM に作り、読み込み直しの回数を数える。
 * @param dom installFakeDom で設置した DOM
 * @param hrefs 先読みを指定する module の URL
 */
function createPageWithPreloads(dom: ReturnType<typeof installFakeDom>, hrefs: string[]) {
    const links = hrefs.map((href) => {
        const link = document.createElement("link");
        link.rel = "modulepreload";
        link.href = href;
        return link;
    });
    // 偽の document の一覧検索は空を返すので、先読みの指定を返すように差し替える。
    dom.document.querySelectorAll = () => links.map((link) => dom.document.body.appendChild(link as never));
    const calls = { reload: 0 };
    Object.defineProperty(window, "location", {
        value: { reload() { calls.reload += 1; } },
        configurable: true
    });
    return calls;
}

/** fetch を差し替え、呼び出しを記録する。 */
function mockFetch(t: TestContext, implementation: typeof fetch) {
    return t.mock.method(globalThis, "fetch", implementation);
}

test("page reload: the preloaded modules are fetched again without the cache before reloading", async (t) => {
    const dom = installFakeDom();
    try {
        const calls = createPageWithPreloads(dom, [
            "https://example.test/browser/bootstrap-AAAA.mjs",
            "https://example.test/browser/chunk-BBBB.mjs"
        ]);
        const reloadCountsAtFetch: number[] = [];
        const fetchMock = mockFetch(t, async () => {
            reloadCountsAtFetch.push(calls.reload);
            return new Response("export {};");
        });

        await reloadPage();

        assert.deepEqual(fetchMock.mock.calls.map(({ arguments: [url, options] }) => [url, options?.cache]), [
            ["https://example.test/browser/bootstrap-AAAA.mjs", "reload"],
            ["https://example.test/browser/chunk-BBBB.mjs", "reload"]
        ]);
        // 取り直してから読み込み直す。先に読み込み直すと、WebKit は失敗した先読みを使い回す。
        assert.deepEqual(reloadCountsAtFetch, [0, 0]);
        assert.equal(calls.reload, 1);
    } finally {
        dom();
    }
});

test("page reload: the page still reloads when the modules cannot be fetched", async (t) => {
    const dom = installFakeDom();
    try {
        const calls = createPageWithPreloads(dom, ["https://example.test/browser/bootstrap-AAAA.mjs"]);
        mockFetch(t, async () => { throw new TypeError("network down"); });

        await reloadPage();
        assert.equal(calls.reload, 1);
    } finally {
        dom();
    }
});

test("page reload: a fetch that never answers is given up after the time limit", async (t) => {
    const dom = installFakeDom();
    try {
        const calls = createPageWithPreloads(dom, ["https://example.test/browser/bootstrap-AAAA.mjs"]);
        let signal: AbortSignal | null | undefined;
        mockFetch(t, (_url, options) => new Promise((_resolve, reject) => {
            signal = options?.signal;
            signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
        }));

        await reloadPage({ timeoutMs: 10 });
        assert.equal(signal?.aborted, true);
        assert.equal(calls.reload, 1);
    } finally {
        dom();
    }
});

test("page reload: a page without preloaded modules reloads at once", async (t) => {
    const dom = installFakeDom();
    try {
        const calls = createPageWithPreloads(dom, []);
        const fetchMock = mockFetch(t, async () => new Response(""));

        await reloadPage();
        assert.equal(fetchMock.mock.callCount(), 0);
        assert.equal(calls.reload, 1);
    } finally {
        dom();
    }
});
