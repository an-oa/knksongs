import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/**
 * 起動出力と UI の静的依存を一度に解決し、後から使う dynamic import は preload しない。
 * @param {import("esbuild").Metafile} metafile
 * @param {string} outputDir
 * @returns {{ startupPath: string, preloadPaths: string[] }}
 */
function resolveStartupOutputs(metafile, outputDir) {
    const outputs = new Map(Object.entries(metafile.outputs).map(([path, output]) => [resolve(path), output]));
    const roots = ["app/startup.mjs", "app/bootstrap.mjs"].map((entry) => {
        const sourcePath = resolve(outputDir, entry);
        const match = [...outputs].find(([, output]) => output.entryPoint && resolve(output.entryPoint) === sourcePath);
        if (!match) throw new Error(`Missing browser startup output for ${entry}`);
        return match[0];
    });
    const visited = new Set();
    /** @param {string} path */
    function visit(path) {
        if (visited.has(path)) return;
        visited.add(path);
        for (const dependency of outputs.get(path)?.imports || []) {
            if (!dependency.external && dependency.kind === "import-statement") {
                visit(resolve(dependency.path));
            }
        }
    }
    roots.forEach(visit);
    visited.delete(roots[0]);
    return {
        startupPath: relative(outputDir, roots[0]).split(sep).join("/"),
        preloadPaths: [...visited].map((path) => relative(outputDir, path).split(sep).join("/")).sort()
    };
}

/**
 * TypeScript emit 済みの起動 module を、データ取得・UI・共有処理の browser bundle にまとめる。
 * _build/app は Node tests と scripts 用の emit 結果として保つ。
 * @param {string} outputDir 検証済みの site build directory
 * @param {{ cacheBuster?: string }} [options] 明示バージョンは生成内容に含め、URLの決定はesbuildに任せる
 * @returns {Promise<void>}
 */
export async function buildBrowserModules(outputDir, { cacheBuster = "" } = {}) {
    const result = await build({
        entryPoints: [join(outputDir, "app/startup.mjs")],
        outdir: join(outputDir, "browser"),
        bundle: true,
        splitting: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        outExtension: { ".js": ".mjs" },
        entryNames: "[name]-[hash]",
        chunkNames: "[name]-[hash]",
        minify: true,
        metafile: true,
        banner: { js: "// Generated browser bundle. Do not edit; run npm run build." +
            (cacheBuster ? `\n// Build version: ${JSON.stringify(cacheBuster)}` : "") }
    });
    const { startupPath, preloadPaths } = resolveStartupOutputs(result.metafile, outputDir);
    // 起動時に dynamic import する UI と静的な共有依存を HTML から発見できるようにする。
    // modulepreload は実行しないため、データ取得の開始は小さい startup module が担う。
    const preloads = preloadPaths
        .map((filePath) => `  <link rel="modulepreload" href="${filePath}">`)
        .join("\n");
    const htmlPath = join(outputDir, "index.html");
    const cssHash = cacheBuster || createHash("sha256").update(await readFile(join(outputDir, "styles.css"))).digest("hex");
    const html = (await readFile(htmlPath, "utf8"))
        .replace('href="styles.css"', `href="styles.css?v=${encodeURIComponent(cssHash)}"`);
    const entry = '  <script type="module" src="app/startup.mjs"></script>';
    if (!html.includes(entry)) throw new Error("Missing browser startup script in index.html");
    await writeFile(htmlPath, html.replace(entry, [
        preloads,
        `  <script type="module" src="${startupPath}"></script>`
    ].join("\n")), "utf8");
}
