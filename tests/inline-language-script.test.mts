import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseSiteLanguageQuery, resolveSiteLanguage } from "../app/lib/site-language.mts";

/** 保存値を読むと例外になる環境を表す印。 */
const UNREADABLE = Symbol("unreadable");

type InlineScriptInput = {
    search: string;
    stored: string | null | typeof UNREADABLE;
    preferredLanguages: string[];
};

/**
 * public/index.html の埋め込みスクリプトを、指定した URL・保存値・ブラウザの言語で実行する。
 * @param source 埋め込みスクリプト
 * @param input URL の query、保存値、ブラウザの優先言語
 * @returns 決まった言語と、文言を置き換えるまで中身を隠したか
 */
function runInlineScript(source: string, input: InlineScriptInput) {
    const classes = new Set<string>();
    const timeouts: number[] = [];
    const root = {
        lang: "ja",
        style: {},
        classList: {
            add: (name: string) => { classes.add(name); },
            remove: (name: string) => { classes.delete(name); }
        }
    };
    const localStorage = {
        getItem(key: string) {
            if (input.stored === UNREADABLE) throw new Error("storage is unavailable");
            return key === "siteLanguage" ? input.stored : null;
        }
    };
    vm.runInNewContext(source, {
        document: { documentElement: root },
        localStorage,
        navigator: { languages: input.preferredLanguages, language: input.preferredLanguages[0] ?? "" },
        location: { search: input.search },
        // 入口の script を読み込めなかったときの表示も同じスクリプトが登録する。言語の判定には関わらない。
        window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
        URLSearchParams,
        setTimeout: (_callback: () => void, ms: number) => { timeouts.push(ms); }
    });
    return {
        language: root.lang,
        pending: classes.has("i18n-pending"),
        revealTimeouts: timeouts
    };
}

test("inline language script: decides the same language as resolveSiteLanguage", async () => {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    const source = scripts[0][1];

    const searches = ["", "?lang=en", "?q=1&lang=ja", "?lang=fr"];
    const storedValues: InlineScriptInput["stored"][] = [null, "en", "ja", "EN", UNREADABLE];
    const preferredLanguageSets = [["ja-JP"], ["en-US"], ["en-US", "ja-JP"], ["zh-TW"], [" ", "JA-jp"], [""], []];

    for (const search of searches) {
        for (const stored of storedValues) {
            for (const preferredLanguages of preferredLanguageSets) {
                // アプリの起動時と同じく、?lang・保存値の順に候補を並べ、どちらもなければブラウザの言語で決める。
                const expected = resolveSiteLanguage(
                    [parseSiteLanguageQuery(search), stored === UNREADABLE ? null : stored],
                    preferredLanguages
                );
                const result = runInlineScript(source, { search, stored, preferredLanguages });
                const label = JSON.stringify({ search, stored: stored === UNREADABLE ? "unreadable" : stored, preferredLanguages });

                assert.equal(result.language, expected, label);
                assert.equal(result.pending, expected === "en", `the page is hidden only for English: ${label}`);
                assert.deepEqual(result.revealTimeouts, expected === "en" ? [4000] : [], label);
            }
        }
    }
});
