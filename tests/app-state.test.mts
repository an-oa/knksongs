import test from "node:test";
import assert from "node:assert/strict";
import {
    appState,
    createInitialPlaybackUiRuntimeState
} from "../app/state.mts";
import { INITIAL_PLAYBACK_SETTING_VALUES } from "../app/lib/playback-settings/definitions.mts";

import type { PlaybackUiRuntimeState, PlaybackSettingsUiSlice } from "../app/state.types.mts";

/**
 * 再生設定値だけを playback runtime state から抜き出す。
 */
function pickPlaybackSettingValues(playback: PlaybackUiRuntimeState): PlaybackSettingsUiSlice {
    return {
        showThumbnails: playback.showThumbnails,
        showExperimentalPlaybackSettings: playback.showExperimentalPlaybackSettings,
        useYoutubeNoCookie: playback.useYoutubeNoCookie,
        playArchiveToEnd: playback.playArchiveToEnd,
        continuousPlayback: playback.continuousPlayback,
        loopPlayback: playback.loopPlayback
    };
}

test("app state: playback runtime defaults come from playback setting defaults", () => {
    const playback = createInitialPlaybackUiRuntimeState();

    assert.deepEqual(pickPlaybackSettingValues(playback), INITIAL_PLAYBACK_SETTING_VALUES);
    assert.equal(playback.activeThumb, null);
});

test("app state: appState playback uses the shared initial state helper", () => {
    assert.deepEqual(
        pickPlaybackSettingValues(appState.ui.playback),
        INITIAL_PLAYBACK_SETTING_VALUES
    );
    assert.equal(appState.ui.playback.activeThumb, null);
});
