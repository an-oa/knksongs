import test from "node:test";
import assert from "node:assert/strict";
import {
    createDeploymentMarker,
    parseArgs,
    resolvePagesArtifactOutputDir,
    resolvePagesArtifactSiteDir
} from "../scripts/build-pages-artifact.mjs";





test("pages artifact: reads source site directory from arguments", () => {
    assert.deepEqual(
        parseArgs(["--site-dir", "_build"], { DEPLOY_CACHE_BUSTER: "abc123" }),
        {
            outputDir: "_site",
            siteDir: "_build",
            deploymentSha: ""
        }
    );
});

test("pages artifact: records deployment SHA without rewriting assets", () => {
    assert.deepEqual(
        parseArgs([], {
            DEPLOY_CACHE_BUSTER: "asset-version",
            DEPLOY_SHA: "c2abca650af9fca8ff7a2ab28627ea3c3620d9b9"
        }),
        {
            outputDir: "_site",
            siteDir: "_build",
            deploymentSha: "c2abca650af9fca8ff7a2ab28627ea3c3620d9b9"
        }
    );
    assert.equal(
        createDeploymentMarker("c2abca650af9fca8ff7a2ab28627ea3c3620d9b9"),
        '{"sha":"c2abca650af9fca8ff7a2ab28627ea3c3620d9b9"}\n'
    );
});

test("pages artifact: resolves output directories inside the project root", () => {
    assert.equal(
        resolvePagesArtifactOutputDir("_site", "/repo/knksongs"),
        "/repo/knksongs/_site"
    );
    assert.equal(
        resolvePagesArtifactOutputDir("_site/pages", "/repo/knksongs"),
        "/repo/knksongs/_site/pages"
    );
});

test("pages artifact: resolves source site directories inside the project root", () => {
    assert.equal(
        resolvePagesArtifactSiteDir(".", "/repo/knksongs"),
        "/repo/knksongs"
    );
    assert.equal(
        resolvePagesArtifactSiteDir("_build", "/repo/knksongs"),
        "/repo/knksongs/_build"
    );
});

test("pages artifact: rejects unsafe output directories", () => {
    assert.throws(
        () => resolvePagesArtifactOutputDir(".", "/repo/knksongs"),
        /must not target the project root/
    );
    assert.throws(
        () => resolvePagesArtifactOutputDir("../outside", "/repo/knksongs"),
        /must stay inside the project root/
    );
    assert.throws(
        () => resolvePagesArtifactOutputDir("app", "/repo/knksongs"),
        /must be _site or its child directory/
    );
    assert.throws(
        () => resolvePagesArtifactOutputDir("data", "/repo/knksongs"),
        /must be _site or its child directory/
    );
    assert.throws(
        () => resolvePagesArtifactOutputDir(".git", "/repo/knksongs"),
        /must be _site or its child directory/
    );
    assert.throws(
        () => resolvePagesArtifactOutputDir("_site/.git", "/repo/knksongs"),
        /must not include dot directories/
    );
});

test("pages artifact: rejects unsafe source site directories", () => {
    assert.throws(
        () => resolvePagesArtifactSiteDir("../outside", "/repo/knksongs"),
        /must stay inside the project root/
    );
    assert.throws(
        () => resolvePagesArtifactSiteDir(".git", "/repo/knksongs"),
        /must not include dot directories/
    );
});
