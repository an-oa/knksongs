import { isHtmlElement } from "./dom-utils.mjs";

/** レイアウト更新の前後で、同じ要素を同じ見た目の位置に保つための記録。 */
export type ViewportAnchor = {
    element: HTMLElement;
    container: HTMLElement;
    top: number;
};

/**
 * 指定要素を含む最も近いスクロール可能祖先を返す。
 * @param {*} element
 */
export function findScrollableAncestor(element: Element | null | undefined): HTMLElement {
    let current = element ? element.parentElement : null;
    while (current) {
        const style = window.getComputedStyle(current);
        const overflowY = style ? style.overflowY : "";
        const isScrollable = (overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight;
        if (isScrollable) return current;
        current = current.parentElement;
    }
    return isHtmlElement(document.scrollingElement)
        ? document.scrollingElement
        : document.documentElement as HTMLElement;
}

/**
 * レイアウト更新後に元の見えていた位置へ戻すためのアンカー情報を作る。
 * @param element 見えていた位置を保つ要素
 * @returns アンカー情報。要素が DOM にない場合は null
 */
export function createViewportAnchor(element: Element | null | undefined): ViewportAnchor | null {
    if (!isHtmlElement(element) || !element.isConnected) return null;
    return {
        element,
        container: findScrollableAncestor(element),
        top: element.getBoundingClientRect().top
    };
}

/**
 * アンカー要素の見えていた位置を維持するようスクロール位置を補正する。
 * @param anchor createViewportAnchor で記録したアンカー情報
 */
export function restoreViewportAnchor(anchor: ViewportAnchor | null | undefined): void {
    if (!anchor || !isHtmlElement(anchor.element) || !anchor.element.isConnected) return;
    const nextTop = anchor.element.getBoundingClientRect().top;
    const delta = nextTop - anchor.top;
    if (Math.abs(delta) < 1) return;
    const container = anchor.container;
    if (container === document.body || container === document.documentElement || container === document.scrollingElement) {
        window.scrollBy({ top: delta, behavior: "auto" });
        return;
    }
    container.scrollTop += delta;
}

/**
 * 指定回数の animation frame を待ってから処理を実行する。
 * レイアウト待ちの境界条件を単体テストするため export している。
 * @param {number} frameCount
 * @param {Function | undefined} callback
 * @returns {Promise<*>}
 */
export function afterAnimationFrames<T = void>(
    frameCount: number,
    callback?: () => T
): Promise<T | undefined> {
    const remaining = Number.isFinite(frameCount) ? Math.max(0, Math.floor(frameCount)) : 0;
    return new Promise<T | undefined>((resolve) => {
        function step(count: number): void {
            if (count <= 0) {
                resolve(typeof callback === "function" ? callback() : undefined);
                return;
            }
            if (typeof requestAnimationFrame !== "function") {
                resolve(undefined);
                return;
            }
            requestAnimationFrame(() => {
                step(count - 1);
            });
        }
        step(remaining);
    });
}

/**
 * レイアウト補正が落ち着くまで2フレーム待ってから処理を実行する。
 * @param {Function | undefined} callback
 * @returns {Promise<*>}
 */
export function afterLayoutSettled(callback?: () => void): Promise<void> {
    return afterAnimationFrames<void>(2, callback).then(() => undefined);
}

/**
 * スクロール位置を維持しながらレイアウト再計算するスケジューラーを作る。
 * 最新リクエストだけが有効になる。
 * @param {*} getRefreshLayout
 */
export function createLayoutRefreshScheduler(
    getRefreshLayout: (() => (() => void) | null | undefined) | null | undefined
) {
    let generation = 0;
    return function scheduleLayoutRefresh(anchorElement: Element | null | undefined): Promise<boolean> {
        const requestGeneration = ++generation;
        const anchor = createViewportAnchor(anchorElement);
        // 結果は resolve で返すので、フレーム待ちが返す Promise は受け取らない。
        return new Promise<boolean>((resolve) => {
            void afterAnimationFrames(1, () => {
                if (requestGeneration !== generation) {
                    resolve(false);
                    return;
                }
                const refreshLayout = typeof getRefreshLayout === "function" ? getRefreshLayout() : null;
                if (typeof refreshLayout === "function") {
                    refreshLayout();
                }
                restoreViewportAnchor(anchor);
                void afterAnimationFrames(1, () => {
                    if (requestGeneration !== generation) {
                        resolve(false);
                        return;
                    }
                    restoreViewportAnchor(anchor);
                    resolve(true);
                });
            });
        });
    };
}
