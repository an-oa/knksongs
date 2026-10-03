import { getSearchBooleanFilterElements } from "../../lib/search-boolean-filters.mjs";
import {
    clearSearchQueryValidationIfValid,
    validateSearchQueryInput
} from "../search-query-validation.mjs";
import { createSidebarPopoverController } from "./popover.mjs";
import { createSidebarSubpanelController } from "./subpanel.mjs";
import type { AppUiState } from "../../state.types";

type SidebarBookmarkUiController = {
    closeBookmarkModal: (options?: { restoreFocus?: boolean }) => void;
    openBookmarkBrowser: (options?: { returnFocusEl?: HTMLElement | null }) => void;
    setupBookmarkHandlers: () => void;
    openBookmarkModal: (
        songKey: string,
        options?: { returnFocusEl?: HTMLElement | null; closeSidebarOnExit?: boolean }
    ) => void;
    removeSongFromActiveBookmark: (songKey: string) => void;
};

type SidebarControllerInput = {
    ui: Pick<AppUiState, "el" | "settingsPanel">;
    callbacks: {
        getBookmarkUiController: () => SidebarBookmarkUiController | null;
        isIOSWebKit: () => boolean;
        markFilterTouched: (options?: { immediate?: boolean }) => void;
        markQueryTouched: () => void;
        commitDateInputChange: (target: HTMLSelectElement, options?: { resetDependentValues?: boolean }) => void;
        commitDateSelectionClear: (kind: string) => void;
        clearSearch: () => void;
        onOpenChange?: (open: boolean) => void;
    };
};

/**
 * サイドバー関連の UI 操作をまとめるコントローラーを作成する。
 */
export function createSidebarController(input: SidebarControllerInput) {
    const { ui, callbacks } = input;
    const settingsPanelUi = ui.settingsPanel;
    const settingsSubpanel = createSidebarSubpanelController({
        getPanel: () => ui.el.settingsSidebarPanel,
        getSidebar: () => ui.el.sidebar,
        getBackgroundElements: () => [ui.el.sidebarHeader, ui.el.sidebarScrollArea],
        getOpener: () => ui.el.openSettingsPanelBtn,
        state: settingsPanelUi
    });
    const {
        getBookmarkUiController,
        isIOSWebKit,
        markFilterTouched,
        markQueryTouched,
        commitDateInputChange,
        commitDateSelectionClear,
        clearSearch,
        onOpenChange
    } = callbacks;
    let closeSidebarMenu: (() => void) | null = null;

    /**
     * 表示設定パネルを開く。
     * @param {{ returnFocusEl?: HTMLElement | null } | undefined} options
     */
    function openSettingsPanel(options?: { returnFocusEl?: HTMLElement | null }): void {
        settingsSubpanel.open({
            returnFocusEl: options?.returnFocusEl,
            focusEl: ui.el.closeSettingsPanelBtn
        });
    }

    /**
     * 表示設定パネルを閉じる。
     * @param {{ restoreFocus?: boolean } | undefined} options
     */
    function closeSettingsPanel(options?: { restoreFocus?: boolean }): void {
        settingsSubpanel.close(options);
    }

    /**
     * ブックマーク UI ハンドラーの初期化を委譲する。
     */
    function setupBookmarkHandlers(): void {
        const bookmarkUiController = getBookmarkUiController();
        if (!bookmarkUiController) return;
        bookmarkUiController.setupBookmarkHandlers();
    }

    /**
     * 曲追加用のブックマークモーダル表示を委譲する。
     * @param {string} songKey
     */
    function openBookmarkModal(songKey: string): void {
        const bookmarkUiController = getBookmarkUiController();
        const sidebar = ui.el.sidebar;
        const openBtn = ui.el.openSidebarBtn;
        if (!bookmarkUiController || !sidebar || !openBtn) return;
        const returnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const sidebarWasActive = sidebar.classList.contains("active");
        if (!sidebarWasActive) {
            openBtn.click();
        }
        bookmarkUiController.openBookmarkModal(songKey, {
            returnFocusEl,
            closeSidebarOnExit: !sidebarWasActive
        });
    }

    /**
     * アクティブブックマークからの曲削除を委譲する。
     * @param {string} songKey
     */
    function removeSongFromActiveBookmark(songKey: string): void {
        const bookmarkUiController = getBookmarkUiController();
        if (!bookmarkUiController) return;
        bookmarkUiController.removeSongFromActiveBookmark(songKey);
    }

    /**
     * 検索 UI・サイドバー・日付入力・各種ボタンのイベントを設定する。
     */
    function setupUIHandlers(): void {
        const sidebar = ui.el.sidebar;
        const openBtn = ui.el.openSidebarBtn;
        const closeBtn = ui.el.closeSidebarBtn;
        const overlay = ui.el.sidebarOverlay;
        const clearBtn = ui.el.clearBtn;
        const dateFromYear = ui.el.dateFromYear;
        const dateFromMonth = ui.el.dateFromMonth;
        const dateFromDay = ui.el.dateFromDay;
        const dateToYear = ui.el.dateToYear;
        const dateToMonth = ui.el.dateToMonth;
        const dateToDay = ui.el.dateToDay;
        let lastFocusedElement: HTMLElement | null = null;

        if (!sidebar || !openBtn || !closeBtn || !overlay || !clearBtn) return;
        const popoverController = createSidebarPopoverController({
            sidebar,
            sidebarSheet: ui.el.sidebarSheet,
            mainContent: ui.el.mainContent,
            openButton: openBtn
        });

        /**
         * サイドバーを開き、フォーカスとARIA状態を同期する。
         */
        const openSidebarMenu = (): void => {
            if (sidebar.classList.contains("active")) return;
            const bookmarkUiController = getBookmarkUiController();
            closeSettingsPanel({ restoreFocus: false });
            if (bookmarkUiController) {
                bookmarkUiController.closeBookmarkModal({ restoreFocus: false });
            }
            popoverController.clearPendingHide();
            const usesPopover = popoverController.show();
            sidebar.classList.add("active");
            if (!usesPopover) overlay.classList.add("show");
            lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            popoverController.setMainContentInert(true);
            popoverController.syncExpandedState(true);
            focusSidebarFirst();
            onOpenChange?.(true);
        };

        openBtn.addEventListener("click", openSidebarMenu);

        /** サイドバーを閉じ、背景操作と開く前のフォーカスを復帰する。 */
        const closeMenu = (): void => {
            if (!sidebar.classList.contains("active")) return;
            const bookmarkUiController = getBookmarkUiController();
            closeSettingsPanel({ restoreFocus: false });
            if (bookmarkUiController) {
                bookmarkUiController.closeBookmarkModal({ restoreFocus: false });
            }
            blurSidebarActiveElement(sidebar);
            sidebar.classList.remove("active");
            overlay.classList.remove("show");
            popoverController.scheduleHideAfterClose();
            popoverController.setMainContentInert(false);
            popoverController.syncExpandedState(false);
            onOpenChange?.(false);
            if (lastFocusedElement) {
                lastFocusedElement.focus();
                return;
            }
            openBtn.focus();
        };

        closeSidebarMenu = closeMenu;
        closeBtn.addEventListener("click", closeMenu);
        overlay.addEventListener("click", closeMenu);
        sidebar.addEventListener("click", (event) => {
            if (event.target === sidebar) closeMenu();
        });
        if (ui.el.openSettingsPanelBtn) {
            ui.el.openSettingsPanelBtn.addEventListener("click", () => {
                const bookmarkUiController = getBookmarkUiController();
                if (bookmarkUiController) {
                    bookmarkUiController.closeBookmarkModal({ restoreFocus: false });
                }
                openSettingsPanel({
                    returnFocusEl: ui.el.openSettingsPanelBtn
                });
            });
        }
        if (ui.el.closeSettingsPanelBtn) {
            ui.el.closeSettingsPanelBtn.addEventListener("click", () => {
                closeSettingsPanel({ restoreFocus: true });
            });
        }
        if (ui.el.closeSettingsSidebarBtn) {
            ui.el.closeSettingsSidebarBtn.addEventListener("click", closeMenu);
        }
        if (ui.el.openBookmarkPanelBtn) {
            ui.el.openBookmarkPanelBtn.addEventListener("click", () => {
                const bookmarkUiController = getBookmarkUiController();
                closeSettingsPanel({ restoreFocus: false });
                if (bookmarkUiController) {
                    bookmarkUiController.openBookmarkBrowser({
                        returnFocusEl: ui.el.openBookmarkPanelBtn
                    });
                }
            });
        }
        if (ui.el.closeBookmarkPanelBtn) {
            ui.el.closeBookmarkPanelBtn.addEventListener("click", () => {
                const bookmarkUiController = getBookmarkUiController();
                if (bookmarkUiController) {
                    bookmarkUiController.closeBookmarkModal({ restoreFocus: true });
                }
            });
        }
        if (ui.el.closeBookmarkSidebarBtn) {
            ui.el.closeBookmarkSidebarBtn.addEventListener("click", closeMenu);
        }
        document.addEventListener("keydown", (event) => {
            const bookmarkUiController = getBookmarkUiController();
            if (event.key === "Escape") {
                if (ui.el.settingsSidebarPanel && !ui.el.settingsSidebarPanel.hidden) {
                    event.preventDefault();
                    closeSettingsPanel({ restoreFocus: true });
                    return;
                }
                if (ui.el.bookmarkSidebarPanel && !ui.el.bookmarkSidebarPanel.hidden) {
                    event.preventDefault();
                    if (bookmarkUiController) {
                        bookmarkUiController.closeBookmarkModal({ restoreFocus: true });
                    }
                    return;
                }
                closeMenu();
            }
            if (event.key === "Tab") trapSidebarFocus(event, sidebar);
        });

        getSearchBooleanFilterElements(ui).forEach((checkbox) => {
            if (!checkbox) return;
            checkbox.addEventListener("change", () => {
                markFilterTouched();
            });
        });
        if (ui.el.searchBox) {
            ui.el.searchBox.addEventListener("input", () => {
                clearSearchQueryValidationIfValid(ui.el.searchBox, ui.el.searchBoxError);
                markQueryTouched();
            });
            ui.el.searchBox.addEventListener("blur", () => {
                validateSearchQueryInput(ui.el.searchBox, ui.el.searchBoxError);
            });
        }

        [dateFromYear, dateFromMonth, dateFromDay, dateToYear, dateToMonth, dateToDay].forEach((element) => {
            if (!element) return;
            element.addEventListener("change", () => {
                const isIOS = isIOSWebKit();
                const group = element.closest(".date-select-group");
                const isYearChange = element === dateFromYear || element === dateToYear;
                const isMonthChange = element === dateFromMonth || element === dateToMonth;
                if (isIOS && group && (isYearChange || isMonthChange)) {
                    group.classList.add("is-updating");
                } else {
                    moveDateFocusIfNeeded(element, dateFromYear, dateFromMonth, dateToYear, dateToMonth);
                }
                commitDateInputChange(element, { resetDependentValues: isIOS });
                if (isIOS && group && (isYearChange || isMonthChange)) {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            group.classList.remove("is-updating");
                        });
                    });
                }
            });
        });

        [ui.el.clearDateFromBtn, ui.el.clearDateToBtn].forEach((button, index) => {
            if (!button) return;
            button.addEventListener("click", () => {
                commitDateSelectionClear(index === 0 ? "from" : "to");
            });
        });

        clearBtn.addEventListener("click", clearSearch);
        setupBookmarkHandlers();
    }

    /**
     * 日付入力時に次のセレクトへフォーカス移動する。
     * @param {HTMLSelectElement} target
     * @param {HTMLSelectElement | null | undefined} fromYear
     * @param {HTMLSelectElement | null | undefined} fromMonth
     * @param {HTMLSelectElement | null | undefined} toYear
     * @param {HTMLSelectElement | null | undefined} toMonth
     */
    function moveDateFocusIfNeeded(
        target: HTMLSelectElement,
        fromYear: HTMLSelectElement | null | undefined,
        fromMonth: HTMLSelectElement | null | undefined,
        toYear: HTMLSelectElement | null | undefined,
        toMonth: HTMLSelectElement | null | undefined
    ) {
        if (fromYear && target === fromYear && fromMonth && fromYear.value) {
            fromMonth.focus();
            return;
        }
        if (fromMonth && target === fromMonth && fromMonth.value) {
            const fromDay = ui.el.dateFromDay;
            if (fromDay) {
                fromDay.focus();
                return;
            }
        }
        if (toYear && target === toYear && toMonth && toYear.value) {
            toMonth.focus();
            return;
        }
        if (toMonth && target === toMonth && toMonth.value) {
            const toDay = ui.el.dateToDay;
            if (toDay) {
                toDay.focus();
            }
        }
    }

    /**
     * サイドバー内の現在フォーカス要素を外す。
     * @param {HTMLElement} sidebar
     */
    function blurSidebarActiveElement(sidebar: HTMLElement) {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return;
        if (!sidebar.contains(active)) return;
        if (typeof active.blur === "function") {
            active.blur();
        }
    }

    /**
     * サイドバー内でフォーカス可能な要素一覧を取得する。
     * @param {HTMLElement | null | undefined} sidebar
     * @returns {HTMLElement[]}
     */
    function getFocusableInSidebar(sidebar: HTMLElement | null | undefined): HTMLElement[] {
        if (!sidebar) return [];
        const focusable = sidebar.querySelectorAll([
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            '[tabindex]:not([tabindex="-1"])'
        ].join(","));
        return Array.from(focusable).filter((element): element is HTMLElement => {
            if (!(element instanceof HTMLElement)) return false;
            for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
                if (ancestor.hasAttribute("inert") || ancestor.hidden) return false;
            }
            const style = window.getComputedStyle(element);
            return style.display !== "none" && style.visibility !== "hidden";
        });
    }

    /**
     * サイドバー内の先頭フォーカス可能要素へフォーカスする。
     */
    function focusSidebarFirst(): void {
        const sidebar = ui.el.sidebar;
        const focusable = getFocusableInSidebar(sidebar);
        if (focusable.length > 0) {
            focusable[0].focus();
            return;
        }
        if (sidebar) {
            sidebar.setAttribute("tabindex", "-1");
            sidebar.focus();
        }
    }

    /**
     * 開いているサイドバー内で Tab フォーカスを循環させる。
     * @param {KeyboardEvent} event
     * @param {HTMLElement | null} sidebar
     */
    function trapSidebarFocus(event: KeyboardEvent, sidebar: HTMLElement | null): void {
        if (!sidebar || !sidebar.classList.contains("active")) return;
        const focusable = getFocusableInSidebar(sidebar);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
            return;
        }
        if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    return {
        setupUIHandlers,
        openBookmarkModal,
        removeSongFromActiveBookmark,
        closeSidebarMenu: () => {
            if (typeof closeSidebarMenu === "function") {
                closeSidebarMenu();
            }
        }
    };
}
