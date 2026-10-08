export const DEPLOYMENT_FAILURE_LABEL = "deploy-pages-failure";
export const DEPLOYMENT_FAILURE_MARKER = "<!-- knksongs:deploy-pages-failure -->";
export const DEPLOYMENT_FAILURE_TITLE = "[Workflow Failure] Deploy Pages";

export type DeploymentJobResults = {
    resolve: string,
    build: string,
    freshness: string,
    deploy: string,
    verify: string
};
export type WorkflowRunOrder = { runNumber: string, runAttempt: string };

const NOTIFY_JOB_NAME = "notify";
const JOB_NAMES = ["resolve", "build", "freshness", "deploy", "verify"] as const;
const JOB_RESULTS = new Set(["success", "failure", "cancelled", "skipped"]);

/**
 * job結果からIssueへ反映する状態遷移を決める。
 * 古いdeploy対象によるskipは無視し、cancelは未完了としてfailure扱いにする。
 */
export function classifyDeploymentState(results: DeploymentJobResults): "failure" | "recovery" | "noop" {
    for (const jobName of JOB_NAMES) {
        const result = results[jobName];
        if (!JOB_RESULTS.has(result)) {
            throw new Error(`Unknown ${jobName} job result: ${result || "(empty)"}`);
        }
    }

    const resultValues = JOB_NAMES.map((jobName) => results[jobName]);
    if (resultValues.some((result) => result === "failure" || result === "cancelled")) {
        return "failure";
    }
    if (results.deploy === "success" && results.verify === "success") {
        return "recovery";
    }
    return "noop";
}

/**
 * workflow runの連番と再実行回数を比較する。
 * run_numberは新規runごと、run_attemptは同じrunの再実行ごとに増加する。
 */
export function isNewerWorkflowRun(candidate: WorkflowRunOrder, reference: WorkflowRunOrder): boolean {
    for (const value of [
        candidate.runNumber,
        candidate.runAttempt,
        reference.runNumber,
        reference.runAttempt
    ]) {
        if (!/^[1-9][0-9]*$/.test(value)) {
            throw new Error(`Workflow run order must be a positive integer: ${value || "(empty)"}`);
        }
    }
    const candidateRunNumber = BigInt(candidate.runNumber);
    const referenceRunNumber = BigInt(reference.runNumber);
    if (candidateRunNumber !== referenceRunNumber) {
        return candidateRunNumber > referenceRunNumber;
    }
    return BigInt(candidate.runAttempt) > BigInt(reference.runAttempt);
}

/**
 * REST APIのjob conclusionをneeds contextと同じ4状態へ正規化する。
 */
function normalizeJobResult(conclusion: unknown): "success" | "failure" | "cancelled" | "skipped" | null {
    if (conclusion === "success" || conclusion === "cancelled" || conclusion === "skipped") {
        return conclusion;
    }
    return typeof conclusion === "string" && conclusion ? "failure" : null;
}

/**
 * 完了済みrunのjob一覧から、failureまたはrecovery通知が成功したか判定する。
 * APIクライアントから利用し、通知完了状態の判定を共有する。
 */
export function hasReportedDeploymentState(jobs: unknown[]): boolean {
    const conclusions = new Map<string, unknown>();
    for (const job of jobs) {
        if (!job || typeof job !== "object" ||
            !("name" in job) || typeof job.name !== "string" || !("conclusion" in job)) {
            continue;
        }
        conclusions.set(job.name, job.conclusion);
    }
    if (conclusions.get(NOTIFY_JOB_NAME) !== "success") return false;

    const resolve = normalizeJobResult(conclusions.get("resolve"));
    const build = normalizeJobResult(conclusions.get("build"));
    const freshness = normalizeJobResult(conclusions.get("freshness"));
    const deploy = normalizeJobResult(conclusions.get("deploy"));
    if (resolve === null || build === null || freshness === null || deploy === null) return false;
    // verifyのない旧runでは公開検証もdeploy内で完了していたため、API読込境界で補正する。
    // 旧workflow runとの互換を打ち切る際は、欠落時もnullとして扱える。
    const verify = conclusions.has("verify") ? normalizeJobResult(conclusions.get("verify")) : deploy;
    if (verify === null) return false;
    return classifyDeploymentState({ resolve, build, freshness, deploy, verify }) !== "noop";
}
