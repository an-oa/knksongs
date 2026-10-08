#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { createGitHubIssueClient } from "./lib/deploy-pages-issue-client.mts";
import type { ManagedIssue } from "./lib/deploy-pages-issue-client.mts";
import {
    DEPLOYMENT_FAILURE_LABEL,
    DEPLOYMENT_FAILURE_MARKER,
    classifyDeploymentState,
    isNewerWorkflowRun
} from "./lib/deploy-pages-issue-state.mts";
import type { DeploymentJobResults } from "./lib/deploy-pages-issue-state.mts";

type RetryOptions = {
    attempts?: number,
    delayMs?: number,
    wait?: (delayMs: number) => Promise<void>
};

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2_000;

/**
 * 指定時間が経過するまで待機する。
 */
function waitFor(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * 不明なthrow値をErrorへ正規化する。
 */
function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/**
 * GitHub API操作を短いbackoff付きで再試行する。
 * 境界条件を単体テストするためexportしている。
 */
export async function retryOperation<T>(
    label: string,
    operation: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        attempts = DEFAULT_RETRY_ATTEMPTS,
        delayMs = DEFAULT_RETRY_DELAY_MS,
        wait = waitFor
    } = options;
    if (!Number.isSafeInteger(attempts) || attempts <= 0) {
        throw new Error("Retry attempts must be a positive integer");
    }
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
        throw new Error("Retry delay must be a non-negative integer");
    }

    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = normalizeError(error);
            if (attempt === attempts) break;
            const nextDelayMs = delayMs * (2 ** (attempt - 1));
            console.warn(
                `${label} failed on attempt ${attempt}/${attempts}: ${lastError.message}. ` +
                `Retrying in ${nextDelayMs} ms.`
            );
            await wait(nextDelayMs);
        }
    }

    throw new Error(
        `${label} failed after ${attempts} attempts: ${lastError?.message || "unknown error"}`,
        { cause: lastError }
    );
}

/**
 * workflow run単位の冪等性markerを作る。
 * attemptは記録するが、同じrunの再実行はmarker prefixで同一通知として扱う。
 */
export function createRunMarker(kind: "failure" | "recovery", runId: string, runAttempt: string): string {
    if (!/^[1-9][0-9]*$/.test(runId)) throw new Error("runId must be a positive integer");
    if (!/^[1-9][0-9]*$/.test(runAttempt)) {
        throw new Error("runAttempt must be a positive integer");
    }
    return `<!-- knksongs:deploy-pages-notification:${kind}:${runId}:${runAttempt} -->`;
}

/**
 * 同じworkflow runの通知を識別するmarker prefixを作る。
 */
function createRunMarkerPrefix(kind: "failure" | "recovery", runId: string): string {
    if (!/^[1-9][0-9]*$/.test(runId)) throw new Error("runId must be a positive integer");
    return `<!-- knksongs:deploy-pages-notification:${kind}:${runId}:`;
}

/**
 * ISO timestampからミリ秒を除き、Issue向けのUTC表記に揃える。
 */
function formatTimestamp(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * deploy失敗のIssue本文または追記コメントを作る。
 * 境界条件を単体テストするためexportしている。
 */
export function buildFailureReport(
    context: {
        deploySha: string,
        runId: string,
        runAttempt: string,
        runUrl: string,
        results: DeploymentJobResults
    },
    detectedAt: Date = new Date()
): string {
    return [
        createRunMarker("failure", context.runId, context.runAttempt),
        "",
        "### Deployment workflow failure",
        "",
        `- Commit: ${context.deploySha}`,
        `- Run: ${context.runUrl}`,
        `- Attempt: ${context.runAttempt}`,
        `- Resolve: ${context.results.resolve}`,
        `- Build: ${context.results.build}`,
        `- Freshness: ${context.results.freshness}`,
        `- Deploy: ${context.results.deploy}`,
        `- Verify: ${context.results.verify}`,
        `- Detected at: ${formatTimestamp(detectedAt)}`,
        ""
    ].join("\n");
}

/**
 * deploy復旧のIssueコメントを作る。
 * 境界条件を単体テストするためexportしている。
 */
export function buildRecoveryReport(
    context: { deploySha: string, runId: string, runAttempt: string, runUrl: string },
    recoveredAt: Date = new Date()
): string {
    return [
        createRunMarker("recovery", context.runId, context.runAttempt),
        "",
        "### Deployment recovered",
        "",
        `- Commit: ${context.deploySha}`,
        `- Run: ${context.runUrl}`,
        `- Attempt: ${context.runAttempt}`,
        `- Recovered at: ${formatTimestamp(recoveredAt)}`,
        ""
    ].join("\n");
}

/**
 * 専用labelと本文markerの両方を持つ自動管理Issueだけを抽出する。
 * タイトルは利用者が変更できる表示情報として識別には使わない。
 */
export function selectManagedIssues(issues: ManagedIssue[]): ManagedIssue[] {
    return issues
        .filter((issue) => {
            const labelNames = (issue.labels || []).map((label) => (
                typeof label === "string" ? label : label.name || ""
            ));
            return labelNames.includes(DEPLOYMENT_FAILURE_LABEL) &&
                String(issue.body || "").includes(DEPLOYMENT_FAILURE_MARKER);
        })
        .sort((left, right) => left.number - right.number);
}

/**
 * Issue本文またはコメントに同じworkflow runの通知markerがあるか判定する。
 */
export function hasRunNotification(
    issueBody: string | null | undefined,
    comments: Array<{ body?: string | null }>,
    kind: "failure" | "recovery",
    runId: string
): boolean {
    const markerPrefix = createRunMarkerPrefix(kind, runId);
    return [issueBody || "", ...comments.map((comment) => comment.body || "")]
        .some((body) => body.includes(markerPrefix));
}

/**
 * 同じrunのコメントがなければ冪等に追加する。
 */
async function ensureRunComment(
    client: ReturnType<typeof createGitHubIssueClient>,
    issue: { number: number, body?: string | null },
    kind: "failure" | "recovery",
    context: { runId: string },
    report: string,
    retryOptions: RetryOptions
): Promise<void> {
    await retryOperation(
        `Comment on deployment ${kind} issue #${issue.number}`,
        async () => {
            const comments = await client.listComments(issue.number);
            if (hasRunNotification(issue.body, comments, kind, context.runId)) {
                console.log(`Issue #${issue.number} already records ${kind} run ${context.runId}.`);
                return;
            }
            await client.commentIssue(issue.number, report);
        },
        retryOptions
    );
}

/**
 * deploy結果を公開Issueへ反映する。
 * GitHub API clientを注入可能にし、状態遷移と一時失敗を単体テストする。
 */
export async function updateDeploymentFailureIssue(
    context: {
        deploySha: string,
        repositoryOwner: string,
        runId: string,
        runNumber: string,
        runAttempt: string,
        runUrl: string,
        results: DeploymentJobResults,
        targetBranch?: string,
        workflowFile?: string
    },
    client: ReturnType<typeof createGitHubIssueClient>,
    options: {
        now?: () => Date,
        retry?: RetryOptions
    } = {}
): Promise<"failure" | "recovery" | "noop"> {
    const state = classifyDeploymentState(context.results);
    if (state === "noop") {
        console.log("No deployment failure or recovery to report.");
        return state;
    }

    const now = options.now || (() => new Date());
    const retryOptions = options.retry || {};
    const targetBranch = context.targetBranch || "main";
    const workflowFile = context.workflowFile || "deploy-pages.yml";
    const supersedingRun = await retryOperation(
        "Check newer Deploy Pages workflow runs",
        () => client.getNewestSupersedingWorkflowRun(workflowFile, context),
        retryOptions
    );
    if (supersedingRun && isNewerWorkflowRun(supersedingRun, context)) {
        console.log(
            `Skip stale notification run ${context.runNumber}/${context.runAttempt}; ` +
            `newer reporting run is ${supersedingRun.runNumber}/${supersedingRun.runAttempt}.`
        );
        return "noop";
    }

    const currentBranchSha = await retryOperation(
        `Check current ${targetBranch} commit`,
        () => client.getBranchSha(targetBranch),
        retryOptions
    );
    if (currentBranchSha !== context.deploySha) {
        console.log(
            `Skip stale notification target ${context.deploySha}; ` +
            `current ${targetBranch} is ${currentBranchSha}.`
        );
        return "noop";
    }

    await retryOperation(
        "Ensure deployment failure label",
        () => client.ensureLabel(),
        retryOptions
    );

    if (state === "failure") {
        const report = buildFailureReport(context, now());
        let existingIssues: ManagedIssue[] = [];
        const created = await retryOperation(
            "Create or locate deployment failure issue",
            async () => {
                existingIssues = selectManagedIssues(await client.listOpenIssues());
                if (existingIssues.length > 0) return false;
                await client.createIssue(report, context.repositoryOwner);
                return true;
            },
            retryOptions
        );
        if (created) {
            console.log("Created the deployment failure issue.");
            return state;
        }

        if (existingIssues.length > 1) {
            console.warn(
                `Found ${existingIssues.length} managed deployment failure issues; updating all of them.`
            );
        }
        for (const issue of existingIssues) {
            await retryOperation(
                `Assign deployment failure issue #${issue.number}`,
                () => client.addAssignee(issue.number, context.repositoryOwner),
                retryOptions
            );
            await ensureRunComment(client, issue, state, context, report, retryOptions);
        }
        return state;
    }

    const existingIssues = await retryOperation(
        "Find recovered deployment failure issues",
        async () => selectManagedIssues(await client.listOpenIssues()),
        retryOptions
    );
    if (existingIssues.length === 0) {
        console.log("No open deployment failure issue to close.");
        return state;
    }
    if (existingIssues.length > 1) {
        console.warn(
            `Found ${existingIssues.length} managed deployment failure issues; closing all of them.`
        );
    }

    const report = buildRecoveryReport(context, now());
    for (const issue of existingIssues) {
        await ensureRunComment(client, issue, state, context, report, retryOptions);
        await retryOperation(
            `Close recovered deployment failure issue #${issue.number}`,
            () => client.closeIssue(issue.number),
            retryOptions
        );
    }
    return state;
}

/**
 * 必須環境変数を読み込む。
 */
function requireEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entryPointUrl) {
    try {
        const context = {
            deploySha: requireEnvironmentVariable("DEPLOY_SHA"),
            repositoryOwner: requireEnvironmentVariable("REPOSITORY_OWNER"),
            runId: requireEnvironmentVariable("GITHUB_RUN_ID"),
            runNumber: requireEnvironmentVariable("GITHUB_RUN_NUMBER"),
            runAttempt: requireEnvironmentVariable("GITHUB_RUN_ATTEMPT"),
            runUrl: requireEnvironmentVariable("RUN_URL"),
            results: {
                resolve: requireEnvironmentVariable("RESOLVE_RESULT"),
                build: requireEnvironmentVariable("BUILD_RESULT"),
                freshness: requireEnvironmentVariable("FRESHNESS_RESULT"),
                deploy: requireEnvironmentVariable("DEPLOY_RESULT"),
                verify: requireEnvironmentVariable("VERIFY_RESULT")
            }
        };
        const client = createGitHubIssueClient({
            apiUrl: requireEnvironmentVariable("GITHUB_API_URL"),
            repository: requireEnvironmentVariable("GITHUB_REPOSITORY"),
            token: requireEnvironmentVariable("GH_TOKEN")
        });
        await updateDeploymentFailureIssue(context, client);
    } catch (error) {
        console.error(normalizeError(error).message);
        process.exitCode = 1;
    }
}
