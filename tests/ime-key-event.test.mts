import test from "node:test";
import assert from "node:assert/strict";
import { isImeComposingKeyEvent } from "../app/lib/ime-key-event.mts";

test("ime key event: a key pressed during a kana-kanji conversion is recognized by either sign", () => {
    // 多くのブラウザは isComposing を付ける。
    assert.equal(isImeComposingKeyEvent({ isComposing: true, keyCode: 13 }), true);
    // Safari は、変換を確定する Enter に isComposing を付けず、キーコード 229 だけを付ける。
    assert.equal(isImeComposingKeyEvent({ isComposing: false, keyCode: 229 }), true);
    assert.equal(isImeComposingKeyEvent({ isComposing: false, keyCode: 13 }), false);
    assert.equal(isImeComposingKeyEvent({ isComposing: false, keyCode: 27 }), false);
});
