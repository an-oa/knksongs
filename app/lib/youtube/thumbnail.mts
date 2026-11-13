import { canUseDom, getHeaderHeight, isHtmlElement } from "../dom-utils.mjs";
import { scheduleScrollElementIntoView } from "../results-scroll.mjs";
import type { YoutubePlaybackMode } from "./playback-start-attempt.mjs";

/** サムネイルの中に置く再生ボタンのクラス名。 */
const YOUTUBE_THUMBNAIL_PLAY_BUTTON_CLASS = "thumb-play-btn";

/** 埋め込み再生の対象として、サムネイルの dataset へ保存する値。 */
export type YoutubePlaybackTargetMetadata = {
    videoId: string;
    playbackKey: string;
    playbackEndSeconds: number | null;
};

/**
 * サムネイル上のブラウザ標準保存導線をキャンセルする。
 * 本番コードではこの module 内の設定関数から使い、境界条件を単体テストするために export している。
 * @param {{ preventDefault?: () => void } | null | undefined} event
 */
export function preventYoutubeThumbnailDefaultAction(event: { preventDefault?: () => void } | null | undefined) {
    if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
    }
}

/**
 * サムネイルコンテナの右クリックメニューを抑止する。
 * @param {Element | null | undefined} thumbDiv
 */
export function suppressYoutubeThumbnailContextMenu(thumbDiv: Element | null | undefined) {
    if (!isHtmlElement(thumbDiv)) return;
    thumbDiv.addEventListener("contextmenu", preventYoutubeThumbnailDefaultAction);
}

/**
 * サムネイル画像の右クリックメニューとドラッグ保存を抑止する。
 * @param {Element | null | undefined} img
 */
export function suppressYoutubeThumbnailImageSaveActions(img: Element | null | undefined) {
    if (!isHtmlElement(img)) return;
    img.draggable = false;
    img.setAttribute("draggable", "false");
    img.addEventListener("contextmenu", preventYoutubeThumbnailDefaultAction);
    img.addEventListener("dragstart", preventYoutubeThumbnailDefaultAction);
}

/**
 * サムネイル画像要素を生成する。
 * 読み込みはブラウザ標準の遅延読み込みに任せ、画面に近づいてから取得させる。
 * 画像は再生ボタンの中に置き、何を再生するかはボタンの説明で伝えるので、代替文字は空にする。
 * @param videoId サムネイルを表示する YouTube 動画 ID
 * @returns サムネイル画像。DOM を使えない環境では null
 */
export function createYoutubeThumbnailImage(videoId: string) {
    if (!canUseDom()) return null;
    const img = document.createElement("img");
    // src より先に指定し、生成した時点で読み込みが始まらないようにする。
    img.loading = "lazy";
    img.alt = "";
    img.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    suppressYoutubeThumbnailImageSaveActions(img);
    return img;
}

/**
 * サムネイル画像を入れた再生ボタンを生成する。
 * サムネイルの枠は再生中に動画と閉じるボタンを入れるので、枠ではなく中のボタンをキーボードの操作先にする。
 * 押したときの処理は枠の click で受けるため、ここでは付けない。
 * @param videoId サムネイルを表示する YouTube 動画 ID
 * @param label ボタンの説明。どの曲を再生するかを伝える
 * @returns 再生ボタン。DOM を使えない環境では null
 */
export function createYoutubeThumbnailPlayButton(videoId: string, label: string) {
    const img = createYoutubeThumbnailImage(videoId);
    if (!img) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = YOUTUBE_THUMBNAIL_PLAY_BUTTON_CLASS;
    if (label) button.setAttribute("aria-label", label);
    button.append(img);
    return button;
}

/**
 * サムネイルの再生ボタンをコンテナへ適用する。説明は枠に保存してある値を使う。
 * @param thumbDiv 再生ボタンを置くサムネイル要素
 * @param videoId サムネイルを表示する YouTube 動画 ID
 */
export function applyYoutubeThumbnailImage(thumbDiv: HTMLElement, videoId: string) {
    const button = createYoutubeThumbnailPlayButton(videoId, getYoutubeThumbnailPlayLabel(thumbDiv));
    if (!isHtmlElement(button)) return;
    thumbDiv.replaceChildren(button);
}

/**
 * サムネイルに保存した再生ボタンの説明を返す。
 * @param thumbDiv 説明を読むサムネイル要素
 * @returns 再生ボタンの説明。保存がなければ空文字
 */
export function getYoutubeThumbnailPlayLabel(thumbDiv: HTMLElement): string {
    return thumbDiv.dataset.playLabel || "";
}

/**
 * 再生ボタンの説明をサムネイルへ保存し、表示中の再生ボタンにも反映する。
 * 再生を閉じるとボタンを作り直すので、枠に保存しておき、作り直したボタンにも同じ説明を付ける。
 * @param thumbDiv 説明を保存するサムネイル要素
 * @param label 再生ボタンの説明
 */
export function setYoutubeThumbnailPlayLabel(thumbDiv: HTMLElement, label: string): void {
    if (thumbDiv.dataset.playLabel !== label) thumbDiv.dataset.playLabel = label;
    const button = getYoutubeThumbnailPlayButton(thumbDiv);
    if (button && button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
}

/**
 * サムネイルに表示中の再生ボタンを返す。
 * @param thumbDiv 再生ボタンを探すサムネイル要素
 * @returns 再生ボタン。再生中やサムネイル非表示で置いていなければ null
 */
export function getYoutubeThumbnailPlayButton(thumbDiv: HTMLElement): HTMLElement | null {
    const button = thumbDiv.querySelector(`.${YOUTUBE_THUMBNAIL_PLAY_BUTTON_CLASS}`);
    return isHtmlElement(button) ? button : null;
}

/**
 * 再生していない状態のサムネイルに描いた内容を表す値を返す。
 * @param thumbDiv 値を読むサムネイル要素
 * @returns 描いた内容を表す値。描いていないか、再生を始めた後なら空文字
 */
export function getYoutubeThumbnailIdleRenderKey(thumbDiv: HTMLElement): string {
    return thumbDiv.dataset.thumbnailRenderKey || "";
}

/**
 * 再生していない状態のサムネイルに描いた内容を表す値を保存する。空文字を渡すと保存を解除する。
 * 同じ値のまま描き直しを求められたときに、画像を作り直さないために使う。
 * @param thumbDiv 値を保存するサムネイル要素
 * @param renderKey 描いた内容を表す値
 */
export function setYoutubeThumbnailIdleRenderKey(thumbDiv: HTMLElement, renderKey: string): void {
    if (renderKey) {
        thumbDiv.dataset.thumbnailRenderKey = renderKey;
        return;
    }
    delete thumbDiv.dataset.thumbnailRenderKey;
}

/**
 * サムネイル要素の再生状態クラスを更新する。
 * @param {HTMLElement} thumbDiv
 * @param {string} state
 */
export function setYoutubeThumbnailPlaybackState(thumbDiv: HTMLElement, state: string) {
    thumbDiv.classList.remove("playing");
    if (state === "playing") {
        thumbDiv.classList.add("playing");
    }
}

/**
 * サムネイル/プレイヤー枠の向きをデータ属性へ反映する。
 * @param {HTMLElement} thumbDiv
 * @param {string} orientation
 */
export function setYoutubeThumbnailOrientation(thumbDiv: HTMLElement, orientation: string) {
    thumbDiv.dataset.videoOrientation = orientation === "vertical" ? "vertical" : "landscape";
}

/**
 * 縦再生で前面表示が必要なカード状態を切り替える。
 * @param {unknown} thumbDiv
 * @param {boolean} isExpanded
 */
export function setYoutubeThumbnailExpandedCardState(thumbDiv: unknown, isExpanded: boolean) {
    const card = isHtmlElement(thumbDiv) ? thumbDiv.closest(".song-card") : null;
    if (!isHtmlElement(card)) return;
    card.classList.toggle("song-card-expanded", Boolean(isExpanded));
}

/**
 * サムネイルに対応する曲キーを返す。
 * @param {unknown} thumbDiv
 * @returns {string}
 */
export function getSongKeyFromYoutubeThumb(thumbDiv: unknown) {
    const card = isHtmlElement(thumbDiv) ? thumbDiv.closest(".song-card") : null;
    return isHtmlElement(card) ? (card.dataset.songKey || "") : "";
}

/**
 * 再生開始したカードが見切れている場合は見える位置まで寄せる。
 * @param {unknown} thumbDiv
 */
export function revealYoutubePlaybackCardIfNeeded(thumbDiv: unknown) {
    const card = isHtmlElement(thumbDiv) ? thumbDiv.closest(".song-card") : null;
    if (!isHtmlElement(card)) return;
    scheduleScrollElementIntoView(card, {
        topOffset: getHeaderHeight(),
        behavior: "smooth"
    });
}

/**
 * サムネイルに保存した再生開始方法を返す。保存がなければクリックによる開始として扱う。
 * @param thumbDiv 再生開始方法を読むサムネイル要素
 * @returns 自動再生なら "autoplay"、それ以外は "manual"
 */
export function getYoutubeThumbnailPlaybackMode(thumbDiv: Element | null | undefined): YoutubePlaybackMode {
    return isHtmlElement(thumbDiv) && thumbDiv.dataset.playbackMode === "autoplay" ? "autoplay" : "manual";
}

/**
 * 再生開始方法をサムネイルへ保存する。省略すると保存を解除する。
 * @param thumbDiv 再生開始方法を保存するサムネイル要素
 * @param playbackMode 保存する再生開始方法
 */
export function setYoutubeThumbnailPlaybackMode(thumbDiv: HTMLElement, playbackMode?: YoutubePlaybackMode) {
    if (typeof playbackMode === "string" && playbackMode) {
        thumbDiv.dataset.playbackMode = playbackMode;
        return;
    }
    delete thumbDiv.dataset.playbackMode;
}

/**
 * サムネイルに紐づく再生セッション ID を返す。
 * @param thumbDiv 再生セッション ID を読むサムネイル要素
 * @returns 再生セッション ID。紐づいていなければ 0
 */
export function getYoutubeThumbnailPlaybackSessionId(thumbDiv: unknown) {
    const value = isHtmlElement(thumbDiv) ? thumbDiv.dataset.playbackSessionId : "";
    const sessionId = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(sessionId) ? sessionId : 0;
}

/**
 * サムネイルに再生セッション ID を設定する。0 以下を渡すと解除する。
 * @param thumbDiv 再生セッション ID を設定するサムネイル要素
 * @param sessionId 設定する再生セッション ID
 */
export function setYoutubeThumbnailPlaybackSessionId(thumbDiv: Element | null | undefined, sessionId: number) {
    if (!isHtmlElement(thumbDiv)) return;
    if (Number.isFinite(sessionId) && sessionId > 0) {
        thumbDiv.dataset.playbackSessionId = String(sessionId);
        return;
    }
    delete thumbDiv.dataset.playbackSessionId;
}

/**
 * サムネイルに再生終了秒数を保存する。正の値でなければ保存を解除する。
 * @param thumbDiv 再生終了秒数を保存するサムネイル要素
 * @param endSeconds 保存する再生終了秒数
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
 * サムネイルに再生対象の値を保存する。
 * @param thumbDiv 再生対象を保存するサムネイル要素
 * @param playbackTarget 保存する再生対象
 */
export function setYoutubeThumbnailPlaybackTarget(
    thumbDiv: HTMLElement,
    playbackTarget: YoutubePlaybackTargetMetadata
): void {
    thumbDiv.dataset.videoId = playbackTarget.videoId;
    thumbDiv.dataset.playbackKey = playbackTarget.playbackKey;
    setPlaybackEndSeconds(thumbDiv, playbackTarget.playbackEndSeconds);
}

/**
 * サムネイルの再生対象を、通常のサムネイル表示用の値へ戻す。
 * @param thumbDiv 再生対象を戻すサムネイル要素
 * @param videoId サムネイルに表示する YouTube 動画 ID
 */
export function clearYoutubeThumbnailPlaybackTarget(thumbDiv: HTMLElement, videoId: string): void {
    setYoutubeThumbnailPlaybackTarget(thumbDiv, {
        videoId,
        playbackKey: "",
        playbackEndSeconds: null
    });
}

/**
 * サムネイルに保存した再生終了秒数を返す。
 * @param thumbDiv 再生終了秒数を読むサムネイル要素
 * @returns 再生終了秒数。保存がなければ null
 */
export function getYoutubeThumbnailPlaybackEndSeconds(thumbDiv: Element | null | undefined): number | null {
    if (!isHtmlElement(thumbDiv)) return null;
    const endSeconds = Number(thumbDiv.dataset.playbackEndSeconds);
    return Number.isFinite(endSeconds) && endSeconds > 0 ? endSeconds : null;
}
