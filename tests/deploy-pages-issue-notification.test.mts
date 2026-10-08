import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubIssueClient } from "../scripts/lib/deploy-pages-issue-client.mts";
import type { ManagedIssue } from "../scripts/lib/deploy-pages-issue-client.mts";
import {
    DEPLOYMENT_FAILURE_LABEL,
    DEPLOYMENT_FAILURE_MARKER,
    DEPLOYMENT_FAILURE_TITLE,
    classifyDeploymentState,
    hasReportedDeploymentState,
    isNewerWorkflowRun
} from "../scripts/lib/deploy-pages-issue-state.mts";
import {
    buildFailureReport,
    createRunMarker,
    hasRunNotification,
    retryOperation,
    selectManagedIssues,
    updateDeploymentFailureIssue
} from "../scripts/deploy-pages-issue-notification.mts";

type RecordedRequest = {
    method: string;
    path: string;
    search: string;
    body: unknown;
};

/** fetchの入力をAPI検証用の情報へ変換し、呼び出し順に記録する。 */
function recordRequest(
    requests: RecordedRequest[],
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1] = {}
): RecordedRequest {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const request: RecordedRequest = {
        method: init.method || "GET",
        path: url.pathname,
        search: url.search,
        body: typeof init.body === "string" ? JSON.parse(init.body) : null
    };
    requests.push(request);
    return request;
}

const BASE_CONTEXT = {
    deploySha: "c2abca650af9fca8ff7a2ab28627ea3c3620d9b9",
    repositoryOwner: "an-oa",
    runId: "12345",
    runNumber: "100",
    runAttempt: "1",
    runUrl: "https://github.com/an-oa/knksongs/actions/runs/12345",
    results: {
        resolve: "success",
        build: "success",
        freshness: "success",
        deploy: "success",
        verify: "success"
    }
};

const CURRENT_DEPLOYMENT_METHODS = {
    async getNewestSupersedingWorkflowRun() { return null; },
    async getBranchSha() {
        return BASE_CONTEXT.deploySha;
    }
};

test("deploy issue state: classifies expected skips, failures, recovery, and cancellation", () => {
    const cases = [
        {
            name: "outdated deployment skip",
            results: {
                resolve: "success",
                build: "skipped",
                freshness: "skipped",
                deploy: "skipped",
                verify: "skipped"
            },
            expected: "noop"
        },
        {
            name: "resolve failure",
            results: {
                resolve: "failure",
                build: "skipped",
                freshness: "skipped",
                deploy: "skipped",
                verify: "skipped"
            },
            expected: "failure"
        },
        {
            name: "build failure",
            results: {
                resolve: "success",
                build: "failure",
                freshness: "skipped",
                deploy: "skipped",
                verify: "skipped"
            },
            expected: "failure"
        },
        {
            name: "freshness failure",
            results: {
                resolve: "success",
                build: "success",
                freshness: "failure",
                deploy: "skipped",
                verify: "skipped"
            },
            expected: "failure"
        },
        {
            name: "deploy failure",
            results: {
                resolve: "success",
                build: "success",
                freshness: "success",
                deploy: "failure",
                verify: "skipped"
            },
            expected: "failure"
        },
        {
            name: "cancelled build",
            results: {
                resolve: "success",
                build: "cancelled",
                freshness: "skipped",
                deploy: "skipped",
                verify: "skipped"
            },
            expected: "failure"
        },
        {
            name: "successful recovery",
            results: BASE_CONTEXT.results,
            expected: "recovery"
        }
    ];

    for (const entry of cases) {
        assert.equal(classifyDeploymentState(entry.results), entry.expected, entry.name);
    }
});

test("deploy issue state: rejects unknown job results", () => {
    assert.throws(
        () => classifyDeploymentState({
            resolve: "success",
            build: "timed_out",
            freshness: "skipped",
            deploy: "skipped",
            verify: "skipped"
        }),
        /Unknown build job result: timed_out/
    );
    assert.throws(
        () => classifyDeploymentState({ ...BASE_CONTEXT.results, verify: "timed_out" }),
        /Unknown verify job result: timed_out/
    );
});

test("deploy issue state: rejects missing or undefined verification results", () => {
    const incompleteResults = {
        resolve: "success",
        build: "success",
        freshness: "success",
        deploy: "success"
    };
    assert.throws(
        // @ts-expect-error 現行job結果ではverifyの欠落を型検査でも拒否する。
        () => classifyDeploymentState(incompleteResults),
        /Unknown verify job result: \(empty\)/
    );
    assert.throws(
        // @ts-expect-error 現行job結果では明示的なundefinedも型検査で拒否する。
        () => classifyDeploymentState({ ...BASE_CONTEXT.results, verify: undefined }),
        /Unknown verify job result: \(empty\)/
    );
});

test("deploy issue state: waits for public verification before reporting recovery", () => {
    for (const [verify, expected] of [
        ["success", "recovery"],
        ["failure", "failure"],
        ["cancelled", "failure"],
        ["skipped", "noop"]
    ]) {
        assert.equal(classifyDeploymentState({ ...BASE_CONTEXT.results, verify }), expected);
    }
});

test("deploy issue identity: uses a dedicated label and body marker instead of the title", () => {
    const issues = [
        {
            number: 3,
            body: DEPLOYMENT_FAILURE_MARKER,
            labels: [{ name: DEPLOYMENT_FAILURE_LABEL }],
            title: "Operator-renamed incident"
        },
        {
            number: 2,
            body: DEPLOYMENT_FAILURE_MARKER,
            labels: [{ name: DEPLOYMENT_FAILURE_LABEL }],
            title: "Another managed incident"
        },
        {
            number: 1,
            body: "Manual issue",
            labels: [{ name: DEPLOYMENT_FAILURE_LABEL }],
            title: "[Workflow Failure] Deploy Pages"
        },
        {
            number: 4,
            body: DEPLOYMENT_FAILURE_MARKER,
            labels: [{ name: "workflow-failure" }],
            title: "[Workflow Failure] Deploy Pages"
        }
    ];

    assert.deepEqual(selectManagedIssues(issues).map((issue) => issue.number), [2, 3]);
});

test("deploy issue report: records the run marker, attempt, and all job results", () => {
    const report = buildFailureReport(
        {
            ...BASE_CONTEXT,
            results: {
                ...BASE_CONTEXT.results,
                deploy: "failure",
                verify: "skipped"
            }
        },
        new Date("2026-08-28T01:02:03.456Z")
    );

    assert.match(report, /knksongs:deploy-pages-notification:failure:12345:1/);
    assert.match(report, /- Attempt: 1/);
    assert.match(report, /- Deploy: failure/);
    assert.match(report, /- Verify: skipped/);
    assert.match(report, /- Detected at: 2026-08-28T01:02:03Z/);
});

test("deploy issue comments: treat another attempt of the same run as already recorded", () => {
    const comments = [{ body: createRunMarker("recovery", "12345", "1") }];

    assert.equal(hasRunNotification("", comments, "recovery", "12345"), true);
    assert.equal(hasRunNotification("", comments, "recovery", "67890"), false);
});

test("deploy issue ordering: compares new runs before attempts of the same run", () => {
    assert.equal(
        isNewerWorkflowRun(
            { runNumber: "101", runAttempt: "1" },
            { runNumber: "100", runAttempt: "20" }
        ),
        true
    );
    assert.equal(
        isNewerWorkflowRun(
            { runNumber: "100", runAttempt: "2" },
            { runNumber: "100", runAttempt: "1" }
        ),
        true
    );
    assert.equal(
        isNewerWorkflowRun(
            { runNumber: "100", runAttempt: "1" },
            { runNumber: "100", runAttempt: "1" }
        ),
        false
    );
});

test("deploy issue ordering: only completed notification jobs carry deployment state", () => {
    assert.equal(hasReportedDeploymentState([
        { name: "resolve", conclusion: "skipped" },
        { name: "build", conclusion: "skipped" },
        { name: "freshness", conclusion: "skipped" },
        { name: "deploy", conclusion: "skipped" },
        { name: "notify", conclusion: "success" }
    ]), false);
    assert.equal(hasReportedDeploymentState([
        { name: "resolve", conclusion: "cancelled" },
        { name: "build", conclusion: "skipped" },
        { name: "freshness", conclusion: "skipped" },
        { name: "deploy", conclusion: "skipped" },
        { name: "notify", conclusion: "cancelled" }
    ]), false);
    assert.equal(hasReportedDeploymentState([
        { name: "resolve", conclusion: "failure" },
        { name: "build", conclusion: "skipped" },
        { name: "freshness", conclusion: "skipped" },
        { name: "deploy", conclusion: "skipped" },
        { name: "notify", conclusion: "success" }
    ]), true);
    assert.equal(hasReportedDeploymentState([
        { name: "resolve", conclusion: "success" },
        { name: "build", conclusion: "success" },
        { name: "freshness", conclusion: "success" },
        { name: "deploy", conclusion: "success" },
        { name: "notify", conclusion: "success" }
    ]), true);
});

test("deploy issue ordering: reads separate verification and preserves historical deployment jobs", () => {
    const successfulJobs = [
        { name: "resolve", conclusion: "success" },
        { name: "build", conclusion: "success" },
        { name: "freshness", conclusion: "success" },
        { name: "deploy", conclusion: "success" },
        { name: "notify", conclusion: "success" }
    ];
    assert.equal(hasReportedDeploymentState(successfulJobs), true);
    assert.equal(hasReportedDeploymentState([
        ...successfulJobs,
        { name: "verify", conclusion: "success" }
    ]), true);
    assert.equal(hasReportedDeploymentState([
        ...successfulJobs,
        { name: "verify", conclusion: "failure" }
    ]), true);
    assert.equal(hasReportedDeploymentState([
        ...successfulJobs,
        { name: "verify", conclusion: "skipped" }
    ]), false);
    assert.equal(hasReportedDeploymentState([
        ...successfulJobs,
        { name: "verify", conclusion: null }
    ]), false);
});

test("deploy issue ordering: normalizes historical verification only at the API boundary", () => {
    for (const [deploy, expected] of [
        ["success", true],
        ["failure", true],
        ["cancelled", true],
        ["skipped", false]
    ] as const) {
        assert.equal(hasReportedDeploymentState([
            { name: "resolve", conclusion: "success" },
            { name: "build", conclusion: "success" },
            { name: "freshness", conclusion: "success" },
            { name: "deploy", conclusion: deploy },
            { name: "notify", conclusion: "success" }
        ]), expected, deploy);
    }
});

test("deploy issue API: retries temporary failures with exponential delays", async () => {
    const waitDelays: number[] = [];
    let calls = 0;

    const result = await retryOperation(
        "Temporary API operation",
        async () => {
            calls++;
            if (calls < 3) throw new Error("temporary failure");
            return "ok";
        },
        {
            attempts: 3,
            delayMs: 10,
            wait: async (delayMs) => {
                waitDelays.push(delayMs);
            }
        }
    );

    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(waitDelays, [10, 20]);
});

test("deploy issue API client: skips newer queued, cancelled, and no-op runs", async () => {
    const requests: RecordedRequest[] = [];
    let labelExists = false;
    const fetchImpl: typeof fetch = async (url, init = {}) => {
        const request = recordRequest(requests, url, init);

        if (request.path.endsWith("/actions/workflows/deploy-pages.yml/runs")) {
            if (new URLSearchParams(request.search).get("page") === "2") {
                return Response.json({
                    workflow_runs: [
                        { id: 105, run_number: 105, run_attempt: 1, status: "queued" },
                        { id: 104, run_number: 104, run_attempt: 1, status: "completed" }
                    ]
                });
            }
            return Response.json({
                workflow_runs: [
                    { id: 103, run_number: 103, run_attempt: 1, status: "completed" },
                    { id: 102, run_number: 102, run_attempt: 1, status: "completed" }
                ]
            }, {
                headers: {
                    link: "<https://api.github.test/repos/an-oa/knksongs/actions/workflows/" +
                        "deploy-pages.yml/runs?per_page=100&page=2>; rel=\"next\""
                }
            });
        }
        if (request.path.endsWith("/actions/runs/104/jobs")) {
            return Response.json({
                jobs: [
                    { name: "resolve", conclusion: "cancelled" },
                    { name: "build", conclusion: "skipped" },
                    { name: "freshness", conclusion: "skipped" },
                    { name: "deploy", conclusion: "skipped" },
                    { name: "notify", conclusion: "cancelled" }
                ]
            });
        }
        if (request.path.endsWith("/actions/runs/103/jobs")) {
            return Response.json({
                jobs: [
                    { name: "resolve", conclusion: "skipped" },
                    { name: "build", conclusion: "skipped" },
                    { name: "freshness", conclusion: "skipped" },
                    { name: "deploy", conclusion: "skipped" },
                    { name: "notify", conclusion: "success" }
                ]
            });
        }
        if (request.path.endsWith("/actions/runs/102/jobs")) {
            return Response.json({
                jobs: [
                    { name: "resolve", conclusion: "success" },
                    { name: "build", conclusion: "success" },
                    { name: "freshness", conclusion: "success" },
                    { name: "deploy", conclusion: "success" },
                    { name: "notify", conclusion: "success" }
                ]
            });
        }
        if (request.path.endsWith("/git/ref/heads/main")) {
            return Response.json({ object: { sha: BASE_CONTEXT.deploySha } });
        }
        if (request.path.endsWith(`/labels/${DEPLOYMENT_FAILURE_LABEL}`)) {
            return labelExists
                ? Response.json({ name: DEPLOYMENT_FAILURE_LABEL })
                : Response.json({ message: "Not Found" }, { status: 404 });
        }
        if (request.path.endsWith("/labels") && request.method === "POST") {
            labelExists = true;
            return Response.json(request.body, { status: 201 });
        }
        throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    };
    const client = createGitHubIssueClient({
        apiUrl: "https://api.github.test",
        repository: "an-oa/knksongs",
        token: "test-token",
        requestTimeoutMs: 100,
        createTimeoutSignal: () => new AbortController().signal,
        fetchImpl
    });

    assert.deepEqual(await client.getNewestSupersedingWorkflowRun(
        "deploy-pages.yml",
        BASE_CONTEXT
    ), {
        runId: "102",
        runNumber: "102",
        runAttempt: "1",
        status: "completed"
    });
    assert.equal(await client.getBranchSha("main"), BASE_CONTEXT.deploySha);
    await client.ensureLabel();
    await client.ensureLabel();

    assert.deepEqual(requests.map(({ method, path, search }) => [method, path, search]), [
        ["GET", "/repos/an-oa/knksongs/actions/workflows/deploy-pages.yml/runs", "?per_page=100"],
        ["GET", "/repos/an-oa/knksongs/actions/workflows/deploy-pages.yml/runs", "?per_page=100&page=2"],
        ["GET", "/repos/an-oa/knksongs/actions/runs/104/jobs", "?filter=latest&per_page=100"],
        ["GET", "/repos/an-oa/knksongs/actions/runs/103/jobs", "?filter=latest&per_page=100"],
        ["GET", "/repos/an-oa/knksongs/actions/runs/102/jobs", "?filter=latest&per_page=100"],
        ["GET", "/repos/an-oa/knksongs/git/ref/heads/main", ""],
        ["GET", `/repos/an-oa/knksongs/labels/${DEPLOYMENT_FAILURE_LABEL}`, ""],
        ["POST", "/repos/an-oa/knksongs/labels", ""],
        ["GET", `/repos/an-oa/knksongs/labels/${DEPLOYMENT_FAILURE_LABEL}`, ""]
    ]);
    assert.deepEqual(requests[7].body, {
        name: DEPLOYMENT_FAILURE_LABEL,
        color: "D73A4A",
        description: "Open while the Deploy Pages workflow is failing"
    });
});

test("deploy issue API client: uses the expected Issue paths, methods, and payloads", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
        const request = recordRequest(requests, url, init);

        if (request.method === "GET" && request.path.endsWith("/issues")) {
            return Response.json([
                { number: 7, body: DEPLOYMENT_FAILURE_MARKER, labels: [] },
                { number: 8, pull_request: { url: "https://api.github.test/pulls/8" } }
            ]);
        }
        if (request.method === "GET" && request.path.endsWith("/comments")) {
            return Response.json([{ body: "existing comment" }]);
        }
        return Response.json({}, { status: request.method === "POST" ? 201 : 200 });
    };
    const client = createGitHubIssueClient({
        apiUrl: "https://api.github.test",
        repository: "an-oa/knksongs",
        token: "test-token",
        requestTimeoutMs: 100,
        createTimeoutSignal: () => new AbortController().signal,
        fetchImpl
    });

    assert.deepEqual(await client.listOpenIssues(), [
        { number: 7, body: DEPLOYMENT_FAILURE_MARKER, labels: [] }
    ]);
    await client.createIssue("failure report", "an-oa");
    await client.addAssignee(7, "an-oa");
    assert.deepEqual(await client.listComments(7), [{ body: "existing comment" }]);
    await client.commentIssue(7, "recovery report");
    await client.closeIssue(7);

    assert.deepEqual(requests, [
        {
            method: "GET",
            path: "/repos/an-oa/knksongs/issues",
            search: `?state=open&labels=${DEPLOYMENT_FAILURE_LABEL}&per_page=100`,
            body: null
        },
        {
            method: "POST",
            path: "/repos/an-oa/knksongs/issues",
            search: "",
            body: {
                title: DEPLOYMENT_FAILURE_TITLE,
                body: `${DEPLOYMENT_FAILURE_MARKER}\nfailure report`,
                assignees: ["an-oa"],
                labels: [DEPLOYMENT_FAILURE_LABEL]
            }
        },
        {
            method: "POST",
            path: "/repos/an-oa/knksongs/issues/7/assignees",
            search: "",
            body: { assignees: ["an-oa"] }
        },
        {
            method: "GET",
            path: "/repos/an-oa/knksongs/issues/7/comments",
            search: "?per_page=100",
            body: null
        },
        {
            method: "POST",
            path: "/repos/an-oa/knksongs/issues/7/comments",
            search: "",
            body: { body: "recovery report" }
        },
        {
            method: "PATCH",
            path: "/repos/an-oa/knksongs/issues/7",
            search: "",
            body: { state: "closed", state_reason: "completed" }
        }
    ]);
});

test("deploy issue update: ignores an older run even when it targets the same commit", async () => {
    let branchChecks = 0;
    let issueWrites = 0;
    const client = {
        ...CURRENT_DEPLOYMENT_METHODS,
        async getNewestSupersedingWorkflowRun() {
            return {
                runId: "67890",
                runNumber: "101",
                runAttempt: "1",
                status: "completed"
            };
        },
        async getBranchSha() {
            branchChecks++;
            return BASE_CONTEXT.deploySha;
        },
        async ensureLabel() { issueWrites++; },
        async listOpenIssues() { issueWrites++; return []; },
        async createIssue() { issueWrites++; },
        async addAssignee() { issueWrites++; },
        async listComments() { issueWrites++; return []; },
        async commentIssue() { issueWrites++; },
        async closeIssue() { issueWrites++; }
    };

    const state = await updateDeploymentFailureIssue(
        {
            ...BASE_CONTEXT,
            results: { ...BASE_CONTEXT.results, deploy: "failure" }
        },
        client
    );

    assert.equal(state, "noop");
    assert.equal(branchChecks, 0);
    assert.equal(issueWrites, 0);
});

test("deploy issue update: keeps a failure when newer runs did not report state", async () => {
    let createdIssues = 0;
    const client = {
        ...CURRENT_DEPLOYMENT_METHODS,
        async ensureLabel() {},
        async listOpenIssues() { return []; },
        async createIssue() { createdIssues++; },
        async addAssignee() {},
        async listComments() { return []; },
        async commentIssue() {},
        async closeIssue() {}
    };

    const state = await updateDeploymentFailureIssue(
        {
            ...BASE_CONTEXT,
            results: { ...BASE_CONTEXT.results, deploy: "failure" }
        },
        client
    );

    assert.equal(state, "failure");
    assert.equal(createdIssues, 1);
});

test("deploy issue update: ignores a run whose commit is no longer main", async () => {
    let issueWrites = 0;
    const client = {
        ...CURRENT_DEPLOYMENT_METHODS,
        async getBranchSha() {
            return "1111111111111111111111111111111111111111";
        },
        async ensureLabel() { issueWrites++; },
        async listOpenIssues() { issueWrites++; return []; },
        async createIssue() { issueWrites++; },
        async addAssignee() { issueWrites++; },
        async listComments() { issueWrites++; return []; },
        async commentIssue() { issueWrites++; },
        async closeIssue() { issueWrites++; }
    };

    const state = await updateDeploymentFailureIssue(BASE_CONTEXT, client);

    assert.equal(state, "noop");
    assert.equal(issueWrites, 0);
});

test("deploy issue update: updates every matching issue when duplicates exist", async () => {
    const issues = [7, 8].map((number) => ({
        number,
        body: DEPLOYMENT_FAILURE_MARKER,
        labels: [{ name: DEPLOYMENT_FAILURE_LABEL }]
    }));
    const assigned: Array<[number, string]> = [];
    const commented: Array<[number, string]> = [];
    const client = {
        ...CURRENT_DEPLOYMENT_METHODS,
        async ensureLabel() {},
        async listOpenIssues() { return issues; },
        async createIssue() { throw new Error("must not create"); },
        async addAssignee(
            issueNumber: number,
            assignee: string
        ) { assigned.push([issueNumber, assignee]); },
        async listComments() { return []; },
        async commentIssue(
            issueNumber: number,
            body: string
        ) { commented.push([issueNumber, body]); },
        async closeIssue() { throw new Error("must not close"); }
    };

    const state = await updateDeploymentFailureIssue(
        {
            ...BASE_CONTEXT,
            results: { ...BASE_CONTEXT.results, deploy: "failure" }
        },
        client,
        { now: () => new Date("2026-08-28T01:02:03Z") }
    );

    assert.equal(state, "failure");
    assert.deepEqual(assigned, [[7, "an-oa"], [8, "an-oa"]]);
    assert.deepEqual(commented.map(([issueNumber]) => issueNumber), [7, 8]);
});

test("deploy issue creation: locates an issue created before a transient response failure", async () => {
    let issues: ManagedIssue[] = [];
    let createCalls = 0;
    let commentCalls = 0;
    const client = {
        ...CURRENT_DEPLOYMENT_METHODS,
        async ensureLabel() {},
        async listOpenIssues() { return issues; },
        async createIssue(body: string) {
            createCalls++;
            issues = [{
                number: 10,
                body: `${DEPLOYMENT_FAILURE_MARKER}\n${body}`,
                labels: [{ name: DEPLOYMENT_FAILURE_LABEL }]
            }];
            throw new Error("response lost after create");
        },
        async addAssignee() {},
        async listComments() { return []; },
        async commentIssue() { commentCalls++; },
        async closeIssue() { throw new Error("must not close"); }
    };

    const state = await updateDeploymentFailureIssue(
        {
            ...BASE_CONTEXT,
            results: { ...BASE_CONTEXT.results, deploy: "failure" }
        },
        client,
        {
            now: () => new Date("2026-08-28T01:02:03Z"),
            retry: { attempts: 2, delayMs: 0, wait: async () => {} }
        }
    );

    assert.equal(state, "failure");
    assert.equal(createCalls, 1);
    assert.equal(commentCalls, 0);
});

test("deploy issue recovery: retries close and avoids duplicate comments across reruns", async () => {
    const recoveryMarker = createRunMarker("recovery", BASE_CONTEXT.runId, "1");
    const issue = {
        number: 9,
        body: DEPLOYMENT_FAILURE_MARKER,
        labels: [{ name: DEPLOYMENT_FAILURE_LABEL }]
    };
    const waitDelays: number[] = [];
    let closeCalls = 0;
    let commentCalls = 0;
    const client = {
        ...CURRENT_DEPLOYMENT_METHODS,
        async ensureLabel() {},
        async listOpenIssues() { return [issue]; },
        async createIssue() { throw new Error("must not create"); },
        async addAssignee() { throw new Error("must not assign"); },
        async listComments() { return [{ body: recoveryMarker }]; },
        async commentIssue() { commentCalls++; },
        async closeIssue() {
            closeCalls++;
            if (closeCalls < 3) throw new Error("temporary close failure");
        }
    };

    const state = await updateDeploymentFailureIssue(
        { ...BASE_CONTEXT, runAttempt: "2" },
        client,
        {
            now: () => new Date("2026-08-28T01:02:03Z"),
            retry: {
                attempts: 3,
                delayMs: 10,
                wait: async (delayMs) => {
                    waitDelays.push(delayMs);
                }
            }
        }
    );

    assert.equal(state, "recovery");
    assert.equal(commentCalls, 0);
    assert.equal(closeCalls, 3);
    assert.deepEqual(waitDelays, [10, 20]);
});

test("deploy issue recovery: fails when closing the issue never succeeds", async () => {
    const issue = {
        number: 11,
        body: DEPLOYMENT_FAILURE_MARKER,
        labels: [{ name: DEPLOYMENT_FAILURE_LABEL }]
    };
    const client = {
        ...CURRENT_DEPLOYMENT_METHODS,
        async ensureLabel() {},
        async listOpenIssues() { return [issue]; },
        async createIssue() { throw new Error("must not create"); },
        async addAssignee() { throw new Error("must not assign"); },
        async listComments() { return []; },
        async commentIssue() {},
        async closeIssue() { throw new Error("permanent close failure"); }
    };

    await assert.rejects(
        updateDeploymentFailureIssue(
            BASE_CONTEXT,
            client,
            {
                retry: { attempts: 2, delayMs: 0, wait: async () => {} }
            }
        ),
        /Close recovered deployment failure issue #11 failed after 2 attempts/
    );
});
