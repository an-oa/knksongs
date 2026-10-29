/**
 * アプリ全体で共有する状態 appState の初期値と、動作の定数。
 *
 * appState は data・ui・youtube の 3 区分で、生成するのはここだけ。
 * 区分ごとに取り出して各 controller と UI へ渡すのは bootstrap.mts が行う。型は ./state.types に置く。
 * 定数は表示件数、形式の既定値、localStorage の key と上限、検索 debounce、YouTube IFrame API の設定など。
 * 曲データの取得 URL とキャッシュ key は ./config.mts にある。
 *
 * 状態を更新する処理は持たない。更新は各 controller が担当する。
 */
import { INITIAL_PLAYBACK_SETTING_VALUES } from "./lib/playback-settings/definitions.mjs";
import type { AppState, PlaybackUiRuntimeState } from "./state.types";

export const RANDOM_DISPLAY_COUNT = 48;
export const MIN_PERFORMANCE_FOR_RANDOM = 3;
export const RESULT_DISPLAY_BATCH_SIZE = 48;
export const DEFAULT_FORMATS = ["配信", "歌みた", "ショート", "切り抜き", "収録"];
// localStorage の保存場所名は互換維持のため searchStateV1 のままにする。
// payload 内の version は schema version で、この key 名とは独立して更新する。
export const SEARCH_STATE_KEY = "searchStateV1";
export const BOOKMARK_STORAGE_KEY = "bookmarksV1";
export const BOOKMARK_STORAGE_VERSION = 3;
export const MAX_BOOKMARK_COUNT = 20;
export const MAX_SONGS_PER_BOOKMARK = 120;
export const MAX_BOOKMARK_NAME_LENGTH = 64;
// Paint preview/フォーム復元の後追い対策で複数回同期する。
export const UI_SYNC_PASSES = 2;
export const SEARCH_DEBOUNCE_MS = 200;
export const YT_IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
export const YT_IFRAME_API_SELECTOR = 'script[data-yt-iframe-api="true"]';
export const YT_IFRAME_READY_POLL_MS = 50;

/**
 * 再生 UI ランタイム状態の初期値を作成する。
 * 本番コードでは appState 初期化に使い、設定 default との同期を
 * 単体テストするため export している。
 * @returns {PlaybackUiRuntimeState}
 */
export function createInitialPlaybackUiRuntimeState(): PlaybackUiRuntimeState {
    return {
        ...INITIAL_PLAYBACK_SETTING_VALUES,
        activeThumb: null
    };
}

export const appState: AppState = {
    data: {
        allSongsRaw: [],
        currentResults: [],
        displayLimit: RANDOM_DISPLAY_COUNT,
        bookmarks: {},
        activeBookmark: null
    },
    ui: {
        el: {}, // DOM要素のキャッシュ用
        search: {
            selectedFormats: new Set(),
            dataReady: false,
            userTouchedQuery: false,
            userTouchedFilters: false,
            hasRestoredSearchState: false,
            recommendedCache: null
        },
        date: {
            bounds: null,
            index: null,
            pendingValues: null
        },
        playback: createInitialPlaybackUiRuntimeState(),
        lookup: {
            songMapByBookmarkKey: new Map(),
            songMapByKey: new Map(),
            songLookupSourceRef: null
        },
        render: {
            cardEntriesBySongKey: new Map()
        },
        language: {
            current: "ja"
        },
        settingsPanel: {
            returnFocusEl: null
        },
        bookmarkPanel: {
            pendingAction: null,
            returnFocusEl: null,
            exitClosesSidebar: false
        }
    },
    youtube: {
        apiPromise: null,
        sharedPlayback: null
    }
};
