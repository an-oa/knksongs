import { isImeComposingKeyEvent } from "../../lib/ime-key-event.mjs";
import type { SiteLanguage } from "../../lib/site-language.mjs";
import type { LocalizedText } from "./text.mjs";

/**
 * 決定操作の結果。失敗時はダイアログを開いたまま message の文言を出す。
 * 開いている間に言語が変わると理由も書き直すので、文言の作り方で渡す。
 */
export type BookmarkPromptDialogResult =
    | { ok: true }
    | { ok: false; message: LocalizedText };

/** 確認・入力ダイアログの表示内容と、決定時の処理。 */
export type BookmarkPromptDialogRequest = {
    title: string;
    /** 確認する内容、または入力の案内。入力欄があるときは、入力欄の名前としても読み上げる。 */
    message: string;
    /** 入力欄。省略すると、確認だけのダイアログになる。 */
    input?: {
        /** 開いたときに入れておく値。開いている間に言語が変わっても、入力中の値は残す。 */
        value: string;
        maxLength?: number;
    };
    submitLabel: string;
    cancelLabel: string;
    /**
     * 今ある内容を消す操作かどうか。決定ボタンを注意の色にし、開いたときのフォーカスを取り消しボタンに置く。
     */
    isDestructive?: boolean;
    /** 決定ボタンで実行する処理。入力欄がないときの value は空文字。成功するとダイアログを閉じる。 */
    onSubmit: (value: string) => BookmarkPromptDialogResult;
};

/**
 * ダイアログを開き、決定して閉じたら true、取り消したら false を返す関数。
 * 表示内容は言語を受け取って作る関数で渡し、開いている間に言語が変わったら作り直す。
 */
export type OpenBookmarkPromptDialog = (
    buildRequest: (language: SiteLanguage) => BookmarkPromptDialogRequest,
    language: SiteLanguage
) => Promise<boolean>;

/** 初回表示時に作るダイアログの要素。 */
type DialogParts = {
    dialog: HTMLDialogElement;
    title: HTMLElement;
    message: HTMLLabelElement;
    body: HTMLElement;
    input: HTMLInputElement;
    status: HTMLElement;
    cancelBtn: HTMLButtonElement;
    submitGroup: HTMLElement;
    submitBtn: HTMLButtonElement;
};

/** 開いているダイアログ 1 回分の状態。 */
type DialogSession = {
    request: BookmarkPromptDialogRequest;
    buildRequest: (language: SiteLanguage) => BookmarkPromptDialogRequest;
    language: SiteLanguage;
    /** 決定操作が失敗した理由。開いたまま決定ボタンの上に出す。 */
    failureMessage: LocalizedText | null;
    resolve: (submitted: boolean) => void;
};

/**
 * 指定したタグ・ID・クラスの要素を作る。
 * @param tagName 作る要素のタグ名
 * @param id 要素の ID。不要なら空文字
 * @param className 要素のクラス名
 */
function createPart<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    id: string,
    className: string
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    if (id) element.id = id;
    element.className = className;
    return element;
}

/**
 * ブックマークの名前の変更・削除の確認・全体の置換の確認に使う、モーダルダイアログを作成する。
 * ブラウザ標準の prompt / confirm の代わりに使い、見た目と操作をエクスポート・インポートのダイアログに揃える。
 * 要素は初回表示時に body の末尾へ作り、以降は使い回す。見た目はエクスポート・インポートのダイアログのクラスを使う。
 * サイドバーは Esc でパネルごと閉じるため、ダイアログ内の Esc はダイアログだけを閉じて外へ伝えない。
 * エクスポート・インポートのダイアログの上にも重ねて開ける。
 */
export function createBookmarkPromptDialogController() {
    let parts: DialogParts | null = null;
    let session: DialogSession | null = null;

    /**
     * ダイアログの要素を作って body へ追加し、操作のイベントを登録する。
     */
    function createParts(): DialogParts {
        const dialog = createPart("dialog", "bookmark-prompt-dialog", "bookmark-transfer-dialog bookmark-prompt-dialog");
        // 文字などを押したときもフォーカスをダイアログ内に留め、Esc をダイアログで受け取る。
        dialog.tabIndex = -1;
        dialog.setAttribute("aria-labelledby", "bookmark-prompt-title");
        dialog.setAttribute("aria-describedby", "bookmark-prompt-message");

        const title = createPart("h2", "bookmark-prompt-title", "bookmark-transfer-title");
        const message = createPart("label", "bookmark-prompt-message", "bookmark-transfer-description bookmark-prompt-message");
        message.htmlFor = "bookmark-prompt-input";
        const header = createPart("div", "", "bookmark-transfer-header");
        header.append(title, message);

        const input = createPart("input", "bookmark-prompt-input", "bookmark-prompt-input");
        input.type = "text";
        input.autocomplete = "off";
        const body = createPart("div", "", "bookmark-prompt-body");
        body.append(input);

        const status = createPart("p", "bookmark-prompt-status", "bookmark-transfer-status bookmark-transfer-status-error");
        status.setAttribute("aria-live", "polite");
        const cancelBtn = createPart("button", "bookmark-prompt-cancel", "bookmark-transfer-cancel");
        cancelBtn.type = "button";
        const submitBtn = createPart("button", "bookmark-prompt-submit", "bookmark-transfer-submit");
        submitBtn.type = "button";
        const submitGroup = createPart("div", "", "bookmark-transfer-submit-group");
        submitGroup.append(submitBtn);
        const actions = createPart("div", "", "bookmark-transfer-actions");
        actions.append(cancelBtn, submitGroup);
        const footer = createPart("div", "", "bookmark-transfer-footer bookmark-prompt-footer");
        footer.append(status, actions);

        dialog.append(header, body, footer);
        document.body.appendChild(dialog);

        submitBtn.addEventListener("click", handleSubmit);
        cancelBtn.addEventListener("click", () => finish(false));
        input.addEventListener("keydown", handleInputKeydown);
        dialog.addEventListener("keydown", handleKeydown);
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            finish(false);
        });
        // ブラウザがダイアログを直接閉じた場合も、待っている呼び出し元へ取り消しを返す。
        // 閉じた後に開き直していれば、前回分の close は無視する。
        dialog.addEventListener("close", () => {
            if (!dialog.open) finish(false);
        });
        return { dialog, title, message, body, input, status, cancelBtn, submitGroup, submitBtn };
    }

    /**
     * Esc でダイアログだけを閉じ、サイドバーや下のダイアログの Esc 処理へ伝えない。
     * かな漢字変換を取り消す Esc は、入力の途中なので閉じない。閉じると、変換だけを取り消すつもりの操作で、
     * 入力中の名前を失う。この場合も、ブラウザ自身の Esc の処理 (cancel) と下のパネルの処理は止める。
     * 変換の取り消しは、キー入力がページへ届く前にかな漢字変換が済ませているので、止めても影響しない。
     * @param event ダイアログ内で受け取ったキー入力
     */
    function handleKeydown(event: KeyboardEvent): void {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (isImeComposingKeyEvent(event)) return;
        finish(false);
    }

    /**
     * 入力欄で Enter を押したら決定する。かな漢字変換を確定する Enter は、入力の途中なので決定にしない。
     * @param event 入力欄で受け取ったキー入力
     */
    function handleInputKeydown(event: KeyboardEvent): void {
        if (event.key !== "Enter" || isImeComposingKeyEvent(event)) return;
        event.preventDefault();
        handleSubmit();
    }

    /**
     * 見出し・説明・ボタン・失敗の理由を、今の要求と言語で書く。入力欄の値は変えない。
     */
    function renderState(): void {
        if (!session || !parts) return;
        const { request } = session;
        parts.title.textContent = request.title;
        parts.message.textContent = request.message;
        parts.cancelBtn.textContent = request.cancelLabel;
        parts.submitBtn.textContent = request.submitLabel;
        parts.body.hidden = !request.input;
        parts.submitGroup.classList.toggle("bookmark-transfer-submit-group-caution", Boolean(request.isDestructive));
        const failure = session.failureMessage ? session.failureMessage(session.language) : "";
        parts.status.textContent = failure;
        parts.status.hidden = !failure;
        if (failure) parts.input.setAttribute("aria-invalid", "true");
        else parts.input.removeAttribute("aria-invalid");
    }

    /**
     * 決定ボタンの処理を実行する。成功すれば閉じ、失敗すれば開いたまま理由を出して入力欄へ戻る。
     */
    function handleSubmit(): void {
        if (!session || !parts) return;
        const current = session;
        const result = current.request.onSubmit(current.request.input ? parts.input.value : "");
        if (session !== current) return;
        if (result.ok) {
            finish(true);
            return;
        }
        current.failureMessage = result.message;
        renderState();
        if (current.request.input) parts.input.focus();
    }

    /**
     * ダイアログを閉じて呼び出し元へ結果を返す。
     * フォーカスは、ブラウザが開く前の要素へ戻す。その要素が作り直されている場合は、呼び出し元が戻す。
     * @param submitted 決定して閉じたら true、取り消したら false
     */
    function finish(submitted: boolean): void {
        const current = session;
        if (!current || !parts) return;
        session = null;
        if (parts.dialog.open) parts.dialog.close();
        current.resolve(submitted);
    }

    /**
     * 言語ごとの表示内容を作る関数でダイアログを開き、決定して閉じたら true、取り消したら false を返す。
     * すでに開いている場合は、開き直さずに false を返す。
     * @param buildRequest 言語を受け取り、表示内容と決定時の処理を返す関数
     * @param language 開くときのサイトの言語
     */
    function open(
        buildRequest: (language: SiteLanguage) => BookmarkPromptDialogRequest,
        language: SiteLanguage
    ): Promise<boolean> {
        if (session) return Promise.resolve(false);
        parts ??= createParts();
        const current = parts;
        const request = buildRequest(language);
        current.input.value = request.input?.value ?? "";
        if (request.input?.maxLength) current.input.maxLength = request.input.maxLength;
        else current.input.removeAttribute("maxlength");

        return new Promise<boolean>((resolve) => {
            session = { request, buildRequest, language, failureMessage: null, resolve };
            renderState();
            current.dialog.showModal();
            if (request.input) {
                current.input.focus();
                current.input.select();
            } else {
                // 今ある内容を消す操作では、Enter をそのまま押しても実行しないよう、取り消しへフォーカスを置く。
                (request.isDestructive ? current.cancelBtn : current.submitBtn).focus();
            }
        });
    }

    /**
     * 開いているダイアログの文言を、指定した言語で作り直す。開いていなければ何もしない。
     * 入力中の値・フォーカス・失敗の理由はそのまま残す。
     * @param language 新しいサイトの言語
     */
    function refreshText(language: SiteLanguage): void {
        if (!session) return;
        session.request = session.buildRequest(language);
        session.language = language;
        renderState();
    }

    return { open, refreshText };
}
