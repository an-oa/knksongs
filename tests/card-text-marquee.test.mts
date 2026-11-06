import test from "node:test";
import assert from "node:assert/strict";
import { bindCardTextMarquee, stopCardTextMarquee } from "../app/lib/render/card-text-marquee.mts";
import { getFakeElement, installFakeDom, invokeListener } from "./test-helpers.mts";

const MARQUEE_ANIMATION_ID = "card-text-marquee";
const MARQUEE_CLASS = "is-marquee-scrolling";

type MockAnimation = {
    id: string;
    cancelled: boolean;
    cancel(): void;
    addEventListener(type: string, listener: () => void): void;
    /** 流し終えたときの通知を、テストから好きな時点で送る。 */
    notifyFinish(): void;
};

type AnimateCall = {
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
    options: number | KeyframeAnimationOptions | undefined;
};

/**
 * 1 行の幅で切る外側の要素と、文字を入れる内側の要素を作る。
 * 外側は文字全体の幅と表示幅を持ち、内側の animate と getAnimations は記録するモックに差し替える。
 * @param scrollWidth 文字全体の幅
 * @param clientWidth 外側の要素の表示幅
 * @returns 流す対象と、animate の呼び出しと、動いているアニメーション
 */
function createTextTarget(scrollWidth: number, clientWidth = 200) {
    const box = document.createElement("div");
    const text = document.createElement("span");
    box.appendChild(text);
    const fakeBox = getFakeElement(box);
    fakeBox._clientWidth = clientWidth;
    Object.defineProperty(fakeBox, "scrollWidth", { value: scrollWidth });
    const calls: AnimateCall[] = [];
    const running: MockAnimation[] = [];
    text.animate = (keyframes, options) => {
        calls.push({ keyframes, options });
        const finishListeners: Array<() => void> = [];
        const animation: MockAnimation = {
            id: "",
            cancelled: false,
            cancel() {
                this.cancelled = true;
                running.splice(running.indexOf(this), 1);
            },
            addEventListener(type, listener) {
                if (type === "finish") finishListeners.push(listener);
            },
            notifyFinish() {
                if (running.includes(this)) running.splice(running.indexOf(this), 1);
                finishListeners.forEach((listener) => listener());
            }
        };
        running.push(animation);
        return animation as unknown as Animation;
    };
    text.getAnimations = () => running as unknown as Animation[];
    return { target: { box, text }, calls, running };
}

/**
 * 曲名とアーティスト名を持つカードに、文字を流す処理を付ける。
 * @param titleWidth 曲名全体の幅
 * @param artistWidth アーティスト名全体の幅
 */
function createCard(titleWidth: number, artistWidth: number) {
    const card = document.createElement("li");
    const title = createTextTarget(titleWidth);
    const artist = createTextTarget(artistWidth);
    bindCardTextMarquee(card, [title.target, artist.target]);
    return { card, title, artist };
}

test("card text marquee: scrolls only the names that do not fit while a mouse points at the card", () => {
    const cleanup = installFakeDom();
    try {
        // 曲名は 80px はみ出し、アーティスト名はちょうど収まる。
        const { card, title, artist } = createCard(280, 200);

        void invokeListener(card, "pointerenter", { pointerType: "mouse" });

        // 1 回分は、先頭で 0.5 秒かけて表し、1 秒止め、80px を 1 秒に 40px で 2 秒かけて流し、末尾で 1 秒止め、0.5 秒かけて消す。
        // 1 回目は表し終えた所から始め、最後は 4 回目の表し終えた所で終わる。
        assert.deepEqual(title.calls, [{
            keyframes: [
                { offset: 0, transform: "translateX(0px)", opacity: 0 },
                { offset: 0.1, transform: "translateX(0px)", opacity: 1 },
                { offset: 0.3, transform: "translateX(0px)", opacity: 1 },
                { offset: 0.7, transform: "translateX(-80px)", opacity: 1 },
                { offset: 0.9, transform: "translateX(-80px)", opacity: 1 },
                { offset: 1, transform: "translateX(-80px)", opacity: 0 }
            ],
            options: { duration: 5000, iterations: 3, iterationStart: 0.1 }
        }]);
        assert.equal(title.running[0].id, MARQUEE_ANIMATION_ID);
        assert.equal(title.target.box.classList.contains(MARQUEE_CLASS), true);
        assert.deepEqual(artist.calls, []);
        assert.equal(artist.target.box.classList.contains(MARQUEE_CLASS), false);
    } finally {
        cleanup();
    }
});

test("card text marquee: does not scroll for a touch or when reduced motion is preferred", () => {
    const cleanup = installFakeDom();
    try {
        const { card, title } = createCard(280, 200);
        void invokeListener(card, "pointerenter", { pointerType: "touch" });
        assert.deepEqual(title.calls, []);

        window.matchMedia = (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }) as unknown as MediaQueryList;
        void invokeListener(card, "pointerenter", { pointerType: "mouse" });
        assert.deepEqual(title.calls, []);
        assert.equal(title.target.box.classList.contains(MARQUEE_CLASS), false);
    } finally {
        cleanup();
    }
});

test("card text marquee: leaving the card stops only the name scroll and brings back the ellipsis", () => {
    const cleanup = installFakeDom();
    try {
        const { card, title } = createCard(280, 200);
        const other = { id: "other", cancelled: false, cancel() { this.cancelled = true; } };
        title.running.push(other as unknown as MockAnimation);
        void invokeListener(card, "pointerenter", { pointerType: "mouse" });
        const marquee = title.running.find((animation) => animation.id === MARQUEE_ANIMATION_ID);

        void invokeListener(card, "pointerleave", { pointerType: "mouse" });

        assert.equal(marquee?.cancelled, true);
        assert.equal(other.cancelled, false);
        assert.equal(title.target.box.classList.contains(MARQUEE_CLASS), false);
    } finally {
        cleanup();
    }
});

test("card text marquee: finishing brings back the ellipsis unless a new scroll has started", () => {
    const cleanup = installFakeDom();
    try {
        const { card, title } = createCard(280, 200);
        void invokeListener(card, "pointerenter", { pointerType: "mouse" });
        const first = title.running[0];

        // 終わりの通知が届く前に、カードから離れてもう一度指し、流し直す。
        void invokeListener(card, "pointerleave", { pointerType: "mouse" });
        void invokeListener(card, "pointerenter", { pointerType: "mouse" });
        const second = title.running[0];
        first.notifyFinish();
        assert.equal(first.cancelled, true);
        assert.equal(title.target.box.classList.contains(MARQUEE_CLASS), true, "the new scroll keeps the ellipsis hidden");

        second.notifyFinish();
        assert.equal(title.target.box.classList.contains(MARQUEE_CLASS), false);
    } finally {
        cleanup();
    }
});

/**
 * カード内に、フォーカスを受けられる要素を足す。
 * @param card 結果カード
 * @param isFocusVisible キーボードでフォーカスしたとき (:focus-visible に一致するとき) は true
 * @returns 足した要素
 */
function appendFocusable(card: HTMLElement, isFocusVisible: boolean) {
    const el = document.createElement("a");
    getFakeElement(el).matches = (selector) => selector === ":focus-visible" && isFocusVisible;
    card.appendChild(el);
    return el;
}

test("card text marquee: scrolls while keyboard focus stays in the card and stops when it leaves", () => {
    const cleanup = installFakeDom();
    try {
        const { card, title } = createCard(280, 200);
        const link = appendFocusable(card, true);
        const button = appendFocusable(card, true);
        const outside = document.createElement("a");

        void invokeListener(card, "focusin", { target: link });
        assert.equal(title.calls.length, 1);
        const marquee = title.running[0];

        // カード内のリンクからボタンへ移っても、流している途中から先頭へ戻さない。
        void invokeListener(card, "focusout", { target: link, relatedTarget: button });
        void invokeListener(card, "focusin", { target: button });
        assert.equal(title.calls.length, 1);
        assert.equal(marquee.cancelled, false);

        void invokeListener(card, "focusout", { target: button, relatedTarget: outside });
        assert.equal(marquee.cancelled, true);
        assert.equal(title.target.box.classList.contains(MARQUEE_CLASS), false);
    } finally {
        cleanup();
    }
});

test("card text marquee: focus from a mouse click or with reduced motion does not scroll", () => {
    const cleanup = installFakeDom();
    try {
        const { card, title } = createCard(280, 200);
        const clicked = appendFocusable(card, false);
        void invokeListener(card, "focusin", { target: clicked });
        assert.deepEqual(title.calls, []);

        window.matchMedia = (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }) as unknown as MediaQueryList;
        const focused = appendFocusable(card, true);
        void invokeListener(card, "focusin", { target: focused });
        assert.deepEqual(title.calls, []);
    } finally {
        cleanup();
    }
});

test("card text marquee: keeps scrolling until both the pointer and keyboard focus leave the card", () => {
    const cleanup = installFakeDom();
    try {
        const { card, title } = createCard(280, 200);
        const link = appendFocusable(card, true);

        // 指してからフォーカスし、指すのをやめてもフォーカスが残る間は流す。
        void invokeListener(card, "pointerenter", { pointerType: "mouse" });
        void invokeListener(card, "focusin", { target: link });
        assert.equal(title.calls.length, 1, "focusing while pointing does not restart the scroll");
        void invokeListener(card, "pointerleave", { pointerType: "mouse" });
        assert.equal(title.running[0]?.cancelled, false);
        void invokeListener(card, "focusout", { target: link, relatedTarget: null });
        assert.equal(title.running.length, 0);

        // フォーカスしてから指し、フォーカスが外れても指している間は流す。
        void invokeListener(card, "focusin", { target: link });
        const marquee = title.running[0];
        void invokeListener(card, "pointerenter", { pointerType: "mouse" });
        void invokeListener(card, "focusout", { target: link, relatedTarget: null });
        assert.equal(marquee.cancelled, false);
        void invokeListener(card, "pointerleave", { pointerType: "mouse" });
        assert.equal(marquee.cancelled, true);
    } finally {
        cleanup();
    }
});

test("card text marquee: stopping works where Web Animations are not available", () => {
    const cleanup = installFakeDom();
    try {
        const box = document.createElement("div");
        const text = document.createElement("span");
        box.appendChild(text);
        box.classList.add(MARQUEE_CLASS);
        stopCardTextMarquee({ box, text });
        assert.equal(box.classList.contains(MARQUEE_CLASS), false);
    } finally {
        cleanup();
    }
});
