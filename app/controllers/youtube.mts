import { createLayoutRefreshScheduler } from "../lib/layout-anchor.mjs";
import { canUseDom, getHeaderHeight, isHtmlElement } from "../lib/dom-utils.mjs";
import { debugPlayback, tracePlayback } from "../lib/playback-debug.mjs";
import {
    applyYoutubePlayerIframeAttributes,
    buildYoutubeEmbedUrl,
    createYoutubeIframeApiLoader
} from "../lib/youtube/embed.mjs";
import type { YoutubeTarget } from "../lib/youtube/embed.mjs";
import {
    destroyYoutubeSharedPlaybackPlayer,
    ensureYoutubeSharedPlaybackElements,
    getYoutubeSharedPlaybackState,
    getYoutubeSharedPlaybackThumb,
    setPendingYoutubeSharedPlaybackAttach,
    setYoutubeSharedPlaybackSessionId,
    syncYoutubeSharedPlaybackIframe
} from "../lib/youtube/shared-playback.mjs";
import {
    applyYoutubeThumbnailImage,
    createYoutubeThumbnailImage,
    getSongKeyFromYoutubeThumb,
    revealYoutubePlaybackCardIfNeeded,
    setYoutubeThumbnailExpandedCardState,
    setYoutubeThumbnailOrientation,
    setYoutubeThumbnailPlaybackState,
    shouldLoadYoutubeThumbnailNow
} from "../lib/youtube/thumbnail.mjs";
import {
    createYoutubePlaybackState,
    isYoutubePlaybackSessionActive,
    reduceYoutubePlaybackState
} from "../lib/youtube/playback-state.mjs";
import type { YoutubePlaybackStateEvent } from "../lib/youtube/playback-state.mjs";
import {
    createYoutubePlaybackStartAttemptManager,
    createYoutubePlaybackStartResult,
    YOUTUBE_PLAYBACK_START_STATUS
} from "../lib/youtube/playback-start-attempt.mjs";
import type { YoutubePlaybackStartResult } from "../lib/youtube/playback-start-attempt.mjs";
import { createYoutubeUnconfirmedPlaybackStartManager } from "../lib/youtube/unconfirmed-playback-start.mjs";
import {
    createYoutubePlayerAdapter
} from "../lib/youtube/player-adapter.mjs";
import {
    readYoutubePlayerState,
    YOUTUBE_PLAYER_STATE
} from "../lib/youtube/player-state.mjs";
import { createYoutubePostPlaybackAdRestoreManager } from "../lib/youtube/post-playback-ad-restore.mjs";
import type {
    AppUiState,
    AppYoutubeRuntimeState
} from "../state.types";
import type { YoutubePlayerEvent, YoutubePlayerLike } from "../lib/youtube/iframe-api.types";

export { extractYoutubeInfo } from "../lib/youtube-url.mjs";

type YoutubeConstants = {
    YT_IFRAME_API_SRC: string;
    YT_IFRAME_API_SELECTOR: string;
    YT_IFRAME_READY_POLL_MS: number;
    STOP_PLAYBACK_ON_SCROLL_OUT: boolean;
};

type YoutubePlaybackError = Error & {
    code?: string;
};

type YoutubePlaybackMode = "manual" | "autoplay" | string;

type PlaybackStartFailureOptions = {
    playbackMode?: YoutubePlaybackMode;
    reason?: string;
    errorCode?: unknown;
    sessionId?: number;
    wasPlaybackStartUnconfirmed?: boolean;
};

type PlaybackStartFailedPayload = {
    songKey: string;
    playbackMode: YoutubePlaybackMode;
    wasPlaybackStartUnconfirmed?: boolean;
};

type YoutubePlaybackOptions = {
    playbackMode?: YoutubePlaybackMode;
    revealCard?: boolean;
};

type YoutubePlaybackTargetMetadata = {
    videoId: string;
    playbackKey: string;
    playbackEndSeconds: number | null;
};

type YoutubeControllerInput = {
    ui: Pick<AppUiState, "playback">;
    youtube: AppYoutubeRuntimeState;
    constants: YoutubeConstants;
};

type YoutubeController = {
    setLayoutHook: (fn: () => void) => void;
    setPlaybackEndedHook: (fn: (payload: { songKey: string }) => void) => void;
    setPlaybackStartFailedHook: (fn: (payload: PlaybackStartFailedPayload) => void) => void;
    isIOSWebKit: () => boolean;
    ensureThumbnailPlaybackReady: () => void;
    setupScrollObserver: () => void;
    playThumbnail: (
        thumbDiv: Element | null | undefined,
        yt: YoutubeTarget | null | undefined,
        options?: YoutubePlaybackOptions
    ) => Promise<YoutubePlaybackStartResult>;
    updateThumbnail: (thumbDiv: HTMLElement, yt: YoutubeTarget) => void;
    restoreActivePlayback: () => void;
};

/**
 * サムネイル表示と埋め込み再生の制御を行うコントローラーを作成する。
 */
export function createYoutubeController({ ui, youtube, constants }: YoutubeControllerInput): YoutubeController {
    const {
        YT_IFRAME_API_SRC,
        YT_IFRAME_API_SELECTOR,
        YT_IFRAME_READY_POLL_MS,
        STOP_PLAYBACK_ON_SCROLL_OUT
    } = constants;
    const playbackUi = ui.playback;
    let refreshLayout: () => void = () => {};
    let handlePlaybackEnded: (payload: { songKey: string }) => void = () => {};
    let handlePlaybackStartFailed: (payload: PlaybackStartFailedPayload) => void = () => {};
    let playbackState: ReturnType<typeof createYoutubePlaybackState> = createYoutubePlaybackState();
    const refreshCardLayoutSoon = createLayoutRefreshScheduler(() => refreshLayout);
    const youtubeIframeApiLoader = createYoutubeIframeApiLoader({
        youtube,
        iframeApiSrc: YT_IFRAME_API_SRC,
        iframeApiSelector: YT_IFRAME_API_SELECTOR,
        readyPollMs: YT_IFRAME_READY_POLL_MS
    });

    /**
     * 共有埋め込みプレーヤーの保持領域を返す。
     */
    function getSharedPlaybackState() {
        return getYoutubeSharedPlaybackState(youtube);
    }

    /**
     * 共有プレーヤーが内部で置き換えた最新の iframe 要素を同期する。
     */
    function syncSharedPlaybackIframe() {
        return syncYoutubeSharedPlaybackIframe(youtube);
    }

    /**
     * 共有プレーヤーに紐づく再生セッション ID を設定する。
     */
    function setSharedPlaybackSessionId(sessionId: number) {
        setYoutubeSharedPlaybackSessionId(youtube, sessionId);
    }

    /**
     * 共有プレーヤー初期化待ち中に使う最新の紐付け要求を保存する。
     */
    function setPendingSharedPlaybackAttach(iframe: HTMLIFrameElement | null, playbackSessionId: number) {
        setPendingYoutubeSharedPlaybackAttach(youtube, iframe, playbackSessionId);
    }

    /**
     * 指定セッションの現在の再生サムネイルを返す。
     */
    function getSharedPlaybackThumb(sessionId: number) {
        return getYoutubeSharedPlaybackThumb(youtube, sessionId);
    }

    /**
     * 再生開始方法を返す。
     */
    function getPlaybackMode(thumbDiv: Element | null | undefined) {
        return isHtmlElement(thumbDiv) ? (thumbDiv.dataset.playbackMode || "manual") : "manual";
    }

    /**
     * 再生開始方法をサムネイルへ保存または解除する。
     */
    function setPlaybackMode(thumbDiv: HTMLElement, playbackMode?: YoutubePlaybackMode) {
        if (typeof playbackMode === "string" && playbackMode) {
            thumbDiv.dataset.playbackMode = playbackMode;
            return;
        }
        delete thumbDiv.dataset.playbackMode;
    }

    /**
     * 再生状態機械へイベントを適用し、最新 state を返す。
     */
    function applyPlaybackStateEvent(event: YoutubePlaybackStateEvent) {
        playbackState = reduceYoutubePlaybackState(playbackState, event);
        return playbackState;
    }

    /**
     * state change event が示す状態と、プレーヤーが現在返す状態の不一致を検出する。
     * 古い再生から遅れて届いたイベントを誤処理しないために使う。
     */
    function isStalePlayerStateEvent(
        event: YoutubePlayerEvent | null | undefined,
        currentPlayerState: number | null
    ): boolean {
        if (!event || currentPlayerState === null) return false;
        return currentPlayerState !== event.data;
    }

    const unconfirmedPlaybackStarts = createYoutubeUnconfirmedPlaybackStartManager({
        getSharedPlaybackState
    });

    const playbackStartAttempts = createYoutubePlaybackStartAttemptManager({
        getSharedPlaybackState,
        getThumbForSession: (sessionId) => getSharedPlaybackThumb(sessionId),
        getSessionIdForThumb: (thumbDiv) => getPlaybackSessionId(thumbDiv),
        isCurrentSession: (thumbDiv, sessionId) => isCurrentPlaybackSession(thumbDiv, sessionId),
        handleStartFailure: (thumbDiv, options) => handlePlaybackStartFailure(thumbDiv, options),
        markUnconfirmedStart: (sessionId) => unconfirmedPlaybackStarts.mark(sessionId),
        clearUnconfirmedStart: (sessionId) => unconfirmedPlaybackStarts.clear(sessionId)
    });

    /**
     * レイアウト再計算フックを登録する。
     */
    function setLayoutHook(fn: () => void) {
        if (typeof fn === "function") {
            refreshLayout = fn;
        }
    }

    /**
     * 再生終了時の継続再生フックを登録する。
     */
    function setPlaybackEndedHook(fn: (payload: { songKey: string }) => void) {
        if (typeof fn === "function") {
            handlePlaybackEnded = fn;
        }
    }

    /**
     * 再生開始失敗時のフックを登録する。
     */
    function setPlaybackStartFailedHook(fn: (payload: PlaybackStartFailedPayload) => void) {
        if (typeof fn === "function") {
            handlePlaybackStartFailed = fn;
        }
    }

    /**
     * 再生終了として扱い、サムネイル復元と継続再生通知を行う。
     */
    function completeEndedPlayback(thumbDiv: HTMLElement, playbackSessionId: number): void {
        const shouldNotifyPlaybackEnded = playbackState.phase === "playing";
        const wasPlaybackStartUnconfirmed = unconfirmedPlaybackStarts.consume(playbackSessionId);
        playbackStartAttempts.settle(
            playbackSessionId,
            createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED)
        );
        const endedSongKey = getSongKeyFromYoutubeThumb(thumbDiv);
        const endedPlaybackMode = getPlaybackMode(thumbDiv);
        const endedGeneration = applyPlaybackStateEvent({
            type: "PLAYBACK_ENDED",
            sessionId: playbackSessionId
        }).transitionGeneration;
        Promise.resolve(restoreThumbnail(thumbDiv, thumbDiv.dataset.videoId || "", {
            preserveTransitionGeneration: true
        })).then((restored) => {
            if (!restored) return;
            if (endedGeneration !== playbackState.transitionGeneration) return;
            if (shouldNotifyPlaybackEnded && endedSongKey) {
                handlePlaybackEnded({ songKey: endedSongKey });
                return;
            }
            if (endedSongKey) {
                handlePlaybackStartFailed(buildPlaybackStartFailedPayload(endedSongKey, endedPlaybackMode, {
                    wasPlaybackStartUnconfirmed
                }));
            }
        });
    }

    const postPlaybackAdRestore = createYoutubePostPlaybackAdRestoreManager({
        getPlayer: () => getSharedPlaybackState().player,
        getThumbForSession: (sessionId) => getSharedPlaybackThumb(sessionId),
        isCurrentSession: (thumbDiv, sessionId) => isCurrentPlaybackSession(thumbDiv, sessionId),
        getExpectedPlaybackEndSeconds: (thumbDiv) => getPlaybackEndSeconds(thumbDiv),
        completeEndedPlayback: (thumbDiv, sessionId) => completeEndedPlayback(thumbDiv, sessionId),
        debug: (message, details) => debugPlayback("youtube", message, details)
    });

    /**
     * 実行環境がiOS系WebKitかどうかを判定する。
     */
    function isIOSWebKit() {
        const hasTouch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
        const webkitTouchCallout = CSS.supports && CSS.supports("-webkit-touch-callout", "none");
        const webkitOverflowScrolling = CSS.supports && CSS.supports("-webkit-overflow-scrolling", "touch");
        const isWebKit = webkitTouchCallout || webkitOverflowScrolling;
        return hasTouch && isWebKit;
    }

    const youtubeApi = {
        ensureReady() {
            return youtubeIframeApiLoader.ensureReady();
        },
        /**
         * 埋め込み再生用の標準 YouTube URL を生成する。
         */
        buildEmbedUrl(yt: YoutubeTarget, playbackMode: YoutubePlaybackMode | undefined) {
            return buildYoutubeEmbedUrl(yt, {
                endSeconds: getEffectiveEndSeconds(yt),
                autoplay: isEmbeddedPlayerAutoplayEnabled(playbackMode),
                useYoutubeNoCookie: Boolean(playbackUi.useYoutubeNoCookie)
            });
        },
        /**
         * プレイヤー状態変化に応じて再生状態表示を更新する。
         */
        handleStateChange(event: YoutubePlayerEvent, playbackSessionId: number) {
            const thumbDiv = getSharedPlaybackThumb(playbackSessionId);
            debugPlayback("youtube", "player state change", {
                playbackSessionId,
                playerState: event && event.data,
                hasThumb: isHtmlElement(thumbDiv),
                activeSongKey: isHtmlElement(thumbDiv) ? getSongKeyFromYoutubeThumb(thumbDiv) : ""
            });
            if (!isHtmlElement(thumbDiv)) return;
            if (!isCurrentPlaybackSession(thumbDiv, playbackSessionId)) return;
            const currentPlayerState = readYoutubePlayerState(event.target);
            if (postPlaybackAdRestore.handleWatchingStateEvent({
                playbackSessionId,
                eventState: event.data,
                currentPlayerState
            })) {
                return;
            }
            if (event.data !== YOUTUBE_PLAYER_STATE.PLAYING && isStalePlayerStateEvent(event, currentPlayerState)) {
                if (postPlaybackAdRestore.handleStaleEndedState({
                    thumbDiv,
                    playbackSessionId,
                    eventState: event.data,
                    currentPlayerState,
                    player: event.target
                })) {
                    return;
                }
                debugPlayback("youtube", "ignored stale player state event", {
                    playbackSessionId,
                    playerState: event && event.data,
                    currentPlayerState,
                    activeSongKey: getSongKeyFromYoutubeThumb(thumbDiv)
                });
                return;
            }
            if (event.data === YOUTUBE_PLAYER_STATE.ENDED) {
                completeEndedPlayback(thumbDiv, playbackSessionId);
                return;
            }
            if (event.data === YOUTUBE_PLAYER_STATE.PAUSED) {
                setYoutubeThumbnailPlaybackState(thumbDiv, "stopped");
                return;
            }
            if (event.data === YOUTUBE_PLAYER_STATE.PLAYING) {
                unconfirmedPlaybackStarts.clear(playbackSessionId);
                playbackStartAttempts.settle(
                    playbackSessionId,
                    createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED)
                );
                applyPlaybackStateEvent({
                    type: "PLAYBACK_STARTED",
                    sessionId: playbackSessionId
                });
                setYoutubeThumbnailPlaybackState(thumbDiv, "playing");
            }
        },
        /**
         * プレーヤーエラー発生時に再生開始待ちを失敗として処理する。
         */
        handlePlayerError(event: YoutubePlayerEvent, playbackSessionId: number) {
            const thumbDiv = getSharedPlaybackThumb(playbackSessionId);
            if (!isHtmlElement(thumbDiv)) return;
            if (!isCurrentPlaybackSession(thumbDiv, playbackSessionId)) return;
            const wasPlaybackStartUnconfirmed = unconfirmedPlaybackStarts.consume(playbackSessionId);
            playbackStartAttempts.settle(
                playbackSessionId,
                createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED)
            );
            handlePlaybackStartFailure(thumbDiv, {
                sessionId: playbackSessionId,
                playbackMode: getPlaybackMode(thumbDiv),
                reason: "player-error",
                errorCode: event && event.data,
                wasPlaybackStartUnconfirmed
            });
        }
    };

    const youtubePlayerAdapter = createYoutubePlayerAdapter({
        getSharedPlaybackState,
        setPendingAttach: (iframe, playbackSessionId) => {
            setPendingSharedPlaybackAttach(iframe, playbackSessionId);
        },
        setSessionId: (playbackSessionId) => {
            setSharedPlaybackSessionId(playbackSessionId);
        },
        ensureReady: () => youtubeApi.ensureReady(),
        applyIframeAttributes: (iframe) => applyYoutubePlayerIframeAttributes(iframe),
        syncIframe: () => syncSharedPlaybackIframe(),
        handleStateChange: (event, playbackSessionId) => youtubeApi.handleStateChange(event, playbackSessionId),
        handlePlayerError: (event, playbackSessionId) => youtubeApi.handlePlayerError(event, playbackSessionId),
        handleAttachFailure: (_error, playbackSessionId) => handleYoutubePlayerAttachFailure(playbackSessionId),
        debug: (message, details) => debugPlayback("youtube", message, details)
    });

    /**
     * YouTube Iframe API への接続失敗時に再生方針を適用する。
     */
    function handleYoutubePlayerAttachFailure(playbackSessionId: number) {
        // API読み込み失敗時は埋め込みのみで継続する
        debugPlayback("youtube", "attachPlayer failed to create player", {
            playbackSessionId
        });
        const thumbDiv = getSharedPlaybackThumb(playbackSessionId);
        if (getPlaybackMode(thumbDiv) === "autoplay") {
            const error = new Error("iframe api unavailable for autoplay") as YoutubePlaybackError;
            error.code = "iframe-api-load-failed";
            throw error;
        }
        playbackStartAttempts.settle(
            playbackSessionId,
            createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED)
        );
        return null;
    }

    /**
     * Player 接続前に始まった再生状態を取りこぼさないよう、現在状態を反映する。
     */
    function syncAttachedPlayerState(player: YoutubePlayerLike | null | undefined, playbackSessionId: number) {
        const currentState = readYoutubePlayerState(player);
        if (player && currentState === YOUTUBE_PLAYER_STATE.PLAYING) {
            youtubeApi.handleStateChange({
                data: currentState,
                target: player
            }, playbackSessionId);
        }
    }

    /**
     * 共有プレイヤーを停止できたか返す。
     */
    function stopSharedPlaybackPlayer() {
        const player = getSharedPlaybackState().player;
        if (!player || typeof player.stopVideo !== "function") return false;
        try {
            player.stopVideo();
            debugPlayback("youtube", "stopPlayer called", undefined);
            return true;
        } catch {
            debugPlayback("youtube", "stopPlayer failed", undefined);
            return false;
        }
    }

    /**
     * 再生開始方法に応じて埋め込みプレイヤーを自動開始するか返す。
     * 手動クリックは連続再生設定中でも autoplay へ昇格させない。
     */
    function isEmbeddedPlayerAutoplayEnabled(playbackMode: YoutubePlaybackMode | undefined) {
        return playbackMode === "autoplay";
    }

    /**
     * 共有再生に使う iframe 要素を生成する。
     */
    function createSharedPlaybackFrame() {
        if (!canUseDom()) return null;
        const iframe = document.createElement("iframe");
        applyYoutubePlayerIframeAttributes(iframe);
        return iframe;
    }

    /**
     * 共有再生に使う閉じるボタンを生成する。
     */
    function createSharedPlaybackCloseButton() {
        if (!canUseDom()) return null;
        const close = document.createElement("button");
        close.type = "button";
        close.className = "thumb-close-btn";
        close.setAttribute("aria-label", "サムネイルに戻す");
        close.innerHTML = "&times;";
        close.addEventListener("click", (event) => {
            event.stopPropagation();
            const activeThumb = playbackUi.activeThumb;
            if (!activeThumb) return;
            restoreThumbnail(activeThumb, activeThumb.dataset.videoId || "");
        });
        return close;
    }

    /**
     * autoplay 開始失敗のデバッグ用詳細を組み立てる。
     */
    function buildAutoplayFailureDebugDetails(
        thumbDiv: Element | null | undefined,
        options: PlaybackStartFailureOptions | undefined
    ) {
        const details: { songKey: string, videoId: string, reason: string, errorCode?: unknown } = {
            songKey: getSongKeyFromYoutubeThumb(thumbDiv),
            videoId: isHtmlElement(thumbDiv) ? (thumbDiv.dataset.videoId || "") : "",
            reason: options && options.reason ? options.reason : "unknown"
        };
        if (options && options.errorCode !== undefined) {
            details.errorCode = options.errorCode;
        }
        return details;
    }

    /**
     * autoplay 開始失敗を opt-in デバッグログへ出力する。
     */
    function logAutoplayPlaybackFailure(
        thumbDiv: Element | null | undefined,
        options: PlaybackStartFailureOptions | undefined
    ) {
        debugPlayback(
            "youtube",
            "autoplay playback start failed; skipping candidate",
            buildAutoplayFailureDebugDetails(thumbDiv, options)
        );
    }

    /**
     * 再生開始失敗フックへ渡す payload を組み立てる。
     */
    function buildPlaybackStartFailedPayload(
        songKey: string,
        playbackMode: YoutubePlaybackMode,
        options?: Pick<PlaybackStartFailureOptions, "wasPlaybackStartUnconfirmed">
    ) {
        const payload: PlaybackStartFailedPayload = {
            songKey,
            playbackMode
        };
        if (options && options.wasPlaybackStartUnconfirmed) {
            payload.wasPlaybackStartUnconfirmed = true;
        }
        return payload;
    }

    /**
     * 再生開始失敗時の後始末を行い、通常サムネイル表示へ戻す。
     */
    function handlePlaybackStartFailure(
        thumbDiv: HTMLElement,
        options: PlaybackStartFailureOptions | undefined = undefined
    ) {
        const playbackMode = options && options.playbackMode ? options.playbackMode : getPlaybackMode(thumbDiv);
        const failedSongKey = getSongKeyFromYoutubeThumb(thumbDiv);
        const failedSessionId = options && Number.isFinite(options.sessionId) ? options.sessionId : 0;
        const shouldNotifyStartFailure =
            Boolean(failedSongKey) &&
            (!failedSessionId || isCurrentPlaybackSession(thumbDiv, failedSessionId));
        if (playbackMode === "autoplay") {
            logAutoplayPlaybackFailure(thumbDiv, options);
        }
        const expectedGeneration = playbackState.transitionGeneration + 1;
        Promise.resolve(restoreThumbnail(thumbDiv, thumbDiv.dataset.videoId || "")).then((restored) => {
            if (!restored) return;
            if (expectedGeneration !== playbackState.transitionGeneration) return;
            if (!shouldNotifyStartFailure) return;
            debugPlayback("youtube", "playback start failed hook", {
                songKey: failedSongKey,
                playbackMode,
                reason: options && options.reason ? options.reason : "unknown",
                errorCode: options && options.errorCode
            });
            handlePlaybackStartFailed(buildPlaybackStartFailedPayload(failedSongKey, playbackMode, options));
        });
    }

    /**
     * 共有 iframe と閉じるボタンを必要に応じて生成する。
     */
    function ensureSharedPlaybackElements() {
        return ensureYoutubeSharedPlaybackElements({
            youtube,
            syncIframe: () => syncSharedPlaybackIframe(),
            createFrame: () => createSharedPlaybackFrame(),
            createCloseButton: () => createSharedPlaybackCloseButton()
        });
    }

    /**
     * 広告終了監視を止め、共有プレーヤー実体とカードへの紐付けを破棄する。
     * 再生成前に作成した再生開始待ちと未確定セッションは保持する。
     */
    function destroySharedPlaybackPlayer() {
        postPlaybackAdRestore.clear();
        destroyYoutubeSharedPlaybackPlayer({
            youtube,
            syncIframe: () => syncSharedPlaybackIframe(),
            debug: (message, details) => debugPlayback("youtube", message, details)
        });
    }

    /**
     * 指定サムネイルに共有プレーヤーが載っているか判定する。
     */
    function isSharedPlaybackMountedInThumb(thumbDiv: Element | null | undefined) {
        const iframe = syncSharedPlaybackIframe();
        return Boolean(
            isHtmlElement(thumbDiv) &&
            isHtmlElement(iframe) &&
            iframe.parentElement === thumbDiv
        );
    }

    /**
     * 指定サムネイルから共有プレーヤーを外して破棄する。
     */
    function detachSharedPlayback(thumbDiv: Element | null | undefined, options?: { stopPlayback?: boolean }) {
        if (!isSharedPlaybackMountedInThumb(thumbDiv)) {
            const sharedPlayback = getSharedPlaybackState();
            if (sharedPlayback.hostThumb === thumbDiv) {
                postPlaybackAdRestore.clear();
                sharedPlayback.hostThumb = null;
                setSharedPlaybackSessionId(0);
            }
            debugPlayback("youtube", "detachSharedPlayback skipped because iframe is not mounted in thumb", {
                songKey: getSongKeyFromYoutubeThumb(thumbDiv)
            });
            return false;
        }
        postPlaybackAdRestore.clear();
        const iframe = syncSharedPlaybackIframe();
        const shouldStopPlayback = !(options && options.stopPlayback === false);
        tracePlayback("youtube", "detachSharedPlayback", {
            songKey: getSongKeyFromYoutubeThumb(thumbDiv),
            shouldStopPlayback
        });
        const stopped = shouldStopPlayback ? stopSharedPlaybackPlayer() : false;
        if (shouldStopPlayback && !stopped && isHtmlElement(iframe)) {
            const iframeElement = iframe as HTMLIFrameElement;
            iframeElement.src = "about:blank";
            debugPlayback("youtube", "detachSharedPlayback fell back to about:blank", {
                songKey: getSongKeyFromYoutubeThumb(thumbDiv)
            });
        }
        destroySharedPlaybackPlayer();
        clearActiveThumb(thumbDiv);
        return true;
    }

    /**
     * 指定サムネイルへ共有プレーヤーを差し込み、iframe src から再生開始する。
     */
    function mountSharedPlayback(
        thumbDiv: HTMLElement,
        yt: YoutubeTarget,
        playbackSessionId: number,
        playbackMode: YoutubePlaybackMode
    ) {
        let sharedPlayback = getSharedPlaybackState();
        if (sharedPlayback.player || sharedPlayback.iframe || sharedPlayback.hostThumb) {
            debugPlayback("youtube", "mountSharedPlayback recreating iframe-backed player", {
                previousSongKey: getSongKeyFromYoutubeThumb(sharedPlayback.hostThumb),
                nextSongKey: getSongKeyFromYoutubeThumb(thumbDiv),
                videoId: yt && yt.videoId,
                playbackSessionId
            });
            destroySharedPlaybackPlayer();
        }
        sharedPlayback = ensureSharedPlaybackElements();
        const iframe = syncSharedPlaybackIframe() || sharedPlayback.iframe;
        if (!isHtmlElement(iframe) || !isHtmlElement(sharedPlayback.closeButton)) {
            return Promise.resolve(false);
        }
        iframe.src = youtubeApi.buildEmbedUrl(yt, playbackMode);
        thumbDiv.replaceChildren(iframe, sharedPlayback.closeButton);
        sharedPlayback.hostThumb = thumbDiv;
        setSharedPlaybackSessionId(playbackSessionId);
        debugPlayback("youtube", "mountSharedPlayback using iframe src", {
            songKey: getSongKeyFromYoutubeThumb(thumbDiv),
            videoId: yt && yt.videoId,
            playbackSessionId,
            iframeSrc: iframe.src
        });
        return youtubePlayerAdapter.attach(iframe, playbackSessionId)
            .then((player) => {
                syncAttachedPlayerState(player, playbackSessionId);
                return Boolean(thumbDiv.querySelector("iframe"));
            });
    }

    /**
     * サムネイル表示時にYouTube APIの事前読み込みを行う。
     */
    function ensureYoutubeApiForThumbnails() {
        if (!playbackUi.showThumbnails) return;
        requestAnimationFrame(() => youtubeApi.ensureReady().catch(() => {}));
    }

    /**
     * サムネイルに紐づく再生セッションIDを返す。
     */
    function getPlaybackSessionId(thumbDiv: unknown) {
        const value = isHtmlElement(thumbDiv) ? thumbDiv.dataset.playbackSessionId : "";
        const sessionId = Number.parseInt(String(value || ""), 10);
        return Number.isFinite(sessionId) ? sessionId : 0;
    }

    /**
     * サムネイルに再生セッションIDを設定または解除する。
     */
    function setPlaybackSessionId(thumbDiv: Element | null | undefined, sessionId: number) {
        if (!isHtmlElement(thumbDiv)) return;
        if (Number.isFinite(sessionId) && sessionId > 0) {
            thumbDiv.dataset.playbackSessionId = String(sessionId);
            return;
        }
        delete thumbDiv.dataset.playbackSessionId;
    }

    /**
     * イベントが現在有効な再生セッションに属するか判定する。
     */
    function isCurrentPlaybackSession(thumbDiv: Element | null | undefined, sessionId: number) {
        return isYoutubePlaybackSessionActive(playbackState, sessionId) &&
            getPlaybackSessionId(thumbDiv) === sessionId;
    }

    /**
     * 実際に再生へ使う終了秒数を返す。
     */
    function getEffectiveEndSeconds(yt: YoutubeTarget | null | undefined) {
        if (playbackUi.playArchiveToEnd) return null;
        const endSeconds = yt?.endSeconds;
        return typeof endSeconds === "number" && Number.isFinite(endSeconds) ? endSeconds : null;
    }

    /**
     * 再生対象の dataset 保存に使う metadata を作成する。
     */
    function buildPlaybackTargetMetadata(yt: YoutubeTarget): YoutubePlaybackTargetMetadata {
        const playbackEndSeconds = getEffectiveEndSeconds(yt);
        const endPart = Number.isFinite(playbackEndSeconds) ? String(playbackEndSeconds) : "";
        return {
            videoId: yt.videoId,
            playbackKey: yt.videoId ? `${yt.videoId}:${yt.startSeconds}:${endPart}` : "",
            playbackEndSeconds
        };
    }

    /**
     * サムネイルコンテナを再生状態から初期表示へリセットする。
     */
    function resetThumbnailContainer(
        thumbDiv: HTMLElement,
        playbackTarget: YoutubePlaybackTargetMetadata
    ): void {
        const previousSessionId = getPlaybackSessionId(thumbDiv);
        playbackStartAttempts.cancelForThumb(thumbDiv);
        applyPlaybackStateEvent({
            type: "CANCEL_PLAYBACK",
            sessionId: previousSessionId
        });
        clearActiveThumb(thumbDiv);
        detachSharedPlayback(thumbDiv);
        setPlaybackTargetMetadata(thumbDiv, playbackTarget);
        setPlaybackSessionId(thumbDiv, 0);
        setPlaybackMode(thumbDiv);
        thumbDiv.classList.remove("playing");
        setYoutubeThumbnailExpandedCardState(thumbDiv, false);
        thumbDiv.onclick = null;
        thumbDiv.replaceChildren();
    }

    /**
     * サムネイルに再生終了秒数を保存または解除する。
     */
    function setPlaybackEndSeconds(
        thumbDiv: HTMLElement,
        endSeconds: number | null | undefined
    ): void {
        if (Number.isFinite(endSeconds) && Number(endSeconds) > 0) {
            thumbDiv.dataset.playbackEndSeconds = String(endSeconds);
            return;
        }
        delete thumbDiv.dataset.playbackEndSeconds;
    }

    /**
     * サムネイルに再生対象 metadata を保存する。
     */
    function setPlaybackTargetMetadata(
        thumbDiv: HTMLElement,
        playbackTarget: YoutubePlaybackTargetMetadata
    ): void {
        thumbDiv.dataset.videoId = playbackTarget.videoId;
        thumbDiv.dataset.playbackKey = playbackTarget.playbackKey;
        setPlaybackEndSeconds(thumbDiv, playbackTarget.playbackEndSeconds);
    }

    /**
     * サムネイルの再生対象 metadata を通常サムネイル用に戻す。
     */
    function clearPlaybackTargetMetadata(thumbDiv: HTMLElement, videoId: string): void {
        setPlaybackTargetMetadata(thumbDiv, {
            videoId,
            playbackKey: "",
            playbackEndSeconds: null
        });
    }

    /**
     * サムネイルに保存した再生終了秒数を返す。
     */
    function getPlaybackEndSeconds(thumbDiv: Element | null | undefined): number | null {
        if (!isHtmlElement(thumbDiv)) return null;
        const endSeconds = Number(thumbDiv.dataset.playbackEndSeconds);
        return Number.isFinite(endSeconds) && endSeconds > 0 ? endSeconds : null;
    }

    /**
     * 現在表示中の再生対象と次の対象が同一か判定する。
     */
    function isSamePlaybackTarget(thumbDiv: HTMLElement, nextPlaybackKey: string) {
        if (!playbackUi.showThumbnails) return false;
        if (!isSharedPlaybackMountedInThumb(thumbDiv)) return false;
        return (thumbDiv.dataset.playbackKey || "") === nextPlaybackKey;
    }

    /**
     * アクティブなサムネイルを切り替える。
     */
    function setActiveThumb(thumbDiv: HTMLElement, options?: { preserveTransitionGeneration?: boolean }) {
        if (playbackUi.activeThumb && playbackUi.activeThumb !== thumbDiv) {
            restoreThumbnail(playbackUi.activeThumb, playbackUi.activeThumb.dataset.videoId || "", {
                preserveTransitionGeneration: Boolean(options && options.preserveTransitionGeneration)
            });
        }
        playbackUi.activeThumb = thumbDiv;
    }

    /**
     * 指定サムネイルがアクティブなら参照を解除する。
     */
    function clearActiveThumb(thumbDiv: Element | null | undefined) {
        if (playbackUi.activeThumb === thumbDiv) playbackUi.activeThumb = null;
    }

    /**
     * スクロール監視結果に応じて画像読み込みや再生停止を処理する。
     */
    function handleScrollObserver(entries: IntersectionObserverEntry[]) {
        entries.forEach((entry) => {
            const thumb = entry.target;
            if (!isHtmlElement(thumb)) return;
            if (entry.isIntersecting) {
                const img = thumb.querySelector("img");
                const srcAttr = img ? img.getAttribute("src") : null;
                if (img && (!srcAttr || srcAttr === "about:blank")) {
                    const dataSrc = img.dataset.src;
                    if (dataSrc) img.src = dataSrc;
                }
                return;
            }
            if (!entry.isIntersecting) {
                if (!STOP_PLAYBACK_ON_SCROLL_OUT) return;
                playbackStartAttempts.cancelForThumb(thumb);
                if (!detachSharedPlayback(thumb)) return;
                const videoId = thumb.dataset.videoId;
                setPlaybackSessionId(thumb, 0);
                thumb.classList.remove("playing");
                setYoutubeThumbnailOrientation(thumb, "landscape");
                setYoutubeThumbnailExpandedCardState(thumb, false);
                if (videoId) {
                    applyYoutubeThumbnailImage(thumb, videoId, undefined);
                } else {
                    thumb.replaceChildren();
                }
                refreshCardLayoutSoon(thumb);
            }
        });
    }

    /**
     * サムネイル可視判定用のIntersectionObserverを再設定する。
     */
    function setupScrollObserver() {
        const headerHeight = getHeaderHeight();
        if (playbackUi.scrollObserver) playbackUi.scrollObserver.disconnect();
        const observer = new IntersectionObserver(handleScrollObserver, {
            threshold: 0,
            rootMargin: `-${headerHeight}px 0px 0px 0px`
        });
        playbackUi.scrollObserver = observer;
        if (!playbackUi.showThumbnails) return;
        document.querySelectorAll(".thumb").forEach((thumb) => {
            observer.observe(thumb);
        });
    }

    /**
     * 埋め込み再生を解除して通常サムネイル表示へ戻す。
     */
    function restoreThumbnail(
        thumbDiv: HTMLElement,
        videoId: string,
        options?: { preserveTransitionGeneration?: boolean }
    ) {
        tracePlayback("youtube", "restoreThumbnail", {
            songKey: getSongKeyFromYoutubeThumb(thumbDiv),
            videoId,
            playbackMode: getPlaybackMode(thumbDiv),
            sessionId: getPlaybackSessionId(thumbDiv)
        });
        applyPlaybackStateEvent({
            type: "RESTORE_PLAYBACK",
            sessionId: getPlaybackSessionId(thumbDiv),
            preserveTransitionGeneration: Boolean(options && options.preserveTransitionGeneration)
        });
        playbackStartAttempts.cancelForThumb(thumbDiv);
        clearActiveThumb(thumbDiv);
        detachSharedPlayback(thumbDiv);
        clearPlaybackTargetMetadata(thumbDiv, videoId);
        setPlaybackSessionId(thumbDiv, 0);
        setPlaybackMode(thumbDiv);
        setYoutubeThumbnailOrientation(thumbDiv, "landscape");
        setYoutubeThumbnailPlaybackState(thumbDiv, "stopped");
        setYoutubeThumbnailExpandedCardState(thumbDiv, false);
        if (videoId) {
            applyYoutubeThumbnailImage(thumbDiv, videoId, { eager: true });
        } else {
            thumbDiv.replaceChildren();
        }
        return refreshCardLayoutSoon(thumbDiv);
    }

    /**
     * 現在アクティブな再生サムネイルを通常表示へ復元する。
     */
    function restoreActivePlayback() {
        const activeThumb = playbackUi.activeThumb;
        if (!activeThumb) return;
        if (!activeThumb.isConnected) {
            playbackUi.activeThumb = null;
            applyPlaybackStateEvent({ type: "STOP_PLAYBACK" });
            return;
        }
        tracePlayback("youtube", "restoreActivePlayback", {
            songKey: getSongKeyFromYoutubeThumb(activeThumb),
            videoId: activeThumb.dataset.videoId || "",
            playbackMode: getPlaybackMode(activeThumb),
            sessionId: getPlaybackSessionId(activeThumb)
        });
        restoreThumbnail(activeThumb, activeThumb.dataset.videoId || "");
    }

    /**
     * サムネイルを埋め込みプレイヤーへ切り替えて再生開始する。
     */
    function startEmbeddedPlayback(thumbDiv: HTMLElement, yt: YoutubeTarget, options?: YoutubePlaybackOptions) {
        postPlaybackAdRestore.clear();
        const playbackMode = options && options.playbackMode ? options.playbackMode : "manual";
        const playbackSessionId = applyPlaybackStateEvent({
            type: "REQUEST_PLAYBACK"
        }).activeSessionId;
        const playbackStartPromise = playbackStartAttempts.create(playbackSessionId, {
            thumbDiv,
            playbackMode
        });
        setActiveThumb(thumbDiv, { preserveTransitionGeneration: true });
        setPlaybackTargetMetadata(thumbDiv, buildPlaybackTargetMetadata(yt));
        setPlaybackSessionId(thumbDiv, playbackSessionId);
        setPlaybackMode(thumbDiv, playbackMode);
        setYoutubeThumbnailOrientation(thumbDiv, yt && yt.isVertical ? "vertical" : "landscape");
        setYoutubeThumbnailPlaybackState(thumbDiv, "playing");
        setYoutubeThumbnailExpandedCardState(thumbDiv, Boolean(yt && yt.isVertical));
        Promise.resolve(mountSharedPlayback(thumbDiv, yt, playbackSessionId, playbackMode)).then((didMount) => {
            if (didMount) {
                playbackStartAttempts.armStartTimeout(playbackSessionId);
                return;
            }
            playbackStartAttempts.settle(
                playbackSessionId,
                createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED)
            );
            handlePlaybackStartFailure(thumbDiv, {
                sessionId: playbackSessionId,
                playbackMode,
                reason: "mount-failed"
            });
        }).catch((error) => {
            playbackStartAttempts.settle(
                playbackSessionId,
                createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED)
            );
            handlePlaybackStartFailure(thumbDiv, {
                sessionId: playbackSessionId,
                playbackMode,
                reason: error && typeof error.code === "string"
                    ? error.code
                    : "mount-error"
            });
        });
        if (yt && yt.isVertical) {
            refreshCardLayoutSoon(thumbDiv);
        }
        if (options && options.revealCard) {
            revealYoutubePlaybackCardIfNeeded(thumbDiv);
        }
        return playbackStartPromise;
    }

    /**
     * 指定サムネイルを即座に埋め込み再生へ切り替える。
     */
    function playThumbnail(
        thumbDiv: Element | null | undefined,
        yt: YoutubeTarget | null | undefined,
        options?: YoutubePlaybackOptions
    ) {
        const failedResult = createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED);
        if (!isHtmlElement(thumbDiv)) return Promise.resolve(failedResult);
        if (!playbackUi.showThumbnails) return Promise.resolve(failedResult);
        if (!yt || !yt.videoId) return Promise.resolve(failedResult);
        return startEmbeddedPlayback(thumbDiv, yt, options);
    }

    /**
     * 曲情報に合わせてサムネイル表示内容を更新する。
     */
    function updateThumbnail(thumbDiv: HTMLElement, yt: YoutubeTarget) {
        const playbackTarget = buildPlaybackTargetMetadata(yt);
        if (isSamePlaybackTarget(thumbDiv, playbackTarget.playbackKey)) {
            setPlaybackTargetMetadata(thumbDiv, playbackTarget);
            setYoutubeThumbnailOrientation(thumbDiv, yt && yt.isVertical ? "vertical" : "landscape");
            return;
        }
        resetThumbnailContainer(thumbDiv, playbackTarget);
        setYoutubeThumbnailOrientation(thumbDiv, "landscape");

        if (!playbackUi.showThumbnails) return;
        if (!yt.videoId) return;

        const img = createYoutubeThumbnailImage(yt.videoId);
        if (!img) return;
        thumbDiv.onclick = () => {
            if (thumbDiv.classList.contains("playing")) return;
            startEmbeddedPlayback(thumbDiv, yt, {
                revealCard: true,
                playbackMode: "manual"
            });
        };
        thumbDiv.appendChild(img);
        if (shouldLoadYoutubeThumbnailNow(thumbDiv) && img.dataset.src) {
            img.src = img.dataset.src;
        }
    }

    return {
        setLayoutHook,
        setPlaybackEndedHook,
        setPlaybackStartFailedHook,
        isIOSWebKit,
        ensureThumbnailPlaybackReady: ensureYoutubeApiForThumbnails,
        setupScrollObserver,
        playThumbnail,
        updateThumbnail,
        restoreActivePlayback
    };
}
