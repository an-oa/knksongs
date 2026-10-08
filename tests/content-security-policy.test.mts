import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test("CSP permits the initial theme script with its exact hash", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    assert.ok(policy);
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf("<script>"));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    for (const [, source] of scripts) {
        const hash = createHash("sha256").update(source).digest("base64");
        assert.ok(policy.includes(`'sha256-${hash}'`), "update the CSP hash when changing the theme initializer");
    }
    assert.ok(!policy.includes("'unsafe-inline'"));
    assert.ok(!policy.includes("'unsafe-eval'"));
});
