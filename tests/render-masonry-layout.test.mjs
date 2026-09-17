import test from "node:test";
import assert from "node:assert/strict";
import {
    applyMasonryLayout,
    estimateInitialResultDisplayCount,
    estimateMasonryVisibleCardCount,
    getMasonryColumnCount
} from "../_build/app/lib/render/masonry-layout.mjs";
import { installFakeDom, setGlobalValue } from "./test-helpers.mjs";

test("render masonry: column count follows available width and minimum card width", () => {
    assert.equal(getMasonryColumnCount(1920), 6);
    assert.equal(getMasonryColumnCount(1400), 4);
    assert.equal(getMasonryColumnCount(1000), 3);
    assert.equal(getMasonryColumnCount(600), 2);
    assert.equal(getMasonryColumnCount(305), 1);
    assert.equal(getMasonryColumnCount(0), 1);
});

test("render masonry: one column uses natural height and clears previous absolute placement", () => {
    const cleanup = installFakeDom();
    try {
        const container = document.createElement("div");
        container._clientWidth = 700;
        const cards = [100, 200, 80].map((height) => {
            const card = document.createElement("div");
            card.className = "song-card";
            card._scrollHeight = height;
            container.appendChild(card);
            return card;
        });
        applyMasonryLayout(container);
        assert.equal(container.dataset.layoutColumns, "2");
        assert.equal(container.style.height, "200px");

        container._clientWidth = 350;
        for (const card of cards) {
            Object.defineProperty(card, "scrollHeight", {
                configurable: true,
                get() { throw new Error("single-column cards must not be measured"); }
            });
        }
        applyMasonryLayout(container);
        assert.equal(container.dataset.layoutColumns, "1");
        assert.equal(container.style.height, "");
        for (const card of cards) {
            assert.equal(card.style.width, "");
            assert.equal(card.style.top, "");
            assert.equal(card.style.left, "");
            assert.equal(card.style.transform, "");
            assert.equal(card.dataset.layoutColumn, "0");
            delete card.scrollHeight;
        }

        container._clientWidth = 700;
        applyMasonryLayout(container);
        assert.equal(container.dataset.layoutColumns, "2");
        assert.equal(container.style.height, "200px");
        assert.equal(cards[2].style.top, "112px");
    } finally {
        cleanup();
    }
});

test("render masonry: measures all new widths before writing any card positions", () => {
    const cleanup = installFakeDom();
    try {
        const container = document.createElement("div");
        container._clientWidth = 700;
        const cards = Array.from({ length: 3 }, () => {
            const card = document.createElement("div");
            card.className = "song-card";
            container.appendChild(card);
            return card;
        });
        let reads = 0;
        cards.forEach((card) => Object.defineProperty(card, "scrollHeight", {
            get() {
                reads += 1;
                assert.ok(cards.every((node) => node.style.width === "344px"));
                assert.ok(cards.every((node) => !node.style.top), "no position writes between height reads");
                return 100;
            }
        }));
        applyMasonryLayout(container);
        assert.equal(reads, cards.length);
        assert.equal(cards[2].style.top, "112px");
    } finally {
        cleanup();
    }
});

test("render masonry: initial single-column count follows height and thumbnail visibility", () => {
    const cleanup = installFakeDom();
    try {
        const container = document.createElement("div");
        container._clientWidth = 350;
        container._rect = { top: 100, bottom: 100, left: 0, right: 350, width: 350, height: 0 };
        const options = { defaultCount: 48, showThumbnails: false, viewportHeight: 850 };
        assert.equal(estimateInitialResultDisplayCount(container, options), 19);
        assert.equal(estimateInitialResultDisplayCount(container, { ...options, showThumbnails: true }), 12);
        assert.equal(estimateInitialResultDisplayCount(container, { ...options, viewportHeight: 3000 }), 48);
        assert.equal(estimateInitialResultDisplayCount(container, { ...options, viewportHeight: 0 }), 48);
        assert.equal(estimateInitialResultDisplayCount(container, { ...options, defaultCount: 5 }), 5);
        assert.equal(estimateInitialResultDisplayCount(null, options), 48);
        container._clientWidth = 700;
        assert.equal(estimateInitialResultDisplayCount(container, options), 48);
    } finally {
        cleanup();
    }
});

test("render masonry: applies fixed columns and container height", () => {
    const cleanup = installFakeDom();
    try {
        const container = document.createElement("div");
        container._clientWidth = 224;
        const cards = Array.from({ length: 3 }, () => document.createElement("div"));
        cards.forEach((card, index) => {
            card.className = "song-card";
            card._scrollHeight = [100, 80, 40][index];
            container.appendChild(card);
        });

        applyMasonryLayout(container, {
            gapPx: 12,
            minCardWidthPx: 100
        });

        assert.equal(cards[0].style.width, "106px");
        assert.equal(cards[1].style.left, "118px");
        assert.equal(cards[2].style.top, "112px");
        assert.equal(cards[2].dataset.layoutColumn, "0");
        assert.equal(container.style.height, "152px");
    } finally {
        cleanup();
    }
});

test("render masonry: reads layout metrics from CSS custom properties", () => {
    const cleanup = installFakeDom();
    const previousGetComputedStyle = globalThis.getComputedStyle;
    try {
        setGlobalValue("getComputedStyle", () => ({
            getPropertyValue(name) {
                return {
                    "--masonry-gap": "12px",
                    "--masonry-min-card-width": "100px",
                    "--masonry-card-content-estimate": "40px"
                }[name] || "";
            }
        }));
        const container = document.createElement("div");
        container._clientWidth = 224;
        container._rect = { top: 100, bottom: 200, left: 0, right: 224, width: 224, height: 100 };
        const cards = Array.from({ length: 2 }, () => document.createElement("div"));
        cards.forEach((card) => {
            card.className = "song-card";
            card._scrollHeight = 50;
            container.appendChild(card);
        });

        applyMasonryLayout(container);

        assert.equal(cards[0].style.width, "106px");
        assert.equal(cards[1].style.left, "118px");
        assert.equal(estimateMasonryVisibleCardCount(container, {
            minItemCount: 0,
            viewportHeight: 210
        }), 4);
    } finally {
        setGlobalValue("getComputedStyle", previousGetComputedStyle);
        cleanup();
    }
});

test("render masonry: estimated visible count expands beyond the minimum for tall viewports", () => {
    const cleanup = installFakeDom();
    try {
        const container = document.createElement("div");
        container._clientWidth = 3840;
        container._rect = { top: 100, bottom: 200, left: 0, right: 3840, width: 3840, height: 100 };

        assert.equal(estimateMasonryVisibleCardCount(container, {
            minItemCount: 48,
            viewportHeight: 2100
        }), 96);

        container._clientWidth = 1920;
        container._rect = { top: 100, bottom: 200, left: 0, right: 1920, width: 1920, height: 100 };

        assert.equal(estimateMasonryVisibleCardCount(container, {
            minItemCount: 48,
            viewportHeight: 900
        }), 48);
        assert.equal(estimateMasonryVisibleCardCount(null, { minItemCount: 48 }), 48);
    } finally {
        cleanup();
    }
});
