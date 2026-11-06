/**
 * 現在の実行環境で HTMLElement 判定が可能な場合だけ要素型チェックする。
 * @param {*} value
 * @returns {value is HTMLElement}
 */
export function isHtmlElement(value: unknown): value is HTMLElement {
    return typeof HTMLElement === "function" && value instanceof HTMLElement;
}

/**
 * 要素生成に必要な document API が利用可能か判定する。
 * @returns {boolean}
 */
export function canUseDom(): boolean {
    return typeof document === "object" && !!document && typeof document.createElement === "function";
}

/**
 * 現在の viewport 高を返す。
 * @returns {number}
 */
export function getViewportHeight(): number {
    if (typeof window !== "undefined" && Number.isFinite(window.innerHeight)) {
        return window.innerHeight;
    }
    if (typeof document !== "undefined" && Number.isFinite(document.documentElement.clientHeight)) {
        return document.documentElement.clientHeight;
    }
    return 0;
}

/**
 * 動きを減らす設定 (prefers-reduced-motion: reduce) になっているかを返す。
 * @returns 動きを減らす設定なら true。matchMedia を使えない環境では false
 */
export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 実行環境が iOS 系の WebKit かどうかを判定する。
 * タッチ操作に対応し、WebKit 独自の CSS プロパティを使える環境を iOS 系とみなす。
 * @returns iOS 系の WebKit なら true
 */
export function isIOSWebKit(): boolean {
    const hasTouch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
    const webkitTouchCallout = CSS.supports && CSS.supports("-webkit-touch-callout", "none");
    const webkitOverflowScrolling = CSS.supports && CSS.supports("-webkit-overflow-scrolling", "touch");
    return hasTouch && (webkitTouchCallout || webkitOverflowScrolling);
}

/**
 * 固定ヘッダーの高さを返す。
 * @returns {number}
 */
export function getHeaderHeight(): number {
    const header = document.querySelector(".header");
    return header ? header.getBoundingClientRect().height : 0;
}

/**
 * 固定ヘッダーの下端の、画面上の位置を返す。
 * ヘッダーが自動で隠れている間や隠れる途中は、画面の上へ出た分だけ小さくなる。
 * @returns ヘッダーの下端。ヘッダーがないか、画面の上へ隠れているときは 0
 */
export function getVisibleHeaderBottom(): number {
    const header = document.querySelector(".header");
    return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}
