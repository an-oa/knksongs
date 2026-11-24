import { isHtmlElement } from "../dom-utils.mjs";
import { resolveYoutubeEmbedHostFromUrl } from "./embed.mjs";
import type { YoutubeSharedPlaybackState } from "./shared-playback.mjs";
import type { YoutubePlayerEvent, YoutubePlayerLike } from "./iframe-api.types.mjs";

type YoutubePlayerAdapterInput = {
    getSharedPlaybackState: () => Pick<YoutubeSharedPlaybackState, "player">;
    ensureReady: () => Promise<unknown>;
    applyIframeAttributes: (iframe: Element | null) => void;
    syncIframe: () => void;
    handleStateChange: (event: YoutubePlayerEvent, playbackSessionId: number) => void;
    handlePlayerError: (event: YoutubePlayerEvent, playbackSessionId: number) => void;
    handleAttachFailure?: (error: unknown, playbackSessionId: number) => YoutubePlayerLike | null | Promise<YoutubePlayerLike | null>;
    debug?: (message: string, details: unknown) => void;
};

/** 再生のたびに作る iframe へ、YouTube IFrame API の Player を紐付ける adapter を作成する。 */
export function createYoutubePlayerAdapter(input: YoutubePlayerAdapterInput) {
    const {
        getSharedPlaybackState,
        ensureReady,
        applyIframeAttributes,
        syncIframe,
        handleStateChange,
        handlePlayerError,
        handleAttachFailure,
        debug
    } = input;

    /**
     * 生成済み iframe へ YouTube プレイヤーを紐付ける。
     * API の準備を待つ間に別の再生が始まると、この iframe は破棄されて DOM から外れるので、紐付けずに null を返す。
     * @param iframe プレーヤーを紐付ける iframe
     * @param playbackSessionId プレーヤーのイベントを対応付ける再生セッション ID
     * @returns 作成したプレーヤー。紐付けなかった場合は null
     */
    function attach(iframe: HTMLIFrameElement | null, playbackSessionId: number): Promise<YoutubePlayerLike | null> {
        if (typeof debug === "function") {
            debug("attachPlayer creating player", { playbackSessionId });
        }
        return ensureReady().then(() => {
            if (!isHtmlElement(iframe)) return null;
            if (!document.body.contains(iframe)) return null;
            const sharedPlayback = getSharedPlaybackState();
            sharedPlayback.player = new window.YT.Player(iframe, {
                host: resolveYoutubeEmbedHostFromUrl(iframe.src),
                events: {
                    onReady: (event) => {
                        applyIframeAttributes(
                            event && event.target && typeof event.target.getIframe === "function"
                                ? event.target.getIframe()
                                : iframe
                        );
                    },
                    onStateChange: (event) => handleStateChange(event, playbackSessionId),
                    onError: (event) => handlePlayerError(event, playbackSessionId)
                }
            });
            applyIframeAttributes(iframe);
            syncIframe();
            if (typeof debug === "function") {
                debug("attachPlayer created player", { playbackSessionId });
            }
            return sharedPlayback.player;
        }).catch((error) => {
            if (typeof handleAttachFailure === "function") {
                return handleAttachFailure(error, playbackSessionId);
            }
            throw error;
        });
    }

    return { attach };
}
