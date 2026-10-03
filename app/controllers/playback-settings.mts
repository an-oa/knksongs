import {
    createPlaybackSettingDefinitions,
    LEGACY_PLAYBACK_SETTINGS_STORAGE_KEYS,
    PLAYBACK_SETTING_SCOPES
} from "../lib/playback-settings/definitions.mjs";
import {
    createInitialPlaybackBehaviorPageValues,
    getPlaybackBehaviorEffectiveValue,
    isPagePlaybackBehaviorDefinition,
    reducePlaybackSettingChange
} from "../lib/playback-settings/value-reducer.mjs";
import type {
    AppUiElements,
    PlaybackUiRuntimeState,
    PlaybackSettingsUiSlice,
    SearchUiRuntimeState
} from "../state.types";
import type { PlaybackSettingDefinition } from "../lib/playback-settings/definitions.mjs";
import {
    getStoredSettingText,
    removeStoredSetting,
    setStoredSettingText
} from "../lib/storage/settings-storage.mjs";

type PlaybackSettingsUiElements = Pick<
    AppUiElements,
    "playbackSettingsGroup" |
    "experimentalPlaybackSettingsGroup" |
    "closeSettingsPanelBtn" |
    "thumbToggle" |
    "youtubeNoCookieToggle" |
    "playArchiveToEndToggle" |
    "continuousPlaybackToggle" |
    "loopPlaybackToggle"
> & Record<string, Element | null | undefined>;

type PlaybackSettingsUiState = {
    el: PlaybackSettingsUiElements;
    playback: PlaybackUiRuntimeState;
    search: Pick<SearchUiRuntimeState, "dataReady">;
};

export type PlaybackSettingsConsoleApi = {
    setExperimentalPlaybackSettings: (value: boolean) => boolean;
    showExperimentalPlaybackSettings: boolean;
    readonly state: PlaybackSettingsUiSlice;
};

type PlaybackSettingsCallbacks = {
    ensureThumbnailPlaybackReady: () => void;
    restoreActivePlayback: () => void;
    updateDisplay: () => void;
    setupScrollObserver: () => void;
};

type PlaybackSettingsControllerInput = {
    ui: PlaybackSettingsUiState;
    callbacks: PlaybackSettingsCallbacks;
};

type PlaybackSettingEffectHook = (previousValue: boolean, nextValue: boolean) => void;

type PlaybackSettingEffects = {
    syncValue?: (value: boolean) => void;
    afterStorageApply?: PlaybackSettingEffectHook;
    afterToggleChange?: PlaybackSettingEffectHook;
};

type PlaybackSettingValueHookName = "afterStorageApply" | "afterToggleChange";

/**
 * 再生設定の保存値反映とトグル配線を扱うコントローラーを作成する。
 * @param {PlaybackSettingsControllerInput} input
 */
export function createPlaybackSettingsController({ ui, callbacks }: PlaybackSettingsControllerInput) {
    const playbackUi = ui.playback;
    const searchUiState = ui.search;
    const ensureThumbnailPlaybackReady = callbacks.ensureThumbnailPlaybackReady;
    const restoreActivePlayback = callbacks.restoreActivePlayback;
    const updateDisplay = callbacks.updateDisplay;
    const setupScrollObserver = callbacks.setupScrollObserver;
    let didApplyInitialPlaybackSettingValues = false;
    const playbackBehaviorPageValues = new Map<string, boolean>();

    /**
     * ページ内だけで保持する再生挙動設定を差し替える。
     * @param {Map<string, boolean>} nextValues
     */
    function replacePlaybackBehaviorPageValues(nextValues: ReadonlyMap<string, boolean>): void {
        playbackBehaviorPageValues.clear();
        for (const [key, value] of nextValues.entries()) {
            playbackBehaviorPageValues.set(key, value);
        }
    }

    /**
     * 実験的な再生設定が有効かを返す。
     * @returns {boolean}
     */
    function isExperimentalPlaybackSettingsEffective(): boolean {
        return Boolean(playbackUi.showThumbnails && playbackUi.showExperimentalPlaybackSettings);
    }

    /**
     * 非表示にする設定グループ内にフォーカスがある場合は設定パネルの戻るボタンへ移す。
     * @param {HTMLElement | null} settingsGroup
     */
    function moveFocusBeforeHidingSettingsGroup(settingsGroup: HTMLElement | null | undefined): void {
        if (!settingsGroup || settingsGroup.hidden) return;
        if (!settingsGroup.contains(document.activeElement)) return;
        const closeSettingsPanelBtn = ui.el.closeSettingsPanelBtn;
        if (closeSettingsPanelBtn) closeSettingsPanelBtn.focus();
    }

    /**
     * 設定グループの表示状態と支援技術向けの露出状態を同期する。
     * @param {HTMLElement | null} settingsGroup
     * @param {boolean} visible
     */
    function syncSettingsGroupVisibility(
        settingsGroup: HTMLElement | null | undefined,
        visible: boolean
    ): void {
        if (!settingsGroup) return;
        if (!visible) moveFocusBeforeHidingSettingsGroup(settingsGroup);
        settingsGroup.hidden = !visible;
        settingsGroup.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    /**
     * 再生セクションの表示状態を切り替える。
     */
    function syncPlaybackSettingsVisibility(): void {
        syncSettingsGroupVisibility(
            ui.el.playbackSettingsGroup,
            Boolean(playbackUi.showThumbnails)
        );
    }

    /**
     * 実験的な再生セクションの表示状態を切り替える。
     */
    function syncExperimentalPlaybackVisibility(): void {
        syncSettingsGroupVisibility(
            ui.el.experimentalPlaybackSettingsGroup,
            isExperimentalPlaybackSettingsEffective()
        );
    }

    /**
     * 再生設定定義に対応するトグル要素を返す。
     * @param {PlaybackSettingDefinition} definition
     * @returns {HTMLInputElement | null}
     */
    function getPlaybackSettingToggle(definition: PlaybackSettingDefinition): HTMLInputElement | null {
        if (!definition.elementKey) return null;
        return (ui.el[definition.elementKey] as HTMLInputElement | null | undefined) || null;
    }

    /**
     * 保存済み真偽値設定を返す。
     * @param {string} key
     * @param {boolean} defaultValue
     * @returns {boolean}
     */
    function loadStoredBoolean(key: string, defaultValue: boolean): boolean {
        const savedSetting = getStoredSettingText(key);
        return savedSetting !== null ? (savedSetting === "true") : Boolean(defaultValue);
    }

    /**
     * 旧バージョンで保存していた再生設定を削除する。
     */
    function removeLegacyPlaybackSettingsStorage(): void {
        for (const key of LEGACY_PLAYBACK_SETTINGS_STORAGE_KEYS) {
            removeStoredSetting(key);
        }
    }

    /**
     * ページロード直後の再生設定をページ内だけの固定値で初期化する。
     */
    function applyInitialPlaybackSettingValuesIfNeeded(): void {
        if (didApplyInitialPlaybackSettingValues) return;
        didApplyInitialPlaybackSettingValues = true;
        replacePlaybackBehaviorPageValues(createInitialPlaybackBehaviorPageValues(pagePlaybackBehaviorDefinitions));
        for (const definition of pagePlaybackBehaviorDefinitions) {
            const nextValue = getPlaybackBehaviorEffectiveValue(
                definition,
                isExperimentalPlaybackSettingsEffective(),
                playbackBehaviorPageValues
            );
            applyPlaybackDefinitionValue(definition, nextValue, "afterStorageApply");
        }
    }

    /**
     * 現在値とトグル状態へ設定値を反映する。
     * @param {PlaybackSettingDefinition} definition
     * @param {boolean} value
     */
    function applyPlaybackSettingValue(definition: PlaybackSettingDefinition, value: boolean): void {
        playbackUi[definition.stateKey] = value;
        const toggle = getPlaybackSettingToggle(definition);
        if (toggle) toggle.checked = value;
        runPlaybackSettingSyncEffect(definition, value);
    }

    /**
     * 設定定義へ現在値を反映し、副作用フックがあれば呼ぶ。
     * @param {PlaybackSettingDefinition} definition
     * @param {boolean} nextValue
     * @param {"afterStorageApply" | "afterToggleChange"} hookName
     */
    function applyPlaybackDefinitionValue(
        definition: PlaybackSettingDefinition,
        nextValue: boolean,
        hookName: PlaybackSettingValueHookName
    ): void {
        const previousValue = Boolean(playbackUi[definition.stateKey]);
        applyPlaybackSettingValue(definition, nextValue);
        runPlaybackSettingValueEffect(definition, hookName, previousValue, nextValue);
    }

    /**
     * 実験設定の表示状態に応じて、隠し設定の実効値を反映する。
     * @param {"afterStorageApply" | "afterToggleChange"} hookName
     */
    function applyExperimentalPlaybackSettingValues(hookName: PlaybackSettingValueHookName): void {
        const experimentalEnabled = isExperimentalPlaybackSettingsEffective();
        for (const definition of pagePlaybackBehaviorDefinitions) {
            const nextValue = getPlaybackBehaviorEffectiveValue(
                definition,
                experimentalEnabled,
                playbackBehaviorPageValues
            );
            applyPlaybackDefinitionValue(definition, nextValue, hookName);
        }
    }

    /**
     * サムネイル表示設定を DOM と準備処理へ反映する。
     * @param {boolean} value
     */
    function syncThumbnailVisibility(value: boolean): void {
        document.body.classList.toggle("hide-thumbs", !value);
        syncPlaybackSettingsVisibility();
        syncExperimentalPlaybackVisibility();
        ensureThumbnailPlaybackReady();
    }

    /**
     * 保存値からサムネイル表示が切り替わった後の描画を更新する。
     * @param {boolean} previousValue
     * @param {boolean} nextValue
     */
    function afterThumbnailStorageApply(previousValue: boolean, nextValue: boolean): void {
        if (previousValue === nextValue || !searchUiState.dataReady) return;
        updateDisplay();
        setupScrollObserver();
    }

    /**
     * トグル操作でサムネイル表示が変わった後の描画と隠し再生設定を更新する。
     */
    function afterThumbnailToggleChange(): void {
        updateDisplay();
        setupScrollObserver();
        applyExperimentalPlaybackSettingValues("afterToggleChange");
    }

    const {
        pagePlaybackBehaviorDefinitions,
        experimentalPlaybackVisibilityDefinition,
        thumbnailVisibilityDefinition,
        playbackSettingDefinitions
    } = createPlaybackSettingDefinitions();

    /** @type {Map<PlaybackSettingDefinition, PlaybackSettingEffects>} */
    const playbackSettingEffectsByDefinition: Map<PlaybackSettingDefinition, PlaybackSettingEffects> = new Map([
        [thumbnailVisibilityDefinition, {
            syncValue: syncThumbnailVisibility,
            afterStorageApply: afterThumbnailStorageApply,
            afterToggleChange: afterThumbnailToggleChange
        }],
        [experimentalPlaybackVisibilityDefinition, {
            syncValue: syncExperimentalPlaybackVisibility,
            afterStorageApply: () => applyExperimentalPlaybackSettingValues("afterStorageApply"),
            afterToggleChange: () => applyExperimentalPlaybackSettingValues("afterToggleChange")
        }]
    ]);

    /**
     * 設定値の反映時に同期系の副作用を実行する。
     * @param {PlaybackSettingDefinition} definition
     * @param {boolean} value
     */
    function runPlaybackSettingSyncEffect(definition: PlaybackSettingDefinition, value: boolean): void {
        const effects = playbackSettingEffectsByDefinition.get(definition);
        if (typeof effects?.syncValue === "function") effects.syncValue(value);
    }

    /**
     * 設定値の反映後に保存反映またはトグル操作の副作用を実行する。
     * @param {PlaybackSettingDefinition} definition
     * @param {"afterStorageApply" | "afterToggleChange"} hookName
     * @param {boolean} previousValue
     * @param {boolean} nextValue
     */
    function runPlaybackSettingValueEffect(
        definition: PlaybackSettingDefinition,
        hookName: PlaybackSettingValueHookName,
        previousValue: boolean,
        nextValue: boolean
    ): void {
        const effects = playbackSettingEffectsByDefinition.get(definition);
        const effect = effects ? effects[hookName] : null;
        if (typeof effect === "function") effect(previousValue, nextValue);
        if (definition.restoreActivePlaybackOnChange) {
            restoreActivePlaybackWhenChanged(previousValue, nextValue);
        }
    }

    /**
     * 再生対象範囲が変わったときだけ現在の再生を作り直す。
     * @param {boolean} previousValue
     * @param {boolean} nextValue
     */
    function restoreActivePlaybackWhenChanged(previousValue: boolean, nextValue: boolean): void {
        if (previousValue !== nextValue) restoreActivePlayback();
    }

    const persistedDefinitions = playbackSettingDefinitions.filter((definition) => (
        definition.scope === PLAYBACK_SETTING_SCOPES.PERSISTED
    ));

    const interactiveToggleDefinitions = playbackSettingDefinitions.filter((definition) => (
        definition.interactive || isPagePlaybackBehaviorDefinition(definition)
    ));

    /**
     * 保存領域から全再生設定の値を読み出す。
     * @returns {Map<string, boolean>}
     */
    function readPlaybackSettingValues(definitions: Extract<PlaybackSettingDefinition, { scope: "persisted" }>[]): Map<string, boolean> {
        return new Map(definitions.map((definition) => [
            definition.stateKey,
            loadStoredBoolean(definition.storageKey, definition.defaultValue)
        ]));
    }

    /**
     * 設定更新と副作用実行を行う。
     * @param {PlaybackSettingDefinition} definition
     * @param {boolean} nextValue
     * @param {{ persist?: boolean } | undefined} [options]
     */
    function applyPlaybackSettingChange(
        definition: PlaybackSettingDefinition,
        nextValue: boolean,
        options?: { persist?: boolean }
    ): void {
        const shouldPersist = options?.persist !== false;
        const reduction = reducePlaybackSettingChange({
            definition,
            currentValue: Boolean(playbackUi[definition.stateKey]),
            nextValue,
            experimentalEnabled: isExperimentalPlaybackSettingsEffective(),
            pageValues: playbackBehaviorPageValues
        });
        replacePlaybackBehaviorPageValues(reduction.pageValues);
        if (!reduction.changed) return;
        applyPlaybackSettingValue(definition, reduction.nextValue);
        if (shouldPersist && definition.storageKey) {
            setStoredSettingText(definition.storageKey, String(reduction.nextValue));
        }
        runPlaybackSettingValueEffect(
            definition,
            "afterToggleChange",
            reduction.previousValue,
            reduction.nextValue
        );
    }

    /**
     * 現在の再生設定を UI 状態とトグルへ反映する。
     */
    function applyPlaybackSettingsFromStorage(): void {
        removeLegacyPlaybackSettingsStorage();
        applyInitialPlaybackSettingValuesIfNeeded();
        const nextValues = readPlaybackSettingValues(persistedDefinitions);
        for (const definition of persistedDefinitions) {
            const nextValue = Boolean(nextValues.get(definition.stateKey));
            applyPlaybackDefinitionValue(definition, nextValue, "afterStorageApply");
        }
        applyPlaybackDefinitionValue(
            experimentalPlaybackVisibilityDefinition,
            Boolean(playbackUi.showExperimentalPlaybackSettings),
            "afterStorageApply"
        );
    }

    /**
     * 再生設定トグルを初期化して変更内容を保存する。
     */
    function setupPlaybackSettings(): void {
        applyPlaybackSettingsFromStorage();
        for (const definition of interactiveToggleDefinitions) {
            const toggle = getPlaybackSettingToggle(definition);
            if (!toggle) continue;
            toggle.addEventListener("change", () => {
                applyPlaybackSettingChange(definition, toggle.checked);
            });
        }
    }

    /**
     * 実験的な機能の表示状態をページ内だけで更新する。
     * @param {boolean} value
     * @returns {boolean}
     */
    function setExperimentalPlaybackSettings(value: boolean): boolean {
        applyPlaybackSettingChange(experimentalPlaybackVisibilityDefinition, Boolean(value), { persist: false });
        return Boolean(playbackUi.showExperimentalPlaybackSettings);
    }

    /**
     * console から確認しやすい再生設定の現在値を返す。
     * @returns {PlaybackSettingsUiSlice}
     */
    function getPlaybackSettingsSnapshot(): PlaybackSettingsUiSlice {
        return {
            showThumbnails: Boolean(playbackUi.showThumbnails),
            showExperimentalPlaybackSettings: Boolean(playbackUi.showExperimentalPlaybackSettings),
            useYoutubeNoCookie: Boolean(playbackUi.useYoutubeNoCookie),
            playArchiveToEnd: Boolean(playbackUi.playArchiveToEnd),
            continuousPlayback: Boolean(playbackUi.continuousPlayback),
            loopPlayback: Boolean(playbackUi.loopPlayback)
        };
    }

    /**
     * Inspect の console へ公開する再生設定 API を作る。
     * @returns {PlaybackSettingsConsoleApi}
     */
    function createConsoleApi(): PlaybackSettingsConsoleApi {
        const api: PlaybackSettingsConsoleApi = {
            get showExperimentalPlaybackSettings() {
                return getPlaybackSettingsSnapshot().showExperimentalPlaybackSettings;
            },
            set showExperimentalPlaybackSettings(value) {
                setExperimentalPlaybackSettings(Boolean(value));
            },
            get state() {
                return getPlaybackSettingsSnapshot();
            },
            setExperimentalPlaybackSettings(value) {
                return setExperimentalPlaybackSettings(Boolean(value));
            }
        };
        return api;
    }

    return {
        setupPlaybackSettings,
        applyPlaybackSettingsFromStorage,
        setExperimentalPlaybackSettings,
        getPlaybackSettingsSnapshot,
        createConsoleApi
    };
}
