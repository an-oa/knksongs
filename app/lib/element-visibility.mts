/** 見えていると判断する割合。YouTube の規約は、自動再生をプレーヤーの半分より多くが見えてから始めることを求める。 */
const MIN_VISIBLE_RATIO = 0.5;

/** 見えている割合が変わったと知らせてもらう区切り。半分を超えた後も、割合が増えれば知らせを受ける。 */
const VISIBILITY_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

type WaitForElementMostlyVisibleOptions = {
    /** 画面の上端から除く高さ。固定ヘッダーに隠れる分は、見えていないものとして数える。 */
    topInset: number;
    /** 待つ上限 (ミリ秒)。 */
    timeoutMs: number;
};

/**
 * 要素の半分より多くが画面に見えるまで待つ。
 * すでに見えていれば、最初の知らせですぐに終わる。
 * @param element 見えるまで待つ要素
 * @param options 画面の上端から除く高さと、待つ上限
 * @returns 半分より多く見えたら true。上限までに見えなければ false
 */
export function waitForElementMostlyVisible(
    element: Element,
    options: WaitForElementMostlyVisibleOptions
): Promise<boolean> {
    const topInset = Number.isFinite(options.topInset) && options.topInset > 0 ? options.topInset : 0;
    return new Promise<boolean>((resolve) => {
        let isSettled = false;
        let observer: IntersectionObserver | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const settle = (isVisible: boolean) => {
            if (isSettled) return;
            isSettled = true;
            if (timeoutId !== null) clearTimeout(timeoutId);
            observer?.disconnect();
            resolve(isVisible);
        };
        observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > MIN_VISIBLE_RATIO)) {
                settle(true);
            }
        }, {
            rootMargin: `${-topInset}px 0px 0px 0px`,
            threshold: VISIBILITY_THRESHOLDS
        });
        timeoutId = setTimeout(() => settle(false), options.timeoutMs);
        observer.observe(element);
    });
}
