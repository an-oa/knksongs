import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkPromptDialogController } from "../app/ui/bookmark/prompt-dialog.mts";
import type { BookmarkPromptDialogRequest, BookmarkPromptDialogResult } from "../app/ui/bookmark/prompt-dialog.mts";
import type { SiteLanguage } from "../app/lib/site-language.mts";
import { installFakeDom, invokeListener } from "./test-helpers.mts";

/** 言語ごとの、名前の変更ダイアログの表示内容。 */
const RENAME_TEXT = {
    ja: { title: "ブックマーク名の変更", message: "新しいブックマーク名を入力してください。", submit: "変更", cancel: "キャンセル" },
    en: { title: "Edit bookmark name", message: "Enter a new bookmark name.", submit: "Save", cancel: "Cancel" }
} as const;

/**
 * 名前を入力するダイアログの表示内容を作る関数を返す。決定時に渡された値は submitted に記録する。
 * @param submitted 決定時に渡された値の記録先
 * @param onSubmit 決定の結果。省略時は成功
 */
function buildRenameRequest(
    submitted: string[],
    onSubmit: (value: string) => BookmarkPromptDialogResult = () => ({ ok: true })
) {
    return (language: SiteLanguage): BookmarkPromptDialogRequest => ({
        title: RENAME_TEXT[language].title,
        message: RENAME_TEXT[language].message,
        input: { value: "First", maxLength: 64 },
        submitLabel: RENAME_TEXT[language].submit,
        cancelLabel: RENAME_TEXT[language].cancel,
        onSubmit: (value) => {
            submitted.push(value);
            return onSubmit(value);
        }
    });
}

/**
 * 確認だけのダイアログの表示内容を作る関数を返す。
 * @param isDestructive 今ある内容を消す操作として出すかどうか
 */
function buildConfirmRequest(isDestructive: boolean) {
    return (): BookmarkPromptDialogRequest => ({
        title: "ブックマークの削除",
        message: "ブックマーク「First」を削除しますか？",
        submitLabel: "削除",
        cancelLabel: "キャンセル",
        isDestructive,
        onSubmit: () => ({ ok: true })
    });
}

/** body に作られたダイアログと、その中の要素を返す。 */
function getDialogParts() {
    /** id が一致する要素を body から探す。偽の DOM は id をプロパティで持つので、属性セレクターで探す。 */
    const find = (id: string) => {
        const element = document.body.querySelector<HTMLElement>(`[id="${id}"]`);
        assert.ok(element, `${id} is missing`);
        return element;
    };
    return {
        dialog: find("bookmark-prompt-dialog") as HTMLDialogElement,
        title: find("bookmark-prompt-title"),
        message: find("bookmark-prompt-message"),
        input: find("bookmark-prompt-input") as HTMLInputElement,
        status: find("bookmark-prompt-status"),
        cancelBtn: find("bookmark-prompt-cancel"),
        submitBtn: find("bookmark-prompt-submit")
    };
}

test("bookmark prompt dialog: an input request opens with the current value selected for typing", async () => {
    const restoreDom = installFakeDom();
    try {
        const controller = createBookmarkPromptDialogController();
        const submitted: string[] = [];
        const closed = controller.open(buildRenameRequest(submitted), "ja");
        const parts = getDialogParts();

        assert.equal(parts.dialog.open, true);
        assert.equal(parts.dialog.getAttribute("aria-labelledby"), "bookmark-prompt-title");
        assert.equal(parts.title.textContent, "ブックマーク名の変更");
        assert.equal(parts.message.textContent, "新しいブックマーク名を入力してください。");
        assert.equal(parts.submitBtn.textContent, "変更");
        assert.equal(parts.cancelBtn.textContent, "キャンセル");
        assert.equal(parts.input.value, "First");
        assert.equal(parts.input.maxLength, 64);
        assert.equal(parts.input.parentElement?.hidden, false);
        assert.equal(parts.status.hidden, true);
        assert.equal(document.activeElement, parts.input);

        parts.input.value = "Renamed";
        parts.submitBtn.click();
        assert.equal(await closed, true);
        assert.deepEqual(submitted, ["Renamed"]);
        assert.equal(parts.dialog.open, false);
    } finally {
        restoreDom();
    }
});

test("bookmark prompt dialog: a failed submit keeps the dialog open with the reason until it succeeds", async () => {
    const restoreDom = installFakeDom();
    try {
        const controller = createBookmarkPromptDialogController();
        const submitted: string[] = [];
        const closed = controller.open(buildRenameRequest(submitted, (value) => (value.trim()
            ? { ok: true }
            : { ok: false, message: (language) => (language === "en" ? "Enter a bookmark name." : "ブックマーク名を入力してください。") }
        )), "ja");
        const parts = getDialogParts();

        parts.input.value = "  ";
        parts.cancelBtn.focus();
        parts.submitBtn.click();
        assert.equal(parts.dialog.open, true);
        assert.equal(parts.status.hidden, false);
        assert.equal(parts.status.textContent, "ブックマーク名を入力してください。");
        assert.equal(parts.input.getAttribute("aria-invalid"), "true");
        assert.equal(document.activeElement, parts.input, "focus goes back to the field to fix it");

        // 開いている間に言語が変わると、見出しと理由を書き直し、入力中の値は残す。
        controller.refreshText("en");
        assert.equal(parts.title.textContent, "Edit bookmark name");
        assert.equal(parts.submitBtn.textContent, "Save");
        assert.equal(parts.status.textContent, "Enter a bookmark name.");
        assert.equal(parts.input.value, "  ");

        parts.input.value = "Renamed";
        parts.submitBtn.click();
        assert.equal(await closed, true);
        assert.deepEqual(submitted, ["  ", "Renamed"]);

        // 開き直したときは、前回の失敗の理由を持ち越さない。
        const reopened = controller.open(buildRenameRequest(submitted), "ja");
        assert.equal(parts.status.hidden, true);
        assert.equal(parts.status.textContent, "");
        assert.equal(parts.input.getAttribute("aria-invalid"), null);
        assert.equal(parts.input.value, "First");
        parts.cancelBtn.click();
        assert.equal(await reopened, false);
    } finally {
        restoreDom();
    }
});

test("bookmark prompt dialog: Enter in the field submits, except while converting kana", async () => {
    const restoreDom = installFakeDom();
    try {
        const controller = createBookmarkPromptDialogController();
        const submitted: string[] = [];
        const closed = controller.open(buildRenameRequest(submitted), "ja");
        const parts = getDialogParts();
        /** 入力欄でキーを押す。 */
        const pressKey = (event: { key: string; isComposing?: boolean; keyCode?: number }) => {
            invokeListener(parts.input, "keydown", { ...event, preventDefault() {} });
        };

        pressKey({ key: "Enter", isComposing: true });
        pressKey({ key: "Enter", keyCode: 229 });
        pressKey({ key: "a" });
        assert.deepEqual(submitted, []);
        assert.equal(parts.dialog.open, true);

        pressKey({ key: "Enter" });
        assert.equal(await closed, true);
        assert.deepEqual(submitted, ["First"]);
    } finally {
        restoreDom();
    }
});

test("bookmark prompt dialog: Escape that cancels a kana-kanji conversion keeps the dialog and the typed name", async () => {
    const restoreDom = installFakeDom();
    try {
        const controller = createBookmarkPromptDialogController();
        const submitted: string[] = [];
        const closed = controller.open(buildRenameRequest(submitted), "ja");
        const parts = getDialogParts();
        const settled = { value: null as boolean | null };
        void closed.then((value) => { settled.value = value; });
        /** ダイアログでキーを押し、既定の動作を止めたかと、外へ伝えるのを止めたかを返す。 */
        const pressEscape = (event: { isComposing?: boolean; keyCode?: number }) => {
            const pressed = { prevented: false, stopped: false };
            invokeListener(parts.dialog, "keydown", {
                key: "Escape",
                ...event,
                preventDefault() { pressed.prevented = true; },
                stopPropagation() { pressed.stopped = true; }
            });
            return pressed;
        };

        parts.input.value = "あさの";
        // isComposing を付けるブラウザと、キーコード 229 だけを付けるブラウザの両方を確かめる。
        for (const event of [{ isComposing: true }, { keyCode: 229 }]) {
            const pressed = pressEscape(event);
            assert.equal(parts.dialog.open, true);
            assert.equal(parts.input.value, "あさの");
            assert.equal(pressed.prevented, true, "the browser must not close the dialog on its own either");
            assert.equal(pressed.stopped, true, "the panel under the dialog must not close either");
        }
        await Promise.resolve();
        assert.equal(settled.value, null);
        assert.deepEqual(submitted, []);

        // 変換が終わった後の Esc は、ダイアログを閉じる。
        assert.deepEqual(pressEscape({}), { prevented: true, stopped: true });
        assert.equal(await closed, false);
        assert.equal(parts.dialog.open, false);
    } finally {
        restoreDom();
    }
});

test("bookmark prompt dialog: Escape and the cancel button close only this dialog without submitting", async () => {
    const restoreDom = installFakeDom();
    try {
        const controller = createBookmarkPromptDialogController();
        const submitted: string[] = [];

        const closedByEscape = controller.open(buildRenameRequest(submitted), "ja");
        const parts = getDialogParts();
        const escape = { key: "Escape", prevented: false, stopped: false, preventDefault() { escape.prevented = true; }, stopPropagation() { escape.stopped = true; } };
        invokeListener(parts.dialog, "keydown", escape);
        assert.equal(await closedByEscape, false);
        assert.equal(escape.prevented, true);
        assert.equal(escape.stopped, true, "the sidebar must not close on the same key press");
        assert.equal(parts.dialog.open, false);

        const closedByCancel = controller.open(buildRenameRequest(submitted), "ja");
        parts.cancelBtn.click();
        assert.equal(await closedByCancel, false);

        // ブラウザが直接閉じた場合も、待っている呼び出し元へ取り消しを返す。
        const closedByBrowser = controller.open(buildRenameRequest(submitted), "ja");
        parts.dialog.close();
        assert.equal(await closedByBrowser, false);
        assert.deepEqual(submitted, []);
    } finally {
        restoreDom();
    }
});

test("bookmark prompt dialog: a confirmation has no field and puts focus on the safer button for destructive actions", async () => {
    const restoreDom = installFakeDom();
    try {
        const controller = createBookmarkPromptDialogController();

        const destructive = controller.open(buildConfirmRequest(true), "ja");
        const parts = getDialogParts();
        assert.equal(parts.input.parentElement?.hidden, true);
        assert.equal(parts.message.textContent, "ブックマーク「First」を削除しますか？");
        assert.equal(parts.submitBtn.parentElement?.classList.contains("bookmark-transfer-submit-group-caution"), true);
        assert.equal(document.activeElement, parts.cancelBtn);
        parts.submitBtn.click();
        assert.equal(await destructive, true);

        const plain = controller.open(buildConfirmRequest(false), "ja");
        assert.equal(parts.submitBtn.parentElement?.classList.contains("bookmark-transfer-submit-group-caution"), false);
        assert.equal(document.activeElement, parts.submitBtn);
        parts.cancelBtn.click();
        assert.equal(await plain, false);
    } finally {
        restoreDom();
    }
});

test("bookmark prompt dialog: a second request while one is open is declined without replacing it", async () => {
    const restoreDom = installFakeDom();
    try {
        const controller = createBookmarkPromptDialogController();
        const submitted: string[] = [];
        const first = controller.open(buildRenameRequest(submitted), "ja");
        const parts = getDialogParts();

        assert.equal(await controller.open(buildConfirmRequest(true), "ja"), false);
        assert.equal(parts.title.textContent, "ブックマーク名の変更");
        assert.equal(parts.dialog.open, true);

        parts.cancelBtn.click();
        assert.equal(await first, false);
        // 開いていないときの言語の切り替えは何もしない。
        assert.doesNotThrow(() => controller.refreshText("en"));
    } finally {
        restoreDom();
    }
});
