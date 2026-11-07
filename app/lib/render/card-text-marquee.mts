import { isHtmlElement, prefersReducedMotion } from "../dom-utils.mjs";

/** 文字を流す動きに付ける id。カードから離れたときや文字を書き換えるとき、この動きだけを止めるために使う。 */
const CARD_TEXT_MARQUEE_ANIMATION_ID = "card-text-marquee";
/** 流している間だけ外側の要素に付けるクラス。末尾の省略記号を消し、内側の文字を動かせる箱にする。 */
const CARD_TEXT_MARQUEE_CLASS = "is-marquee-scrolling";
/** 1 秒あたりに流す幅。読みながら目で追える速さにする。 */
const CARD_TEXT_MARQUEE_PX_PER_SECOND = 40;
/** 先頭と末尾で止めておく時間。カードの上を素通りしただけでは動かさず、末尾を読む間も取る。 */
const CARD_TEXT_MARQUEE_HOLD_MS = 1000;
/**
 * 文字を一定の速さで消していく時間と、表していく時間。
 * 末尾で止めた後に消し、消えている間に先頭へ戻して表すので、戻る動きは見せない。
 */
const CARD_TEXT_MARQUEE_FADE_MS = 500;
/** 流す回数。流し終えると先頭へ戻り、省略記号の表示に戻る。 */
const CARD_TEXT_MARQUEE_ITERATIONS = 3;

/** 流す対象の、曲名またはアーティスト名。 */
export type CardTextMarqueeTarget = {
    /** 1 行の幅で文字を切る外側の要素。 */
    box: HTMLElement;
    /** box の中で動かす、文字を入れた要素。 */
    text: HTMLElement;
};

/**
 * 文字を流す動きが続いているかを返す。
 * @param target 曲名またはアーティスト名
 * @returns 流している途中なら true
 */
function isCardTextMarqueeRunning(target: CardTextMarqueeTarget): boolean {
    return typeof target.text.getAnimations === "function"
        && target.text.getAnimations().some((animation) => animation.id === CARD_TEXT_MARQUEE_ANIMATION_ID);
}

/**
 * 1 行に収まらない文字を、先頭で止めてから右から左へ末尾まで流し、末尾で止めてから消していく。
 * 消えたら先頭へ戻して表し、また流す。これを決まった回数繰り返し、最後も先頭で表して終える。
 * 収まっている文字や、Web Animations を使えない環境では何もしない。
 * @param target 曲名またはアーティスト名
 */
function startCardTextMarquee(target: CardTextMarqueeTarget): void {
    stopCardTextMarquee(target);
    const { box, text } = target;
    if (typeof text.animate !== "function") return;
    const distance = box.scrollWidth - box.clientWidth;
    if (distance <= 0) return;
    const fadeInEndMs = CARD_TEXT_MARQUEE_FADE_MS;
    const scrollStartMs = fadeInEndMs + CARD_TEXT_MARQUEE_HOLD_MS;
    const scrollEndMs = scrollStartMs + distance / CARD_TEXT_MARQUEE_PX_PER_SECOND * 1000;
    const fadeOutStartMs = scrollEndMs + CARD_TEXT_MARQUEE_HOLD_MS;
    const duration = fadeOutStartMs + CARD_TEXT_MARQUEE_FADE_MS;
    const endTransform = `translateX(${-distance}px)`;
    box.classList.add(CARD_TEXT_MARQUEE_CLASS);
    // transform で動かすと、ブラウザは描いた文字を 1px 未満ずつずらせる。
    // 字下げ (text-indent) で動かすと、毎フレーム配置を計算し直し、文字が 1px 単位で飛んでコマ送りに見える。
    // 1 回分は、先頭で表す、止める、流す、末尾で止める、消す、の順。
    // 繰り返しの境目では、消えた末尾から、消えたままの先頭へ切り替わる。
    const animation = text.animate([
        { offset: 0, transform: "translateX(0px)", opacity: 0 },
        { offset: fadeInEndMs / duration, transform: "translateX(0px)", opacity: 1 },
        { offset: scrollStartMs / duration, transform: "translateX(0px)", opacity: 1 },
        { offset: scrollEndMs / duration, transform: endTransform, opacity: 1 },
        { offset: fadeOutStartMs / duration, transform: endTransform, opacity: 1 },
        { offset: 1, transform: endTransform, opacity: 0 }
    ], {
        duration,
        iterations: CARD_TEXT_MARQUEE_ITERATIONS,
        // 1 回目は表し終えた所から始め、指したときに見えていた文字を一度消さない。
        // 長さは繰り返す回数の分のままなので、最後は 4 回目の表し終えた所、先頭で見えている状態で終わる。
        iterationStart: fadeInEndMs / duration
    });
    animation.id = CARD_TEXT_MARQUEE_ANIMATION_ID;
    animation.addEventListener("finish", () => {
        // 終わりの通知より先に流し直していたら、新しい動きのクラスを残す。
        if (!isCardTextMarqueeRunning(target)) box.classList.remove(CARD_TEXT_MARQUEE_CLASS);
    });
}

/**
 * 文字を流す動きを止め、先頭を見せて省略記号の表示に戻す。流していないときは何もしない。
 * @param target 曲名またはアーティスト名
 */
export function stopCardTextMarquee(target: CardTextMarqueeTarget): void {
    if (typeof target.text.getAnimations === "function") {
        for (const animation of target.text.getAnimations()) {
            if (animation.id === CARD_TEXT_MARQUEE_ANIMATION_ID) animation.cancel();
        }
    }
    target.box.classList.remove(CARD_TEXT_MARQUEE_CLASS);
}

/**
 * カードを指している間と、キーボードでカード内のリンクやボタンにフォーカスしている間、
 * カード内の 1 行に収まらない文字を流す。どれも外れたら止める。
 * 指している間は、マウスやペンではカードに乗せている間、タッチではカードをタップしてから、
 * 別の場所をタップするまでの間とする。カードの影 (:hover) が付いている間と同じになる。指でスクロールしただけでは流さない。
 * キーボードのフォーカスは :focus-visible で見分け、マウスのクリックやタッチで付いたフォーカスでは流さない。
 * 動きを減らす設定のときは流さない。
 * @param card 結果カード
 * @param targets 流す対象の、曲名とアーティスト名
 */
export function bindCardTextMarquee(card: HTMLElement, targets: readonly CardTextMarqueeTarget[]): void {
    /** マウスやペンでカードを指しているか。 */
    let isPointerInside = false;
    /** タッチでカードをタップしてから、別の場所をタップするまでの間か。 */
    let isTapped = false;
    /** キーボードでカード内にフォーカスしているか。 */
    let hasKeyboardFocus = false;
    /** カードの中で最後に押したポインタの種類。click に種類が付かないブラウザがあるため、押したときに覚える。 */
    let lastPressPointerType = "";

    /** まだ流していない名前を流し始める。指したままフォーカスしたときなどに、流している途中の名前を先頭へ戻さない。 */
    const start = () => {
        if (prefersReducedMotion()) return;
        for (const target of targets) {
            if (!isCardTextMarqueeRunning(target)) startCardTextMarquee(target);
        }
    };
    /** 指してもタップしてもフォーカスもしていなければ止める。 */
    const stopIfInactive = () => {
        if (isPointerInside || isTapped || hasKeyboardFocus) return;
        document.removeEventListener("pointerup", onPointerUpOutside, true);
        targets.forEach(stopCardTextMarquee);
    };
    /**
     * カードの外でポインタを離したことを受け、タップした状態と、指している状態を解く。
     * タッチの端末では、画面が変わったときにブラウザがマウスの出入りを送ることがあり、離れたことは届かないことがある。
     * 一覧から外れたカード (ブックマークから削除した曲など) には、pointerleave も focusout も届かないので、
     * ここで全部の状態を解き、この listener も外す。
     * @param event 離したときのポインタのイベント
     */
    function onPointerUpOutside(event: PointerEvent) {
        if (!card.isConnected) {
            isPointerInside = false;
            isTapped = false;
            hasKeyboardFocus = false;
            stopIfInactive();
            return;
        }
        if (event.target instanceof Element && card.contains(event.target)) return;
        isPointerInside = false;
        isTapped = false;
        stopIfInactive();
    }

    card.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        isPointerInside = true;
        document.addEventListener("pointerup", onPointerUpOutside, true);
        start();
    });
    card.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "touch") return;
        isPointerInside = false;
        stopIfInactive();
    });
    // タッチの出入り (pointerenter / pointerleave) は、指を離すとすぐ「離れた」になるので見ない。
    // 実機の Android の Chrome では、タップの後に mouseenter も届かなかったため、タップは click で見分ける。
    // click はタップでだけ届き、指でなぞったときや長押しでは届かない。離したこと (pointerup) は、なぞっても届く。
    card.addEventListener("pointerdown", (event) => {
        lastPressPointerType = event.pointerType;
    });
    card.addEventListener("pointercancel", () => {
        // 指でスクロールしたなど、押した操作が取り消されたときは click が届かないので、記録を捨てる。
        lastPressPointerType = "";
    });
    card.addEventListener("click", (event) => {
        // キーボードでリンクやボタンを押したときと、スクリプトからの click は detail が 0 になる。
        // スクロールしない一覧を指でなぞった後のように、click の届かなかったタッチの記録が残っていても、
        // キーボードでの click をタップと取り違えない。
        const isTap = event.detail > 0 && lastPressPointerType === "touch";
        lastPressPointerType = "";
        if (!isTap) return;
        isTapped = true;
        document.addEventListener("pointerup", onPointerUpOutside, true);
        start();
    });
    card.addEventListener("focusin", (event) => {
        hasKeyboardFocus = isHtmlElement(event.target) && event.target.matches(":focus-visible");
        if (hasKeyboardFocus) start();
    });
    card.addEventListener("focusout", (event) => {
        // カード内のリンクからボタンへ移るときは、流し続ける。
        if (isHtmlElement(event.relatedTarget) && card.contains(event.relatedTarget)) return;
        hasKeyboardFocus = false;
        stopIfInactive();
    });
}
