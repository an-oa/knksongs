import type { AppUiElements } from "../../state.types";
import { getStoredSettingText, setStoredSettingText } from "../../lib/storage/settings-storage.mjs";

/**
 * 指定 ID の input 要素参照を返す。
 * @param {string} id
 * @returns {HTMLInputElement | null}
 */
function getInputElementById(id: string): HTMLInputElement | null {
    return document.getElementById(id) as HTMLInputElement | null;
}

/**
 * 指定 ID の button 要素参照を返す。
 * @param {string} id
 * @returns {HTMLButtonElement | null}
 */
function getButtonElementById(id: string): HTMLButtonElement | null {
    return document.getElementById(id) as HTMLButtonElement | null;
}

/**
 * 初期化時に利用する DOM 要素参照をまとめて取得する。
 * @returns {import("../../state.types").AppUiElements}
 */
export function collectUiElements(): AppUiElements {
    const sidebar = document.getElementById("sidebar");
    return {
        header: document.querySelector(".header"),
        sidebar,
        sidebarSheet: sidebar ? sidebar.querySelector(".sidebar-sheet") : null,
        sidebarHeader: sidebar ? sidebar.querySelector(".sidebar-header") : null,
        sidebarScrollArea: sidebar ? sidebar.querySelector(".sidebar-scroll-area") : null,
        sidebarOverlay: document.getElementById("sidebar-overlay"),
        mainContent: document.querySelector(".main-content"),
        openSidebarBtn: document.getElementById("open-sidebar"),
        closeSidebarBtn: document.getElementById("close-sidebar"),
        resultList: document.getElementById("resultList"),
        resultCount: document.getElementById("resultCount"),
        resultTailSentinel: document.getElementById("resultTailSentinel"),
        searchBox: getInputElementById("searchBox"),
        searchBoxError: document.getElementById("searchBoxError"),
        clearBtn: getButtonElementById("clearBtn"),
        collabHostOnly: getInputElementById("collabHostOnly"),
        collabGuestOnly: getInputElementById("collabGuestOnly"),
        relayOnly: getInputElementById("relayOnly"),
        harmonyOnly: getInputElementById("harmonyOnly"),
        dateFromYear: document.getElementById("dateFromYear") as HTMLSelectElement | null,
        dateFromMonth: document.getElementById("dateFromMonth") as HTMLSelectElement | null,
        dateFromDay: document.getElementById("dateFromDay") as HTMLSelectElement | null,
        dateToYear: document.getElementById("dateToYear") as HTMLSelectElement | null,
        dateToMonth: document.getElementById("dateToMonth") as HTMLSelectElement | null,
        dateToDay: document.getElementById("dateToDay") as HTMLSelectElement | null,
        clearDateFromBtn: getButtonElementById("clearDateFromBtn"),
        clearDateToBtn: getButtonElementById("clearDateToBtn"),
        themeToggle: getInputElementById("theme-toggle"),
        thumbToggle: getInputElementById("thumbnail-toggle"),
        youtubeNoCookieToggle: getInputElementById("youtube-nocookie-toggle"),
        playArchiveToEndToggle: getInputElementById("play-archive-to-end-toggle"),
        continuousPlaybackToggle: getInputElementById("continuous-playback-toggle"),
        loopPlaybackToggle: getInputElementById("loop-playback-toggle"),
        playbackSettingsGroup: document.getElementById("playback-settings-group"),
        experimentalPlaybackSettingsGroup: document.getElementById("experimental-playback-settings"),
        openSettingsPanelBtn: getButtonElementById("open-settings-panel"),
        settingsSidebarPanel: document.getElementById("settings-sidebar-panel"),
        closeSettingsPanelBtn: getButtonElementById("close-settings-panel"),
        closeSettingsSidebarBtn: getButtonElementById("close-settings-sidebar"),
        formatsList: document.getElementById("formatsList"),
        openBookmarkPanelBtn: getButtonElementById("open-bookmark-panel"),
        bookmarkSidebarPanel: document.getElementById("bookmark-sidebar-panel"),
        closeBookmarkPanelBtn: getButtonElementById("close-bookmark-panel"),
        closeBookmarkSidebarBtn: getButtonElementById("close-bookmark-sidebar"),
        bookmarkPanelCreate: document.getElementById("bookmark-panel-create"),
        bookmarkPanelNewName: getInputElementById("bookmark-panel-new-name"),
        bookmarkPanelError: document.getElementById("bookmark-panel-error"),
        bookmarkPanelCreateBtn: getButtonElementById("bookmark-panel-create-btn"),
        bookmarkPanelExportBtn: getButtonElementById("bookmark-panel-export-btn"),
        bookmarkPanelImportBtn: getButtonElementById("bookmark-panel-import-btn"),
        bookmarkPanelImportInput: getInputElementById("bookmark-panel-import-input"),
        bookmarkList: document.getElementById("bookmark-list"),
        bookmarkNotificationRegion: document.getElementById("bookmark-notification-region")
    };
}

/**
 * テーマのクラスとブラウザ標準 UI 向けの色スキームを同期する。
 * @param {boolean} isDarkMode
 */
export function applyDocumentTheme(isDarkMode: boolean): void {
    document.documentElement.classList.toggle("dark-theme", isDarkMode);
    document.documentElement.style.colorScheme = isDarkMode ? "dark" : "light";
}

/**
 * 保存値またはシステム設定からテーマを適用する。
 */
export function applyThemeFromStorage({ ui }: { ui: { el: AppUiElements } }): void {
    const themeToggle = ui.el.themeToggle;
    const savedTheme = getStoredSettingText("theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDarkMode = savedTheme ? savedTheme === "dark" : systemPrefersDark;
    applyDocumentTheme(isDarkMode);
    if (themeToggle) themeToggle.checked = isDarkMode;
}

/**
 * テーマ状態を初期化し、トグル変更を保存する。
 */
export function setupTheme({ ui }: { ui: { el: AppUiElements } }): void {
    const themeToggle = ui.el.themeToggle;
    applyThemeFromStorage({ ui });
    if (!themeToggle) return;
    themeToggle.addEventListener("change", () => {
        const isDarkNow = themeToggle.checked;
        applyDocumentTheme(isDarkNow);
        setStoredSettingText("theme", isDarkNow ? "dark" : "light");
    });
}
