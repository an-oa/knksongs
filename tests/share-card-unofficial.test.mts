import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** 共有カードの文言を持つページと、非公式であることを示す語。 */
const SHARE_PAGES = [
    { file: "../public/index.html", word: /非公式/ },
    { file: "../public/en/index.html", word: /\bunofficial\b/i }
];

/** 共有カードに出る説明と画像の代替テキスト。 */
const SHARE_TEXT_KEYS = ["og:description", "twitter:description", "og:image:alt"];

/**
 * meta 要素の content を、property または name で読む。
 * @param html ページの HTML
 * @param key 読む meta の property または name
 * @returns content の値。見つからなければ undefined
 */
function readMeta(html: string, key: string): string | undefined {
    const pattern = new RegExp(`<meta (?:property|name)="${key.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`);
    return pattern.exec(html)?.[1];
}

// SNS の共有カードはサイトの外で単独で見られるので、公式と誤認されないよう、説明にも画像の代替テキストにも非公式と書く。
test("share cards: Japanese and English pages say the site is unofficial", async () => {
    for (const page of SHARE_PAGES) {
        const html = await readFile(new URL(page.file, import.meta.url), "utf8");
        for (const key of SHARE_TEXT_KEYS) {
            const value = readMeta(html, key);
            assert.ok(value, `${page.file} has ${key}`);
            assert.match(value, page.word, `${page.file} ${key} says the site is unofficial`);
        }
    }
});

// 検索結果に出る説明文は、共有カードの説明と同じ文にする。片方だけを直して食い違うのを防ぐ。
test("search snippet: the main page describes itself with the same text as its share card", async () => {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    const description = readMeta(html, "description");
    assert.ok(description, "the main page has a meta description");
    assert.equal(description, readMeta(html, "og:description"));
    assert.match(description, /非公式/);
});
