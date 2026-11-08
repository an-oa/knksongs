import test from "node:test";
import assert from "node:assert/strict";
import { createAutoHideHeaderController } from "../app/ui/header/auto-hide.mts";
import { installFakeDom, invokeListener, getFakeElement, installFakeAnimationFrames } from "./test-helpers.mts";

/**
 * テスト用ヘッダーと controller を初期化する。
 * @param initialScrollY 初期化時のページスクロール位置
 * @param headerHeight 初期化時に測られるヘッダーの高さ
 */
function setupHeaderController(initialScrollY = 0, headerHeight = 60) {
    const header = document.createElement("header");
    header.className = "header";
    getFakeElement(header)._rect = { top: 0, bottom: headerHeight, left: 0, right: 300, width: 300, height: headerHeight };
    document.body.appendChild(header);
    const sidebar = document.createElement("aside");
    sidebar.className = "sidebar";
    document.body.appendChild(sidebar);
    window.scrollY = initialScrollY;
    const controller = createAutoHideHeaderController({
        ui: { el: { header } },
        isSidebarOpen: () => sidebar.classList.contains("active"),
        scrollDeltaPx: 16
    });
    controller.setup();
    return {
        controller,
        header,
        setSidebarOpen(open: boolean) {
            sidebar.classList.toggle("active", open);
            controller.handleSidebarOpenChange();
        }
    };
}

/**
 * ページスクロール位置を更新して登録済み listener を呼ぶ。
 * @param {number} scrollY
 */
function scrollPageTo(mockWindow: ReturnType<typeof installFakeDom>["window"], scrollY: number) {
    window.scrollY = scrollY;
    invokeListener(mockWindow, "scroll", {});
}

test("auto-hide header: starts visible at a restored scroll position", () => {
    const restoreDom = installFakeDom();
    try {
        const { header } = setupHeaderController(300);

        assert.equal(header.classList.contains("is-auto-hidden"), false);
        scrollPageTo(restoreDom.window, 315);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
        scrollPageTo(restoreDom.window, 316);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: pageshow reveals a header after late scroll restoration", () => {
    const restoreDom = installFakeDom();
    try {
        const { header } = setupHeaderController();

        scrollPageTo(restoreDom.window, 100);
        assert.equal(header.classList.contains("is-auto-hidden"), true);

        window.scrollY = 300;
        invokeListener(restoreDom.window, "pageshow", {});
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 315);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
        scrollPageTo(restoreDom.window, 316);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: hides after downward movement and returns after upward movement", () => {
    const restoreDom = installFakeDom();
    try {
        const { header } = setupHeaderController();

        scrollPageTo(restoreDom.window, 60);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 75);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 76);
        assert.equal(header.classList.contains("is-auto-hidden"), true);

        scrollPageTo(restoreDom.window, 61);
        assert.equal(header.classList.contains("is-auto-hidden"), true);

        scrollPageTo(restoreDom.window, 60);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: direction changes reset the movement threshold", () => {
    const restoreDom = installFakeDom();
    try {
        const { header } = setupHeaderController();

        scrollPageTo(restoreDom.window, 70);
        assert.equal(header.classList.contains("is-auto-hidden"), true);

        scrollPageTo(restoreDom.window, 62);
        scrollPageTo(restoreDom.window, 68);
        scrollPageTo(restoreDom.window, 61);
        assert.equal(header.classList.contains("is-auto-hidden"), true);

        scrollPageTo(restoreDom.window, 52);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: sidebar state keeps the header visible until the next downward movement", () => {
    const restoreDom = installFakeDom();
    try {
        const { header, setSidebarOpen } = setupHeaderController();

        scrollPageTo(restoreDom.window, 100);
        assert.equal(header.classList.contains("is-auto-hidden"), true);

        setSidebarOpen(true);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 140);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        setSidebarOpen(false);
        scrollPageTo(restoreDom.window, 155);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 156);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: keyboard focus shows and protects the header", () => {
    const restoreDom = installFakeDom();
    try {
        const { header } = setupHeaderController();
        const button = document.createElement("button");
        getFakeElement(button).matches = (selector) => selector === ":focus-visible";
        header.appendChild(button);

        scrollPageTo(restoreDom.window, 100);
        assert.equal(header.classList.contains("is-auto-hidden"), true);

        button.focus();
        invokeListener(header, "focusin", { target: button });
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 140);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        button.blur();
        invokeListener(header, "focusout", { relatedTarget: document.body });
        scrollPageTo(restoreDom.window, 156);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        restoreDom();
    }
});

/**
 * 検索窓を置いたヘッダーを用意し、検索窓へフォーカスを入れる。
 * 検索窓はマウスやタップで入れても :focus-visible になるので、常に一致させる。
 */
function setupFocusedSearchBox() {
    const restoreDom = installFakeDom();
    const { header } = setupHeaderController();
    const searchBox = document.createElement("input");
    getFakeElement(searchBox).matches = (selector) => selector === ":focus-visible";
    header.appendChild(searchBox);
    searchBox.focus();
    invokeListener(header, "focusin", { target: searchBox });
    return { restoreDom, header, searchBox };
}

for (const gesture of ["wheel", "touchmove"]) {
    test(`auto-hide header: a ${gesture} scroll hides the header while the search box keeps focus`, () => {
        const { restoreDom, header, searchBox } = setupFocusedSearchBox();
        try {
            // 入力中に結果の描き直しなどでページが動いても隠さない。
            scrollPageTo(restoreDom.window, 100);
            assert.equal(header.classList.contains("is-auto-hidden"), false);

            invokeListener(restoreDom.window, gesture, {});
            scrollPageTo(restoreDom.window, 115);
            assert.equal(header.classList.contains("is-auto-hidden"), false);
            scrollPageTo(restoreDom.window, 116);
            assert.equal(header.classList.contains("is-auto-hidden"), true);
            assert.equal(document.activeElement, searchBox);
        } finally {
            restoreDom();
        }
    });
}

test("auto-hide header: pressing outside the header, such as on the scrollbar, lets it hide while the search box keeps focus", () => {
    const { restoreDom, header, searchBox } = setupFocusedSearchBox();
    try {
        scrollPageTo(restoreDom.window, 100);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        // スクロールバーを押すと、ページの html 要素への pointerdown として届く。
        invokeListener(restoreDom.window, "pointerdown", { target: document.documentElement });
        scrollPageTo(restoreDom.window, 116);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
        assert.equal(document.activeElement, searchBox);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: pressing the search box keeps the header shown while the page moves by itself", () => {
    const { restoreDom, header, searchBox } = setupFocusedSearchBox();
    try {
        // 検索窓を押した直後は、キーボードが開くときの自動スクロールなどでページが動いても隠さない。
        invokeListener(restoreDom.window, "pointerdown", { target: searchBox });
        scrollPageTo(restoreDom.window, 100);
        scrollPageTo(restoreDom.window, 200);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
    } finally {
        restoreDom();
    }
});

for (const inputEvent of ["keydown", "input"]) {
    test(`auto-hide header: ${inputEvent} in the header after a scroll gesture shows and protects it again`, () => {
        const { restoreDom, header, searchBox } = setupFocusedSearchBox();
        try {
            invokeListener(restoreDom.window, "wheel", {});
            scrollPageTo(restoreDom.window, 200);
            assert.equal(header.classList.contains("is-auto-hidden"), true);

            invokeListener(header, inputEvent, { target: searchBox });
            assert.equal(header.classList.contains("is-auto-hidden"), false);

            scrollPageTo(restoreDom.window, 260);
            assert.equal(header.classList.contains("is-auto-hidden"), false);
        } finally {
            restoreDom();
        }
    });
}

test("auto-hide header: focusing into the header after a scroll gesture protects it again", () => {
    const { restoreDom, header, searchBox } = setupFocusedSearchBox();
    try {
        invokeListener(restoreDom.window, "touchmove", {});
        scrollPageTo(restoreDom.window, 200);
        assert.equal(header.classList.contains("is-auto-hidden"), true);

        const button = document.createElement("button");
        getFakeElement(button).matches = (selector) => selector === ":focus-visible";
        header.appendChild(button);
        searchBox.blur();
        button.focus();
        invokeListener(header, "focusin", { target: button });
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 260);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: focus without focus-visible shows without preventing the next hide", () => {
    const restoreDom = installFakeDom();
    try {
        const { header } = setupHeaderController();
        const button = document.createElement("button");
        getFakeElement(button).matches = () => false;
        header.appendChild(button);

        scrollPageTo(restoreDom.window, 100);
        button.focus();
        invokeListener(header, "focusin", { target: button });
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 116);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: coalesces scroll events into one animation frame", () => {
    const restoreDom = installFakeDom();
    const frames = installFakeAnimationFrames();
    try {
        const { header } = setupHeaderController();

        scrollPageTo(restoreDom.window, 70);
        scrollPageTo(restoreDom.window, 85);
        scrollPageTo(restoreDom.window, 100);

        assert.equal(frames.pendingCount, 1);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        frames.advanceFrame();
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        frames.cleanup();
        restoreDom();
    }
});

test("auto-hide header: resizing to a taller header keeps it visible within the new height", () => {
    const restoreDom = installFakeDom();
    try {
        const { header } = setupHeaderController();

        // 狭い画面ではヘッダーが 2 段になり、高さが 60px から 108px へ変わる。
        getFakeElement(header)._rect = { top: 0, bottom: 108, left: 0, right: 300, width: 300, height: 108 };
        invokeListener(restoreDom.window, "resize", {});

        scrollPageTo(restoreDom.window, 80);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
        scrollPageTo(restoreDom.window, 108);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
        scrollPageTo(restoreDom.window, 123);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
        scrollPageTo(restoreDom.window, 124);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: uses the current header height after styles shrink it without a resize", () => {
    const restoreDom = installFakeDom();
    try {
        // CSS が当たる前に初期化されると、ヘッダーの中身が縦に並び、実際よりずっと高く測られる。
        const { header } = setupHeaderController(0, 3115);
        getFakeElement(header)._rect = { top: 0, bottom: 60, left: 0, right: 300, width: 300, height: 60 };

        scrollPageTo(restoreDom.window, 60);
        assert.equal(header.classList.contains("is-auto-hidden"), false);
        scrollPageTo(restoreDom.window, 663);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        restoreDom();
    }
});

test("auto-hide header: resetting the baseline after a programmatic scroll keeps the header state", () => {
    const restoreDom = installFakeDom();
    try {
        const { controller, header } = setupHeaderController(300);

        window.scrollY = 900;
        controller.resetScrollBaseline();
        scrollPageTo(restoreDom.window, 900);
        assert.equal(header.classList.contains("is-auto-hidden"), false);

        scrollPageTo(restoreDom.window, 916);
        assert.equal(header.classList.contains("is-auto-hidden"), true);
    } finally {
        restoreDom();
    }
});
