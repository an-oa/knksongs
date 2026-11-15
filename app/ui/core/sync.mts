type UiSyncControllerInput = {
    uiSyncPasses: number;
    /** 検索条件の状態を、検索窓と絞り込みの入力欄へ映す。 */
    refreshConditionInputs: () => void;
    applyThemeFromStorage: () => void;
    applyPlaybackSettingsFromStorage: () => void;
    applySiteLanguageFromStorage: () => void;
};

/**
 * 画面復帰時の UI 再同期をまとめて扱うコントローラーを作成する。
 * テーマ・再生設定・サイトの言語は、別のタブで変わっていることがあるので、保存値から読み直す。
 * 検索条件は状態 (ui.search) が正なので読み直さず、状態の値を入力欄へ映し直すだけにする。
 * ブラウザがフォームの値を後から復元することがあるため、次のフレームと少し後にも同じ同期を行う。
 */
export function createUiSyncController(input: UiSyncControllerInput) {
    const {
        uiSyncPasses,
        refreshConditionInputs,
        applyThemeFromStorage,
        applyPlaybackSettingsFromStorage,
        applySiteLanguageFromStorage
    } = input;

    /**
     * 保存値で決まる設定と、検索条件の入力欄を同期する。
     */
    function syncUiState(): void {
        applyThemeFromStorage();
        applyPlaybackSettingsFromStorage();
        applySiteLanguageFromStorage();
        refreshConditionInputs();
    }

    /**
     * UI 同期を実行し、必要に応じて次フレームでも再同期する。
     */
    function scheduleSyncUiState(): void {
        syncUiState();
        if (uiSyncPasses < 2) return;
        requestAnimationFrame(() => syncUiState());
    }

    /**
     * 少し待ってから、もう一度 UI 同期を予約する。
     * @param delayMs 待つ時間。省略時は 200ms
     */
    function scheduleDelayedSync(delayMs?: number): void {
        const delay = Number.isFinite(delayMs) ? delayMs : 200;
        setTimeout(() => scheduleSyncUiState(), delay);
    }

    /**
     * フォーカス復帰時の UI 同期を行う。
     */
    function handleFocusSync(): void {
        scheduleSyncUiState();
    }

    /**
     * ページ再表示時に UI 同期を行う。
     */
    function handleVisibilitySync(): void {
        if (document.visibilityState !== "visible") return;
        scheduleSyncUiState();
    }

    /**
     * pageshow 時に同期し、少し後にももう一度同期する。
     */
    function handlePageShowSync(): void {
        scheduleSyncUiState();
        scheduleDelayedSync();
    }

    /**
     * フォーカス・表示状態・pageshow の同期イベントを登録する。
     */
    function setupSyncEvents(): void {
        window.addEventListener("focus", handleFocusSync);
        document.addEventListener("visibilitychange", handleVisibilitySync);
        window.addEventListener("pageshow", handlePageShowSync);
    }

    return {
        scheduleSyncUiState,
        scheduleDelayedSync,
        setupSyncEvents
    };
}
