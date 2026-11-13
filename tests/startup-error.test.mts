import test from "node:test";
import assert from "node:assert/strict";
import { STARTUP_ERROR_TEXT, showStartupLoadError } from "../app/startup-error.mts";
import { getUiText } from "../app/lib/ui-text.mts";
import { installFakeDom } from "./test-helpers.mts";

/**
 * 件数表示と結果一覧を持つページを偽の DOM に作り、読み込み直しの回数を数える。
 * @param language ページの言語。index.html の埋め込みスクリプトが <html lang> へ入れる値
 */
function createStartupPage(language: "ja" | "en") {
    const resultCount = document.createElement("p");
    resultCount.setAttribute("id", "resultCount");
    resultCount.textContent = "接続中...";
    const resultList = document.createElement("ol");
    resultList.setAttribute("id", "resultList");
    resultList.style.height = "480px";
    document.body.append(resultCount, resultList);
    document.documentElement.lang = language;
    const calls = { reload: 0 };
    Object.defineProperty(window, "location", {
        value: { reload() { calls.reload += 1; } },
        configurable: true
    });
    return { resultCount, resultList, calls };
}

test("startup error: the texts are the same as the dictionary the UI would have used", () => {
    for (const language of ["ja", "en"] as const) {
        const results = getUiText(language).results;
        assert.deepEqual(STARTUP_ERROR_TEXT[language], {
            title: results.loadError,
            detail: results.appLoadErrorDetail,
            reload: results.reload
        });
    }
});

for (const language of ["ja", "en"] as const) {
    test(`startup error: shows the failure and a reload button instead of staying on "connecting" (${language})`, async () => {
        const cleanup = installFakeDom();
        try {
            const { resultCount, resultList, calls } = createStartupPage(language);
            document.documentElement.classList.add("i18n-pending");

            showStartupLoadError();

            const text = STARTUP_ERROR_TEXT[language];
            assert.equal(resultCount.textContent, text.title);
            assert.equal(resultList.children.length, 1);
            const item = resultList.children[0];
            assert.equal(item.tagName, "LI");
            assert.equal(item.querySelector(".result-empty-state-title")?.textContent, text.detail);
            assert.equal(resultList.style.height, "");
            assert.equal(
                document.documentElement.classList.contains("i18n-pending"),
                false,
                "the page hidden while waiting for English text must be revealed"
            );

            const reloadButton = item.querySelector<HTMLButtonElement>(".result-reload-btn");
            assert.ok(reloadButton);
            assert.equal(reloadButton.textContent, text.reload);
            reloadButton.click();
            // 読み込み直す前に、先読みの module を取り直すのを待つ (このページには先読みの指定がない)。
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(calls.reload, 1);
        } finally {
            cleanup();
        }
    });
}

test("startup error: a page without the result elements is left alone", () => {
    const cleanup = installFakeDom();
    try {
        assert.doesNotThrow(() => showStartupLoadError());
    } finally {
        cleanup();
    }
});
