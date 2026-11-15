import assert from "node:assert/strict";
import { createPlaybackSettingsController } from "../../app/controllers/playback-settings.mts";
import { LEGACY_PLAYBACK_SETTINGS_STORAGE_KEYS } from "../../app/lib/playback-settings/definitions.mts";

type PlaybackSettingsFixtureInput = {
    ui?: Partial<import("../../app/state.types.mts").PlaybackSettingsUiSlice> & {
        dataReady?: boolean;
        activeThumb?: HTMLElement | null;
    };
    callbacks?: Partial<Parameters<typeof createPlaybackSettingsController>[0]["callbacks"]>;
};

/** 再生設定テストの依存関数に、省略された操作の既定値を補う。 */
function createPlaybackSettingsCallbacks(input: PlaybackSettingsFixtureInput["callbacks"] = {}):
    Parameters<typeof createPlaybackSettingsController>[0]["callbacks"] {
    return {
        ensureThumbnailPlaybackReady: input.ensureThumbnailPlaybackReady ?? (() => {}),
        restoreActivePlayback: input.restoreActivePlayback ?? (() => {}),
        updateDisplay: input.updateDisplay ?? (() => {})
    };
}

/** 再生設定系テスト用の controller と標準 DOM を作る。 */
export function createPlaybackSettingsFixture(input: PlaybackSettingsFixtureInput = {}) {
    const playbackSettingsGroup = document.createElement("section");
    playbackSettingsGroup.hidden = true;
    playbackSettingsGroup.setAttribute("aria-hidden", "true");
    const experimentalPlaybackSettingsGroup = document.createElement("div");
    experimentalPlaybackSettingsGroup.hidden = true;
    experimentalPlaybackSettingsGroup.setAttribute("aria-hidden", "true");
    const state = input.ui ?? {};
    const playback: Parameters<typeof createPlaybackSettingsController>[0]["ui"]["playback"] = {
        showThumbnails: state.showThumbnails ?? true,
        showExperimentalPlaybackSettings: state.showExperimentalPlaybackSettings ?? false,
        useYoutubeNoCookie: state.useYoutubeNoCookie ?? false,
        playArchiveToEnd: state.playArchiveToEnd ?? false,
        continuousPlayback: state.continuousPlayback ?? false,
        loopPlayback: state.loopPlayback ?? false,
        activeThumb: state.activeThumb ?? null
    };
    const ui = {
        el: {
            thumbToggle: document.createElement("input"),
            youtubeNoCookieToggle: document.createElement("input"),
            playArchiveToEndToggle: document.createElement("input"),
            continuousPlaybackToggle: document.createElement("input"),
            loopPlaybackToggle: document.createElement("input"),
            playbackSettingsGroup,
            experimentalPlaybackSettingsGroup,
            closeSettingsPanelBtn: null as HTMLButtonElement | null
        },
        search: { dataReady: state.dataReady ?? false },
        playback
    };
    const controller = createPlaybackSettingsController({
        ui,
        callbacks: createPlaybackSettingsCallbacks(input.callbacks)
    });
    return { ui, controller };
}

/**
 * 再生設定系の保存値をまとめて投入する。
 * @param {Record<string, string>} values
 */
export function seedPlaybackSettingsStorage(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) {
        globalThis.localStorage.setItem(key, value);
    }
}

/**
 * 旧再生設定の保存値が残っていないことを確認する。
 */
export function assertLegacyPlaybackSettingsStorageCleared() {
    for (const key of LEGACY_PLAYBACK_SETTINGS_STORAGE_KEYS) {
        assert.equal(globalThis.localStorage.getItem(key), null);
    }
}

/**
 * 設定グループの hidden と aria-hidden が表示状態に合っていることを確認する。
 * @param {HTMLElement} settingsGroup
 * @param {boolean} visible
 */
function assertSettingsGroupVisibility(settingsGroup: HTMLElement, visible: boolean) {
    assert.ok(settingsGroup);
    assert.equal(settingsGroup.hidden, !visible);
    assert.equal(settingsGroup.getAttribute("aria-hidden"), visible ? "false" : "true");
}

/**
 * 再生設定グループが表示状態であることを確認する。
 */
export function assertPlaybackSettingsGroupVisible(ui: ReturnType<typeof createPlaybackSettingsFixture>["ui"]) {
    assertSettingsGroupVisibility(ui.el.playbackSettingsGroup, true);
}

/**
 * 再生設定グループが非表示であることを確認する。
 */
export function assertPlaybackSettingsGroupHidden(ui: ReturnType<typeof createPlaybackSettingsFixture>["ui"]) {
    assertSettingsGroupVisibility(ui.el.playbackSettingsGroup, false);
}

/**
 * 実験的な再生設定項目が非表示であることを確認する。
 */
export function assertExperimentalPlaybackSettingsHidden(ui: ReturnType<typeof createPlaybackSettingsFixture>["ui"]) {
    assertSettingsGroupVisibility(ui.el.experimentalPlaybackSettingsGroup, false);
}

/**
 * 実験的な再生設定項目が表示状態であることを確認する。
 */
export function assertExperimentalPlaybackSettingsVisible(ui: ReturnType<typeof createPlaybackSettingsFixture>["ui"]) {
    assertSettingsGroupVisibility(ui.el.experimentalPlaybackSettingsGroup, true);
}
