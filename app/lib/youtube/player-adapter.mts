import { isHtmlElement } from "../dom-utils.mjs";
import { resolveYoutubeEmbedHostFromUrl } from "./embed.mjs";
import type { YoutubeSharedPlaybackState } from "./shared-playback.mjs";
import type { YoutubePlayerEvent, YoutubePlayerLike } from "./iframe-api.types.mjs";

type YoutubePlayerAdapterInput = {
    getSharedPlaybackState: () => Pick<YoutubeSharedPlaybackState,
        "player" | "playerPromise" | "pendingAttach">;
    setPendingAttach: (iframe: HTMLIFrameElement | null, playbackSessionId: number) => void;
    setSessionId: (playbackSessionId: number) => void;
    ensureReady: () => Promise<unknown>;
    applyIframeAttributes: (iframe: Element | null) => void;
    syncIframe: () => void;
    handleStateChange: (event: YoutubePlayerEvent, playbackSessionId: number) => void;
    handlePlayerError: (event: YoutubePlayerEvent, playbackSessionId: number) => void;
    handleAttachFailure?: (error: unknown, playbackSessionId: number) => YoutubePlayerLike | null | Promise<YoutubePlayerLike | null>;
    debug?: (message: string, details: unknown) => void;
};

/** 共有 iframe に YouTube Iframe API の Player を紐付ける adapter を作成する。 */
export function createYoutubePlayerAdapter(input: YoutubePlayerAdapterInput) {
    const {
        getSharedPlaybackState,
        setPendingAttach,
        setSessionId,
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
     * @param iframe プレーヤーを紐付けるiframe
     * @param {number} playbackSessionId
     * @returns 作成したプレーヤー、または紐付け不要な場合はnull
     */
    function attach(iframe: HTMLIFrameElement | null, playbackSessionId: number): Promise<YoutubePlayerLike | null> {
        const sharedPlayback = getSharedPlaybackState();
        setPendingAttach(iframe, playbackSessionId);
        if (sharedPlayback.playerPromise) {
            setSessionId(playbackSessionId);
            if (typeof debug === "function") {
                debug("attachPlayer waiting for existing playerPromise", { playbackSessionId });
            }
            return sharedPlayback.playerPromise;
        }
        setSessionId(playbackSessionId);
        if (typeof debug === "function") {
            debug("attachPlayer creating player", { playbackSessionId });
        }
        sharedPlayback.playerPromise = ensureReady().then(() => {
            const latestSharedPlayback = getSharedPlaybackState();
            const pendingAttach = latestSharedPlayback.pendingAttach;
            if (!pendingAttach) return null;
            const nextIframe = pendingAttach.iframe;
            const nextPlaybackSessionId = pendingAttach.playbackSessionId;
            setSessionId(nextPlaybackSessionId);
            if (!isHtmlElement(nextIframe)) return null;
            if (!document.body.contains(nextIframe)) return null;
            if (latestSharedPlayback.player) return latestSharedPlayback.player;
            latestSharedPlayback.player = new window.YT.Player(nextIframe, {
                host: resolveYoutubeEmbedHostFromUrl(nextIframe.src),
                events: {
                    onReady: (event) => {
                        applyIframeAttributes(
                            event && event.target && typeof event.target.getIframe === "function"
                                ? event.target.getIframe()
                                : nextIframe
                        );
                    },
                    onStateChange: (event) => handleStateChange(event, nextPlaybackSessionId),
                    onError: (event) => handlePlayerError(event, nextPlaybackSessionId)
                }
            });
            applyIframeAttributes(nextIframe);
            syncIframe();
            if (typeof debug === "function") {
                debug("attachPlayer created player", { playbackSessionId: nextPlaybackSessionId });
            }
            return latestSharedPlayback.player;
        }).catch((error) => {
            if (typeof handleAttachFailure === "function") {
                return handleAttachFailure(error, playbackSessionId);
            }
            throw error;
        }).finally(() => {
            sharedPlayback.playerPromise = null;
        });
        return sharedPlayback.playerPromise;
    }

    return { attach };
}
