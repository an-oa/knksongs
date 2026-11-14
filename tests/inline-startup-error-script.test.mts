import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { showStartupLoadError } from "../app/startup-error.mts";
import { installFakeDom, invokeListener } from "./test-helpers.mts";

type FakeDom = ReturnType<typeof installFakeDom>;
type FakeElement = ReturnType<FakeDom["document"]["createElement"]>;

/** public/index.html の埋め込みスクリプトを読む。 */
async function readInlineScript(): Promise<string> {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    return scripts[0][1];
}

/**
 * 件数表示と結果一覧を持つ、アプリが動く前のページを偽の DOM に作る。
 * @param dom installFakeDom で設置した DOM
 * @returns 件数表示と結果一覧
 */
function createUnstartedPage(dom: FakeDom) {
    const resultCount = dom.document.createElement("p");
    resultCount.setAttribute("id", "resultCount");
    resultCount.textContent = "接続中...";
    const resultList = dom.document.createElement("ol");
    resultList.setAttribute("id", "resultList");
    dom.document.body.append(resultCount, resultList);
    return { resultCount, resultList };
}

/**
 * 埋め込みスクリプトを偽の DOM の上で実行する。
 * @param source 埋め込みスクリプト
 * @param dom installFakeDom で設置した DOM
 * @param language 保存してあるサイトの言語
 * @returns 取り直しと読み込み直しの呼び出し記録
 */
function runInlineScript(source: string, dom: FakeDom, language: "ja" | "en") {
    const calls = { reload: 0, fetches: [] as [string, RequestInit | undefined][] };
    vm.runInNewContext(source, {
        document: dom.document,
        window: dom.window,
        localStorage: { getItem: (key: string) => (key === "siteLanguage" ? language : null) },
        navigator: { languages: ["ja-JP"], language: "ja-JP" },
        location: { search: "", reload() { calls.reload += 1; } },
        URLSearchParams,
        setTimeout: () => 0,
        fetch(url: string, options?: RequestInit) {
            calls.fetches.push([url, options]);
            // 通信が切れたままでも、例外を外へ出さない。
            return Promise.reject(new TypeError("network down"));
        }
    });
    return calls;
}

/**
 * 指定した種類の要素で読み込みの失敗 (error イベント) が起きたことを、window へ届ける。
 * @param dom installFakeDom で設置した DOM
 * @param tagName 失敗した要素のタグ名
 * @param type 要素の type
 */
function dispatchLoadError(dom: FakeDom, tagName: string, type: string) {
    const target = dom.document.createElement(tagName);
    target.type = type;
    invokeListener(dom.window, "error", { target });
}

/**
 * 画面に出ている失敗の表示を、比べられる形にする。
 * @param resultCount 件数表示
 * @param resultList 結果一覧
 * @returns 件数表示の文言と、結果一覧の項目の構造
 */
function describeFailure(resultCount: FakeElement, resultList: FakeElement) {
    return {
        count: resultCount.textContent,
        items: resultList.children.map((item) => ({
            tagName: item.tagName,
            className: item.className,
            children: item.children.map((child) => ({
                tagName: child.tagName,
                className: child.className,
                type: child.type,
                text: child.textContent
            }))
        }))
    };
}

for (const language of ["ja", "en"] as const) {
    test(`inline startup error script: shows the same failure as the app would when the entry script cannot be loaded (${language})`, async () => {
        const source = await readInlineScript();

        // アプリのコードが出す表示。入口の script は動いたが、UI のコードを読み込めなかったときに使う。
        let expected: ReturnType<typeof describeFailure>;
        const appDom = installFakeDom();
        try {
            const page = createUnstartedPage(appDom);
            document.documentElement.lang = language;
            showStartupLoadError();
            expected = describeFailure(page.resultCount, page.resultList);
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            appDom();
        }

        const dom = installFakeDom();
        try {
            const page = createUnstartedPage(dom);
            const calls = runInlineScript(source, dom, language);
            const root = dom.document.documentElement;
            assert.equal(root.classList.contains("i18n-pending"), language === "en");
            assert.equal(page.resultCount.textContent, "接続中...", "nothing is shown until the script fails");

            dispatchLoadError(dom, "script", "module");

            assert.deepEqual(describeFailure(page.resultCount, page.resultList), expected);
            assert.equal(expected.items.length, 1);
            assert.equal(root.classList.contains("i18n-pending"), false, "the page hidden while waiting for English text is revealed");

            const reloadButton = page.resultList.children[0].children[1];
            assert.equal(reloadButton.tagName, "BUTTON");
            void reloadButton.click();
            assert.equal(calls.reload, 1);
        } finally {
            dom();
        }
    });
}

test("inline startup error script: fetches the preloaded modules again so that WebKit forgets the failure", async () => {
    const source = await readInlineScript();
    const dom = installFakeDom();
    try {
        createUnstartedPage(dom);
        const links = ["https://example.test/browser/bootstrap-AAAA.mjs", "https://example.test/browser/chunk-BBBB.mjs"].map((href) => {
            const link = dom.document.createElement("link");
            Object.assign(link, { rel: "modulepreload", href });
            return link;
        });
        // 偽の document の一覧検索は空を返すので、先読みの指定を返すように差し替える。
        dom.document.querySelectorAll = () => links;
        const calls = runInlineScript(source, dom, "ja");
        assert.equal(calls.fetches.length, 0, "nothing is fetched while the page loads normally");

        dispatchLoadError(dom, "script", "module");

        assert.deepEqual(calls.fetches.map(([url, options]) => [url, options?.cache]), [
            ["https://example.test/browser/bootstrap-AAAA.mjs", "reload"],
            ["https://example.test/browser/chunk-BBBB.mjs", "reload"]
        ]);
        // 取り直しは失敗する (通信が切れたまま) が、未処理の rejection にはしない。
        await new Promise((resolve) => setImmediate(resolve));
    } finally {
        dom();
    }
});

test("inline startup error script: other load errors are left to the app", async () => {
    const source = await readInlineScript();
    const dom = installFakeDom();
    try {
        const page = createUnstartedPage(dom);
        const calls = runInlineScript(source, dom, "ja");

        // 先読みの失敗は、入口の script が動いていれば app/startup-error.mts が扱う。
        dispatchLoadError(dom, "link", "");
        // YouTube の IFrame API などの、module ではない script の失敗。
        dispatchLoadError(dom, "script", "");
        dispatchLoadError(dom, "img", "");
        // 実行中の例外では、要素ではなく window が対象になる。
        invokeListener(dom.window, "error", { target: null });

        assert.equal(page.resultCount.textContent, "接続中...");
        assert.equal(page.resultList.children.length, 0);
        assert.equal(calls.fetches.length, 0);
    } finally {
        dom();
    }
});
