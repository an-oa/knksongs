import test from "node:test";
import { createDateFilterController } from "../app/ui/date/filter.mts";
import assert from "node:assert/strict";
import { createSidebarController } from "../app/ui/sidebar/ui.mts";
import { installFakeDom, invokeListener, installFakeAnimationFrames } from "./test-helpers.mts";

/**
 * サイドバーUIテスト用の最小状態を作る。
 */
function createSidebarUiState() {
    const sidebar = document.createElement("aside");
    sidebar.setAttribute("id", "sidebar");
    const mainContent = document.createElement("main");
    mainContent.className = "main-content";
    const sidebarHeader = document.createElement("div");
    sidebarHeader.className = "sidebar-header";
    const sidebarScrollArea = document.createElement("div");
    sidebarScrollArea.className = "sidebar-scroll-area";
    const settingsSidebarPanel = document.createElement("div");
    const bookmarkSidebarPanel = document.createElement("div");
    const openSidebarBtn = document.createElement("button");
    const closeSidebarBtn = document.createElement("button");
    const overlay = document.createElement("div");
    const clearBtn = document.createElement("button");
    const openSettingsPanelBtn = document.createElement("button");
    const closeSettingsPanelBtn = document.createElement("button");
    const closeSettingsSidebarBtn = document.createElement("button");
    const openBookmarkPanelBtn = document.createElement("button");
    const closeBookmarkPanelBtn = document.createElement("button");
    const closeBookmarkSidebarBtn = document.createElement("button");
    const searchBox = document.createElement("input");
    const collabHostOnly = document.createElement("input");
    const collabGuestOnly = document.createElement("input");
    const relayOnly = document.createElement("input");
    const harmonyOnly = document.createElement("input");
    const dateFromYear = document.createElement("select");
    const dateFromMonth = document.createElement("select");
    const dateFromDay = document.createElement("select");
    const dateToYear = document.createElement("select");
    const dateToMonth = document.createElement("select");
    const dateToDay = document.createElement("select");
    const clearDateFromBtn = document.createElement("button");
    const clearDateToBtn = document.createElement("button");

    openSidebarBtn.setAttribute("id", "open-sidebar");
    closeSidebarBtn.setAttribute("id", "close-sidebar");
    overlay.setAttribute("id", "sidebar-overlay");
    clearBtn.setAttribute("id", "clearBtn");

    settingsSidebarPanel.hidden = true;
    bookmarkSidebarPanel.hidden = true;

    sidebarHeader.append(closeSidebarBtn, clearBtn);
    const fromGroup = document.createElement("div");
    fromGroup.className = "date-select-group";
    fromGroup.append(dateFromYear, dateFromMonth, dateFromDay);
    const toGroup = document.createElement("div");
    toGroup.className = "date-select-group";
    toGroup.append(dateToYear, dateToMonth, dateToDay);
    sidebarScrollArea.append(
        searchBox, fromGroup, clearDateFromBtn, toGroup, clearDateToBtn,
        collabHostOnly, collabGuestOnly, relayOnly, harmonyOnly,
        openBookmarkPanelBtn, openSettingsPanelBtn
    );
    settingsSidebarPanel.append(closeSettingsPanelBtn, closeSettingsSidebarBtn);
    bookmarkSidebarPanel.append(closeBookmarkPanelBtn, closeBookmarkSidebarBtn);
    sidebar.append(sidebarHeader, sidebarScrollArea, settingsSidebarPanel, bookmarkSidebarPanel);
    document.body.append(mainContent, sidebar, openSidebarBtn, overlay);

    return {
        ui: {
            el: {
                sidebar,
                sidebarSheet: null,
                sidebarHeader,
                sidebarScrollArea,
                sidebarOverlay: overlay,
                mainContent,
                openSidebarBtn,
                closeSidebarBtn,
                clearBtn,
                settingsSidebarPanel,
                bookmarkSidebarPanel,
                openSettingsPanelBtn,
                closeSettingsPanelBtn,
                closeSettingsSidebarBtn,
                openBookmarkPanelBtn,
                closeBookmarkPanelBtn,
                closeBookmarkSidebarBtn,
                searchBox,
                collabHostOnly,
                collabGuestOnly,
                relayOnly,
                harmonyOnly,
                dateFromYear,
                dateFromMonth,
                dateFromDay,
                dateToYear,
                dateToMonth,
                dateToDay,
                clearDateFromBtn,
                clearDateToBtn
            },
            settingsPanel: {
                returnFocusEl: null
            }
        },
        openSidebarBtn,
        closeSidebarBtn,
        overlay,
        mainContent,
        clearBtn,
        fromGroup
    };
}

type BookmarkUiMockOverrides = Partial<NonNullable<
    ReturnType<Parameters<typeof createSidebarController>[0]["callbacks"]["getBookmarkUiController"]>
>>;

/** ブックマーク操作の既定モックと、モーダルを開く呼び出し記録を作る。 */
function createBookmarkUiMock(overrides: BookmarkUiMockOverrides = {}) {
    const openBookmarkCalls: Parameters<NonNullable<BookmarkUiMockOverrides["openBookmarkModal"]>>[] = [];
    const controller = {
        closeBookmarkModal() {},
        openBookmarkBrowser() {},
        setupBookmarkHandlers() {},
        openBookmarkModal(...args: Parameters<NonNullable<BookmarkUiMockOverrides["openBookmarkModal"]>>) {
            openBookmarkCalls.push(args);
        },
        removeSongFromActiveBookmark() {},
        ...overrides
    };
    return { controller, openBookmarkCalls };
}

/** サイドバーコントローラー用のコールバックを作る。 */
function createSidebarCallbacks(state: {
    bookmarkUiController?: ReturnType<typeof createBookmarkUiMock>["controller"];
    onOpenChange?: Parameters<typeof createSidebarController>[0]["callbacks"]["onOpenChange"];
} = {}): Parameters<typeof createSidebarController>[0]["callbacks"] {
    const bookmarkUiController = state.bookmarkUiController ?? createBookmarkUiMock().controller;
    return {
        getBookmarkUiController: () => bookmarkUiController,
        isIOSWebKit: () => false,
        markFilterTouched: () => {},
        markQueryTouched: () => {},
        commitDateInputChange: () => {},
        commitDateSelectionClear: () => {},
        clearSearch: () => {},
        onOpenChange: state.onOpenChange
    };
}

test("sidebar: opening settings panel makes background inert and focuses back button", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, openSidebarBtn } = createSidebarUiState();
        let closedBookmarkModal = 0;
        const controller = createSidebarController({
            ui,
            callbacks: createSidebarCallbacks({
                bookmarkUiController: createBookmarkUiMock({
                    closeBookmarkModal() {
                        closedBookmarkModal += 1;
                    }
                }).controller
            })
        });

        controller.setupUIHandlers();
        invokeListener(openSidebarBtn, "click", {});
        invokeListener(ui.el.openSettingsPanelBtn, "click", {});

        assert.equal(ui.el.settingsSidebarPanel.hidden, false);
        assert.equal(ui.el.settingsSidebarPanel.getAttribute("aria-hidden"), "false");
        assert.equal(ui.el.sidebarHeader.hasAttribute("inert"), true);
        assert.equal(ui.el.sidebarScrollArea.hasAttribute("inert"), true);
        assert.equal(document.activeElement, ui.el.closeSettingsPanelBtn);
        assert.equal(closedBookmarkModal, 2);
    } finally {
        restoreDom();
    }
});

test("sidebar: escape closes settings panel, removes inert, and restores focus", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, openSidebarBtn } = createSidebarUiState();
        const controller = createSidebarController({
            ui,
            callbacks: createSidebarCallbacks()
        });

        controller.setupUIHandlers();
        invokeListener(openSidebarBtn, "click", {});
        invokeListener(ui.el.openSettingsPanelBtn, "click", {});

        let prevented = false;
        invokeListener(restoreDom.document, "keydown", {
            key: "Escape",
            preventDefault() {
                prevented = true;
            }
        });

        assert.equal(prevented, true);
        assert.equal(ui.el.settingsSidebarPanel.hidden, true);
        assert.equal(ui.el.settingsSidebarPanel.getAttribute("aria-hidden"), "true");
        assert.equal(ui.el.sidebarHeader.hasAttribute("inert"), false);
        assert.equal(ui.el.sidebarScrollArea.hasAttribute("inert"), false);
        assert.equal(document.activeElement, ui.el.openSettingsPanelBtn);
    } finally {
        restoreDom();
    }
});

test("sidebar: openBookmarkModal opens sidebar first when closed and passes closeSidebarOnExit", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, closeSidebarBtn } = createSidebarUiState();
        const launcher = document.createElement("button");
        document.body.appendChild(launcher);
        launcher.focus();
        const { controller: bookmarkUiController, openBookmarkCalls } = createBookmarkUiMock();
        const controller = createSidebarController({
            ui,
            callbacks: createSidebarCallbacks({ bookmarkUiController })
        });

        controller.setupUIHandlers();
        controller.openBookmarkModal("song-42");

        assert.equal(ui.el.sidebar.classList.contains("active"), true);
        assert.equal(openBookmarkCalls.length, 1);
        const [songKey, options] = openBookmarkCalls[0];
        assert.equal(songKey, "song-42");
        assert.ok(options);
        assert.equal(options.returnFocusEl, launcher);
        assert.equal(options.closeSidebarOnExit, true);
        assert.equal(document.activeElement, closeSidebarBtn);
    } finally {
        restoreDom();
    }
});

test("sidebar: open button aria-expanded follows sidebar open state", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, openSidebarBtn, overlay, mainContent } = createSidebarUiState();
        openSidebarBtn.setAttribute("aria-expanded", "false");
        const openChangeCalls: boolean[] = [];
        const controller = createSidebarController({
            ui,
            callbacks: createSidebarCallbacks({
                onOpenChange(open) {
                    openChangeCalls.push(open);
                }
            })
        });

        controller.setupUIHandlers();
        invokeListener(openSidebarBtn, "click", {});

        assert.equal(ui.el.sidebar.getAttribute("aria-hidden"), "false");
        assert.equal(openSidebarBtn.getAttribute("aria-expanded"), "true");
        assert.equal(mainContent.hasAttribute("inert"), true);
        assert.deepEqual(openChangeCalls, [true]);

        invokeListener(overlay, "click", {});

        assert.equal(ui.el.sidebar.getAttribute("aria-hidden"), "true");
        assert.equal(openSidebarBtn.getAttribute("aria-expanded"), "false");
        assert.equal(mainContent.hasAttribute("inert"), false);
        assert.deepEqual(openChangeCalls, [true, false]);
    } finally {
        restoreDom();
    }
});

test("sidebar: native popover opens without fallback overlay and backdrop click closes", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, openSidebarBtn, overlay, mainContent } = createSidebarUiState();
        let showPopoverCount = 0;
        let hidePopoverCount = 0;
        ui.el.sidebar.showPopover = () => {
            showPopoverCount += 1;
        };
        ui.el.sidebar.hidePopover = () => {
            hidePopoverCount += 1;
        };
        const controller = createSidebarController({
            ui,
            callbacks: createSidebarCallbacks()
        });

        controller.setupUIHandlers();
        invokeListener(openSidebarBtn, "click", {});

        assert.equal(showPopoverCount, 1);
        assert.equal(overlay.classList.contains("show"), false);
        assert.equal(ui.el.sidebar.classList.contains("active"), true);
        assert.equal(mainContent.hasAttribute("inert"), true);

        invokeListener(ui.el.sidebar, "click", {
            target: ui.el.sidebar
        });

        assert.equal(hidePopoverCount, 1);
        assert.equal(ui.el.sidebar.classList.contains("active"), false);
        assert.equal(ui.el.sidebar.getAttribute("aria-hidden"), "true");
        assert.equal(openSidebarBtn.getAttribute("aria-expanded"), "false");
        assert.equal(mainContent.hasAttribute("inert"), false);
    } finally {
        restoreDom();
    }
});

test("sidebar: escape prioritizes settings panel over bookmark panel", () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, openSidebarBtn } = createSidebarUiState();
        let bookmarkCloseCount = 0;
        const controller = createSidebarController({
            ui,
            callbacks: createSidebarCallbacks({
                bookmarkUiController: createBookmarkUiMock({
                    closeBookmarkModal() {
                        bookmarkCloseCount += 1;
                    }
                }).controller
            })
        });

        controller.setupUIHandlers();
        invokeListener(openSidebarBtn, "click", {});
        ui.el.settingsSidebarPanel.hidden = false;
        ui.el.bookmarkSidebarPanel.hidden = false;
        ui.el.openSettingsPanelBtn.focus();

        let prevented = false;
        invokeListener(restoreDom.document, "keydown", {
            key: "Escape",
            preventDefault() {
                prevented = true;
            }
        });

        assert.equal(prevented, true);
        assert.equal(ui.el.settingsSidebarPanel.hidden, true);
        assert.equal(ui.el.bookmarkSidebarPanel.hidden, false);
        assert.equal(bookmarkCloseCount, 1);
        assert.equal(document.activeElement, ui.el.openSettingsPanelBtn);
    } finally {
        restoreDom();
    }
});

test("sidebar: ios year change clears lower date selects and removes updating class after two frames", () => {
    const restoreDom = installFakeDom();
    const frames = installFakeAnimationFrames();
    try {
        const { ui, fromGroup } = createSidebarUiState();
        ui.el.dateFromYear.value = "2026";
        ui.el.dateFromMonth.value = "03";
        ui.el.dateFromDay.value = "11";
        const markFilterTouchedArgs: ({ immediate?: boolean } | undefined)[] = [];
        const dateController = createDateFilterController({
            ui: { el: ui.el, date: { bounds: null, index: null, pendingValues: null } },
            onDateSelectionChange: () => markFilterTouchedArgs.push({ immediate: true })
        });
        const controller = createSidebarController({
            ui,
            callbacks: {
                ...createSidebarCallbacks(),
                isIOSWebKit: () => true,
                commitDateInputChange: dateController.commitDateInputChange
            }
        });

        controller.setupUIHandlers();
        invokeListener(ui.el.dateFromYear, "change", { target: ui.el.dateFromYear });

        assert.equal(fromGroup.classList.contains("is-updating"), true);
        assert.equal(ui.el.dateFromMonth.value, "");
        assert.equal(ui.el.dateFromDay.value, "");
        assert.deepEqual(markFilterTouchedArgs, [{ immediate: true }]);

        frames.advanceFrame();
        assert.equal(fromGroup.classList.contains("is-updating"), true);
        frames.advanceFrame();
        assert.equal(fromGroup.classList.contains("is-updating"), false);
    } finally {
        frames.cleanup();
        restoreDom();
    }
});
