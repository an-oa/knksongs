import test from "node:test";
import assert from "node:assert/strict";
import { waitForElementMostlyVisible } from "../app/lib/element-visibility.mts";
import { installFakeDom, installFakeIntersectionObservers, installFakeTimeouts } from "./test-helpers.mts";

/**
 * Promise がまだ決まっていないかを、マイクロタスクを 1 回進めてから調べる。
 * @param promise 調べる Promise
 * @returns まだ決まっていなければ true
 */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
    let isSettled = false;
    void promise.then(() => { isSettled = true; });
    await Promise.resolve();
    return !isSettled;
}

test("element visibility: resolves once more than half of the element is visible below the header", async (t) => {
    t.after(installFakeDom());
    const intersectionObservers = installFakeIntersectionObservers();
    t.after(() => intersectionObservers.cleanup());
    const fakeTimeouts = installFakeTimeouts();
    t.after(() => fakeTimeouts.cleanup());
    const element = document.createElement("div");

    const waiting = waitForElementMostlyVisible(element, { topInset: 64, timeoutMs: 5000 });
    const [observer] = intersectionObservers.observers;

    assert.ok(observer);
    assert.deepEqual(observer.targets, [element]);
    assert.equal(observer.rootMargin, "-64px 0px 0px 0px");
    assert.equal(fakeTimeouts.timeoutCalls[0]?.delay, 5000);

    observer.trigger(0.5);
    assert.equal(await isPending(waiting), true, "exactly half is not more than half");

    observer.trigger(0.8);
    assert.equal(await waiting, true);
    assert.equal(observer.disconnected, true);
    assert.equal(fakeTimeouts.timeoutCalls[0]?.cleared, true);
});

test("element visibility: resolves false when the element does not become mostly visible in time", async (t) => {
    t.after(installFakeDom());
    const intersectionObservers = installFakeIntersectionObservers();
    t.after(() => intersectionObservers.cleanup());
    const fakeTimeouts = installFakeTimeouts();
    t.after(() => fakeTimeouts.cleanup());
    const element = document.createElement("div");

    const waiting = waitForElementMostlyVisible(element, { topInset: Number.NaN, timeoutMs: 5000 });
    const [observer] = intersectionObservers.observers;
    assert.ok(observer);
    assert.equal(observer.rootMargin, "0px 0px 0px 0px", "an unusable inset is treated as no header");

    observer.trigger(0.3);
    assert.equal(await isPending(waiting), true);

    fakeTimeouts.timeoutCalls[0]?.cb();
    assert.equal(await waiting, false);
    assert.equal(observer.disconnected, true);

    observer.trigger(1);
    assert.equal(await waiting, false, "a late notice does not change the result");
});
