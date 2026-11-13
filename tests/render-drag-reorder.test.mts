import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkDragReorderController, findCardAtPoint } from "../app/lib/render/drag-reorder.mts";
import { createBookmarkReorderFixture } from "./support/bookmark-reorder-fixture.mts";
import {
    getFakeElement,
    installFakeAnimationFrames,
    installFakeDom,
    makeRenderRow
} from "./test-helpers.mts";

type CardBox = { left: number; top: number; width: number; height: number };

/** 1 列に並べるときのカードの間隔。 */
const CARD_GAP = 10;
/** 並べ替えのドラッグに使うポインタの id。 */
const DRAG_POINTER_ID = 1;

/**
 * カードの配置の位置を、一覧の中の順番と、前にあるカードの高さから決める。
 * 並べ替えて DOM の順番が変わると、位置も変わる。
 * @param card 結果カード
 * @param height カードの高さ
 */
function placeInOneColumn(card: HTMLElement, height: number) {
    const top = () => {
        const siblings: HTMLElement[] = card.parentElement ? Array.from(card.parentElement.children, (node) => node as HTMLElement) : [];
        return siblings.slice(0, siblings.indexOf(card)).reduce((sum, sibling) => sum + sibling.offsetHeight + CARD_GAP, 0);
    };
    Object.defineProperties(card, {
        offsetLeft: { get: () => 0, configurable: true },
        offsetTop: { get: top, configurable: true },
        offsetWidth: { get: () => 300, configurable: true },
        offsetHeight: { get: () => height, configurable: true }
    });
}

/**
 * カードの配置の位置を、並べ替えても動かない固定の位置にする。
 * @param card 結果カード
 * @param box 固定する位置と大きさ
 */
function placeAt(card: HTMLElement, box: CardBox) {
    Object.defineProperties(card, {
        offsetLeft: { get: () => box.left, configurable: true },
        offsetTop: { get: () => box.top, configurable: true },
        offsetWidth: { get: () => box.width, configurable: true },
        offsetHeight: { get: () => box.height, configurable: true }
    });
}

/**
 * 結果一覧の画面上の位置を、幅 300px・高さ 600px のまま変える。
 * @param list 結果カードを並べた一覧
 * @param top 一覧の上端の、画面上の位置
 */
function setListTop(list: HTMLElement, top: number) {
    getFakeElement(list)._rect = { top, bottom: top + 600, left: 0, right: 300, width: 300, height: 600 };
}

/**
 * 画面上の位置が、要素の画面上の枠の中かを返す。
 * @param element 調べる要素
 * @param x 画面から見た横の位置
 * @param y 画面から見た縦の位置
 */
function isInsideBox(element: HTMLElement, x: number, y: number) {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height;
}

/**
 * ドラッグの状態、結果一覧、描き直しと保存の記録を作る。
 * 結果一覧は、描画と同じく並べ替え途中の順序（orderForPreview）で並べ直す。
 * 画面の高さは偽の DOM の 720px で、上端と下端の近く（48px 以内）では端の自動スクロールが始まる。
 * 偽の DOM の requestAnimationFrame はその場で呼ぶので、自動スクロールを見ないテストでは、ポインタを端の近くへ置かない。
 * @param options 保存の結果と、カードの高さ
 */
function createDragHarness(options: {
    saveResult?: import("../app/controllers/bookmark-persistence.mts").BookmarkSaveResult;
    heights?: Record<string, number>;
} = {}) {
    const data: import("../app/state.types").AppDataState = {
        allSongsRaw: [],
        displayLimit: 48,
        activeBookmark: "bookmark-1",
        bookmarks: {
            "bookmark-1": {
                name: "Bookmark",
                createdAt: 1,
                songs: ["a", "b", "c"]
            }
        },
        currentResults: [
            makeRenderRow({ songKey: "a" }),
            makeRenderRow({ songKey: "b" }),
            makeRenderRow({ songKey: "c" })
        ]
    };
    const calls = {
        save: 0,
        render: 0,
        savedBookmarks: [] as import("../app/state.types").AppDataState["bookmarks"][],
        saveFailures: [] as import("../app/controllers/storage.mts").StorageActionFailure[]
    };
    const list = document.createElement("div");
    document.body.appendChild(list);
    setListTop(list, 0);
    // 位置にある要素は、一覧の枠の中なら一覧、外なら body とする。ヘッダーを重ねるテストでは差し替える。
    document.elementFromPoint = (x, y) => (isInsideBox(list, x, y) ? list : document.body);
    const cards = new Map<string, HTMLElement>();
    for (const row of data.currentResults) {
        const card = document.createElement("div");
        card.className = "song-card";
        card.dataset.songKey = row.songKey;
        placeInOneColumn(card, options.heights?.[row.songKey] ?? 100);
        cards.set(row.songKey, card);
    }
    /** 描画と同じく、並べ替え途中の順序で結果一覧を並べ直す。 */
    const render = () => {
        calls.render += 1;
        const ordered = controller.orderForPreview(data.currentResults)
            .map((row) => cards.get(row.songKey))
            .filter((card): card is HTMLElement => card !== undefined);
        list.replaceChildren(...ordered);
    };
    const storageController = createBookmarkReorderFixture({
        data,
        saveBookmarks: (bookmarks) => {
            calls.save += 1;
            calls.savedBookmarks.push(bookmarks);
            return options.saveResult ?? { ok: true };
        },
        updateDisplay: render
    });
    const controller = createBookmarkDragReorderController({
        data,
        moveSongInActiveBookmark: storageController.moveSongInActiveBookmark,
        onSaveFailure: (result) => calls.saveFailures.push(result),
        refreshDisplay: render,
        getResultList: () => list
    });
    render();
    calls.render = 0;
    return { data, calls, controller, storageController, list, cards };
}

/**
 * 移動元カードのハンドルで起きる pointerdown のイベントを作る。
 * @param card 移動元のカード
 * @param options ポインタの id、主ポインタか、押したボタン
 */
function createHandlePointerDown(card: HTMLElement | undefined, options: { pointerId?: number; isPrimary?: boolean; button?: number } = {}) {
    assert.ok(card);
    const handle = document.createElement("div");
    card.appendChild(handle);
    const event = {
        currentTarget: handle,
        pointerId: options.pointerId ?? DRAG_POINTER_ID,
        isPrimary: options.isPrimary ?? true,
        button: options.button ?? 0,
        clientX: 290,
        clientY: card.offsetTop + 10,
        prevented: false,
        preventDefault() {
            event.prevented = true;
        }
    };
    return event;
}

/**
 * 移動元カードのハンドルを押して、並べ替えのドラッグを始める。
 * @param controller 並べ替えの controller
 * @param card 移動元のカード
 */
function startDragFrom(controller: ReturnType<typeof createDragHarness>["controller"], card: HTMLElement | undefined) {
    const event = createHandlePointerDown(card);
    controller.onHandlePointerDown(event);
    return event;
}

/**
 * 画面から見た縦の位置で、結果一覧が受けるポインタのイベントを作る。
 * @param y 画面の上端からの位置。一覧の上端が 0 のときは、一覧の上端からの位置と同じ
 * @param options ポインタの id と横の位置
 */
function pointerAt(y: number, options: { pointerId?: number; x?: number } = {}) {
    return { pointerId: options.pointerId ?? DRAG_POINTER_ID, clientX: options.x ?? 150, clientY: y };
}

/**
 * 文書で受ける keydown のイベントを、文書の listener へ届ける。
 * @param dom installFakeDom で設置した DOM
 * @param key 押したキー
 */
function pressKey(dom: ReturnType<typeof installFakeDom>, key: string) {
    void dom.document.dispatchListeners("keydown", { key });
}

/**
 * 文書で受ける contextmenu のイベントを届け、既定の動作が止められたかを返す。
 * @param dom installFakeDom で設置した DOM
 * @returns 既定の動作を止めたら true
 */
function openContextMenu(dom: ReturnType<typeof installFakeDom>) {
    const event = { prevented: false, preventDefault() { event.prevented = true; } };
    void dom.document.dispatchListeners("contextmenu", event);
    return event.prevented;
}

/**
 * 一覧に並んでいるカードの曲キーを、DOM 順に返す。
 * @param list 結果カードを並べた一覧
 */
function readListOrder(list: HTMLElement) {
    return Array.from(list.children, (card) => (card as HTMLElement).dataset.songKey);
}

test("render drag reorder: pressing the handle captures the pointer on the list and marks the dragged card", () => {
    const cleanup = installFakeDom();
    try {
        const { calls, controller, list, cards } = createDragHarness();
        const down = startDragFrom(controller, cards.get("a"));

        // 一覧がキャプチャするので、描き直しでハンドルが動いても、一覧の外へ出ても、離すまでのイベントが一覧に届く。
        assert.deepEqual([...getFakeElement(list).capturedPointerIds], [DRAG_POINTER_ID]);
        assert.equal(down.prevented, true);
        assert.equal(cards.get("a")?.classList.contains("dragging"), true);
        assert.equal(controller.isDraggingSong("a"), true);
        assert.equal(calls.render, 0);
    } finally {
        cleanup();
    }
});

test("render drag reorder: moving over another card shows the dragged card in its slot without saving", () => {
    const cleanup = installFakeDom();
    try {
        const { data, calls, controller, list, cards } = createDragHarness();
        startDragFrom(controller, cards.get("a"));

        // c の上へ来ると、a が c の枠へ移り、b と c が 1 枠ずつ上へよける。
        controller.onListPointerMove(pointerAt(270));

        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["a", "b", "c"]);
        assert.equal(calls.save, 0);
        assert.equal(calls.render, 1);
    } finally {
        cleanup();
    }
});

test("render drag reorder: releasing in the list saves the order shown during the drag", () => {
    const cleanup = installFakeDom();
    try {
        const { data, calls, controller, list, cards } = createDragHarness();
        startDragFrom(controller, cards.get("a"));
        controller.onListPointerMove(pointerAt(270));

        // 離す位置は、移った a の上でも、カードの間の隙間でもよい。
        controller.onListPointerUp(pointerAt(215));

        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["b", "c", "a"]);
        assert.deepEqual(data.bookmarks["bookmark-1"].songs, ["b", "c", "a"]);
        assert.equal(calls.save, 1);
        assert.deepEqual(calls.saveFailures, []);
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);
        assert.equal(cards.get("a")?.classList.contains("dragging"), false);
        assert.deepEqual([...getFakeElement(list).capturedPointerIds], []);
        assert.equal(controller.isDraggingSong("a"), false);
    } finally {
        cleanup();
    }
});

test("bookmark reorder: moves only visible songs and keeps hidden songs in their slots", () => {
    const cleanup = installFakeDom();
    try {
        const { data, storageController, calls } = createDragHarness();
        const originalResults = data.currentResults;
        data.displayLimit = 2;
        data.bookmarks["bookmark-1"].songs = ["hidden-1", "a", "hidden-2", "b", "c", "hidden-3"];
        assert.deepEqual(storageController.moveSongInActiveBookmark("a", "c"), { ok: true, changed: true });
        assert.deepEqual(data.bookmarks["bookmark-1"].songs, ["hidden-1", "b", "hidden-2", "c", "a", "hidden-3"]);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["b", "c", "a"]);
        assert.equal(calls.save, 1);
        assert.equal(calls.render, 1);
        assert.equal(data.currentResults, originalResults);
        assert.equal(data.displayLimit, 2);
        assert.deepEqual(storageController.moveSongInActiveBookmark("a", "b"), { ok: true, changed: true });
        assert.deepEqual(data.bookmarks["bookmark-1"].songs, ["hidden-1", "a", "hidden-2", "b", "c", "hidden-3"]);
    } finally {
        cleanup();
    }
});

test("render drag reorder: releasing outside the list puts the cards back in the saved order", () => {
    const cleanup = installFakeDom();
    try {
        const { data, calls, controller, list, cards } = createDragHarness();
        startDragFrom(controller, cards.get("a"));
        controller.onListPointerMove(pointerAt(270));
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);

        // 一覧の右（幅 300px の外）で離す。キャプチャしているので、一覧の外で離しても一覧に届く。
        controller.onListPointerUp(pointerAt(270, { x: 320 }));

        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["a", "b", "c"]);
        assert.equal(calls.save, 0);
        assert.equal(cards.get("a")?.classList.contains("dragging"), false);
        assert.deepEqual([...getFakeElement(list).capturedPointerIds], []);
    } finally {
        cleanup();
    }
});

test("render drag reorder: a cancelled pointer or a lost capture puts the cards back in the saved order", () => {
    for (const reason of ["pointercancel", "lostpointercapture"]) {
        const cleanup = installFakeDom();
        try {
            const { data, calls, controller, list, cards } = createDragHarness();
            startDragFrom(controller, cards.get("a"));
            controller.onListPointerMove(pointerAt(270));

            // どちらのイベントも、一覧では同じ listener で受ける。
            controller.onListPointerCancel(pointerAt(270));

            assert.deepEqual(readListOrder(list), ["a", "b", "c"], reason);
            assert.deepEqual(data.currentResults.map((row) => row.songKey), ["a", "b", "c"], reason);
            assert.equal(calls.save, 0, reason);
            assert.equal(cards.get("a")?.classList.contains("dragging"), false, reason);
        } finally {
            cleanup();
        }
    }
});

test("render drag reorder: Esc cancels the drag and stops listening to the document", () => {
    const dom = installFakeDom();
    try {
        const { data, calls, controller, list, cards } = createDragHarness();
        startDragFrom(controller, cards.get("a"));
        controller.onListPointerMove(pointerAt(270));

        pressKey(dom, "Enter");
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);
        pressKey(dom, "Escape");

        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
        assert.equal(cards.get("a")?.classList.contains("dragging"), false);
        assert.deepEqual([...getFakeElement(list).capturedPointerIds], []);
        // 取り消した後のポインタのイベントや、離したことは、並べ替えに使わない。
        controller.onListPointerMove(pointerAt(270));
        controller.onListPointerUp(pointerAt(270));
        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["a", "b", "c"]);
        assert.equal(calls.save, 0);
        assert.equal(dom.document._events.has("keydown"), false);
        assert.equal(dom.document._events.has("contextmenu"), false);
    } finally {
        dom();
    }
});

test("render drag reorder: a long press during the drag does not open the menu or select text", () => {
    const dom = installFakeDom();
    try {
        const { controller, cards } = createDragHarness();
        // ドラッグしていないときは、長押しのメニューを止めない。
        assert.equal(openContextMenu(dom), false);

        startDragFrom(controller, cards.get("a"));
        assert.equal(openContextMenu(dom), true);

        controller.onListPointerUp(pointerAt(50));
        assert.equal(openContextMenu(dom), false);
    } finally {
        dom();
    }
});

test("render drag reorder: a failed save is reported and the saved order comes back", () => {
    const cleanup = installFakeDom();
    try {
        const { data, calls, controller, list, cards } = createDragHarness({
            saveResult: { ok: false, reason: "storage_write_failed" }
        });
        startDragFrom(controller, cards.get("a"));
        controller.onListPointerMove(pointerAt(270));
        controller.onListPointerUp(pointerAt(270));

        assert.deepEqual(calls.saveFailures, [{ ok: false, reason: "storage_write_failed" }]);
        assert.deepEqual(calls.savedBookmarks[0]["bookmark-1"].songs, ["b", "c", "a"]);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["a", "b", "c"]);
        assert.deepEqual(data.bookmarks["bookmark-1"].songs, ["a", "b", "c"]);
        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
    } finally {
        cleanup();
    }
});

test("render drag reorder: moving back to the original slot and releasing saves nothing", () => {
    const cleanup = installFakeDom();
    try {
        const { data, calls, controller, list, cards } = createDragHarness();
        startDragFrom(controller, cards.get("a"));
        controller.onListPointerMove(pointerAt(270));
        // b 0-100、c 110-210、a 220-320 になったので、b の上へ戻ると a は元の先頭へ戻る。
        controller.onListPointerMove(pointerAt(50));
        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
        calls.render = 0;

        controller.onListPointerUp(pointerAt(50));

        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["a", "b", "c"]);
        assert.equal(calls.save, 0);
        assert.equal(calls.render, 0);
        assert.equal(cards.get("a")?.classList.contains("dragging"), false);
    } finally {
        cleanup();
    }
});

test("render drag reorder: a taller card that moved aside is skipped until the pointer leaves it", () => {
    const cleanup = installFakeDom();
    try {
        // c だけ背が高い。a 0-100、b 110-210、c 220-520 に並ぶ。
        const { controller, list, cards } = createDragHarness({ heights: { c: 300 } });
        startDragFrom(controller, cards.get("a"));

        controller.onListPointerMove(pointerAt(300));
        // b 0-100、c 110-410、a 420-520 になり、ポインタは上へよけた c の上に残る。c へは戻らない。
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);
        controller.onListPointerMove(pointerAt(350));
        controller.onListPointerMove(pointerAt(200));
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);

        // いったん c から出て（a の上へ）、もう一度 c に入ると、a が c の枠へ移る。
        controller.onListPointerMove(pointerAt(450));
        controller.onListPointerMove(pointerAt(200));
        assert.deepEqual(readListOrder(list), ["b", "a", "c"]);
    } finally {
        cleanup();
    }
});

test("render drag reorder: the cards wait for the pointer to move before rearranging again", () => {
    const cleanup = installFakeDom();
    try {
        const { controller, list, cards } = createDragHarness();
        // 並べ替えても動かない位置にし、並べ替えた直後にポインタのすぐそばへ別のカードが来た状況を作る。
        // b（110-228）と c（224-324）が少し重なるようにし、DOM 順で先に来る b がその重なりで選ばれるようにする。
        placeAt(cards.get("a") ?? list, { left: 0, top: 0, width: 300, height: 100 });
        placeAt(cards.get("b") ?? list, { left: 0, top: 110, width: 300, height: 118 });
        placeAt(cards.get("c") ?? list, { left: 0, top: 224, width: 300, height: 100 });
        startDragFrom(controller, cards.get("a"));

        controller.onListPointerMove(pointerAt(230));
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);

        // 3px しか動いていないので、b の上でも並べ替えない。
        controller.onListPointerMove(pointerAt(227));
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);

        controller.onListPointerMove(pointerAt(215));
        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
    } finally {
        cleanup();
    }
});

test("render drag reorder: pointers other than the dragging one do not rearrange the cards", () => {
    const cleanup = installFakeDom();
    try {
        const { data, calls, controller, list, cards } = createDragHarness();

        // ドラッグしていないときのポインタの動きは、並べ替えに使わない。
        controller.onListPointerMove(pointerAt(270));
        controller.onListPointerUp(pointerAt(270));
        assert.equal(calls.render, 0);

        // ドラッグ中の 2 本目の指は、別のハンドルを押しても、動かしても、離しても使わない。
        startDragFrom(controller, cards.get("a"));
        const secondDown = createHandlePointerDown(cards.get("b"), { pointerId: 2 });
        controller.onHandlePointerDown(secondDown);
        controller.onListPointerMove(pointerAt(270, { pointerId: 2 }));
        controller.onListPointerUp(pointerAt(270, { pointerId: 2 }));

        assert.equal(secondDown.prevented, false);
        assert.equal(cards.get("b")?.classList.contains("dragging"), false);
        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
        assert.equal(controller.isDraggingSong("a"), true);
        assert.equal(calls.render, 0);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["a", "b", "c"]);
    } finally {
        cleanup();
    }
});

test("render drag reorder: the drag does not start outside bookmark mode, from a secondary pointer, or with another button", () => {
    const cases = [
        { name: "outside bookmark mode", activeBookmark: null, down: {} },
        { name: "secondary pointer", activeBookmark: "bookmark-1", down: { isPrimary: false } },
        { name: "right button", activeBookmark: "bookmark-1", down: { button: 2 } }
    ];
    for (const { name, activeBookmark, down } of cases) {
        const cleanup = installFakeDom();
        try {
            const { data, controller, list, cards } = createDragHarness();
            data.activeBookmark = activeBookmark;
            const event = createHandlePointerDown(cards.get("a"), down);
            controller.onHandlePointerDown(event);

            assert.equal(event.prevented, false, name);
            assert.deepEqual([...getFakeElement(list).capturedPointerIds], [], name);
            assert.equal(cards.get("a")?.classList.contains("dragging"), false, name);
            assert.equal(controller.isDraggingSong("a"), false, name);
        } finally {
            cleanup();
        }
    }
});

test("render drag reorder: the drag does not start when the list cannot capture the pointer", () => {
    const cleanup = installFakeDom();
    try {
        const { controller, list, cards } = createDragHarness();
        // キャプチャできないと、一覧の外で離したことを受け取れず、ドラッグが終わらなくなる。
        list.setPointerCapture = () => {
            throw new DOMException("The pointer is not active.", "NotFoundError");
        };
        const event = createHandlePointerDown(cards.get("a"));
        controller.onHandlePointerDown(event);

        assert.equal(event.prevented, false);
        assert.equal(cards.get("a")?.classList.contains("dragging"), false);
        assert.equal(controller.isDraggingSong("a"), false);
    } finally {
        cleanup();
    }
});

test("render drag reorder: holding the pointer near the bottom edge scrolls the page and keeps the preview under the pointer", () => {
    const dom = installFakeDom();
    const frames = installFakeAnimationFrames();
    try {
        const { data, controller, list, cards } = createDragHarness();
        // 一覧の上端を画面の 500px に置く。a 500-600、b 610-710 が見え、c（720-820）は画面の外にある。
        setListTop(list, 500);
        const scrolls: number[] = [];
        Object.assign(dom.window, {
            scrollBy(options: ScrollToOptions) {
                const step = options.top ?? 0;
                scrolls.push(step);
                // ブラウザと同じく、ページが動いたら scroll イベントを送る。
                setListTop(list, list.getBoundingClientRect().top - step);
                void dom.document.dispatchListeners("scroll", {});
            }
        });
        startDragFrom(controller, cards.get("a"));

        // 画面の下端から 5px のところ（一覧では b と c の間の隙間）へ運ぶ。
        controller.onListPointerMove(pointerAt(715));
        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
        assert.equal(frames.pendingCount, 1);

        // 1 フレームで 15px 下へスクロールし、ポインタの下に来た c の枠へ a が移る。端にいる間は次のフレームも予約する。
        frames.advanceFrame();
        assert.deepEqual(scrolls, [15]);
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);
        assert.equal(frames.pendingCount, 1);

        // 離すと、見えている順序で保存し、端のスクロールもやめる。
        controller.onListPointerUp(pointerAt(715));
        assert.deepEqual(data.bookmarks["bookmark-1"].songs, ["b", "c", "a"]);
        assert.equal(frames.pendingCount, 0);
    } finally {
        frames.cleanup();
        dom();
    }
});

test("render drag reorder: the page stops scrolling once the pointer leaves the edge", () => {
    const dom = installFakeDom();
    const frames = installFakeAnimationFrames();
    try {
        const { controller, list, cards } = createDragHarness();
        setListTop(list, 500);
        const scrolls: number[] = [];
        Object.assign(dom.window, {
            scrollBy(options: ScrollToOptions) {
                scrolls.push(options.top ?? 0);
            }
        });
        startDragFrom(controller, cards.get("a"));
        controller.onListPointerMove(pointerAt(715));
        controller.onListPointerMove(pointerAt(600));

        frames.advanceFrame();

        assert.deepEqual(scrolls, []);
        assert.equal(frames.pendingCount, 0);
        controller.onListPointerUp(pointerAt(600));
    } finally {
        frames.cleanup();
        dom();
    }
});

test("render drag reorder: scrolling the page without moving the pointer shows the dragged card under the pointer", () => {
    const dom = installFakeDom();
    try {
        const { data, controller, list, cards } = createDragHarness();
        startDragFrom(controller, cards.get("a"));
        // b と c の間の隙間で止める。
        controller.onListPointerMove(pointerAt(215));
        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);

        // ホイールで 30px スクロールすると、止めたポインタの下に c が来る。
        setListTop(list, -30);
        void dom.document.dispatchListeners("scroll", {});
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);

        controller.onListPointerUp(pointerAt(215));
        assert.deepEqual(data.bookmarks["bookmark-1"].songs, ["b", "c", "a"]);
        // ドラッグが終わったら、スクロールでは並べ替えない。
        assert.equal(dom.document._events.has("scroll"), false);
    } finally {
        dom();
    }
});

test("render drag reorder: releasing over the header after scrolling down puts the cards back", () => {
    const dom = installFakeDom();
    const frames = installFakeAnimationFrames();
    try {
        const { data, calls, controller, list, cards } = createDragHarness();
        // スクロールして、一覧の上端が画面の上へ出ている。a -150 から -50、b -40 から 60、c 70 から 170。
        // 一覧の枠は、画面の上の 64px を覆う固定ヘッダーの下にも広がっている。
        setListTop(list, -150);
        const header = document.createElement("header");
        header.className = "header";
        getFakeElement(header)._rect = { top: 0, bottom: 64, left: 0, right: 300, width: 300, height: 64 };
        document.body.appendChild(header);
        document.elementFromPoint = (x, y) => {
            if (isInsideBox(header, x, y)) return header;
            return isInsideBox(list, x, y) ? list : document.body;
        };
        startDragFrom(controller, cards.get("a"));
        controller.onListPointerMove(pointerAt(120));
        assert.deepEqual(readListOrder(list), ["b", "c", "a"]);

        // ヘッダーの上で離す。一覧の枠の中だが、一覧は見えていないので、元の順序へ戻す。
        controller.onListPointerUp(pointerAt(30));

        assert.deepEqual(readListOrder(list), ["a", "b", "c"]);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), ["a", "b", "c"]);
        assert.equal(calls.save, 0);
        assert.equal(frames.pendingCount, 0);
    } finally {
        frames.cleanup();
        dom();
    }
});

test("render drag reorder: finds the card under the pointer by its laid-out box", () => {
    const cleanup = installFakeDom();
    try {
        const { list, cards } = createDragHarness();
        // a 0-100、b 110-210、c 220-320。上端と左端は含み、下端と右端は含まない。
        assert.equal(findCardAtPoint(list, { x: 0, y: 0 }), cards.get("a"));
        assert.equal(findCardAtPoint(list, { x: 299, y: 99 }), cards.get("a"));
        assert.equal(findCardAtPoint(list, { x: 150, y: 100 }), null);
        assert.equal(findCardAtPoint(list, { x: 150, y: 110 }), cards.get("b"));
        assert.equal(findCardAtPoint(list, { x: 300, y: 150 }), null);
        assert.equal(findCardAtPoint(list, { x: 150, y: 319 }), cards.get("c"));
    } finally {
        cleanup();
    }
});
