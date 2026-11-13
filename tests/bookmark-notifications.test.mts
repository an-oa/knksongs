import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkNotificationController } from "../app/ui/bookmark/notifications.mts";
import type { SiteLanguage } from "../app/lib/site-language.mts";
import { createSongFixture } from "./fixtures/song.mts";
import { installFakeDom, installFakeTimeouts, invokeListener } from "./test-helpers.mts";

/**
 * 通知テスト用の UI 状態を作る。
 * @param language サイトの言語
 * @returns 通知の表示先と曲参照用のマップを持つ UI 状態
 */
function createNotificationUiState(language: SiteLanguage = "ja") {
    const bookmarkNotificationRegion = document.createElement("div");
    document.body.appendChild(bookmarkNotificationRegion);
    return {
        el: {
            bookmarkNotificationRegion
        },
        lookup: {
            songMapByKey: new Map<string, Song>(),
            songLookupSourceRef: null
        },
        language: {
            current: language
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
            createSongFixture({
                songKey: "bookmark-song-z",
                title: "透明な朝",
                titleEn: "Clear Morning"
            })
        ],
        currentResults: [],
        displayLimit: 0,
        bookmarks: {},
        activeBookmark: null
    };
}

test("bookmark notifications: replaces toast and clears the previous timer", () => {
    const restoreDom = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    const timers = fakeTimeouts.timeoutCalls;

    try {
        const ui = createNotificationUiState();
        const controller = createBookmarkNotificationController({
            data: createNotificationDataState(),
            ui,
            timeoutMs: 1200
        });

        controller.notifyBookmarkCreated("Morning");
        const firstToast = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast");
        assert.ok(firstToast);
        controller.notifySongSavedToBookmark("Morning", "bookmark-song-z");

        const secondMessage = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-message");
        assert.ok(secondMessage);
        assert.equal(firstToast.parentElement, null);
        assert.equal(secondMessage.textContent, "ブックマーク「Morning」に「透明な朝」を保存しました。");
        assert.equal(timers.length, 2);
        assert.equal(timers[0].unrefCalled, true);
        assert.equal(timers[1].delay, 1200);
        assert.deepEqual(timers.filter((timer) => timer.cleared), [timers[0]]);
    } finally {
        fakeTimeouts.cleanup();
        restoreDom();
    }
});

test("bookmark notifications: English notifications use English sentences and song titles", () => {
    const restoreDom = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();

    try {
        const ui = createNotificationUiState("en");
        const controller = createBookmarkNotificationController({
            data: createNotificationDataState(),
            ui
        });

        controller.notifySongSavedToBookmark("Morning", "bookmark-song-z");

        const message = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-message");
        assert.ok(message);
        assert.equal(message.textContent, "Saved “Clear Morning” to the bookmark “Morning”.");
        assert.equal(
            ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-close")?.getAttribute("aria-label"),
            "Close notification"
        );
    } finally {
        fakeTimeouts.cleanup();
        restoreDom();
    }
});

test("bookmark notifications: close button removes toast and clears timer", () => {
    const restoreDom = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();
    const timers = fakeTimeouts.timeoutCalls;

    try {
        const ui = createNotificationUiState();
        const controller = createBookmarkNotificationController({
            data: createNotificationDataState(),
            ui
        });

        controller.notifyBookmarkCreated("Morning");
        const closeBtn = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-close");
        assert.ok(closeBtn);
        invokeListener(closeBtn, "click", {});

        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 0);
        assert.deepEqual(timers.filter((timer) => timer.cleared), [timers[0]]);
    } finally {
        fakeTimeouts.cleanup();
        restoreDom();
    }
});

test("bookmark notifications: the shown toast is rewritten in the new language, including the song title", () => {
    const restoreDom = installFakeDom();
    const fakeTimeouts = installFakeTimeouts();

    try {
        const ui = createNotificationUiState();
        const controller = createBookmarkNotificationController({
            data: createNotificationDataState(),
            ui
        });

        controller.notifySongSavedToBookmark("Morning", "bookmark-song-z");
        const toast = ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast");
        ui.language.current = "en";
        controller.refreshText();

        // 同じ toast のまま、文言と閉じるボタンの読み上げ名だけを書き直す。
        assert.equal(ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast"), toast);
        assert.equal(
            ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-message")?.textContent,
            "Saved “Clear Morning” to the bookmark “Morning”."
        );
        assert.equal(
            ui.el.bookmarkNotificationRegion.querySelector(".bookmark-toast-close")?.getAttribute("aria-label"),
            "Close notification"
        );

        controller.dismissBookmarkNotification();
        ui.language.current = "ja";
        controller.refreshText();
        assert.equal(ui.el.bookmarkNotificationRegion.childElementCount, 0);
    } finally {
        fakeTimeouts.cleanup();
        restoreDom();
    }
});
