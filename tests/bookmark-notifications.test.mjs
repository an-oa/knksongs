import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkNotificationController } from "../_build/app/ui/bookmark/notifications.mjs";
import { installFakeDom, invokeListener, setGlobalValue } from "./test-helpers.mjs";

/**
 * 通知テスト用の UI 状態を作る。
 * @returns {object}
 */
function createNotificationUiState() {
    const bookmarkNotificationRegion = document.createElement("div");
    document.body.appendChild(bookmarkNotificationRegion);
    return {
        el: {
            bookmarkNotificationRegion
        },
        lookup: {
            songMapByBookmarkKey: new Map(),
            songMapByKey: new Map(),
            songLookupSourceRef: null
        }
    };
}

/**
 * 通知テスト用の曲データを作る。
 * @returns {object}
 */
function createNotificationDataState() {
    return {
        allSongsRaw: [
            {
                songKey: "song-z",
                bookmarkSongKey: "bookmark-song-z",
                title: "透明な朝"
            }
        ],
        currentResults: [],
        displayLimit: 0,
        bookmarks: {},
        activeBookmark: null
    };
}

test("bookmark notifications: replaces toast and clears the previous timer", () => {
    const restoreDom = installFakeDom();
    const previousSetTimeout = globalThis.setTimeout;
    const previousClearTimeout = globalThis.clearTimeout;
    const timers = [];
    const clearedTimers = [];
    setGlobalValue("setTimeout", (callback, delay) => {
        const timer = {
            callback,
            delay,
            unrefCalled: false,
            unref() {
                this.unrefCalled = true;
            }
        };
        timers.push(timer);
        return timer;
    });
    setGlobalValue("clearTimeout", (timer) => {
        clearedTimers.push(timer);
    });

    try {
        const ui = createNotificationUiState();
        const controller = createBookmarkNotificationController({
            data: createNotificationDataState(),
            ui,
            timeoutMs: 1200
        });

        controller.notifyBookmarkCreated("Morning");
        const firstToast = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast");
        controller.notifySongSavedToBookmark("Morning", "bookmark-song-z");

        const secondMessage = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-message");
        assert.equal(firstToast.parentElement, null);
        assert.equal(secondMessage.textContent, "ブックマーク「Morning」に「透明な朝」を保存しました。");
        assert.equal(timers.length, 2);
        assert.equal(timers[0].unrefCalled, true);
        assert.equal(timers[1].delay, 1200);
        assert.deepEqual(clearedTimers, [timers[0]]);
    } finally {
        setGlobalValue("setTimeout", previousSetTimeout);
        setGlobalValue("clearTimeout", previousClearTimeout);
        restoreDom();
    }
});

test("bookmark notifications: close button removes toast and clears timer", () => {
    const restoreDom = installFakeDom();
    const previousSetTimeout = globalThis.setTimeout;
    const previousClearTimeout = globalThis.clearTimeout;
    const timers = [];
    const clearedTimers = [];
    setGlobalValue("setTimeout", (callback, delay) => {
        const timer = {
            callback,
            delay,
            unref() {}
        };
        timers.push(timer);
        return timer;
    });
    setGlobalValue("clearTimeout", (timer) => {
        clearedTimers.push(timer);
    });

    try {
        const ui = createNotificationUiState();
        const controller = createBookmarkNotificationController({
            data: createNotificationDataState(),
            ui
        });

        controller.notifyBookmarkCreated("Morning");
        const closeBtn = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-close");
        invokeListener(closeBtn, "click", {});

        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 0);
        assert.deepEqual(clearedTimers, [timers[0]]);
    } finally {
        setGlobalValue("setTimeout", previousSetTimeout);
        setGlobalValue("clearTimeout", previousClearTimeout);
        restoreDom();
    }
});
