import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildBrowserModules } from "../scripts/build-browser.mjs";
import { buildPagesArtifact } from "../scripts/build-pages-artifact.mjs";

const htmlTemplate = '<head>\n<link rel="stylesheet" href="styles.css">\n  <script type="module" src="app/startup.mjs"></script>\n</head>';

/** 独立した emit fixture と再ビルド用 helper を作り、テスト終了時に片付ける。 */
async function createBrowserFixture(t) {
    const root = await mkdtemp(join(process.cwd(), "_build/browser-test-"));
    const outputDir = `_site/${relative(join(process.cwd(), "_build"), root)}`;
    t.after(async () => {
        await rm(root, { recursive: true, force: true });
        await rm(outputDir, { recursive: true, force: true });
    });
    await mkdir(join(root, "app"));
    await mkdir(join(root, "data"));
    const bootstrap = 'import { snapshot } from "./data.mjs"; snapshot.then(() => console.log("ready"));';
    await Promise.all([
        writeFile(join(root, "styles.css"), "body {}"),
        writeFile(join(root, "ogp.png"), "fixture"),
        writeFile(join(root, "data/songs.json"), "{}"),
        writeFile(join(root, "data/songs-meta.json"), "{}"),
        writeFile(join(root, "app/startup.mjs"), 'import "./data.mjs"; void import("./bootstrap.mjs");'),
        writeFile(join(root, "app/data.mjs"), 'export const snapshot = fetch("data/songs.json");'),
        writeFile(join(root, "app/bootstrap.mjs"), bootstrap)
    ]);
    /** source HTMLから毎回ビルドし、ブラウザ成果物の内容を比較する。 */
    async function compile(options) {
        await rm(join(root, "browser"), { recursive: true, force: true });
        await writeFile(join(root, "index.html"), htmlTemplate);
        await buildBrowserModules(root, options);
        const files = (await readdir(join(root, "browser"))).sort();
        const sources = await Promise.all(files.map((file) => readFile(join(root, "browser", file), "utf8")));
        const html = await readFile(join(root, "index.html"), "utf8");
        return { files, sources, html };
    }
    return { root, outputDir, bootstrap, compile };
}

test("browser build: owns content-hashed URLs and publishes only browser artifacts", async (t) => {
    const { root, outputDir, bootstrap, compile } = await createBrowserFixture(t);
    const first = await compile();
    assert.equal(first.files.length, 3, "startup, UI, and one shared module");
    assert.ok(first.files.every((file) => /-[A-Z0-9]+\.mjs$/.test(file)));
    assert.equal(first.sources.join("").match(/fetch\(/g)?.length, 1);
    assert.match(first.html, /styles\.css\?v=[0-9a-f]{64}/);
    for (const file of first.files) assert.ok(first.html.includes(`browser/${file}`));
    for (const source of first.sources) {
        for (const match of source.matchAll(/["']\.\/([^"']+\.mjs)["']/g)) {
            assert.ok(first.html.includes(`browser/${match[1]}`), "preload and import have identical URLs");
        }
    }
    await buildPagesArtifact({ outputDir, siteDir: root, deploymentSha: "abcdef0" });
    assert.equal(await readFile(join(outputDir, "index.html"), "utf8"), first.html);
    assert.deepEqual((await readdir(outputDir)).sort(), ["browser", "data", "deployment.json", "index.html", "ogp.png", "styles.css"]);
    for (let i = 0; i < first.files.length; i++) {
        assert.equal(await readFile(join(outputDir, "browser", first.files[i]), "utf8"), first.sources[i]);
    }
    await writeFile(join(root, "app/bootstrap.mjs"), `// emit comment only\n${bootstrap}`);
    await writeFile(join(root, "data/songs.json"), '{"updated":true}');
    assert.deepEqual(await compile(), first, "emit comments and JSON updates do not invalidate JS/CSS URLs");
    await writeFile(join(root, "app/bootstrap.mjs"), bootstrap.replace('"ready"', '"changed"'));
    const changed = await compile();
    assert.notEqual(changed.files.find((file) => file.startsWith("startup-")), first.files.find((file) => file.startsWith("startup-")), "entry hash includes imported code changes");
    assert.notEqual(changed.html, first.html);
    await writeFile(join(root, "styles.css"), "body { color: red; }");
    const cssChanged = await compile();
    assert.deepEqual(cssChanged.files, changed.files, "CSS updates leave JS hashes unchanged");
    assert.notEqual(cssChanged.html, changed.html);
    const versioned = await compile({ cacheBuster: "release/v2" });
    assert.match(versioned.html, /styles\.css\?v=release%2Fv2/);
    assert.notDeepEqual(versioned.files, cssChanged.files, "explicit versions change JS hashes at build time");
});

test("browser build: preloads startup UI and static dependencies but excludes lazy chunks", async (t) => {
    const { root, compile } = await createBrowserFixture(t);
    await Promise.all([
        writeFile(join(root, "app/startup.mjs"), 'import "./data.mjs"; void import("./bootstrap.mjs"); globalThis.loadHelp = () => import("./help.mjs");'),
        writeFile(join(root, "app/bootstrap.mjs"), 'import { snapshot } from "./data.mjs"; import { shared } from "./shared.mjs"; snapshot.then(() => console.log(shared)); globalThis.loadSettings = () => import("./settings.mjs");'),
        writeFile(join(root, "app/shared.mjs"), 'export const shared = Math.random();'),
        writeFile(join(root, "app/lazy-shared.mjs"), 'export const lazy = Math.random();'),
        writeFile(join(root, "app/settings.mjs"), 'import { shared } from "./shared.mjs"; import { lazy } from "./lazy-shared.mjs"; console.log("settings", shared, lazy);'),
        writeFile(join(root, "app/help.mjs"), 'import { lazy } from "./lazy-shared.mjs"; console.log("help", lazy);')
    ]);
    const { html, files } = await compile();
    const preloads = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((match) => match[1]);
    const ui = files.find((file) => file.startsWith("bootstrap-"));
    assert.ok(ui);
    assert.ok(preloads.includes(`browser/${ui}`));
    const startup = files.find((file) => file.startsWith("startup-"));
    assert.ok(startup);
    assert.ok(!preloads.includes(`browser/${startup}`));
    const staticDependencies = new Set();
    for (const file of [startup, ui]) {
        const source = await readFile(join(root, "browser", file), "utf8");
        for (const match of source.matchAll(/from"\.\/([^"]+)"/g)) {
            staticDependencies.add(`browser/${match[1]}`);
        }
    }
    assert.ok(staticDependencies.size >= 2, "covers startup data and UI-only shared dependencies");
    assert.deepEqual(preloads, [`browser/${ui}`, ...staticDependencies].sort());
    assert.ok(files.some((file) => file.startsWith("settings-")));
    assert.ok(files.some((file) => file.startsWith("help-")));
    assert.ok(files.length > preloads.length + 3, "lazy-only shared dependency is also emitted");
});
