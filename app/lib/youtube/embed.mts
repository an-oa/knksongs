import { isHtmlElement } from "../dom-utils.mjs";

const YT_EMBED_HOST = "https://www.youtube.com";
const YT_NOCOOKIE_EMBED_HOST = "https://www.youtube-nocookie.com";

export type YoutubeTarget = {
    videoId: string;
    startSeconds: number;
    endSeconds?: number | null;
    isVertical: boolean;
};

/**
 * YouTube Iframe API の読み込み完了を扱うローダーを作成する。
 */
export function createYoutubeIframeApiLoader({
    youtube,
    iframeApiSrc,
    iframeApiSelector,
    readyPollMs
}: {
    youtube: Pick<import("../../state.types.mjs").AppYoutubeRuntimeState, "apiPromise">;
    iframeApiSrc: string;
    iframeApiSelector: string;
    readyPollMs: number;
}) {
    /**
     * YouTube Iframe API が利用可能か返す。
     * @returns {boolean}
     */
    function isReady() {
        return Boolean(window.YT && window.YT.Player);
    }

    /**
     * Iframe API が利用可能になるまでポーリングで待機する。
     * @param {() => void} resolve
     */
    function waitForReady(resolve: () => void) {
        if (isReady()) {
            resolve();
            return;
        }
        setTimeout(() => waitForReady(resolve), readyPollMs);
    }

    /**
     * Iframe API スクリプトの読み込みと初期化完了を保証する。
     * @returns {Promise<void>}
     */
    function ensureReady() {
        if (isReady()) return Promise.resolve();
        if (youtube.apiPromise) return youtube.apiPromise;
        let script: HTMLScriptElement | null = null;
        let resolveReady: (value?: void | PromiseLike<void>) => void = () => {};
        const prevCallback = window.onYouTubeIframeAPIReady;

        /**
         * このローダーが差し替えた ready callback を失敗時に戻す。
         */
        function restoreCallback() {
            if (window.onYouTubeIframeAPIReady === readyCallback) {
                window.onYouTubeIframeAPIReady = prevCallback;
            }
        }

        /**
         * 読み込みに失敗した Iframe API script を再試行前に取り除く。
         */
        function removeScript() {
            if (isHtmlElement(script) && script.parentElement) {
                script.parentElement.removeChild(script);
            }
        }

        /**
         * YouTube Iframe API の ready callback を処理する。
         */
        function readyCallback() {
            if (typeof prevCallback === "function") prevCallback();
            resolveReady();
        }

        const apiPromise = new Promise<void>((resolve, reject) => {
            const existing = document.querySelector(iframeApiSelector);
            resolveReady = resolve;
            window.onYouTubeIframeAPIReady = readyCallback;
            const rejectWithCleanup = (error: Error) => {
                restoreCallback();
                removeScript();
                reject(error);
            };
            if (existing) {
                waitForReady(resolve);
                return;
            }
            script = document.createElement("script");
            script.src = iframeApiSrc;
            script.async = true;
            script.dataset.ytIframeApi = "true";
            script.onerror = () => rejectWithCleanup(new Error("iframe_api load failed"));
            document.head.appendChild(script);
        }).catch((error) => {
            if (youtube.apiPromise === apiPromise) {
                youtube.apiPromise = null;
            }
            throw error;
        });
        youtube.apiPromise = apiPromise;
        return youtube.apiPromise;
    }

    return {
        ensureReady
    };
}

/**
 * YouTube 埋め込みに使う host を設定値から返す。
 * @param {{ useYoutubeNoCookie?: boolean } | undefined} options
 * @returns {string}
 */
export function resolveYoutubeEmbedHost(options?: { useYoutubeNoCookie?: boolean }) {
    return options && options.useYoutubeNoCookie
        ? YT_NOCOOKIE_EMBED_HOST
        : YT_EMBED_HOST;
}

/**
 * iframe の URL から YouTube Player API に渡す host を返す。
 * @param {string | null | undefined} iframeSrc
 * @returns {string}
 */
export function resolveYoutubeEmbedHostFromUrl(iframeSrc: string | null | undefined) {
    const src = String(iframeSrc || "");
    return resolveYoutubeEmbedHost({
        useYoutubeNoCookie: src.startsWith(`${YT_NOCOOKIE_EMBED_HOST}/`)
    });
}

/**
 * 埋め込み再生用の標準 YouTube URL を生成する。
 * @param yt 動画IDと再生開始位置
 * @param {{ endSeconds?: number | null, autoplay?: boolean, useYoutubeNoCookie?: boolean } | undefined} options
 * @returns {string}
 */
export function buildYoutubeEmbedUrl(yt: Pick<YoutubeTarget, "videoId" | "startSeconds">, options?: { endSeconds?: number | null; autoplay?: boolean; useYoutubeNoCookie?: boolean }) {
    const autoplay = options && options.autoplay === true ? "1" : "0";
    const embedHost = resolveYoutubeEmbedHost(options);
    const params = new URLSearchParams({
        autoplay,
        playsinline: "1",
        start: String(yt.startSeconds),
        enablejsapi: "1",
        rel: "0",
        cc_load_policy: "0",
        iv_load_policy: "3"
    });
    const endSeconds = Number.isFinite(options?.endSeconds)
        ? options?.endSeconds
        : null;
    if (Number.isFinite(endSeconds)) {
        params.set("end", String(endSeconds));
    }
    if (location.origin !== "null") {
        params.set("origin", location.origin);
    }
    return `${embedHost}/embed/${yt.videoId}?${params.toString()}`;
}

/**
 * YouTube が生成した iframe へ必要な属性を反映する。
 * @param {Element | null | undefined} iframe
 */
export function applyYoutubePlayerIframeAttributes(iframe: Element | null | undefined) {
    if (!isHtmlElement(iframe)) return;
    const iframeElement = iframe as HTMLIFrameElement;
    iframeElement.allow = "autoplay; encrypted-media";
    iframeElement.referrerPolicy = "strict-origin-when-cross-origin";
    iframeElement.allowFullscreen = true;
}

export { YT_EMBED_HOST, YT_NOCOOKIE_EMBED_HOST };
