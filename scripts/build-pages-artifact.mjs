#!/usr/bin/env node

import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveProjectPath } from "./lib/paths.mjs";
import {
    DATA_ASSET_FILES,
    ROOT_ASSET_FILES
} from "./lib/site-assets.mjs";

const DEFAULT_OUTPUT_DIR = "_site";
const DEFAULT_SITE_DIR = "_build";
const DEPLOYMENT_MARKER_FILE = "deployment.json";

/**
 * 公開済みcommitを識別するmarker JSONを作る。
 * @param {string} deploymentSha
 * @returns {string}
 */
export function createDeploymentMarker(deploymentSha) {
    return `${JSON.stringify({ sha: deploymentSha })}\n`;
}

/**
 * CLI 引数と環境変数から artifact 生成オプションを作る。
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {{ outputDir: string, siteDir: string, deploymentSha: string }}
 */
export function parseArgs(args, env = process.env) {
    const options = {
        outputDir: env.PAGES_ARTIFACT_DIR || DEFAULT_OUTPUT_DIR,
        siteDir: env.PAGES_SITE_DIR || DEFAULT_SITE_DIR,
        deploymentSha: env.DEPLOY_SHA || ""
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        if (arg === "--output-dir") {
            if (!next) throw new Error("--output-dir requires a directory path");
            options.outputDir = next;
            i++;
            continue;
        }
        if (arg === "--site-dir") {
            if (!next) throw new Error("--site-dir requires a directory path");
            options.siteDir = next;
            i++;
            continue;
        }
        if (arg === "--deployment-sha") {
            if (!next) throw new Error("--deployment-sha requires a commit SHA");
            options.deploymentSha = next;
            i++;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    options.deploymentSha = options.deploymentSha.trim();
    if (options.deploymentSha && !/^[0-9a-f]{7,64}$/i.test(options.deploymentSha)) {
        throw new Error("DEPLOY_SHA must be a hexadecimal commit SHA");
    }
    return options;
}

/**
 * artifact 出力先を安全な project root 配下の directory に解決する。
 * 本番 artifact 生成で rm の対象を限定し、境界条件を単体テストするため export している。
 * @param {string} outputDir
 * @param {string} [rootDir]
 * @returns {string}
 */
export function resolvePagesArtifactOutputDir(outputDir, rootDir = process.cwd()) {
    return resolveProjectPath({
        targetPath: outputDir,
        rootDir,
        pathLabel: "Pages artifact output directory",
        requiredTopLevelDirectory: DEFAULT_OUTPUT_DIR
    });
}

/**
 * artifact の入力元となる静的 site directory を project root 配下に解決する。
 * @param {string} siteDir
 * @param {string} [rootDir]
 * @returns {string}
 */
export function resolvePagesArtifactSiteDir(siteDir, rootDir = process.cwd()) {
    return resolveProjectPath({
        targetPath: siteDir,
        rootDir,
        pathLabel: "Pages artifact site directory",
        allowProjectRoot: true
    });
}

/**
 * 公開に必要な静的ファイルを artifact directory へコピーする。
 * @param {string} outputDir
 * @param {string} siteDir
 * @returns {Promise<void>}
 */
async function copySiteAssets(outputDir, siteDir) {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(join(outputDir, "data"), { recursive: true });
    await Promise.all(ROOT_ASSET_FILES.map((fileName) => (
        copyFile(join(siteDir, fileName), join(outputDir, fileName))
    )));
    await cp(join(siteDir, "browser"), join(outputDir, "browser"), { recursive: true });
    await Promise.all(DATA_ASSET_FILES.map((fileName) => (
        copyFile(join(siteDir, "data", fileName), join(outputDir, "data", fileName))
    )));
}

/**
 * GitHub Pages へ upload する静的 artifact を生成する。
 * @param {{ outputDir: string, siteDir?: string, deploymentSha?: string }} options
 * @returns {Promise<string>}
 */
export async function buildPagesArtifact(options) {
    const outputDir = resolvePagesArtifactOutputDir(options.outputDir);
    const siteDir = resolvePagesArtifactSiteDir(options.siteDir || DEFAULT_SITE_DIR);
    await copySiteAssets(outputDir, siteDir);
    if (options.deploymentSha) {
        await writeFile(
            join(outputDir, DEPLOYMENT_MARKER_FILE),
            createDeploymentMarker(options.deploymentSha),
            "utf8"
        );
    }
    return outputDir;
}

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entryPointUrl) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const outputDir = await buildPagesArtifact(options);
        console.log(`Prepared Pages artifact: ${outputDir}`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
