import assert from "node:assert/strict";

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    add(...tokens) {
        tokens.forEach((token) => {
            if (token) this.values.add(token);
        });
    }

    remove(...tokens) {
        tokens.forEach((token) => this.values.delete(token));
    }

    contains(token) {
        return this.values.has(token);
    }

    toggle(token, force) {
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

    toString() {
        return Array.from(this.values).join(" ");
    }
}

class FakeElement {
    constructor(tagName = "div") {
        this.tagName = String(tagName).toUpperCase();
        this.dataset = {};
        this.children = [];
        this.parentElement = null;
        this.classList = new FakeClassList();
        this.style = {};
        this.attributes = new Map();
        this.onclick = null;
        this.textContent = "";
        this._innerHTML = "";
        this.hidden = false;
        this.type = "";
        this._events = new Map();
    }

    get className() {
        return this.classList.toString();
    }

    set className(value) {
        this.classList = new FakeClassList();
        String(value || "")
            .split(/\s+/)
            .filter(Boolean)
            .forEach((token) => this.classList.add(token));
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value) {
        this._innerHTML = String(value || "");
        this.children.forEach((child) => {
            child.parentElement = null;
        });
        this.children = [];
        this.textContent = "";
        parseSimpleInnerHtml(this, this._innerHTML);
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

    get nextSibling() {
        if (!this.parentElement) return null;
        const siblings = this.parentElement.children;
        const index = siblings.indexOf(this);
        if (index < 0) return null;
        return siblings[index + 1] || null;
    }

    get isConnected() {
        const body = globalThis.document && globalThis.document.body;
        if (!body) return false;
        let node = this;
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

    appendChild(child) {
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

    append(...nodes) {
        nodes.forEach((node) => {
            if (node instanceof FakeElement) {
                this.appendChild(node);
            }
        });
    }

    replaceChildren(...nodes) {
        this.children.forEach((child) => {
            child.parentElement = null;
        });
        this.children = [];
        this.append(...nodes);
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) {
            this.children.splice(index, 1);
            child.parentElement = null;
        }
        return child;
    }

    insertBefore(node, referenceNode) {
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

    contains(node) {
        if (node === this) return true;
        for (const child of this.children) {
            if (child.contains(node)) return true;
        }
        return false;
    }

    closest(selector) {
        if (!selector || !selector.startsWith(".")) return null;
        const targetClass = selector.slice(1);
        let current = this;
        while (current) {
            if (current.classList.contains(targetClass)) return current;
            current = current.parentElement;
        }
        return null;
    }

    querySelector(selector) {
        const matcher = createMatcher(selector);
        for (const child of this.children) {
            if (matcher(child)) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }

    querySelectorAll(selector) {
        const matcher = createMatcher(selector);
        const matches = [];
        for (const child of this.children) {
            if (matcher(child)) matches.push(child);
            matches.push(...child.querySelectorAll(selector));
        }
        return matches;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    addEventListener(type, listener) {
        this._events.set(type, listener);
    }

    click() {
        const event = {
            target: this,
            currentTarget: this,
            preventDefault() {},
            stopPropagation() {}
        };
        const listener = this._events.get("click");
        if (typeof listener === "function") {
            listener(event);
        }
        if (typeof this.onclick === "function") {
            this.onclick(event);
        }
    }

    focus() {
        if (globalThis.document) {
            globalThis.document.activeElement = this;
        }
    }

    blur() {
        if (globalThis.document && globalThis.document.activeElement === this) {
            globalThis.document.activeElement = null;
        }
    }

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

function findElementById(root, id) {
    if (!root) return null;
    if (root.getAttribute && root.getAttribute("id") === id) return root;
    for (const child of root.children || []) {
        const found = findElementById(child, id);
        if (found) return found;
    }
    return null;
}

function createMatcher(selector) {
    if (selector.startsWith(".")) {
        const targetClass = selector.slice(1);
        return (el) => el.classList.contains(targetClass);
    }
    const attrSelector = selector.match(/^([a-zA-Z0-9-]+)\[([a-zA-Z0-9:-]+)="([^"]*)"\]$/);
    if (attrSelector) {
        const [, tagName, attrName, attrValue] = attrSelector;
        const tag = tagName.toUpperCase();
        return (el) => el.tagName === tag && (el[attrName] === attrValue || el.getAttribute(attrName) === attrValue);
    }
    const tag = selector.toUpperCase();
    return (el) => el.tagName === tag;
}

function parseSimpleInnerHtml(root, html) {
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
    const document = {
        body,
        head,
        scrollingElement: body,
        documentElement,
        activeElement: null,
        _events: new Map(),
        createElement(tagName) {
            return new FakeElement(tagName);
        },
        createDocumentFragment() {
            return new FakeDocumentFragment();
        },
        querySelectorAll() {
            return [];
        },
        querySelector(selector) {
            const fromHead = head.querySelector(selector);
            if (fromHead) return fromHead;
            return body.querySelector(selector);
        },
        getElementById(id) {
            return findElementById(head, id) || findElementById(body, id);
        },
        addEventListener(type, listener) {
            this._events.set(type, listener);
        }
    };

    setGlobalValue("document", document);
    setGlobalValue("window", {
        innerHeight: 720,
        scrollBy() {},
        matchMedia() {
            return { matches: false };
        },
        getComputedStyle() {
            return { overflowY: "visible" };
        },
        _events: new Map(),
        addEventListener(type, listener) {
            this._events.set(type, listener);
        }
    });
    setGlobalValue("Element", FakeElement);
    setGlobalValue("HTMLElement", FakeElement);
    setGlobalValue("navigator", { maxTouchPoints: 0 });
    setGlobalValue("location", { origin: "https://example.test" });
    setGlobalValue("CSS", { supports: () => false });
    setGlobalValue("requestAnimationFrame", (cb) => {
        if (typeof cb === "function") cb();
        return 0;
    });
    setGlobalValue("IntersectionObserver", class {
        observe() {}
        disconnect() {}
    });

    return () => {
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
}

export function setGlobalValue(name, value) {
    Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true
    });
}

export function makeRenderRow(input) {
    return {
        songKey: input.songKey,
        bookmarkSongKey: input.bookmarkSongKey ?? input.songKey,
        title: input.title || "title",
        artist: input.artist || "artist",
        date: input.date || "2024-01-01",
        format: input.format || "配信",
        streamRole: input.streamRole ?? "",
        videoOrientation: input.videoOrientation || "",
        isRelay: false,
        isHarmony: false,
        url: input.url || "https://youtu.be/video1"
    };
}

export function createDataTransferMock() {
    const store = new Map();
    return {
        effectAllowed: "none",
        setData(type, value) {
            store.set(String(type), String(value));
        },
        getData(type) {
            return store.get(String(type)) || "";
        }
    };
}

export function invokeListener(element, type, event) {
    const listener = element && element._events ? element._events.get(type) : null;
    assert.equal(typeof listener, "function", `${type} listener is missing`);
    listener(event);
}

/**
 * setTimeout/clearTimeout を記録型 fake に差し替える。
 * @returns {{
 *   timeoutCalls: Array<{ cb: Function, delay: number | undefined, cleared: boolean, unref: Function }>,
 *   cleanup: Function
 * }}
 */
export function installFakeTimeouts() {
    const previousSetTimeout = globalThis.setTimeout;
    const previousClearTimeout = globalThis.clearTimeout;
    const timeoutCalls = [];
    setGlobalValue("setTimeout", (cb, delay) => {
        const timeout = {
            cb,
            delay,
            cleared: false,
            unref() {}
        };
        timeoutCalls.push(timeout);
        return timeout;
    });
    setGlobalValue("clearTimeout", (timeout) => {
        if (timeout) timeout.cleared = true;
    });
    return {
        timeoutCalls,
        cleanup() {
            setGlobalValue("setTimeout", previousSetTimeout);
            setGlobalValue("clearTimeout", previousClearTimeout);
        }
    };
}
