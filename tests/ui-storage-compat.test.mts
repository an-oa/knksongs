import test from "node:test";
import assert from "node:assert/strict";
import { applyThemeFromStorage, setupTheme } from "../app/ui/core/elements.mts";
import { createFakeLocalStorage } from "./fixtures/local-storage.mts";
import { installFakeDom, invokeListener } from "./test-helpers.mts";
import {
    assertExperimentalPlaybackSettingsHidden,
    assertExperimentalPlaybackSettingsVisible,
    assertLegacyPlaybackSettingsStorageCleared,
    assertPlaybackSettingsGroupHidden,
    assertPlaybackSettingsGroupVisible,
    createPlaybackSettingsFixture,
    seedPlaybackSettingsStorage
} from "./support/playback-settings-fixture.mts";

test("applyThemeFromStorage: main branch theme key restores dark mode state", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const ui = {
            el: {
                themeToggle: document.createElement("input")
            }
        };
        globalThis.localStorage.setItem("theme", "dark");

        applyThemeFromStorage({ ui });

        assert.equal(document.documentElement.classList.contains("dark-theme"), true);
        assert.equal(document.documentElement.style.colorScheme, "dark");
        assert.equal(ui.el.themeToggle.checked, true);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("settings: read and legacy removal failures use defaults and complete initialization", (t) => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    t.mock.method(console, "warn", () => {});
    t.mock.method(globalThis.localStorage, "getItem", () => { throw new Error("read denied"); });
    t.mock.method(globalThis.localStorage, "removeItem", () => { throw new Error("remove denied"); });
    try {
        const themeUi = { el: { themeToggle: document.createElement("input") } };
        setupTheme({ ui: themeUi });
        assert.equal(themeUi.el.themeToggle.checked, window.matchMedia("(prefers-color-scheme: dark)").matches);
        const { ui, controller } = createPlaybackSettingsFixture({
            ui: { showThumbnails: true, useYoutubeNoCookie: true, playArchiveToEnd: true }
        });
        controller.setupPlaybackSettings();
        assert.equal(ui.playback.showThumbnails, false);
        assert.equal(ui.el.thumbToggle.checked, false);
        assert.equal(ui.playback.useYoutubeNoCookie, false);
        assert.equal(ui.el.youtubeNoCookieToggle.checked, false);
        assert.equal(ui.playback.playArchiveToEnd, false);
        assert.equal(ui.el.playArchiveToEndToggle.checked, false);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("settings: denied storage getter does not interrupt theme or playback setup", (t) => {
    const restoreDom = installFakeDom();
    const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    t.mock.method(console, "warn", () => {});
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() { throw new Error("storage access denied"); }
    });
    try {
        const themeUi = { el: { themeToggle: document.createElement("input") } };
        setupTheme({ ui: themeUi });
        const { ui, controller } = createPlaybackSettingsFixture();
        controller.setupPlaybackSettings();
        ui.el.thumbToggle.checked = true;
        invokeListener(ui.el.thumbToggle, "change", {});
        assert.equal(ui.playback.showThumbnails, true);
        assertPlaybackSettingsGroupVisible(ui);
    } finally {
        if (previousDescriptor) Object.defineProperty(globalThis, "localStorage", previousDescriptor);
        else Reflect.deleteProperty(globalThis, "localStorage");
        restoreDom();
    }
});

test("settings: failed writes still apply theme, thumbnail rendering and playback effects", (t) => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    t.mock.method(console, "warn", () => {});
    t.mock.method(globalThis.localStorage, "setItem", () => { throw new Error("quota exceeded"); });
    try {
        const themeUi = { el: { themeToggle: document.createElement("input") } };
        setupTheme({ ui: themeUi });
        themeUi.el.themeToggle.checked = true;
        invokeListener(themeUi.el.themeToggle, "change", {});
        assert.equal(document.documentElement.style.colorScheme, "dark");
        const calls: string[] = [];
        const { ui, controller } = createPlaybackSettingsFixture({
            callbacks: {
                updateDisplay: () => { calls.push("render"); },
                setupScrollObserver: () => { calls.push("observe"); },
                restoreActivePlayback: () => { calls.push("restore playback"); }
            }
        });
        controller.setupPlaybackSettings();
        ui.el.thumbToggle.checked = true;
        invokeListener(ui.el.thumbToggle, "change", {});
        assert.equal(ui.playback.showThumbnails, true);
        assertPlaybackSettingsGroupVisible(ui);
        ui.el.youtubeNoCookieToggle.checked = true;
        invokeListener(ui.el.youtubeNoCookieToggle, "change", {});
        assert.equal(ui.playback.useYoutubeNoCookie, true);
        assert.equal(ui.el.youtubeNoCookieToggle.checked, true);
        assert.deepEqual(calls, ["render", "observe", "restore playback"]);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: playback settings are reset to load defaults on boot", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "false",
            showExperimentalPlaybackSettings: "true",
            stopAtEndTime: "true",
            continuousPlayback: "true",
            loopPlayback: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();

        assert.equal(ui.playback.showThumbnails, false);
        assert.equal(ui.playback.showExperimentalPlaybackSettings, false);
        assert.equal(ui.playback.useYoutubeNoCookie, false);
        assert.equal(ui.playback.playArchiveToEnd, false);
        assert.equal(ui.playback.continuousPlayback, false);
        assert.equal(ui.playback.loopPlayback, false);
        assert.equal(ui.el.thumbToggle.checked, false);
        assert.equal(ui.el.youtubeNoCookieToggle.checked, false);
        assert.equal(ui.el.playArchiveToEndToggle.checked, false);
        assert.equal(ui.el.continuousPlaybackToggle.checked, false);
        assert.equal(ui.el.loopPlaybackToggle.checked, false);
        assertPlaybackSettingsGroupHidden(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
        assert.equal(document.body.classList.contains("hide-thumbs"), true);
        assertLegacyPlaybackSettingsStorageCleared();
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("applyPlaybackSettingsFromStorage: ui sync reapplies stored playback settings", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true",
            useYoutubeNoCookie: "true",
            playArchiveToEnd: "true",
            showExperimentalPlaybackSettings: "false",
            stopAtEndTime: "true",
            continuousPlayback: "true",
            loopPlayback: "false"
        });
        const { ui, controller } = createPlaybackSettingsFixture({
            ui: {
                showThumbnails: false,
                showExperimentalPlaybackSettings: false,
                dataReady: true
            },
            callbacks: {
                updateDisplay: () => {
                    displayUpdateCount += 1;
                }
            }
        });
        let displayUpdateCount = 0;

        controller.applyPlaybackSettingsFromStorage();

        assert.equal(ui.playback.showThumbnails, true);
        assert.equal(ui.playback.showExperimentalPlaybackSettings, false);
        assert.equal(ui.playback.useYoutubeNoCookie, true);
        assert.equal(ui.playback.playArchiveToEnd, true);
        assert.equal(ui.playback.continuousPlayback, false);
        assert.equal(ui.playback.loopPlayback, false);
        assert.equal(ui.el.thumbToggle.checked, true);
        assert.equal(ui.el.youtubeNoCookieToggle.checked, true);
        assert.equal(ui.el.playArchiveToEndToggle.checked, true);
        assert.equal(ui.el.continuousPlaybackToggle.checked, false);
        assert.equal(ui.el.loopPlaybackToggle.checked, false);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
        assert.equal(document.body.classList.contains("hide-thumbs"), false);
        assert.equal(displayUpdateCount, 1);
        assertLegacyPlaybackSettingsStorageCleared();
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("applyPlaybackSettingsFromStorage: hidden experimental playback settings keep load defaults", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true",
            playArchiveToEnd: "true",
            showExperimentalPlaybackSettings: "false",
            stopAtEndTime: "true",
            continuousPlayback: "true",
            loopPlayback: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.applyPlaybackSettingsFromStorage();

        assert.equal(ui.playback.showExperimentalPlaybackSettings, false);
        assert.equal(ui.playback.playArchiveToEnd, true);
        assert.equal(ui.playback.continuousPlayback, false);
        assert.equal(ui.playback.loopPlayback, false);
        assert.equal(ui.el.playArchiveToEndToggle.checked, true);
        assert.equal(ui.el.continuousPlaybackToggle.checked, false);
        assert.equal(ui.el.loopPlaybackToggle.checked, false);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("applyPlaybackSettingsFromStorage: ui sync keeps page-only experimental playback setting", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true",
            showExperimentalPlaybackSettings: "false",
            showExperimentalPlaybackSettingsHiddenResetV1: "true",
            continuousPlayback: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();
        controller.setExperimentalPlaybackSettings(true);
        controller.applyPlaybackSettingsFromStorage();

        assert.equal(ui.playback.showExperimentalPlaybackSettings, true);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsVisible(ui);
        assert.equal(ui.playback.continuousPlayback, false);
        assertLegacyPlaybackSettingsStorageCleared();
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: archive playback toggle restores active playback before switching mode", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true",
            stopAtEndTime: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture({
            callbacks: {
                restoreActivePlayback: () => {
                    restoreCount += 1;
                }
            }
        });
        let restoreCount = 0;

        controller.setupPlaybackSettings();
        controller.setExperimentalPlaybackSettings(true);
        ui.el.playArchiveToEndToggle.checked = true;
        invokeListener(ui.el.playArchiveToEndToggle, "change", {});

        assert.equal(ui.playback.playArchiveToEnd, true);
        assert.equal(globalThis.localStorage.getItem("playArchiveToEnd"), "true");
        assertLegacyPlaybackSettingsStorageCleared();
        assert.equal(restoreCount, 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: youtube-nocookie toggle restores active playback before switching host", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture({
            callbacks: {
                restoreActivePlayback: () => {
                    restoreCount += 1;
                }
            }
        });
        let restoreCount = 0;

        controller.setupPlaybackSettings();
        ui.el.youtubeNoCookieToggle.checked = true;
        invokeListener(ui.el.youtubeNoCookieToggle, "change", {});

        assert.equal(ui.playback.useYoutubeNoCookie, true);
        assert.equal(globalThis.localStorage.getItem("useYoutubeNoCookie"), "true");
        assertLegacyPlaybackSettingsStorageCleared();
        assert.equal(restoreCount, 1);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: archive playback toggle persists while playback settings are hidden", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "false"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();
        assertPlaybackSettingsGroupHidden(ui);
        assertExperimentalPlaybackSettingsHidden(ui);

        ui.el.playArchiveToEndToggle.checked = true;
        invokeListener(ui.el.playArchiveToEndToggle, "change", {});

        assert.equal(ui.playback.playArchiveToEnd, true);
        assert.equal(ui.el.playArchiveToEndToggle.checked, true);
        assert.equal(globalThis.localStorage.getItem("playArchiveToEnd"), "true");
        assertLegacyPlaybackSettingsStorageCleared();

        const nextFixture = createPlaybackSettingsFixture();
        nextFixture.controller.setupPlaybackSettings();

        assert.equal(nextFixture.ui.playback.playArchiveToEnd, true);
        assert.equal(nextFixture.ui.el.playArchiveToEndToggle.checked, true);
        assertPlaybackSettingsGroupHidden(nextFixture.ui);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: continuous and loop toggles keep page playback preferences", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();
        controller.setExperimentalPlaybackSettings(true);
        ui.el.continuousPlaybackToggle.checked = true;
        invokeListener(ui.el.continuousPlaybackToggle, "change", {});
        ui.el.loopPlaybackToggle.checked = true;
        invokeListener(ui.el.loopPlaybackToggle, "change", {});

        assert.equal(ui.playback.continuousPlayback, true);
        assert.equal(ui.playback.loopPlayback, true);
        assertLegacyPlaybackSettingsStorageCleared();

        controller.applyPlaybackSettingsFromStorage();

        assert.equal(ui.playback.continuousPlayback, true);
        assert.equal(ui.playback.loopPlayback, true);
        assertLegacyPlaybackSettingsStorageCleared();
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: hidden experimental playback setting shows and hides playback settings", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();
        assert.equal(ui.playback.showExperimentalPlaybackSettings, false);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsHidden(ui);

        controller.setExperimentalPlaybackSettings(true);

        assert.equal(ui.playback.showExperimentalPlaybackSettings, true);
        assertLegacyPlaybackSettingsStorageCleared();
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsVisible(ui);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: hidden experimental playback setting does not persist across boot", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true"
        });
        let { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();
        controller.setExperimentalPlaybackSettings(true);

        assert.equal(ui.playback.showExperimentalPlaybackSettings, true);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsVisible(ui);
        assertLegacyPlaybackSettingsStorageCleared();

        ({ ui, controller } = createPlaybackSettingsFixture());

        controller.setupPlaybackSettings();

        assert.equal(ui.playback.showExperimentalPlaybackSettings, false);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
        assertLegacyPlaybackSettingsStorageCleared();
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: enabling experimental playback keeps load default preferences", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true",
            showExperimentalPlaybackSettings: "false",
            stopAtEndTime: "true",
            continuousPlayback: "true",
            loopPlayback: "false"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();
        controller.setExperimentalPlaybackSettings(true);

        assert.equal(ui.playback.showExperimentalPlaybackSettings, true);
        assert.equal(ui.playback.playArchiveToEnd, false);
        assert.equal(ui.playback.continuousPlayback, false);
        assert.equal(ui.playback.loopPlayback, false);
        assert.equal(ui.el.playArchiveToEndToggle.checked, false);
        assert.equal(ui.el.continuousPlaybackToggle.checked, false);
        assert.equal(ui.el.loopPlaybackToggle.checked, false);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsVisible(ui);
        assertLegacyPlaybackSettingsStorageCleared();
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: disabling hidden experimental playback clears continuation effects", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();
        controller.setExperimentalPlaybackSettings(true);
        ui.el.continuousPlaybackToggle.checked = true;
        invokeListener(ui.el.continuousPlaybackToggle, "change", {});
        ui.el.loopPlaybackToggle.checked = true;
        invokeListener(ui.el.loopPlaybackToggle, "change", {});
        controller.setExperimentalPlaybackSettings(false);

        assert.equal(ui.playback.showExperimentalPlaybackSettings, false);
        assert.equal(ui.playback.playArchiveToEnd, false);
        assert.equal(ui.playback.continuousPlayback, false);
        assert.equal(ui.playback.loopPlayback, false);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
        assertLegacyPlaybackSettingsStorageCleared();

        controller.setExperimentalPlaybackSettings(true);

        assert.equal(ui.playback.showExperimentalPlaybackSettings, true);
        assert.equal(ui.playback.continuousPlayback, true);
        assert.equal(ui.playback.loopPlayback, true);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsVisible(ui);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: hiding experimental playback settings moves focus to settings back button", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();
        ui.el.closeSettingsPanelBtn = document.createElement("button");
        document.body.append(
            ui.el.closeSettingsPanelBtn,
            ui.el.playbackSettingsGroup
        );
        ui.el.playbackSettingsGroup.append(ui.el.experimentalPlaybackSettingsGroup);
        ui.el.experimentalPlaybackSettingsGroup.append(ui.el.loopPlaybackToggle);

        controller.setupPlaybackSettings();
        controller.setExperimentalPlaybackSettings(true);
        ui.el.loopPlaybackToggle.focus();
        controller.setExperimentalPlaybackSettings(false);

        assert.equal(document.activeElement, ui.el.closeSettingsPanelBtn);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: hiding playback settings moves focus to settings back button", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();
        ui.el.closeSettingsPanelBtn = document.createElement("button");
        document.body.append(
            ui.el.closeSettingsPanelBtn,
            ui.el.playbackSettingsGroup
        );
        ui.el.playbackSettingsGroup.append(ui.el.playArchiveToEndToggle);

        controller.setupPlaybackSettings();
        ui.el.playArchiveToEndToggle.focus();
        ui.el.thumbToggle.checked = false;
        invokeListener(ui.el.thumbToggle, "change", {});

        assert.equal(document.activeElement, ui.el.closeSettingsPanelBtn);
        assertPlaybackSettingsGroupHidden(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupPlaybackSettings: thumbnail toggle controls experimental playback entry visibility", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        seedPlaybackSettingsStorage({
            showThumbnails: "true",
            showExperimentalPlaybackSettings: "true",
            showExperimentalPlaybackSettingsHiddenResetV1: "true",
            continuousPlayback: "true"
        });
        const { ui, controller } = createPlaybackSettingsFixture();

        controller.setupPlaybackSettings();
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
        assert.equal(ui.playback.showExperimentalPlaybackSettings, false);
        assertLegacyPlaybackSettingsStorageCleared();

        controller.setExperimentalPlaybackSettings(true);
        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsVisible(ui);
        assert.equal(ui.playback.playArchiveToEnd, false);
        assert.equal(ui.playback.continuousPlayback, false);

        ui.el.thumbToggle.checked = false;
        invokeListener(ui.el.thumbToggle, "change", {});

        assertPlaybackSettingsGroupHidden(ui);
        assertExperimentalPlaybackSettingsHidden(ui);
        assert.equal(ui.playback.showExperimentalPlaybackSettings, true);
        assert.equal(ui.playback.playArchiveToEnd, false);
        assert.equal(ui.playback.continuousPlayback, false);

        ui.el.thumbToggle.checked = true;
        invokeListener(ui.el.thumbToggle, "change", {});

        assertPlaybackSettingsGroupVisible(ui);
        assertExperimentalPlaybackSettingsVisible(ui);
        assert.equal(ui.playback.playArchiveToEnd, false);
        assert.equal(ui.playback.continuousPlayback, false);
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});

test("setupTheme: toggle change updates document theme class and storage", () => {
    const restoreDom = installFakeDom();
    const prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = createFakeLocalStorage();
    try {
        const themeToggle = document.createElement("input");
        themeToggle.checked = false;
        const ui = {
            el: {
                themeToggle
            }
        };

        setupTheme({ ui });
        assert.equal(document.documentElement.classList.contains("dark-theme"), false);
        assert.equal(document.documentElement.style.colorScheme, "light");

        themeToggle.checked = true;
        invokeListener(themeToggle, "change", {});

        assert.equal(document.documentElement.classList.contains("dark-theme"), true);
        assert.equal(document.documentElement.style.colorScheme, "dark");
        assert.equal(globalThis.localStorage.getItem("theme"), "dark");

        themeToggle.checked = false;
        invokeListener(themeToggle, "change", {});

        assert.equal(document.documentElement.classList.contains("dark-theme"), false);
        assert.equal(document.documentElement.style.colorScheme, "light");
        assert.equal(globalThis.localStorage.getItem("theme"), "light");
    } finally {
        globalThis.localStorage = prevLocalStorage;
        restoreDom();
    }
});
