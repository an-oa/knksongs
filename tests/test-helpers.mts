import assert from "node:assert/strict";
import { createSongFixture } from "./fixtures/song.mts";

// 実際にテストで渡すイベントの部分形。ブラウザの Event 全体は実装しない。
type FakeEvent = {
    target?: FakeElement | EventTarget | null;
    currentTarget?: FakeElement | EventTarget | null;
    relatedTarget?: FakeElement | EventTarget | null;
    key?: string;
    /** かな漢字変換の途中のキー操作かどうか。 */
    isComposing?: boolean;
    /** かな漢字変換の途中のキー操作に付く 229 を渡すために使う。 */
    keyCode?: number;
    shiftKey?: boolean;
    clientX?: number;
    clientY?: number;
    pointerId?: number;
    pointerType?: string;
    /** click の回数。キーボードやスクリプトからの click では 0。 */
    detail?: number;
    isPrimary?: boolean;
    button?: number;
    preventDefault?: () => void;
    stopPropagation?: () => void;
};

type FakeTimeout = {
    cb: () => void;
    delay: number | undefined;
    cleared: boolean;
    unrefCalled: boolean;
    unref: () => void;
};

class FakeClassList {
    values = new Set<string>();

    /** 指定されたクラス名を追加する。 */
    add(...tokens: string[]) {
        tokens.forEach((token) => {
            if (token) this.values.add(token);
        });
    }

    /** 指定されたクラス名を取り除く。 */
    remove(...tokens: string[]) {
        tokens.forEach((token) => this.values.delete(token));
    }

    /** クラス名の有無を返す。 */
    contains(token: string) {
        return this.values.has(token);
    }

    /** クラス名の有無を切り替え、変更後の状態を返す。 */
    toggle(token: string, force?: boolean) {
        if (force === true) {
            this.values.add(token);
            return true;
        }
        if (force === false) {
            this.values.delete(token);
            return false;
        }
        if (this.values.has(token)) {
            this.values.delete(token);
            return false;
        }
        this.values.add(token);
        return true;
    }

    /** クラス名を空白区切りで返す。 */
    toString() {
        return Array.from(this.values).join(" ");
    }
}

type FakeListener = (event: FakeEvent) => void | Promise<void>;

/** DOMモックで使う関数リスナーの登録・解除・通知を共通管理する。 */
class FakeEventTarget {
    readonly _events = new Map<string, Set<FakeListener>>();

    /** 同じ関数の重複登録を避け、登録順にリスナーを保持する。 */
    addEventListener(type: string, listener: FakeListener) {
        let listeners = this._events.get(type);
        if (!listeners) {
            listeners = new Set();
            this._events.set(type, listeners);
        }
        listeners.add(listener);
    }

    /** 指定されたリスナーだけを解除する。 */
    removeEventListener(type: string, listener: FakeListener) {
        const listeners = this._events.get(type);
        if (!listeners) return;
        listeners.delete(listener);
        if (listeners.size === 0) this._events.delete(type);
    }

    /** 登録順に同期呼び出しし、非同期リスナーの完了はまとめて返す。 */
    dispatchListeners(type: string, event: FakeEvent): void | Promise<void> {
        const listeners = this._events.get(type);
        if (!listeners) return;
        const pending: Promise<void>[] = [];
        for (const listener of [...listeners]) {
            // 通知中に解除された関数は呼ばず、追加された関数は次回から呼ぶ。
            if (!listeners.has(listener)) continue;
            const result = listener(event);
            if (result) pending.push(result);
        }
        if (pending.length > 0) return Promise.all(pending).then(() => {});
    }
}

// 必要な DOM 操作だけを持つモック。HTMLElement としての完全な実装ではない。
class FakeElement extends FakeEventTarget {
    tagName: string;
    dataset: Record<string, string | undefined> = {};
    children: FakeElement[] = [];
    parentElement: FakeElement | null = null;
    classList = new FakeClassList();
    style: Partial<CSSStyleDeclaration> = {};
    attributes = new Map<string, string>();
    onclick: ((event: FakeEvent) => void) | null = null;
    // 機能判定を変えないよう、matches は必要なテストだけで設定する。
    matches?: (selector: string) => boolean;
    textContent = "";
    _innerHTML = "";
    hidden = false;
    type = "";
    /** dialog 要素が開いているか。モーダルとしての挙動は扱わず、開閉だけを記録する。 */
    open = false;
    _scrollHeight?: number;
    _clientHeight?: number;
    _clientWidth?: number;
    _rect?: Pick<DOMRectReadOnly, "top" | "bottom" | "left" | "right" | "width" | "height">;
    /** キャプチャしているポインタの id。キャプチャの開始と解除をテストで確かめるために記録する。 */
    capturedPointerIds = new Set<number>();

    constructor(tagName = "div") {
        super();
        this.tagName = String(tagName).toUpperCase();
    }

    get className() {
        return this.classList.toString();
    }

    set className(value: string) {
        this.classList = new FakeClassList();
        String(value || "")
            .split(/\s+/)
            .filter(Boolean)
            .forEach((token) => this.classList.add(token));
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value: string) {
        this._innerHTML = String(value || "");
        this.children.forEach((child) => {
            child.parentElement = null;
        });
        this.children = [];
        this.textContent = "";
        parseSimpleInnerHtml(this, this._innerHTML);
    }

    /** このモックが扱う要素の親を parentElement と同じ参照で返す。 */
    get parentNode(): FakeElement | null {
        return this.parentElement;
    }

    get firstChild() {
        return this.children[0] || null;
    }

    get childElementCount() {
        return this.children.length;
    }

    get lastElementChild() {
        return this.children[this.children.length - 1] || null;
    }

    get nextSibling(): FakeElement | null {
        if (!this.parentElement) return null;
        const siblings = this.parentElement.children;
        const index = siblings.indexOf(this);
        if (index < 0) return null;
        return siblings[index + 1] || null;
    }

    get isConnected(): boolean {
        const body = getInstalledFakeDocument()?.body;
        if (!body) return false;
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- 自身から祖先をたどるための走査位置。
        let node: FakeElement | null = this;
        while (node) {
            if (node === body) return true;
            node = node.parentElement;
        }
        return false;
    }

    get scrollHeight() {
        if (typeof this._scrollHeight === "number") return this._scrollHeight;
        return 100;
    }

    get clientHeight() {
        if (typeof this._clientHeight === "number") return this._clientHeight;
        return 100;
    }

    get clientWidth() {
        if (typeof this._clientWidth === "number") return this._clientWidth;
        return 100;
    }

    /** 親を付け替えて子要素を追加し、fragment はその子を展開する。 */
    appendChild<T extends FakeElement>(child: T): T {
        if (child instanceof FakeDocumentFragment) {
            child.children.slice().forEach((fragmentChild) => {
                this.appendChild(fragmentChild);
            });
            return child;
        }
        if (child.parentElement) {
            child.parentElement.removeChild(child);
        }
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    /** モック要素だけを末尾へ追加する。 */
    append(...nodes: (FakeElement | string)[]) {
        nodes.forEach((node) => {
            if (node instanceof FakeElement) {
                this.appendChild(node);
            }
        });
    }

    /** 既存の子要素を外して指定された要素へ置き換える。 */
    replaceChildren(...nodes: (FakeElement | string)[]) {
        this.children.forEach((child) => {
            child.parentElement = null;
        });
        this.children = [];
        this.append(...nodes);
    }

    /** 子要素を取り除き、その親参照を解除する。 */
    removeChild<T extends FakeElement>(child: T): T {
        const index = this.children.indexOf(child);
        if (index >= 0) {
            this.children.splice(index, 1);
            child.parentElement = null;
        }
        return child;
    }

    /** 指定した子の直前、または末尾に要素を移動する。 */
    insertBefore<T extends FakeElement>(node: T, referenceNode: FakeElement | null): T {
        if (node.parentElement) {
            node.parentElement.removeChild(node);
        }
        if (!referenceNode) {
            return this.appendChild(node);
        }
        const index = this.children.indexOf(referenceNode);
        if (index < 0) {
            return this.appendChild(node);
        }
        node.parentElement = this;
        this.children.splice(index, 0, node);
        return node;
    }

    /** 自身または子孫に指定された要素があるか返す。 */
    contains(node: unknown): boolean {
        if (node === this) return true;
        for (const child of this.children) {
            if (child.contains(node)) return true;
        }
        return false;
    }

    /** クラス名が一致する自身または祖先を返す。 */
    closest(selector: string): FakeElement | null {
        if (!selector || !selector.startsWith(".")) return null;
        const targetClass = selector.slice(1);
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- 自身から祖先をたどるための走査位置。
        let current: FakeElement | null = this;
        while (current) {
            if (current.classList.contains(targetClass)) return current;
            current = current.parentElement;
        }
        return null;
    }

    /** セレクターが一致する最初の子孫を返す。 */
    querySelector(selector: string): FakeElement | null {
        const matcher = createMatcher(selector);
        for (const child of this.children) {
            if (matcher(child)) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }

    /** セレクターが一致する子孫を配列で返す。 */
    querySelectorAll(selector: string): FakeElement[] {
        const matcher = createMatcher(selector);
        const matches: FakeElement[] = [];
        for (const child of this.children) {
            if (matcher(child)) matches.push(child);
            matches.push(...child.querySelectorAll(selector));
        }
        return matches;
    }

    /** スクロール要求の差し替え先。 */
    scrollTo(options?: ScrollToOptions) { void options; }

    /** ポインタのキャプチャを記録する。 */
    setPointerCapture(pointerId: number) {
        this.capturedPointerIds.add(pointerId);
    }

    /** ポインタのキャプチャの記録を外す。 */
    releasePointerCapture(pointerId: number) {
        this.capturedPointerIds.delete(pointerId);
    }

    /** 属性値を文字列として記録する。 */
    setAttribute(name: string, value: unknown) {
        this.attributes.set(name, String(value));
    }

    /** 記録済みの属性値を返す。 */
    getAttribute(name: string) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    /** 属性が記録されているか返す。 */
    hasAttribute(name: string) {
        return this.attributes.has(name);
    }

    /** 記録済みの属性を削除する。 */
    removeAttribute(name: string) {
        this.attributes.delete(name);
    }

    /** 登録済み listener へイベントを通知する。既定動作の取り消しは扱わない。 */
    dispatchEvent(event: Pick<Event, "type">): boolean {
        void this.dispatchListeners(event.type, { target: this, currentTarget: this });
        return true;
    }

    /** 記録されたクリック listener と onclick を呼ぶ。 */
    click() {
        const event = {
            target: this,
            currentTarget: this,
            preventDefault() {},
            stopPropagation() {}
        };
        const pending = this.dispatchListeners("click", event);
        if (typeof this.onclick === "function") {
            this.onclick(event);
        }
        return pending;
    }

    /** グローバルに設置したモック document のフォーカスを更新する。 */
    focus(): void {
        const document = getInstalledFakeDocument();
        if (document) {
            document.activeElement = this;
        }
    }

    /** dialog 要素を開いたことを記録する。背面を操作できなくする挙動は扱わない。 */
    showModal(): void {
        this.open = true;
    }

    /** 開いている dialog 要素を閉じ、ブラウザと同じく close を通知する。 */
    close(): void {
        if (!this.open) return;
        this.open = false;
        void this.dispatchListeners("close", { target: this, currentTarget: this });
    }

    /** 入力欄の文字の全選択。選択範囲は扱わない。 */
    select(): void {}

    /** 自身がフォーカスされている場合だけ解除する。 */
    blur(): void {
        const document = getInstalledFakeDocument();
        if (document && document.activeElement === this) {
            document.activeElement = null;
        }
    }

    /** テスト指定の矩形、または既定の矩形を返す。 */
    getBoundingClientRect() {
        if (this._rect) return this._rect;
        return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
    }
}

class FakeDocumentFragment extends FakeElement {
    constructor() {
        super("#fragment");
    }
}

/**
 * installFakeDom が設置した document を取得し、モック内部の型境界をここに集める。
 * body がモック要素である場合だけ返し、cleanup 後の実 DOM は操作しない。
 */
function getInstalledFakeDocument() {
    const document = globalThis.document as unknown as ReturnType<typeof installFakeDom>["document"] | undefined;
    return document?.body instanceof FakeElement ? document : undefined;
}

/** 属性の id が一致する要素を部分木から探す。 */
function findElementById(root: FakeElement | null, id: string): FakeElement | null {
    if (!root) return null;
    if (root.getAttribute && root.getAttribute("id") === id) return root;
    for (const child of root.children || []) {
        const found = findElementById(child, id);
        if (found) return found;
    }
    return null;
}

/** テストで使うクラス・タグ・属性セレクターの判定を作る。 */
function createMatcher(selector: string): (element: FakeElement) => boolean {
    if (selector.includes(",")) {
        const matchers = selector.split(",").map((part) => createMatcher(part.trim()));
        return (el) => matchers.some((matches) => matches(el));
    }
    const negation = selector.match(/^(.*):not\(([^()]+)\)$/);
    if (negation) {
        const matches = createMatcher(negation[1]);
        const excludes = createMatcher(negation[2]);
        return (el) => matches(el) && !excludes(el);
    }
    const attribute = selector.match(/^([a-zA-Z0-9-]*)\[([a-zA-Z0-9:-]+)(?:="([^"]*)")?\]$/);
    if (attribute) {
        const [, tag, name, value] = attribute;
        return (el) => (!tag || el.tagName === tag.toUpperCase()) && (value === undefined
            ? el.hasAttribute(name)
            : el.getAttribute(name) === value || Reflect.get(el, name) === value);
    }
    if (selector.startsWith(".")) {
        const targetClass = selector.slice(1);
        return (el) => el.classList.contains(targetClass);
    }
    const tag = selector.toUpperCase();
    return (el) => el.tagName === tag;
}

/** 設置した DOM モックであることを確認し、モック固有の設定を操作する。 */
export function getFakeElement(element: Element): FakeElement {
    assert.ok(element instanceof FakeElement, "element is not a DOM mock");
    return element;
}

/** テスト用の単純な HTML をモック要素の木へ変換する。 */
function parseSimpleInnerHtml(root: FakeElement, html: string) {
    const source = String(html || "");
    if (!source.trim()) return;
    const tokenPattern = /<\/?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
    const stack = [root];
    let match;

    while ((match = tokenPattern.exec(source))) {
        const [, tagName, attrs, text] = match;
        const current = stack[stack.length - 1];
        if (!current) break;

        if (text) {
            const decoded = text.replace(/&times;/g, "×");
            if (decoded.trim()) {
                current.textContent += decoded.trim();
            }
            continue;
        }

        if (match[0].startsWith("</")) {
            if (stack.length > 1) stack.pop();
            continue;
        }

        const element = new FakeElement(tagName);
        const attrPattern = /([a-zA-Z0-9:-]+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrPattern.exec(attrs || ""))) {
            const [, name, attrValue] = attrMatch;
            if (name === "class") {
                element.className = attrValue;
            } else {
                element.setAttribute(name, attrValue);
            }
        }
        current.appendChild(element);
        if (!match[0].endsWith("/>")) {
            stack.push(element);
        }
    }
}

/**
 * DOM の部分実装をグローバルに設置する。
 * 戻り値は従来どおり cleanup として呼べ、document/window でモック固有の値も操作できる。
 */
export function installFakeDom() {
    const previous = {
        document: globalThis.document,
        window: globalThis.window,
        Element: globalThis.Element,
        HTMLElement: globalThis.HTMLElement,
        navigator: globalThis.navigator,
        location: globalThis.location,
        CSS: globalThis.CSS,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        IntersectionObserver: globalThis.IntersectionObserver
    };

    const body = new FakeElement("body");
    const head = new FakeElement("head");
    const documentElement = new FakeElement("html");
    documentElement._clientHeight = 720;
    const document = Object.assign(new FakeEventTarget(), {
        body,
        head,
        scrollingElement: body,
        documentElement,
        activeElement: null as FakeElement | null,
        visibilityState: "visible" as DocumentVisibilityState,
        /** 指定されたタグのモック要素を作る。 */
        createElement(tagName: string) {
            return new FakeElement(tagName);
        },
        /** 子要素をまとめて移動する fragment を作る。 */
        createDocumentFragment() {
            return new FakeDocumentFragment();
        },
        /** document 全体の一覧検索は従来どおり空配列を返す。 */
        querySelectorAll(): FakeElement[] {
            return [];
        },
        /** セレクターが一致する最初の子孫を返す。 */
        querySelector(selector: string): FakeElement | null {
            const fromHead = head.querySelector(selector);
            if (fromHead) return fromHead;
            return body.querySelector(selector);
        },
        /** head と body から id が一致する要素を探す。 */
        getElementById(id: string) {
            return findElementById(head, id) || findElementById(body, id);
        },
        /** モックは配置を持たないので、位置にある要素は見つからない。位置を扱うテストでは差し替える。 */
        elementFromPoint(x: number, y: number): FakeElement | null {
            void x;
            void y;
            return null;
        }
    });

    setGlobalValue("document", document);
    const window = Object.assign(new FakeEventTarget(), {
        innerHeight: 720 as number | undefined,
        scrollBy() {},
        scrollTo(options?: ScrollToOptions) { void options; },
        /** メディアクエリは既定ではどれも一致しない。一致させるテストでは差し替える。 */
        matchMedia(query?: string) {
            void query;
            return { matches: false };
        },
        getComputedStyle(element: Element) {
            void element;
            return { overflowY: "visible" };
        }
    });
    setGlobalValue("window", window);
    setGlobalValue("Element", FakeElement);
    setGlobalValue("HTMLElement", FakeElement);
    setGlobalValue("navigator", { maxTouchPoints: 0 });
    setGlobalValue("location", { origin: "https://example.test" });
    setGlobalValue("CSS", { supports: () => false });
    setGlobalValue("requestAnimationFrame", (cb: () => void) => {
        if (typeof cb === "function") cb();
        return 0;
    });
    setGlobalValue("IntersectionObserver", class {
        observe() {}
        disconnect() {}
    });

    /** 設置前のグローバル値へ戻す。 */
    const cleanup = () => {
        setGlobalValue("document", previous.document);
        setGlobalValue("window", previous.window);
        setGlobalValue("Element", previous.Element);
        setGlobalValue("HTMLElement", previous.HTMLElement);
        setGlobalValue("navigator", previous.navigator);
        setGlobalValue("location", previous.location);
        setGlobalValue("CSS", previous.CSS);
        setGlobalValue("requestAnimationFrame", previous.requestAnimationFrame);
        setGlobalValue("IntersectionObserver", previous.IntersectionObserver);
    };
    return Object.assign(cleanup, { document, window });
}

/** 部分実装のモックをグローバルへ設置する境界。DOM 全体の型とは混同しない。 */
export function setGlobalValue(name: PropertyKey, value: unknown) {
    Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true
    });
}

/** 描画用の既定値を保ち、共有 fixture で完全な Song を作る。 */
export function makeRenderRow(input: Pick<Song, "songKey"> & Partial<Pick<Song,
    "title" | "artist" | "titleEn" | "artistEn" | "date" | "format" | "streamRole" | "videoOrientation" | "url"
>>): Song {
    return createSongFixture({
        songKey: input.songKey,
        title: input.title || "title",
        artist: input.artist || "artist",
        // 英語表記は指定した曲だけに持たせ、未指定は英語表記のない曲として扱う。
        titleEn: input.titleEn ?? "",
        artistEn: input.artistEn ?? "",
        date: input.date || "2024-01-01",
        format: input.format || "配信",
        streamRole: input.streamRole ?? "",
        videoOrientation: input.videoOrientation || "",
        isRelay: false,
        isHarmony: false,
        url: input.url || "https://youtu.be/video1",
        // 描画用の曲には従来どおり再生終了時刻を指定しない。
        endSeconds: null
    });
}

/** listener の存在を確認して呼び、非同期 handler の完了も待てるよう戻り値を返す。 */
export function invokeListener(
    element: Element | FakeEventTarget | null | undefined,
    type: string,
    event: FakeEvent
) {
    assert.ok(element instanceof FakeEventTarget, "event target is not a DOM mock");
    assert.ok(element._events.get(type)?.size, `${type} listener is missing`);
    return element.dispatchListeners(type, event);
}

/** setTimeout/clearTimeout を記録型 fake に差し替える。 */
export function installFakeTimeouts() {
    const previousSetTimeout = globalThis.setTimeout;
    const previousClearTimeout = globalThis.clearTimeout;
    const timeoutCalls: FakeTimeout[] = [];
    setGlobalValue("setTimeout", (cb: () => void, delay?: number) => {
        const timeout = {
            cb,
            delay,
            cleared: false,
            unrefCalled: false,
            /** Node 互換の参照解除が呼ばれたことを記録する。 */
            unref() { this.unrefCalled = true; }
        };
        timeoutCalls.push(timeout);
        return timeout;
    });
    setGlobalValue("clearTimeout", (timeout: FakeTimeout | null | undefined) => {
        if (timeout) timeout.cleared = true;
    });
    return {
        timeoutCalls,
        /** 元のタイマー関数に戻す。 */
        cleanup() {
            setGlobalValue("setTimeout", previousSetTimeout);
            setGlobalValue("clearTimeout", previousClearTimeout);
        }
    };
}

/** アニメーションフレームを保留し、明示的に1フレームずつ進める。 */
export function installFakeAnimationFrames() {
    const previousRequest = globalThis.requestAnimationFrame;
    const previousCancel = globalThis.cancelAnimationFrame;
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    globalThis.requestAnimationFrame = (callback) => {
        const id = ++nextId;
        pending.set(id, callback);
        return id;
    };
    globalThis.cancelAnimationFrame = (id) => { pending.delete(id); };
    return {
        get pendingCount() { return pending.size; },
        /** 現在のフレームを実行し、追加予約は次のフレームへ残す。 */
        advanceFrame(timestamp = 0) {
            assert.ok(pending.size > 0, "no animation frame is pending");
            for (const id of [...pending.keys()]) {
                const callback = pending.get(id);
                pending.delete(id);
                callback?.(timestamp);
            }
        },
        /** 元のフレーム関数へ戻して残りの予約を破棄する。 */
        cleanup() {
            globalThis.requestAnimationFrame = previousRequest;
            globalThis.cancelAnimationFrame = previousCancel;
            pending.clear();
        }
    };
}
