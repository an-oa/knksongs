import type { PlaybackSettingsUiSlice } from "../../state.types.mjs";

export const THUMBNAIL_STORAGE_KEY = "showThumbnails";
export const USE_YOUTUBE_NOCOOKIE_STORAGE_KEY = "useYoutubeNoCookie";
export const PLAY_ARCHIVE_TO_END_STORAGE_KEY = "playArchiveToEnd";

// 旧バージョンが localStorage に残した個別キー。現行では読み込まず起動時に削除する。
export const LEGACY_PLAYBACK_SETTINGS_STORAGE_KEYS = Object.freeze([
    "showExperimentalPlaybackSettings",
    "showExperimentalPlaybackSettingsHiddenResetV1",
    "stopAtEndTime",
    "continuousPlayback",
    "loopPlayback"
]);

export const PLAYBACK_SETTING_SCOPES = Object.freeze({
    PERSISTED: "persisted",
    PAGE: "page"
});

export const PLAYBACK_SETTING_KINDS = Object.freeze({
    VISIBILITY: "visibility",
    BEHAVIOR: "behavior"
});

export const INITIAL_PLAYBACK_SETTING_VALUES = Object.freeze({
    showThumbnails: false,
    showExperimentalPlaybackSettings: false,
    useYoutubeNoCookie: false,
    playArchiveToEnd: false,
    continuousPlayback: false,
    loopPlayback: false
});

export type PlaybackSettingElementKey =
    "thumbToggle" |
    "youtubeNoCookieToggle" |
    "playArchiveToEndToggle" |
    "continuousPlaybackToggle" |
    "loopPlaybackToggle";

export type PlaybackSettingScope = typeof PLAYBACK_SETTING_SCOPES[keyof typeof PLAYBACK_SETTING_SCOPES];

export type PlaybackSettingKind = typeof PLAYBACK_SETTING_KINDS[keyof typeof PLAYBACK_SETTING_KINDS];

/**
 * 再生設定 1 件の定義。
 */
export type PlaybackSettingDefinition = {
    kind: PlaybackSettingKind;
    stateKey: keyof PlaybackSettingsUiSlice;
    elementKey?: PlaybackSettingElementKey;
    defaultValue: boolean;
    hiddenValue?: boolean;
    interactive?: boolean;
    restoreActivePlaybackOnChange?: boolean;
} & (
    | { scope: typeof PLAYBACK_SETTING_SCOPES.PERSISTED; storageKey: string }
    | { scope: typeof PLAYBACK_SETTING_SCOPES.PAGE; storageKey?: never }
);

type PlaybackSettingDefinitionSet = {
    pagePlaybackBehaviorDefinitions: PlaybackSettingDefinition[];
    youtubeNoCookieDefinition: PlaybackSettingDefinition;
    archivePlaybackBehaviorDefinition: PlaybackSettingDefinition;
    experimentalPlaybackVisibilityDefinition: PlaybackSettingDefinition;
    thumbnailVisibilityDefinition: PlaybackSettingDefinition;
    playbackSettingDefinitions: PlaybackSettingDefinition[];
};

/**
 * 再生設定の定義一覧を作成する。
 * 本番コードでは playback settings controller から使い、
 * 設定 metadata の境界条件を単体テストするため export している。
 */
export function createPlaybackSettingDefinitions(): PlaybackSettingDefinitionSet {
    const youtubeNoCookieDefinition: PlaybackSettingDefinition = {
        scope: PLAYBACK_SETTING_SCOPES.PERSISTED,
        kind: PLAYBACK_SETTING_KINDS.BEHAVIOR,
        interactive: true,
        stateKey: "useYoutubeNoCookie",
        elementKey: "youtubeNoCookieToggle",
        storageKey: USE_YOUTUBE_NOCOOKIE_STORAGE_KEY,
        defaultValue: INITIAL_PLAYBACK_SETTING_VALUES.useYoutubeNoCookie,
        restoreActivePlaybackOnChange: true
    };

    const archivePlaybackBehaviorDefinition: PlaybackSettingDefinition = {
        scope: PLAYBACK_SETTING_SCOPES.PERSISTED,
        kind: PLAYBACK_SETTING_KINDS.BEHAVIOR,
        interactive: true,
        stateKey: "playArchiveToEnd",
        elementKey: "playArchiveToEndToggle",
        storageKey: PLAY_ARCHIVE_TO_END_STORAGE_KEY,
        defaultValue: INITIAL_PLAYBACK_SETTING_VALUES.playArchiveToEnd,
        restoreActivePlaybackOnChange: true
    };

    const pagePlaybackBehaviorDefinitions: PlaybackSettingDefinition[] = [
        {
            scope: PLAYBACK_SETTING_SCOPES.PAGE,
            kind: PLAYBACK_SETTING_KINDS.BEHAVIOR,
            stateKey: "continuousPlayback",
            elementKey: "continuousPlaybackToggle",
            defaultValue: INITIAL_PLAYBACK_SETTING_VALUES.continuousPlayback,
            hiddenValue: false
        },
        {
            scope: PLAYBACK_SETTING_SCOPES.PAGE,
            kind: PLAYBACK_SETTING_KINDS.BEHAVIOR,
            stateKey: "loopPlayback",
            elementKey: "loopPlaybackToggle",
            defaultValue: INITIAL_PLAYBACK_SETTING_VALUES.loopPlayback,
            hiddenValue: false
        }
    ];

    const experimentalPlaybackVisibilityDefinition: PlaybackSettingDefinition = {
        scope: PLAYBACK_SETTING_SCOPES.PAGE,
        kind: PLAYBACK_SETTING_KINDS.VISIBILITY,
        stateKey: "showExperimentalPlaybackSettings",
        defaultValue: INITIAL_PLAYBACK_SETTING_VALUES.showExperimentalPlaybackSettings
    };

    const thumbnailVisibilityDefinition: PlaybackSettingDefinition = {
        scope: PLAYBACK_SETTING_SCOPES.PERSISTED,
        kind: PLAYBACK_SETTING_KINDS.VISIBILITY,
        interactive: true,
        stateKey: "showThumbnails",
        elementKey: "thumbToggle",
        storageKey: THUMBNAIL_STORAGE_KEY,
        defaultValue: INITIAL_PLAYBACK_SETTING_VALUES.showThumbnails
    };

    const playbackSettingDefinitions = [
        thumbnailVisibilityDefinition,
        youtubeNoCookieDefinition,
        archivePlaybackBehaviorDefinition,
        experimentalPlaybackVisibilityDefinition,
        ...pagePlaybackBehaviorDefinitions
    ];

    return {
        pagePlaybackBehaviorDefinitions,
        youtubeNoCookieDefinition,
        archivePlaybackBehaviorDefinition,
        experimentalPlaybackVisibilityDefinition,
        thumbnailVisibilityDefinition,
        playbackSettingDefinitions
    };
}
