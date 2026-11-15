/** かな漢字変換の途中のキー操作に付くキーコード。isComposing を付けないブラウザがあるため併せて見る。 */
const IME_PROCESSING_KEY_CODE = 229;

/**
 * かな漢字変換の途中のキー操作かを判定する。
 * 変換を確定する Enter や、変換を取り消す Esc は入力の途中なので、決定や取り消しの操作として扱わないために使う。
 * @param event キー入力のイベント
 * @returns 変換の途中のキー操作なら true
 */
export function isImeComposingKeyEvent(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
    return Boolean(event.isComposing) || event.keyCode === IME_PROCESSING_KEY_CODE;
}
