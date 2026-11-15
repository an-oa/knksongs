import { createYoutubeController } from "../app/controllers/youtube.mts";
import { createInitialPlaybackUiRuntimeState } from "../app/state.mts";
import type { AppYoutubeRuntimeState, PlaybackUiRuntimeState } from "../app/state.types.mts";
import type { SiteLanguage } from "../app/lib/site-language.mts";
import { createYoutubeIframeApiFixture } from "./fixtures/youtube-api.mts";

export const DEFAULT_YOUTUBE_CONTROLLER_CONSTANTS = {
    YT_IFRAME_API_SRC: "https://www.youtube.com/iframe_api",
    YT_IFRAME_API_SELECTOR: 'script[data-yt-iframe-api="true"]',
    YT_IFRAME_READY_POLL_MS: 50
};

/** youtube 系テスト用に必要な再生 UI 状態を作る。 */
export function createYoutubeUiState(input: Partial<PlaybackUiRuntimeState> = {}) {
    return {
        playback: {
            ...createInitialPlaybackUiRuntimeState(),
            showThumbnails: true,
            useYoutubeNoCookie: false,
            playArchiveToEnd: false,
            continuousPlayback: false,
            loopPlayback: false,
            ...input
        },
        language: { current: "ja" as SiteLanguage }
    };
}

/** youtube コントローラーが共有するテスト用状態を作る。 */
export function createYoutubeState(overrides: Partial<AppYoutubeRuntimeState> = {}): AppYoutubeRuntimeState {
    return { apiPromise: null, sharedPlayback: null, ...overrides };
}

/** youtube コントローラーと周辺状態をまとめて作る。 */
export function createYoutubeControllerHarness(input: {
    ui?: Parameters<typeof createYoutubeController>[0]["ui"];
    youtube?: AppYoutubeRuntimeState;
    constants?: Partial<Parameters<typeof createYoutubeController>[0]["constants"]>;
} = {}) {
    const ui = input.ui ?? createYoutubeUiState();
    const youtube = input.youtube ?? createYoutubeState();
    const constants = { ...DEFAULT_YOUTUBE_CONTROLLER_CONSTANTS, ...input.constants };
    const controller = createYoutubeController({ ui, youtube, constants });
    return { ui, youtube, constants, controller };
}

/** 共通API fixtureを登録し、各Playerとその通知関数を生成順に返す。 */
export function installYoutubePlayerFixture(input: Parameters<typeof createYoutubeIframeApiFixture>[0] = {}) {
    const { api, creations } = createYoutubeIframeApiFixture(input);
    window.YT = api;
    return creations;
}
