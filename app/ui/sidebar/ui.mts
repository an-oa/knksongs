import { isImeComposingKeyEvent } from "../../lib/ime-key-event.mjs";
import { createSidebarPopoverController } from "./popover.mjs";
import { createSidebarSubpanelController } from "./subpanel.mjs";
import type { AppUiState } from "../../state.types.mjs";

type SidebarBookmarkUiController = {
    closeBookmarkModal: (options?: { restoreFocus?: boolean }) => void;
    openBookmarkBrowser: (options?: { returnFocusEl?: HTMLElement | null }) => void;
    setupBookmarkHandlers: () => void;
    openBookmarkModal: (
        songKey: string,
        options?: { returnFocusEl?: HTMLElement | null; closeSidebarOnExit?: boolean }
    ) => void;
};

type SidebarControllerInput = {
    ui: Pick<AppUiState, "el" | "settingsPanel">;
    bookmarkUiController: SidebarBookmarkUiController;
    callbacks: {
        onOpenChange?: (open: boolean) => void;
    };
};

/**
 * サイドバー関連の UI 操作をまとめるコントローラーを作成する。
 */
export function createSidebarController(input: SidebarControllerInput) {
    const { ui, bookmarkUiController, callbacks } = input;
    const settingsPanelUi = ui.settingsPanel;
    const settingsSubpanel = createSidebarSubpanelController({
        getPanel: () => ui.el.settingsSidebarPanel,
        getSidebar: () => ui.el.sidebar,
        getBackgroundElements: () => [ui.el.sidebarHeader, ui.el.sidebarScrollArea],
        getOpener: () => ui.el.openSettingsPanelBtn,
        state: settingsPanelUi
    });
    const { onOpenChange } = callbacks;
    // DOM 要素は initUI で集めるため、Popover の制御は setupUIHandlers で作る。
    // 作る前と、必要な要素がないときは、サイドバーの開閉は何もしない。
    let popoverController: ReturnType<typeof createSidebarPopoverController> | null = null;
    let lastFocusedElement: HTMLElement | null = null;

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
     * サイドバーが開いているかを返す。開閉状態は sidebar 要素の active クラスを正とする。
     * @returns 開いていれば true
     */
    function isOpen(): boolean {
        return ui.el.sidebar?.classList.contains("active") === true;
    }

    /**
     * サイドバーを開き、フォーカスとARIA状態を同期する。
     */
    function openSidebarMenu(): void {
        const sidebar = ui.el.sidebar;
        const overlay = ui.el.sidebarOverlay;
        if (!popoverController || !sidebar || !overlay || isOpen()) return;
        closeSettingsPanel({ restoreFocus: false });
        bookmarkUiController.closeBookmarkModal({ restoreFocus: false });
        popoverController.clearPendingHide();
        const usesPopover = popoverController.show();
        sidebar.classList.add("active");
        if (!usesPopover) overlay.classList.add("show");
        lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        popoverController.setMainContentInert(true);
        popoverController.syncExpandedState(true);
        focusSidebarFirst();
        onOpenChange?.(true);
    }

    /** サイドバーを閉じ、背景操作と開く前のフォーカスを復帰する。 */
    function closeSidebarMenu(): void {
        const sidebar = ui.el.sidebar;
        const overlay = ui.el.sidebarOverlay;
        if (!popoverController || !sidebar || !overlay || !isOpen()) return;
        closeSettingsPanel({ restoreFocus: false });
        bookmarkUiController.closeBookmarkModal({ restoreFocus: false });
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
        ui.el.openSidebarBtn?.focus();
    }

    /**
     * 曲追加用のブックマークモーダルを開く。
     * サイドバーが閉じていれば先に開き、モーダルを閉じるときにサイドバーも閉じるよう伝える。
     * @param songKey 追加する曲の参照キー
     */
    function openBookmarkModal(songKey: string): void {
        if (!ui.el.sidebar) return;
        const returnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const sidebarWasOpen = isOpen();
        if (!sidebarWasOpen) openSidebarMenu();
        bookmarkUiController.openBookmarkModal(songKey, {
            returnFocusEl,
            closeSidebarOnExit: !sidebarWasOpen
        });
    }

    /**
     * サイドバーの開閉と、設定パネル・ブックマークパネルの操作イベントを設定する。
     */
    function setupUIHandlers(): void {
        const sidebar = ui.el.sidebar;
        const openBtn = ui.el.openSidebarBtn;
        const closeBtn = ui.el.closeSidebarBtn;
        const overlay = ui.el.sidebarOverlay;

        if (!sidebar || !openBtn || !closeBtn || !overlay) return;
        popoverController = createSidebarPopoverController({
            sidebar,
            sidebarSheet: ui.el.sidebarSheet,
            mainContent: ui.el.mainContent,
            openButton: openBtn
        });

        openBtn.addEventListener("click", openSidebarMenu);
        closeBtn.addEventListener("click", closeSidebarMenu);
        overlay.addEventListener("click", closeSidebarMenu);
        sidebar.addEventListener("click", (event) => {
            if (event.target === sidebar) closeSidebarMenu();
        });
        if (ui.el.openSettingsPanelBtn) {
            ui.el.openSettingsPanelBtn.addEventListener("click", () => {
                bookmarkUiController.closeBookmarkModal({ restoreFocus: false });
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
            ui.el.closeSettingsSidebarBtn.addEventListener("click", closeSidebarMenu);
        }
        if (ui.el.openBookmarkPanelBtn) {
            ui.el.openBookmarkPanelBtn.addEventListener("click", () => {
                closeSettingsPanel({ restoreFocus: false });
                bookmarkUiController.openBookmarkBrowser({
                    returnFocusEl: ui.el.openBookmarkPanelBtn
                });
            });
        }
        if (ui.el.closeBookmarkPanelBtn) {
            ui.el.closeBookmarkPanelBtn.addEventListener("click", () => {
                bookmarkUiController.closeBookmarkModal({ restoreFocus: true });
            });
        }
        if (ui.el.closeBookmarkSidebarBtn) {
            ui.el.closeBookmarkSidebarBtn.addEventListener("click", closeSidebarMenu);
        }
        document.addEventListener("keydown", (event) => {
            // かな漢字変換を取り消す Esc は、入力の途中なので、パネルもサイドバーも閉じない。
            if (event.key === "Escape" && !isImeComposingKeyEvent(event)) {
                if (ui.el.settingsSidebarPanel && !ui.el.settingsSidebarPanel.hidden) {
                    event.preventDefault();
                    closeSettingsPanel({ restoreFocus: true });
                    return;
                }
                if (ui.el.bookmarkSidebarPanel && !ui.el.bookmarkSidebarPanel.hidden) {
                    event.preventDefault();
                    bookmarkUiController.closeBookmarkModal({ restoreFocus: true });
                    return;
                }
                closeSidebarMenu();
            }
            if (event.key === "Tab") trapSidebarFocus(event, sidebar);
        });

        bookmarkUiController.setupBookmarkHandlers();
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
        isOpen,
        openBookmarkModal,
        closeSidebarMenu
    };
}
