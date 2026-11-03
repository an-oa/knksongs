import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const { file, message } of [
    { file: "verify-pages-deployment.mts", message: "PAGE_URL is required" },
    { file: "deploy-pages-issue-notification.mts", message: "DEPLOY_SHA is required" },
    { file: "song-key-remap-issue.mts", message: "PREVIOUS_SONGS_JSON is required" }
]) {
    test(`scripts native CLI: ${file} starts without installed packages`, async (t) => {
        const directory = await mkdtemp(join(tmpdir(), "knksongs-native-cli-"));
        t.after(() => rm(directory, { recursive: true, force: true }));
        const scriptsDirectory = join(directory, "scripts");
        await cp(new URL("../scripts/", import.meta.url), scriptsDirectory, { recursive: true });
        const entryPoint = join(scriptsDirectory, file);

        // CIと同じNode直接実行で、通信を始める前の入力検証まで到達する。
        const result = spawnSync(process.execPath, [entryPoint], {
            cwd: directory,
            env: { ...process.env, NODE_OPTIONS: "", PAGE_URL: "", DEPLOY_SHA: "", PREVIOUS_SONGS_JSON: "" },
            encoding: "utf8",
            timeout: 10_000
        });

        assert.equal(result.error, undefined);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr.trim(), message);
    });
}
