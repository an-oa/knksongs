import { isHtmlElement, prefersReducedMotion } from "../dom-utils.mjs";
import { getSongCards } from "./masonry-layout.mjs";

/** 並べ替えのスライドに付ける id。続けて並べ替えたとき、前のスライドを止めるために使う。 */
const CARD_REORDER_ANIMATION_ID = "card-reorder";
const CARD_REORDER_DURATION_MS = 250;
const CARD_REORDER_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** 移動元のカードを、スライドの間だけ前面に出すための z-index。 */
const MOVED_CARD_Z_INDEX = 3;

/**
 * カードで動いている並べ替えのスライドを止める。
 * @param card 結果カード
 */
function cancelCardReorderAnimations(card: HTMLElement): void {
    if (typeof card.getAnimations !== "function") return;
    for (const animation of card.getAnimations()) {
        if (animation.id === CARD_REORDER_ANIMATION_ID) animation.cancel();
    }
}

/**
 * 並べ替えの前に、結果カードの画面上の位置を曲キーごとに記録する。
 * スライドの途中で続けて並べ替えたときは、動いている途中の見た目の位置を記録する。
 * @param container 結果カードを並べた一覧
 * @returns 曲キーごとの位置。一覧がなければ空
 */
export function captureCardPositions(container: unknown): Map<string, DOMRectReadOnly> {
    const positions = new Map<string, DOMRectReadOnly>();
    if (!isHtmlElement(container)) return positions;
    for (const card of getSongCards(container)) {
        const songKey = card.dataset.songKey || "";
        if (songKey) positions.set(songKey, card.getBoundingClientRect());
    }
    return positions;
}

/**
 * 並べ替えの後に、各カードを記録した位置から新しい位置までスライドさせる。
 * 上から運ぶと間のカードは上へ、下から運ぶと下へ動く。複数列では、隣の枠や前後の行の端へ動く。
 * 移動元のカードは、通り過ぎるカードの下に潜らないよう、スライドの間だけ前面に出す。
 * 動きを減らす設定のときや、Web Animations を使えない環境では何もしない。
 * @param container 結果カードを並べた一覧
 * @param previousPositions 並べ替えの前に captureCardPositions で記録した位置
 * @param movedSongKey 移動元の曲キー
 */
export function animateCardReorder(
    container: unknown,
    previousPositions: Map<string, DOMRectReadOnly>,
    movedSongKey: string
): void {
    if (!isHtmlElement(container) || prefersReducedMotion()) return;
    const cards = getSongCards(container);
    // 前のスライドを止めてから測り、並べ替えた後の本来の位置を基準にする。
    cards.forEach(cancelCardReorderAnimations);
    for (const card of cards) {
        if (typeof card.animate !== "function") continue;
        const songKey = card.dataset.songKey || "";
        const previous = previousPositions.get(songKey);
        if (!previous) continue;
        const current = card.getBoundingClientRect();
        const dx = previous.left - current.left;
        const dy = previous.top - current.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        const layer = songKey === movedSongKey ? { zIndex: MOVED_CARD_Z_INDEX } : {};
        const animation = card.animate([
            { transform: `translate(${dx}px, ${dy}px)`, ...layer },
            { transform: "none", ...layer }
        ], { duration: CARD_REORDER_DURATION_MS, easing: CARD_REORDER_EASING });
        animation.id = CARD_REORDER_ANIMATION_ID;
    }
}
