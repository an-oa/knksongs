import test from "node:test";
import assert from "node:assert/strict";
import { getFakeElement, installFakeDom, invokeAsyncListener, invokeListener } from "./test-helpers.mts";

for (const kind of ["element", "document", "window"] as const) {
    test(`DOM mock: ${kind} keeps multiple listeners and removes only the requested listener`, () => {
        const cleanup = installFakeDom();
        try {
            const target = kind === "element"
                ? getFakeElement(document.createElement("button"))
                : cleanup[kind];
            const calls: string[] = [];
            const first = () => { calls.push("first"); };
            const second = () => { calls.push("second"); };
            target.addEventListener("change", first);
            target.addEventListener("change", second);
            target.addEventListener("change", first);

            invokeListener(target, "change", {});
            assert.deepEqual(calls, ["first", "second"]);

            target.removeEventListener("change", first);
            invokeListener(target, "change", {});
            assert.deepEqual(calls, ["first", "second", "second"]);

            target.removeEventListener("change", second);
            assert.equal(target._events.has("change"), false);
            assert.throws(() => invokeListener(target, "change", {}), /listener is missing/);
        } finally {
            cleanup();
        }
    });
}

test("DOM mock: dispatch starts all listeners synchronously and awaits asynchronous work", async () => {
    const cleanup = installFakeDom();
    try {
        const calls: string[] = [];
        const gate = Promise.withResolvers<void>();
        cleanup.window.addEventListener("resize", async () => {
            calls.push("first");
            await gate.promise;
            calls.push("finished");
        });
        cleanup.window.addEventListener("resize", () => { calls.push("second"); });

        const pending = invokeAsyncListener(cleanup.window, "resize", {});
        assert.deepEqual(calls, ["first", "second"]);
        gate.resolve();
        await pending;
        assert.deepEqual(calls, ["first", "second", "finished"]);
    } finally {
        cleanup();
    }
});

test("DOM mock: the synchronous helper refuses a listener whose work it cannot wait for", async () => {
    const cleanup = installFakeDom();
    try {
        const calls: string[] = [];
        const gate = Promise.withResolvers<void>();
        cleanup.window.addEventListener("resize", async () => {
            await gate.promise;
            calls.push("finished");
        });

        // 完了を待たずに先へ進むと、「まだ起きていない」ことを確かめる assert が、処理の途中で通ってしまう。
        assert.throws(
            () => invokeListener(cleanup.window, "resize", {}),
            /resize listener is asynchronous; use "await invokeAsyncListener\(\.\.\.\)"/
        );
        assert.deepEqual(calls, []);
        gate.resolve();
        await gate.promise;
    } finally {
        cleanup();
    }
});

test("DOM mock: the asynchronous helper also accepts synchronous listeners and reports a missing one", async () => {
    const cleanup = installFakeDom();
    try {
        const calls: string[] = [];
        cleanup.window.addEventListener("resize", () => { calls.push("called"); });

        const pending = invokeAsyncListener(cleanup.window, "resize", {});
        assert.deepEqual(calls, ["called"], "listeners start before the returned promise is awaited");
        assert.equal(await pending, undefined);

        await assert.rejects(invokeAsyncListener(cleanup.window, "scroll", {}), /scroll listener is missing/);
    } finally {
        cleanup();
    }
});

test("DOM mock: click dispatches all listeners and onclick", () => {
    const cleanup = installFakeDom();
    try {
        const button = document.createElement("button");
        const calls: string[] = [];
        button.addEventListener("click", () => { calls.push("first"); });
        button.addEventListener("click", () => { calls.push("second"); });
        button.onclick = () => { calls.push("onclick"); };
        button.click();
        assert.deepEqual(calls, ["first", "second", "onclick"]);
    } finally {
        cleanup();
    }
});
