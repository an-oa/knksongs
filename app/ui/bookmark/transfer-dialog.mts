import type { SiteLanguage } from "../../lib/site-language.mjs";
import type { LocalizedText } from "./text.mjs";

/** 選択ダイアログに並べるブックマーク 1 件。 */
export type BookmarkTransferDialogOption = {
    id: string;
    name: string;
    /** 名前の横に出す短い区分。省略時は出さない。 */
    badge?: string;
    /** 区分を注意の色で出すかどうか。上書きのように手元の内容が変わる項目に使う。 */
    badgeIsCaution?: boolean;
    /** 名前の下に 1 行ずつ出す補足。 */
    details: string[];
    checked: boolean;
    /** 選べない項目。チェック状態はそのまま表示する。 */
    disabled: boolean;
};

/** 選択が変わるたびに決める、決定ボタンの上の文言と押せるかどうか。 */
export type BookmarkTransferSelectionState = {
    message: string;
    /** message を入力エラーとして目立たせるかどうか。 */
    isError: boolean;
    canSubmit: boolean;
};

/**
 * 決定操作の結果。失敗時はダイアログを開いたまま message の文言を出し、空文字なら何も出さない。
 * 開いている間に言語が変わると理由も書き直すので、文言の作り方で渡す。
 */
export type BookmarkTransferDialogActionResult<T> =
    | { ok: true; value: T }
    | { ok: false; message: LocalizedText };

/** 決定ボタンの ▼ のメニューに並べる操作の名前と説明。 */
export type BookmarkTransferMenuItem = {
    label: string;
    description: string;
};

/**
 * 選択を使わず、一覧のすべてを対象にする操作。決定ボタンの ▼ で、選択を使う通常の操作と切り替える。
 * 選んでいる間は一覧を操作できなくし、決定ボタンを注意の色にする。インポートの置換に使う。
 */
export type BookmarkTransferAllItemsAction<T> = {
    /** ▼ ボタンの名前。 */
    menuLabel: string;
    /** ▼ のメニューでの、選択を使う通常の操作の名前と説明。 */
    selectionItem: BookmarkTransferMenuItem;
    /** ▼ のメニューでの、この操作の名前と説明。 */
    allItemsItem: BookmarkTransferMenuItem;
    /** この操作を選んでいる間のダイアログの説明文。 */
    description: string;
    submitLabel: string;
    /** この操作を選んでいる間、決定ボタンの上に出す結果の説明。 */
    message: string;
    run: () => BookmarkTransferDialogActionResult<T>;
};

/** 選択ダイアログの表示内容と、決定時の処理。 */
export type BookmarkTransferDialogRequest<T> = {
    title: string;
    description: string;
    /** 一覧の上に出す注意。省略時は出さない。 */
    notice?: string;
    options: BookmarkTransferDialogOption[];
    submitLabel: string;
    /** 一括選択のチェックボックスの文言。 */
    selectAllLabel: string;
    /** 取り消しボタンの文言。 */
    cancelLabel: string;
    /** 選んだ項目の ID から、決定ボタンの状態と文言を決める。 */
    describeSelection: (selectedIds: string[]) => BookmarkTransferSelectionState;
    /** 決定ボタンで選んだ項目を処理する。成功するとダイアログを閉じ、値を open の結果として返す。 */
    onSubmit: (selectedIds: string[]) => BookmarkTransferDialogActionResult<T>;
    /** 決定ボタンの ▼ で切り替える、一覧のすべてを対象にする操作。省略時は ▼ を出さない。 */
    allItemsAction?: BookmarkTransferAllItemsAction<T>;
    /** 閉じた後にフォーカスを戻す要素。 */
    returnFocusEl?: HTMLElement | null;
};

/**
 * ダイアログを開き、決定時の値、または取り消し時の null を返す関数。
 * 表示内容は言語を受け取って作る関数で渡し、開いている間に言語が変わったら作り直す。
 */
export type OpenBookmarkTransferDialog = <T>(
    buildRequest: (language: SiteLanguage) => BookmarkTransferDialogRequest<T>,
    language: SiteLanguage
) => Promise<T | null>;

/** ▼ のメニュー項目 1 件分の要素。 */
type MenuItemParts = {
    item: HTMLButtonElement;
    label: HTMLElement;
    description: HTMLElement;
};

/** 初回表示時に作るダイアログの要素。 */
type DialogParts = {
    dialog: HTMLDialogElement;
    title: HTMLElement;
    description: HTMLElement;
    notice: HTMLElement;
    selectAll: HTMLInputElement;
    /** 一括選択の文言。開くたびに、表示中の言語の文言を入れる。 */
    selectAllText: HTMLElement;
    list: HTMLElement;
    status: HTMLElement;
    cancelBtn: HTMLButtonElement;
    submitGroup: HTMLElement;
    submitBtn: HTMLButtonElement;
    menuBtn: HTMLButtonElement;
    menu: HTMLElement;
    selectionItem: MenuItemParts;
    allItemsItem: MenuItemParts;
};

/** 一覧の 1 行と、その要素。 */
type DialogRow = {
    option: BookmarkTransferDialogOption;
    item: HTMLElement;
    input: HTMLInputElement;
    /** 名前・区分・補足を並べる部分。言語が変わったら作り直し、チェックボックスはそのまま残す。 */
    text: HTMLElement;
};

/**
 * 表示中のダイアログの要求と、結果を返す関数。
 * 選択は selectedIds と allItemsActionChosen だけを正とし、チェックボックスと行の見た目は描画のたびに導出する。
 */
type DialogSession = {
    request: BookmarkTransferDialogRequest<unknown>;
    /** 表示内容を作る関数。言語が変わったら作り直して request を置き換える。 */
    buildRequest: (language: SiteLanguage) => BookmarkTransferDialogRequest<unknown>;
    /** 今表示している言語。 */
    language: SiteLanguage;
    /** 決定操作が失敗した理由。次に選択や操作を変えるまで、決定ボタンの上に出したままにする。 */
    failureMessage: LocalizedText | null;
    resolve: (value: unknown) => void;
    rows: DialogRow[];
    /** 選択を使う操作で選んでいる、選べる項目の ID。 */
    selectedIds: Set<string>;
    /** 一覧のすべてを対象にする操作を選んでいるかどうか。 */
    allItemsActionChosen: boolean;
};

/** 決定ボタンの上の文言の見た目。 */
type StatusTone = "normal" | "error" | "caution";

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
 * ▼ のメニュー項目を作る。チェック印は aria-checked に合わせて CSS で出す。
 * @param id 項目の ID
 */
function createMenuItem(id: string): MenuItemParts {
    const item = createPart("button", id, "bookmark-transfer-menu-item");
    item.type = "button";
    item.tabIndex = -1;
    item.setAttribute("role", "menuitemradio");
    const check = createPart("span", "", "bookmark-transfer-menu-check");
    check.setAttribute("aria-hidden", "true");
    const label = createPart("span", "", "bookmark-transfer-menu-label");
    const description = createPart("span", "", "bookmark-transfer-menu-description");
    item.append(check, label, description);
    return { item, label, description };
}

/**
 * ブックマークを選んでエクスポート・インポートするモーダルダイアログを作成する。
 * 要素は初回表示時に body の末尾へ作り、以降は使い回す。
 * サイドバーは Esc でパネルごと閉じるため、ダイアログ内の Esc はメニューかダイアログだけを閉じて外へ伝えない。
 */
export function createBookmarkTransferDialogController() {
    let parts: DialogParts | null = null;
    let session: DialogSession | null = null;

    /**
     * ダイアログの要素を作って body へ追加し、操作のイベントを登録する。
     */
    function createParts(): DialogParts {
        const dialog = createPart("dialog", "bookmark-transfer-dialog", "bookmark-transfer-dialog");
        // 文字などを押したときもフォーカスをダイアログ内に留め、Esc をダイアログで受け取る。
        dialog.tabIndex = -1;
        dialog.setAttribute("aria-labelledby", "bookmark-transfer-title");
        dialog.setAttribute("aria-describedby", "bookmark-transfer-description bookmark-transfer-notice");

        const title = createPart("h2", "bookmark-transfer-title", "bookmark-transfer-title");
        const description = createPart("p", "bookmark-transfer-description", "bookmark-transfer-description");
        const notice = createPart("p", "bookmark-transfer-notice", "bookmark-transfer-notice");
        const header = createPart("div", "", "bookmark-transfer-header");
        header.append(title, description, notice);

        const selectAll = createPart("input", "bookmark-transfer-select-all", "");
        selectAll.type = "checkbox";
        const selectAllText = document.createElement("span");
        const selectAllLabel = createPart("label", "", "bookmark-transfer-select-all checkbox-item");
        selectAllLabel.append(selectAll, selectAllText);

        const list = createPart("ul", "bookmark-transfer-list", "bookmark-transfer-list");
        list.setAttribute("aria-labelledby", "bookmark-transfer-title");

        const status = createPart("p", "bookmark-transfer-status", "bookmark-transfer-status");
        status.setAttribute("aria-live", "polite");
        const cancelBtn = createPart("button", "bookmark-transfer-cancel", "bookmark-transfer-cancel");
        cancelBtn.type = "button";

        const submitBtn = createPart("button", "bookmark-transfer-submit", "bookmark-transfer-submit");
        submitBtn.type = "button";
        const menuBtn = createPart("button", "bookmark-transfer-menu-button", "bookmark-transfer-menu-button");
        menuBtn.type = "button";
        menuBtn.textContent = "▼";
        menuBtn.setAttribute("aria-haspopup", "menu");
        menuBtn.setAttribute("aria-expanded", "false");
        menuBtn.setAttribute("aria-controls", "bookmark-transfer-menu");
        const selectionItem = createMenuItem("bookmark-transfer-menu-selection");
        const allItemsItem = createMenuItem("bookmark-transfer-menu-all-items");
        const menu = createPart("div", "bookmark-transfer-menu", "bookmark-transfer-menu");
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-labelledby", "bookmark-transfer-menu-button");
        menu.hidden = true;
        menu.append(selectionItem.item, allItemsItem.item);
        const submitGroup = createPart("div", "", "bookmark-transfer-submit-group");
        submitGroup.append(submitBtn, menuBtn, menu);

        const actions = createPart("div", "", "bookmark-transfer-actions");
        actions.append(cancelBtn, submitGroup);
        const footer = createPart("div", "", "bookmark-transfer-footer");
        footer.append(status, actions);

        dialog.append(header, selectAllLabel, list, footer);
        document.body.appendChild(dialog);

        selectAll.addEventListener("change", handleSelectAllChange);
        list.addEventListener("change", handleOptionChange);
        submitBtn.addEventListener("click", handleSubmit);
        cancelBtn.addEventListener("click", () => finish(null));
        menuBtn.addEventListener("click", () => {
            if (isMenuOpen()) closeMenu();
            else openMenu();
        });
        menuBtn.addEventListener("keydown", handleMenuButtonKeydown);
        menu.addEventListener("keydown", handleMenuKeydown);
        selectionItem.item.addEventListener("click", () => chooseFromMenu(false));
        allItemsItem.item.addEventListener("click", () => chooseFromMenu(true));
        dialog.addEventListener("pointerdown", (event) => {
            const target = event.target instanceof Node ? event.target : null;
            if (target && (menu.contains(target) || menuBtn.contains(target))) return;
            closeMenu();
        });
        dialog.addEventListener("keydown", handleKeydown);
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            if (isMenuOpen()) closeMenu({ focusMenuButton: true });
            else finish(null);
        });
        // ブラウザがダイアログを直接閉じた場合も、待っている呼び出し元へ取り消しを返す。
        // 閉じた後に開き直していれば、前回分の close は無視する。
        dialog.addEventListener("close", () => {
            if (!dialog.open) finish(null);
        });
        return {
            dialog,
            title,
            description,
            notice,
            selectAll,
            selectAllText,
            list,
            status,
            cancelBtn,
            submitGroup,
            submitBtn,
            menuBtn,
            menu,
            selectionItem,
            allItemsItem
        };
    }

    /**
     * Esc でメニュー、メニューが閉じていればダイアログだけを閉じ、サイドバーの Esc 処理へ伝えない。
     * @param event ダイアログ内で受け取ったキー入力
     */
    function handleKeydown(event: KeyboardEvent): void {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (isMenuOpen()) {
            closeMenu({ focusMenuButton: true });
            return;
        }
        finish(null);
    }

    /**
     * ▼ のメニューが開いているかどうかを返す。
     */
    function isMenuOpen(): boolean {
        return Boolean(parts && !parts.menu.hidden);
    }

    /**
     * ▼ のメニューの項目を、並び順で返す。
     */
    function getMenuItems(): HTMLButtonElement[] {
        return parts ? [parts.selectionItem.item, parts.allItemsItem.item] : [];
    }

    /**
     * ▼ のメニューを開き、選んでいる項目、または指定した端の項目へフォーカスを移す。
     * @param focusLast 最後の項目へフォーカスを移すかどうか
     */
    function openMenu(focusLast = false): void {
        if (!parts || !session?.request.allItemsAction) return;
        parts.menu.hidden = false;
        parts.menuBtn.setAttribute("aria-expanded", "true");
        const items = getMenuItems();
        const checkedItem = items.find((item) => item.getAttribute("aria-checked") === "true");
        (focusLast ? items[items.length - 1] : checkedItem ?? items[0]).focus();
    }

    /**
     * ▼ のメニューを閉じる。
     * @param options focusMenuButton が true なら ▼ ボタンへフォーカスを戻す
     */
    function closeMenu(options?: { focusMenuButton?: boolean }): void {
        if (!parts || parts.menu.hidden) return;
        parts.menu.hidden = true;
        parts.menuBtn.setAttribute("aria-expanded", "false");
        if (options?.focusMenuButton) parts.menuBtn.focus();
    }

    /**
     * ▼ ボタン上の上下キーでメニューを開く。
     * @param event ▼ ボタンで受け取ったキー入力
     */
    function handleMenuButtonKeydown(event: KeyboardEvent): void {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        openMenu(event.key === "ArrowUp");
    }

    /**
     * メニュー内の上下キーと Home・End で項目を移り、Tab ではメニューを閉じる。
     * @param event メニューで受け取ったキー入力
     */
    function handleMenuKeydown(event: KeyboardEvent): void {
        if (event.key === "Tab") {
            closeMenu();
            return;
        }
        const items = getMenuItems();
        const currentIndex = items.findIndex((item) => item === document.activeElement);
        const nextIndexByKey: Partial<Record<string, number>> = {
            ArrowDown: (currentIndex + 1) % items.length,
            ArrowUp: (currentIndex - 1 + items.length) % items.length,
            Home: 0,
            End: items.length - 1
        };
        const nextIndex = nextIndexByKey[event.key];
        if (nextIndex === undefined) return;
        event.preventDefault();
        items[nextIndex].focus();
    }

    /**
     * メニューで選んだ操作へ切り替えてメニューを閉じ、押せる決定ボタンか ▼ ボタンへフォーカスを移す。
     * @param allItems 一覧のすべてを対象にする操作を選んだかどうか
     */
    function chooseFromMenu(allItems: boolean): void {
        if (!parts) return;
        chooseAllItemsAction(allItems);
        closeMenu();
        (parts.submitBtn.disabled ? parts.menuBtn : parts.submitBtn).focus();
    }

    /**
     * 一覧のすべてを対象にする操作と、選択を使う操作を切り替える。
     * 選択そのものは変えないので、選択を使う操作へ戻すと切り替える前の選択がそのまま表示される。
     * @param chosen 一覧のすべてを対象にする操作を選ぶかどうか
     */
    function chooseAllItemsAction(chosen: boolean): void {
        if (!session || session.allItemsActionChosen === chosen) return;
        session.allItemsActionChosen = chosen;
        session.failureMessage = null;
        renderState();
    }

    /**
     * ブックマーク 1 件分の選択肢を作る。
     * @param option 表示する選択肢
     */
    function createOptionElement(option: BookmarkTransferDialogOption): Omit<DialogRow, "option"> {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = option.checked;
        input.disabled = option.disabled;

        const text = createOptionText(option);
        const label = createPart("label", "", "bookmark-transfer-option-label checkbox-item");
        label.append(input, text);
        const item = createPart("li", "", "bookmark-transfer-option");
        item.append(label);
        return { item, input, text };
    }

    /**
     * 選択肢の名前・区分・補足を並べる部分を作る。
     * @param option 表示する選択肢
     */
    function createOptionText(option: BookmarkTransferDialogOption): HTMLElement {
        const name = createPart("span", "", "bookmark-transfer-option-name");
        name.textContent = option.name;
        const heading = createPart("span", "", "bookmark-transfer-option-heading");
        heading.append(name);
        if (option.badge) {
            const badge = createPart("span", "", "bookmark-transfer-option-badge");
            if (option.badgeIsCaution) badge.classList.add("bookmark-transfer-option-badge-caution");
            badge.textContent = option.badge;
            heading.append(badge);
        }
        const text = createPart("span", "", "bookmark-transfer-option-text");
        text.append(heading);
        option.details.forEach((detail) => {
            const detailEl = createPart("span", "", "bookmark-transfer-option-detail");
            detailEl.textContent = detail;
            text.append(detailEl);
        });
        return text;
    }

    /**
     * 選んでいる項目の ID を一覧の順に返す。
     */
    function getSelectedIds(): string[] {
        if (!session) return [];
        const { selectedIds } = session;
        return session.rows
            .filter(({ option }) => selectedIds.has(option.id))
            .map(({ option }) => option.id);
    }

    /**
     * 決定ボタンの上の文言と見た目を設定する。
     * @param message 表示する文言
     * @param tone 文言の見た目
     */
    function setStatus(message: string, tone: StatusTone): void {
        if (!parts) return;
        parts.status.textContent = message;
        parts.status.classList.toggle("bookmark-transfer-status-error", tone === "error");
        parts.status.classList.toggle("bookmark-transfer-status-caution", tone === "caution");
    }

    /**
     * 選んでいる操作とチェック状態に合わせて、説明文・「すべて選択」・決定ボタン・▼ のメニューを更新する。
     */
    function renderState(): void {
        if (!parts || !session) return;
        const { request, rows, selectedIds } = session;
        const allItemsAction = session.allItemsActionChosen ? request.allItemsAction : undefined;
        const allItemsChosen = Boolean(allItemsAction);
        parts.description.textContent = allItemsAction?.description ?? request.description;
        parts.submitBtn.textContent = allItemsAction?.submitLabel ?? request.submitLabel;
        parts.submitGroup.classList.toggle("bookmark-transfer-submit-group-caution", allItemsChosen);
        parts.selectionItem.item.setAttribute("aria-checked", String(!allItemsChosen));
        parts.allItemsItem.item.setAttribute("aria-checked", String(allItemsChosen));

        // すべてを対象にする間は、全行をチェック済みで操作できない表示にする。
        rows.forEach(({ option, item, input }) => {
            if (allItemsChosen) input.checked = true;
            else input.checked = option.disabled ? option.checked : selectedIds.has(option.id);
            input.disabled = allItemsChosen || option.disabled;
            item.classList.toggle("bookmark-transfer-option-disabled", input.disabled);
        });
        const selectableCount = allItemsChosen ? 0 : rows.filter(({ option }) => !option.disabled).length;
        const selectedCount = selectedIds.size;
        parts.selectAll.disabled = selectableCount === 0;
        parts.selectAll.checked = allItemsChosen || (selectableCount > 0 && selectedCount === selectableCount);
        parts.selectAll.indeterminate = selectableCount > 0 && selectedCount > 0 && selectedCount < selectableCount;

        if (allItemsAction) {
            setStatus(allItemsAction.message, "caution");
            parts.submitBtn.disabled = false;
        } else {
            const state = request.describeSelection(getSelectedIds());
            setStatus(state.message, state.isError ? "error" : "normal");
            parts.submitBtn.disabled = !state.canSubmit;
        }
        const failureText = session.failureMessage?.(session.language) ?? "";
        if (failureText) setStatus(failureText, "error");
    }

    /**
     * 「すべて選択」の変更を、選べる項目すべての選択へ反映する。
     */
    function handleSelectAllChange(): void {
        if (!parts || !session) return;
        const selectableIds = session.rows
            .filter(({ option }) => !option.disabled)
            .map(({ option }) => option.id);
        session.selectedIds = new Set(parts.selectAll.checked ? selectableIds : []);
        session.failureMessage = null;
        renderState();
    }

    /**
     * 項目のチェックの変更を選択へ反映する。
     * @param event 一覧で受け取った change イベント
     */
    function handleOptionChange(event: Event): void {
        if (!session || session.allItemsActionChosen) return;
        const row = session.rows.find(({ input }) => input === event.target);
        if (!row || row.option.disabled) return;
        if (row.input.checked) session.selectedIds.add(row.option.id);
        else session.selectedIds.delete(row.option.id);
        session.failureMessage = null;
        renderState();
    }

    /**
     * 操作の結果に応じて、ダイアログを閉じるか、開いたまま失敗の理由を出す。
     * @param result 決定操作の結果
     */
    function applyActionResult(result: BookmarkTransferDialogActionResult<unknown>): void {
        if (!session) return;
        if (result.ok) {
            finish(result.value);
            return;
        }
        session.failureMessage = result.message;
        renderState();
    }

    /**
     * 選んでいる操作を実行する。選択を使う操作では、押せない選択のときは何もしない。
     */
    function handleSubmit(): void {
        if (!session) return;
        session.failureMessage = null;
        const allItemsAction = session.allItemsActionChosen ? session.request.allItemsAction : undefined;
        if (allItemsAction) {
            applyActionResult(allItemsAction.run());
            return;
        }
        const selectedIds = getSelectedIds();
        if (!session.request.describeSelection(selectedIds).canSubmit) {
            renderState();
            return;
        }
        applyActionResult(session.request.onSubmit(selectedIds));
    }

    /**
     * ダイアログを閉じ、フォーカスを戻して呼び出し元へ結果を返す。
     * @param value 決定時の値。取り消し時は null
     */
    function finish(value: unknown): void {
        const current = session;
        if (!current || !parts) return;
        session = null;
        closeMenu();
        if (parts.dialog.open) parts.dialog.close();
        parts.list.replaceChildren();
        const returnFocusEl = current.request.returnFocusEl;
        if (returnFocusEl && returnFocusEl.isConnected) returnFocusEl.focus();
        current.resolve(value);
    }

    /**
     * 見出し・「すべて選択」・取り消しボタン・注意・▼ のメニューの文言を、要求の内容で書く。
     * 説明文・決定ボタン・決定ボタンの上の文言は、選んでいる操作で変わるので renderState で書く。
     * @param current ダイアログの要素
     * @param request 表示内容
     */
    function applyRequestText(current: DialogParts, request: BookmarkTransferDialogRequest<unknown>): void {
        current.title.textContent = request.title;
        current.selectAllText.textContent = request.selectAllLabel;
        current.cancelBtn.textContent = request.cancelLabel;
        current.notice.textContent = request.notice ?? "";
        current.notice.hidden = !request.notice;
        const allItemsAction = request.allItemsAction;
        current.menuBtn.hidden = !allItemsAction;
        if (allItemsAction) current.menuBtn.setAttribute("aria-label", allItemsAction.menuLabel);
        else current.menuBtn.removeAttribute("aria-label");
        current.submitGroup.classList.toggle("bookmark-transfer-submit-group-split", Boolean(allItemsAction));
        current.selectionItem.label.textContent = allItemsAction?.selectionItem.label ?? "";
        current.selectionItem.description.textContent = allItemsAction?.selectionItem.description ?? "";
        current.allItemsItem.label.textContent = allItemsAction?.allItemsItem.label ?? "";
        current.allItemsItem.description.textContent = allItemsAction?.allItemsItem.description ?? "";
    }

    /**
     * 言語ごとの表示内容を作る関数でダイアログを開き、決定時の値、または取り消し時の null を返す。
     * すでに開いている場合は、開き直さずに null を返す。
     * @param buildRequest 言語を受け取り、表示内容と決定時の処理を返す関数
     * @param language 開くときのサイトの言語
     */
    function open<T>(
        buildRequest: (language: SiteLanguage) => BookmarkTransferDialogRequest<T>,
        language: SiteLanguage
    ): Promise<T | null> {
        if (session) return Promise.resolve(null);
        parts ??= createParts();
        const current = parts;
        const request = buildRequest(language);
        applyRequestText(current, request);

        const rows = request.options.map((option) => {
            const row = { option, ...createOptionElement(option) };
            current.list.append(row.item);
            return row;
        });
        const selectedIds = new Set(request.options
            .filter((option) => option.checked && !option.disabled)
            .map((option) => option.id));

        return new Promise<T | null>((resolve) => {
            session = {
                request,
                buildRequest,
                language,
                failureMessage: null,
                resolve: (value) => resolve(value as T | null),
                rows,
                selectedIds,
                allItemsActionChosen: false
            };
            renderState();
            current.dialog.showModal();
            // 選べる項目がない場合は、破壊的な操作ではなくキャンセルへフォーカスを置く。
            (current.selectAll.disabled ? current.cancelBtn : current.selectAll).focus();
        });
    }

    /**
     * 開いているダイアログの文言を、指定した言語で作り直す。開いていなければ何もしない。
     * 選択・選んでいる操作・▼ のメニューの開閉・フォーカス・失敗の理由はそのまま残す。
     * 一覧の項目は開いた時点のものを使い、各行の名前・区分・補足だけを書き直す。
     * @param language 新しいサイトの言語
     */
    function refreshText(language: SiteLanguage): void {
        if (!session || !parts) return;
        const request = session.buildRequest(language);
        session.request = request;
        session.language = language;
        applyRequestText(parts, request);
        const optionsById = new Map(request.options.map((option) => [option.id, option]));
        session.rows.forEach((row) => {
            const option = optionsById.get(row.option.id);
            if (!option) return;
            const text = createOptionText(option);
            row.text.replaceWith(text);
            row.option = option;
            row.text = text;
        });
        renderState();
    }

    return { open, refreshText };
}
