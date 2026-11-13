import test from "node:test";
import assert from "node:assert/strict";
import { createSongFixture } from "./fixtures/song.mts";
import { createRenderController } from "../app/controllers/render.mts";
import { createSearchController } from "../app/controllers/search.mts";
import { extractYoutubeInfo } from "../app/lib/youtube-url.mts";
import { createSearchFiltersController } from "../app/ui/search-filters/controller.mts";
import { createDateFilterController } from "../app/ui/date/filter.mts";
import { createBookmarkReorderFixture } from "./support/bookmark-reorder-fixture.mts";
import {
    createYoutubePlaybackStartResult,
    YOUTUBE_PLAYBACK_START_STATUS
} from "../app/lib/youtube/playback-start-attempt.mts";
import {
    installFakeDom,
    makeRenderRow,
    invokeListener,
    getFakeElement
} from "./test-helpers.mts";

/**
 * カードの曲名またはアーティスト名の文字を返す。
 * 文字は内側の要素に入り、DOM モックの textContent は子の文字を含まないので、内側の要素から読む。
 * @param parent 曲名またはアーティスト名を含む要素
 * @param selector 曲名なら ".title"、アーティスト名なら ".artist"
 * @returns 表示している名前。要素がなければ undefined
 */
function readCardName(parent: Element | null | undefined, selector: ".title" | ".artist") {
    return parent?.querySelector(selector)?.querySelector(".card-name-text")?.textContent;
}

/** 描画と検索の共有データに、省略した初期値を補う。 */
function createRenderDataState(input: Partial<import("../app/state.types").AppDataState>): import("../app/state.types").AppDataState {
    return { allSongsRaw: [], currentResults: [], displayLimit: 48, activeBookmark: null, bookmarks: {}, ...input };
}

/**
 * 再生開始結果の期待値を返す。
 * @param {string} status
 * @returns {{ status: string }}
 */
function playbackStartResult(status: import("../app/lib/youtube/playback-start-attempt.mts").YoutubePlaybackStartStatus) {
    return createYoutubePlaybackStartResult(status);
}

/**
 * render 系テスト用の UI 状態を作る。
 */
function createRenderUiState<Elements extends {
    resultList: HTMLElement;
    resultTailSentinel: HTMLElement;
}>(input: {
    el: Elements;
    selectedFormats?: Set<string>;
    dataReady?: boolean;
    activeThumb?: HTMLElement | null;
    cardEntriesBySongKey?: Map<string, import("../app/state.types").RenderCardEntry>;
    language?: import("../app/lib/site-language.mts").SiteLanguage;
}) {
    return {
        el: input.el,
        search: {
            selectedFormats: input.selectedFormats ?? new Set(["配信"]),
            dataReady: input.dataReady ?? true,
            recommendedCache: null,
            userTouchedQuery: false,
            userTouchedFilters: false,
            hasRestoredSearchState: false
        },
        date: {
            bounds: null,
            index: null,
            pendingValues: null
        },
        playback: {
            activeThumb: input.activeThumb ?? null
        },
        render: {
            cardEntriesBySongKey: input.cardEntriesBySongKey ?? new Map<string, import("../app/state.types").RenderCardEntry>()
        },
        language: {
            current: input.language ?? "ja"
        },
        lookup: {
            songMapByKey: new Map(),
            songLookupSourceRef: null
        }
    };
}

/**
 * render コントローラー用の依存関数を作る。
 */
function createRenderCallbacks(input: Partial<Parameters<typeof createRenderController>[0]["callbacks"]> = {}): Parameters<typeof createRenderController>[0]["callbacks"] {
    const callbacks = input || {};
    return {
        updateThumbnail: callbacks.updateThumbnail || (() => {}),
        extractYoutubeInfo: callbacks.extractYoutubeInfo || (() => ({ videoId: "", startSeconds: 0, isVertical: false })),
        playThumbnail: callbacks.playThumbnail || (() => playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED)),
        restoreActivePlayback: callbacks.restoreActivePlayback || (() => {}),
        openBookmarkModal: callbacks.openBookmarkModal || (() => {}),
        removeSongFromActiveBookmark: callbacks.removeSongFromActiveBookmark || (() => {}),
        moveSongInActiveBookmark: callbacks.moveSongInActiveBookmark || (() => ({ ok: true, changed: false })),
        notifyBookmarkSaveError: callbacks.notifyBookmarkSaveError || (() => {})
    };
}

/**
 * 結果一覧のカードに、1 列に並んだときの配置の位置を与える。
 * 位置は DOM の順番から決まるので、並べ替えのプレビューで描き直して順番が変わると、位置も変わる。
 * @param list 結果カードを並べた一覧
 */
function placeCardsInOneColumn(list: HTMLElement) {
    for (const node of Array.from(list.children)) {
        const card = node as HTMLElement;
        const top = () => (card.parentElement ? Array.from(card.parentElement.children).indexOf(card) : 0) * 110;
        Object.defineProperties(card, {
            offsetLeft: { get: () => 0, configurable: true },
            offsetTop: { get: top, configurable: true },
            offsetWidth: { get: () => 300, configurable: true },
            offsetHeight: { get: () => 100, configurable: true }
        });
    }
}

/**
 * 移動元のハンドルを押して、並べ替えのドラッグを始める。
 * @param source 移動元のカード
 */
function pressDragHandle(source: import("../app/state.types").RenderCardEntry) {
    invokeListener(source.dragHandle, "pointerdown", {
        currentTarget: source.dragHandle,
        target: source.dragHandle,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: 290,
        clientY: source.card.offsetTop + 10,
        preventDefault() {}
    });
}

/**
 * 移動元のハンドルからドラッグを始め、移動先のカードの中央の上を通って、一覧の中で離す。
 * 一覧は画面の左上に置き、ポインタの位置は一覧の中の位置と同じにする。
 * @param list 結果カードを並べた一覧
 * @param source 移動元のカード
 * @param target 移動先のカード
 */
function dragCardOnto(
    list: HTMLElement,
    source: import("../app/state.types").RenderCardEntry,
    target: import("../app/state.types").RenderCardEntry
) {
    placeCardsInOneColumn(list);
    getFakeElement(list)._rect = { top: 0, bottom: 1000, left: 0, right: 300, width: 300, height: 1000 };
    document.elementFromPoint = () => list;
    pressDragHandle(source);
    const point = { target: list, pointerId: 1, clientX: 150, clientY: target.card.offsetTop + 50 };
    invokeListener(list, "pointermove", point);
    invokeListener(list, "pointerup", point);
}

test("render: empty results stop active playback", () => {
    const cleanup = installFakeDom();
    try {
        const data = createRenderDataState({
            currentResults: [],
            displayLimit: 48,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            activeThumb: document.createElement("div"),
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        let restoreCount = 0;
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({
                restoreActivePlayback: () => {
                    restoreCount += 1;
                }
            })
        });

        controller.updateDisplay();
        assert.equal(restoreCount, 1);
    } finally {
        cleanup();
    }
});

test("render: active card kept in next nodes does not stop playback", () => {
    const cleanup = installFakeDom();
    try {
        const row = makeRenderRow({ songKey: "a::1"});
        const data = createRenderDataState({
            currentResults: [row],
            displayLimit: 10,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        let restoreCount = 0;
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({
                restoreActivePlayback: () => {
                    restoreCount += 1;
                }
            })
        });

        controller.updateDisplay();
        const entry = ui.render.cardEntriesBySongKey.get(row.songKey);
        assert.ok(entry);

        ui.playback.activeThumb = entry.thumbDiv;
        ui.playback.activeThumb.appendChild(document.createElement("iframe"));
        controller.updateDisplay();

        assert.equal(restoreCount, 0);
    } finally {
        cleanup();
    }
});

test("render: active card hidden from next nodes stops playback", () => {
    const cleanup = installFakeDom();
    try {
        const rowA = makeRenderRow({ songKey: "a::1"});
        const rowB = makeRenderRow({ songKey: "b::2", url: "https://youtu.be/video2" });
        const data = createRenderDataState({
            currentResults: [rowA],
            displayLimit: 10,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        let restoreCount = 0;
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({
                restoreActivePlayback: () => {
                    restoreCount += 1;
                }
            })
        });

        controller.updateDisplay();
        const entryA = ui.render.cardEntriesBySongKey.get(rowA.songKey);
        assert.ok(entryA);
        ui.playback.activeThumb = entryA.thumbDiv;
        ui.playback.activeThumb.appendChild(document.createElement("iframe"));

        data.currentResults = [rowB];
        controller.updateDisplay();

        assert.equal(restoreCount, 1);
    } finally {
        cleanup();
    }
});

test("render: result cards and empty state use list semantics", () => {
    const cleanup = installFakeDom();
    try {
        const data = createRenderDataState({
            currentResults: [makeRenderRow({ songKey: "song:semantic", title: "Semantic Song" })],
            displayLimit: 48,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("ol"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });

        controller.updateDisplay();

        const card = ui.el.resultList.children[0];
        const article = card.querySelector("article");
        assert.ok(article);
        const heading = article.querySelector("h2");
        assert.ok(heading);
        assert.equal(card.tagName, "LI");
        assert.equal(article.getAttribute("aria-labelledby"), "result-title-1");
        assert.equal(heading.getAttribute("id"), "result-title-1");
        assert.equal(readCardName(heading, ".title"), "Semantic Song");

        data.currentResults = [];
        controller.updateDisplay();

        assert.equal(ui.el.resultList.children[0].tagName, "LI");
        assert.equal(ui.el.resultList.children[0].classList.contains("result-empty-state"), true);
    } finally {
        cleanup();
    }
});

test("render: English cards show English names, tags, dates, and labels, and tag Japanese fallbacks", () => {
    const cleanup = installFakeDom();
    try {
        const data = createRenderDataState({
            currentResults: [
                makeRenderRow({
                    songKey: "song:en",
                    title: "アイネクライネ",
                    artist: "米津玄師",
                    titleEn: "Eine Kleine",
                    artistEn: "Kenshi Yonezu"
                }),
                makeRenderRow({ songKey: "song:ja-only", title: "日本語だけの曲", artist: "歌手" })
            ],
            displayLimit: 48,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("ol"),
                resultTailSentinel: document.createElement("div")
            },
            language: "en"
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });

        controller.updateDisplay();

        const [englishCard, japaneseOnlyCard] = Array.from(ui.el.resultList.children);
        const englishTitle = englishCard.querySelector(".title");
        const englishArtist = englishCard.querySelector(".artist");
        assert.equal(readCardName(englishCard, ".title"), "Eine Kleine");
        assert.equal(englishTitle?.hasAttribute("lang"), false, "English names match the English page");
        assert.equal(readCardName(englishCard, ".artist"), "Kenshi Yonezu");
        assert.equal(englishArtist?.hasAttribute("lang"), false);
        assert.equal(readCardName(japaneseOnlyCard, ".title"), "日本語だけの曲");
        assert.equal(japaneseOnlyCard.querySelector(".title")?.getAttribute("lang"), "ja", "Japanese fallbacks are tagged on the English page");
        assert.equal(englishCard.querySelector(".tag")?.textContent, "Stream");
        assert.equal(englishCard.querySelector(".footer-left")?.children[0]?.textContent, "Mar 11, 2026", "the date comes from dateKey");
        assert.equal(englishCard.querySelector(".add-to-bookmark-btn")?.getAttribute("aria-label"), "Add to bookmark");

        ui.language.current = "ja";
        controller.refreshText();

        assert.equal(readCardName(englishCard, ".title"), "アイネクライネ", "the reused card switches back to Japanese");
        assert.equal(englishTitle?.hasAttribute("lang"), false);
        assert.equal(readCardName(englishCard, ".artist"), "米津玄師");
        assert.equal(englishArtist?.hasAttribute("lang"), false);
        assert.equal(englishCard.querySelector(".tag")?.textContent, "配信");
        assert.equal(englishCard.querySelector(".add-to-bookmark-btn")?.getAttribute("aria-label"), "ブックマークに追加");
    } finally {
        cleanup();
    }
});

test("render: refreshText rewrites only the text of the shown cards", () => {
    const cleanup = installFakeDom();
    try {
        const data = createRenderDataState({
            currentResults: [
                makeRenderRow({ songKey: "song:en", title: "アイネクライネ", artist: "米津玄師", titleEn: "Eine Kleine", artistEn: "Kenshi Yonezu" })
            ],
            displayLimit: 48,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("ol"),
                resultTailSentinel: document.createElement("div")
            }
        });
        let thumbnailUpdateCount = 0;
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({ updateThumbnail: () => { thumbnailUpdateCount += 1; } })
        });

        controller.updateDisplay();
        const card = ui.el.resultList.children[0];
        const actionButton = card.querySelector<HTMLButtonElement>(".add-to-bookmark-btn");
        const actionHandler = actionButton?.onclick;
        const thumbnailUpdatesBeforeSwitch = thumbnailUpdateCount;

        ui.language.current = "en";
        controller.refreshText();

        assert.equal(ui.el.resultList.children[0], card, "the card element is kept");
        assert.equal(readCardName(card, ".title"), "Eine Kleine");
        assert.equal(readCardName(card, ".artist"), "Kenshi Yonezu");
        assert.equal(card.querySelector(".tag")?.textContent, "Stream");
        assert.equal(actionButton?.getAttribute("aria-label"), "Add to bookmark");
        assert.equal(thumbnailUpdateCount, thumbnailUpdatesBeforeSwitch, "the thumbnail is not updated again");
        assert.equal(actionButton?.onclick, actionHandler, "the button handler is not set up again");
    } finally {
        cleanup();
    }
});

test("render: refreshText stops scrolling a name only when the name changes", () => {
    const cleanup = installFakeDom();
    try {
        // 英語の曲名がない曲は、英語のページでも日本語の曲名のままになる。
        const data = createRenderDataState({
            currentResults: [makeRenderRow({ songKey: "song:en", title: "アイネクライネ", artist: "米津玄師", artistEn: "Kenshi Yonezu" })],
            displayLimit: 48,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("ol"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });
        controller.updateDisplay();
        const card = ui.el.resultList.children[0];
        const cancelled: string[] = [];
        for (const selector of [".title", ".artist"]) {
            const box = card.querySelector<HTMLElement>(selector);
            const text = box?.querySelector<HTMLElement>(".card-name-text");
            assert.ok(box && text);
            box.classList.add("is-marquee-scrolling");
            const marquee = { id: "card-text-marquee", cancel() { cancelled.push(selector); } };
            text.getAnimations = () => [marquee as unknown as Animation];
        }

        ui.language.current = "en";
        controller.refreshText();

        assert.deepEqual(cancelled, [".artist"]);
        assert.equal(card.querySelector(".title")?.classList.contains("is-marquee-scrolling"), true);
        assert.equal(card.querySelector(".artist")?.classList.contains("is-marquee-scrolling"), false);
    } finally {
        cleanup();
    }
});

test("render: refreshText rewrites the empty state in the current language", () => {
    const cleanup = installFakeDom();
    try {
        const data = createRenderDataState({ currentResults: [], displayLimit: 48, activeBookmark: null });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("ol"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });

        controller.updateDisplay();
        assert.equal(ui.el.resultList.querySelector(".result-empty-state-title")?.textContent, "見つかりませんでした");

        ui.language.current = "en";
        controller.refreshText();

        assert.equal(ui.el.resultList.children.length, 1);
        assert.equal(ui.el.resultList.children[0].classList.contains("result-empty-state"), true);
        assert.equal(ui.el.resultList.querySelector(".result-empty-state-title")?.textContent, "No songs found");
        assert.equal(
            ui.el.resultList.querySelector(".result-empty-state-hint")?.textContent,
            "Try fewer keywords or clear some filters."
        );
    } finally {
        cleanup();
    }
});

test("render: cards keep fixed columns while preserving DOM order", () => {
    const cleanup = installFakeDom();
    try {
        const rowA = makeRenderRow({ songKey: "a::1"});
        const rowB = makeRenderRow({ songKey: "b::2", url: "https://www.youtube.com/shorts/video2" });
        const data = createRenderDataState({
            currentResults: [rowA, rowB],
            displayLimit: 10,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });
        getFakeElement(ui.el.resultList)._clientWidth = 700;
        getFakeElement(ui.el.resultList)._rect = { top: 0, bottom: 200, left: 0, right: 700, width: 700, height: 200 };

        controller.updateDisplay();
        const entryA = ui.render.cardEntriesBySongKey.get(rowA.songKey);
        assert.ok(entryA);
        const entryB = ui.render.cardEntriesBySongKey.get(rowB.songKey);
        assert.ok(entryB);
        assert.equal(ui.el.resultList.children[0], entryA.card);
        assert.equal(ui.el.resultList.children[1], entryB.card);
        assert.equal(entryA.card.style.width, "344px");
        assert.equal(entryA.card.style.left, "0px");
        assert.equal(entryA.card.style.top, "0px");
        assert.equal(entryA.card.dataset.layoutColumn, "0");
        assert.equal(entryB.card.style.width, "344px");
        assert.equal(entryB.card.style.left, "356px");
        assert.equal(entryB.card.style.top, "0px");
        assert.equal(entryB.card.dataset.layoutColumn, "1");
        assert.equal(ui.el.resultList.style.height, "100px");
    } finally {
        cleanup();
    }
});

test("render: card height changes only shift cards in the same column", () => {
    const cleanup = installFakeDom();
    try {
        const rows = [
            makeRenderRow({ songKey: "a::1"}),
            makeRenderRow({ songKey: "b::2"}),
            makeRenderRow({ songKey: "c::3"}),
            makeRenderRow({ songKey: "d::4"})
        ];
        const data = createRenderDataState({
            currentResults: rows,
            displayLimit: 10,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });
        getFakeElement(ui.el.resultList)._clientWidth = 700;
        getFakeElement(ui.el.resultList)._rect = { top: 0, bottom: 200, left: 0, right: 700, width: 700, height: 200 };

        controller.updateDisplay();
        const entryA = ui.render.cardEntriesBySongKey.get("a::1");
        assert.ok(entryA);
        const entryB = ui.render.cardEntriesBySongKey.get("b::2");
        assert.ok(entryB);
        const entryC = ui.render.cardEntriesBySongKey.get("c::3");
        assert.ok(entryC);
        const entryD = ui.render.cardEntriesBySongKey.get("d::4");
        assert.ok(entryD);

        assert.equal(entryA.card.style.top, "0px");
        assert.equal(entryB.card.style.top, "0px");
        assert.equal(entryC.card.style.top, "112px");
        assert.equal(entryD.card.style.top, "112px");

        getFakeElement(entryA.card)._scrollHeight = 400;
        controller.refreshLayout();

        assert.equal(entryA.card.style.top, "0px");
        assert.equal(entryB.card.style.top, "0px");
        assert.equal(entryC.card.style.top, "412px");
        assert.equal(entryD.card.style.top, "112px");
        assert.equal(ui.el.resultList.style.height, "512px");

        getFakeElement(entryA.card)._scrollHeight = 100;
        controller.refreshLayout();

        assert.equal(entryC.card.style.top, "112px");
        assert.equal(entryD.card.style.top, "112px");
        assert.equal(ui.el.resultList.style.height, "212px");
    } finally {
        cleanup();
    }
});

test("render: refreshLayout shrinks multi-column container height after card height decreases", () => {
    const cleanup = installFakeDom();
    try {
        const row = makeRenderRow({ songKey: "a::1"});
        const data = createRenderDataState({
            currentResults: [row],
            displayLimit: 10,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });

        getFakeElement(ui.el.resultList)._clientWidth = 700;
        controller.updateDisplay();
        const entry = ui.render.cardEntriesBySongKey.get(row.songKey);
        assert.ok(entry);
        getFakeElement(entry.card)._scrollHeight = 400;
        controller.refreshLayout();
        assert.equal(ui.el.resultList.style.height, "400px");

        getFakeElement(entry.card)._scrollHeight = 100;
        controller.refreshLayout();
        assert.equal(ui.el.resultList.style.height, "100px");
    } finally {
        cleanup();
    }
});

test("render: adds footer tags for collaboration, relay, and harmony", () => {
    const cleanup = installFakeDom();
    try {
        const collabRow = makeRenderRow({
            songKey: "song:collab",
            streamRole: "ホスト"
        });
        collabRow.isRelay = true;
        collabRow.isHarmony = true;
        const soloRow = makeRenderRow({
            songKey: "song:solo",
            streamRole: ""
        });
        const data = createRenderDataState({
            currentResults: [collabRow, soloRow],
            displayLimit: 10,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });

        controller.updateDisplay();

        const collabEntry = ui.render.cardEntriesBySongKey.get("song:collab");
        assert.ok(collabEntry);
        const soloEntry = ui.render.cardEntriesBySongKey.get("song:solo");
        assert.ok(soloEntry);
        const collabTags = Array.from(collabEntry.card.querySelectorAll(".tag")).map((tag) => tag.textContent);
        const soloTags = Array.from(soloEntry.card.querySelectorAll(".tag")).map((tag) => tag.textContent);

        assert.deepEqual(collabTags, ["配信", "コラボ", "リレー", "ハモリ"]);
        assert.deepEqual(soloTags, ["配信"]);
        assert.equal(collabEntry.card.querySelector(".tag-collab")?.textContent, "コラボ");
        assert.equal(collabEntry.card.querySelector(".tag-relay")?.textContent, "リレー");
        assert.equal(collabEntry.card.querySelector(".tag-harmony")?.textContent, "ハモリ");
    } finally {
        cleanup();
    }
});

test("render: explicit video orientation overrides URL heuristic", () => {
    const cleanup = installFakeDom();
    try {
        const row = makeRenderRow({
            songKey: "a::1",
            url: "https://youtu.be/video1",
            videoOrientation: "vertical"
        });
        const data = createRenderDataState({
            currentResults: [row],
            displayLimit: 10,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const received: import("../app/lib/youtube/embed.mts").YoutubeTarget[] = [];
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({
                updateThumbnail: (_, yt) => {
                    received.push(yt);
                },
                extractYoutubeInfo
            })
        });

        controller.updateDisplay();
        assert.equal(received[0]?.isVertical, true);
    } finally {
        cleanup();
    }
});

test("render: playSongByKey expands display limit and starts playback for hidden result", async () => {
    const cleanup = installFakeDom();
    try {
        const rows = [
            makeRenderRow({ songKey: "song:1", url: "https://youtu.be/video1" }),
            makeRenderRow({ songKey: "song:2", url: "https://youtu.be/video2" }),
            makeRenderRow({ songKey: "song:3", url: "https://youtu.be/video3" })
        ];
        const data = createRenderDataState({
            currentResults: rows,
            displayLimit: 1,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const playCalls: { thumbDiv: HTMLElement; yt: import("../app/lib/youtube/embed.mts").YoutubeTarget; options: Parameters<Parameters<typeof createRenderController>[0]["callbacks"]["playThumbnail"]>[2] }[] = [];
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            resultDisplayBatchSize: 2,
            callbacks: createRenderCallbacks({
                extractYoutubeInfo,
                playThumbnail: (thumbDiv, yt, options) => {
                    playCalls.push({ thumbDiv, yt, options });
                    return playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED);
                }
            })
        });

        controller.updateDisplay();
        const started = await controller.playSongByKey("song:3");

        assert.deepEqual(started, playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED));
        assert.equal(data.displayLimit, 3);
        assert.equal(playCalls.length, 1);
        assert.equal(playCalls[0].yt.videoId, "video3");
        assert.deepEqual(playCalls[0].options, {
            playbackMode: "autoplay"
        });
        const entry = ui.render.cardEntriesBySongKey.get("song:3");
        assert.ok(entry);
        assert.equal(playCalls[0].thumbDiv, entry.thumbDiv);
    } finally {
        cleanup();
    }
});

test("render: playSongByKey expands display limit in increment-sized chunks", async () => {
    const cleanup = installFakeDom();
    try {
        const rows = [
            makeRenderRow({ songKey: "song:1"}),
            makeRenderRow({ songKey: "song:2"}),
            makeRenderRow({ songKey: "song:3"}),
            makeRenderRow({ songKey: "song:4"}),
            makeRenderRow({ songKey: "song:5"})
        ];
        const data = createRenderDataState({
            currentResults: rows,
            displayLimit: 1,
            activeBookmark: null
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            resultDisplayBatchSize: 2,
            callbacks: createRenderCallbacks({
                extractYoutubeInfo,
                playThumbnail: () => playbackStartResult(YOUTUBE_PLAYBACK_START_STATUS.STARTED)
            })
        });

        controller.updateDisplay();
        await controller.playSongByKey("song:4");

        assert.equal(data.displayLimit, 4);
    } finally {
        cleanup();
    }
});

test("bookmark: observes result tail and increases by RESULT_DISPLAY_BATCH_SIZE (48)", () => {
    const cleanup = installFakeDom();
    const previousIntersectionObserver = globalThis.IntersectionObserver;
    const observers: FakeIntersectionObserver[] = [];
    class FakeIntersectionObserver implements IntersectionObserver {
        readonly root = null;
        readonly rootMargin = "0px";
        readonly scrollMargin = "0px";
        readonly thresholds = [0];
        readonly targets: Element[] = [];
        readonly callback: IntersectionObserverCallback;
        readonly options?: IntersectionObserverInit;
        disconnected = false;

        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
            this.callback = callback;
            this.options = options;
            observers.push(this);
        }

        /** 監視対象を記録する。 */
        observe(target: Element) { this.targets.push(target); }

        /** 監視対象を解除する。 */
        unobserve(target: Element) {
            const index = this.targets.indexOf(target);
            if (index >= 0) this.targets.splice(index, 1);
        }

        /** 監視解除を記録する。 */
        disconnect() { this.disconnected = true; }

        /** 未配信の観測結果は保持しない。 */
        takeRecords(): IntersectionObserverEntry[] { return []; }

        /** 記録した対象の交差状態を通知する。 */
        trigger(isIntersecting = true) {
            this.callback(this.targets.map((target) => ({
                target, isIntersecting, time: 0,
                intersectionRatio: isIntersecting ? 1 : 0,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: target.getBoundingClientRect(),
                rootBounds: null
            })), this);
        }
    }
    globalThis.IntersectionObserver = FakeIntersectionObserver;
    try {
        const rows = Array.from({ length: 100 }, (_, index) => createSongFixture({
            songKey: `song-${index + 1}`,
            title: `曲${index + 1}`,
            artist: "artist",
            date: "2024-01-01",
            dateKey: 20240101,
            format: "配信",
            isRelay: false,
            isHarmony: false,
            url: `https://youtu.be/video${index + 1}`,
            titleNorm: "",
            artistNorm: "",
            titleYomiNorm: "",
            artistYomiNorm: "",
            titleEn: "",
            artistEn: "",
            titleEnNorm: "",
            artistEnNorm: "",
            artistSortNorm: ""
        }));
        const data = createRenderDataState({
            allSongsRaw: rows,
            bookmarks: {
                bm1: {
                    name: "100件",
                    songs: rows.map((row) => row.songKey)
                }
            },
            activeBookmark: "bm1",
            currentResults: [],
            displayLimit: 0
        });
        const resultTailSentinel = document.createElement("div");
        resultTailSentinel.hidden = true;
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel,
                resultCount: { innerText: "" },
                searchBox: { value: "" },
                relayOnly: { checked: false },
                harmonyOnly: { checked: false },
                dateFromYear: null,
                dateFromMonth: null,
                dateFromDay: null,
                dateToYear: null,
                dateToMonth: null,
                dateToDay: null
            }
        });

        const renderController = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({
                extractYoutubeInfo: (url) => ({ videoId: String(url || ""), startSeconds: 0, isVertical: false })
            })
        });

        const searchController = createSearchController({
            data,
            ui,
            searchFiltersController: createSearchFiltersController({
                ui,
                defaultFormats: ["配信", "歌みた", "ショート", "切り抜き"]
            }),
            dateFilterController: createDateFilterController({ ui }),
            constants: {
                RANDOM_DISPLAY_COUNT: 48,
                MIN_PERFORMANCE_FOR_RANDOM: 3,
                RESULT_DISPLAY_BATCH_SIZE: 48
            },
            callbacks: {
                updateDisplay: () => renderController.updateDisplay(),
                showResultCount: () => {},
                scrollResultsPaneToTop: () => {}
            }
        });

        searchController.search();
        assert.equal(data.currentResults.length, 100);
        assert.equal(data.displayLimit, 48);
        assert.equal(ui.el.resultList.children.length, 48);
        assert.equal(resultTailSentinel.hidden, false);
        assert.equal(observers.length, 1);

        const observer = observers.at(-1);
        assert.ok(observer);
        observer.trigger();
        assert.equal(data.displayLimit, 96);
        assert.equal(ui.el.resultList.children.length, 96);
        assert.equal(resultTailSentinel.hidden, false);

        const nextObserver = observers.at(-1);
        assert.ok(nextObserver);
        nextObserver.trigger();
        assert.equal(data.displayLimit, 100);
        assert.equal(ui.el.resultList.children.length, 100);
        assert.equal(resultTailSentinel.hidden, true);
    } finally {
        globalThis.IntersectionObserver = previousIntersectionObserver;
        cleanup();
    }
});

test("render: drag handle is bookmark-only and reorder works in both directions with persistence", () => {
    const cleanup = installFakeDom();
    try {
        const rowA = makeRenderRow({ songKey: "a::1", title: "A" });
        const rowB = makeRenderRow({ songKey: "b::2", title: "B", url: "https://youtu.be/video2" });
        const data = createRenderDataState({
            currentResults: [rowA, rowB],
            displayLimit: 10,
            activeBookmark: null,
            bookmarks: {
                bm1: {
                    name: "test",
                    songs: [rowA.songKey, rowB.songKey]
                }
            }
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        let saveCount = 0;
        const storageController = createBookmarkReorderFixture({
            data,
            saveBookmarks: () => { saveCount += 1; return { ok: true }; },
            updateDisplay: () => controller.updateDisplay()
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({
                moveSongInActiveBookmark: storageController.moveSongInActiveBookmark
            })
        });

        controller.updateDisplay();
        const normalEntryA = ui.render.cardEntriesBySongKey.get(rowA.songKey);
        assert.ok(normalEntryA);
        assert.equal(normalEntryA.dragHandle.hidden, true);
        assert.equal(normalEntryA.card.draggable, false);
        // 通常の検索結果では、隠れたハンドルを押しても並べ替えを始めない。
        pressDragHandle(normalEntryA);
        assert.equal(normalEntryA.card.classList.contains("dragging"), false);
        assert.deepEqual([...getFakeElement(ui.el.resultList).capturedPointerIds], []);

        data.activeBookmark = "bm1";
        controller.updateDisplay();
        const entryA = ui.render.cardEntriesBySongKey.get(rowA.songKey);
        assert.ok(entryA);
        const entryB = ui.render.cardEntriesBySongKey.get(rowB.songKey);
        assert.ok(entryB);
        assert.equal(entryA.dragHandle.hidden, false);

        dragCardOnto(ui.el.resultList, entryA, entryB);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), [rowB.songKey, rowA.songKey]);
        assert.deepEqual(data.bookmarks.bm1.songs, [rowB.songKey, rowA.songKey]);
        assert.equal(saveCount, 1);

        dragCardOnto(ui.el.resultList, entryA, entryB);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), [rowA.songKey, rowB.songKey]);
        assert.deepEqual(data.bookmarks.bm1.songs, [rowA.songKey, rowB.songKey]);
        assert.equal(saveCount, 2);
    } finally {
        cleanup();
    }
});

test("render: re-rendering during a bookmark drag keeps the dragged card semi-transparent", () => {
    const cleanup = installFakeDom();
    try {
        const rowA = makeRenderRow({ songKey: "a::1", title: "A" });
        const rowB = makeRenderRow({ songKey: "b::2", title: "B", url: "https://youtu.be/video2" });
        const data = createRenderDataState({
            currentResults: [rowA, rowB],
            displayLimit: 1,
            activeBookmark: "bm1",
            bookmarks: {
                bm1: {
                    name: "test",
                    songs: [rowA.songKey, rowB.songKey]
                }
            }
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });

        controller.updateDisplay();
        const entryA = ui.render.cardEntriesBySongKey.get(rowA.songKey);
        assert.ok(entryA);
        pressDragHandle(entryA);
        assert.equal(entryA.card.classList.contains("dragging"), true);

        // ドラッグ中に続きのカードを読み込むと、結果一覧が描き直される。
        data.displayLimit = 2;
        controller.updateDisplay();
        const entryB = ui.render.cardEntriesBySongKey.get(rowB.songKey);
        assert.ok(entryB);
        assert.equal(entryA.card.classList.contains("dragging"), true);
        assert.equal(entryB.card.classList.contains("dragging"), false);

        invokeListener(ui.el.resultList, "pointerup", { target: ui.el.resultList, pointerId: 1, clientX: 150, clientY: 50 });
        controller.updateDisplay();
        assert.equal(entryA.card.classList.contains("dragging"), false);
    } finally {
        cleanup();
    }
});

test("render: drag reorder forwards reload-required save failures without changing state", () => {
    const cleanup = installFakeDom();
    try {
        const rowA = makeRenderRow({ songKey: "a::1", title: "A" });
        const rowB = makeRenderRow({ songKey: "b::2", title: "B" });
        const data = createRenderDataState({
            currentResults: [rowA, rowB],
            displayLimit: 10,
            activeBookmark: "bm1",
            bookmarks: {
                bm1: {
                    name: "test",
                    songs: [rowA.songKey, rowB.songKey]
                }
            }
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const saveFailure = { ok: false, reason: "storage_reload_required" } as const;
        const notifiedFailures: import("../app/controllers/storage.mts").StorageActionFailure[] = [];
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({
                moveSongInActiveBookmark: () => saveFailure,
                notifyBookmarkSaveError: (result) => notifiedFailures.push(result)
            })
        });

        controller.updateDisplay();
        const entryA = ui.render.cardEntriesBySongKey.get(rowA.songKey);
        assert.ok(entryA);
        const entryB = ui.render.cardEntriesBySongKey.get(rowB.songKey);
        assert.ok(entryB);

        dragCardOnto(ui.el.resultList, entryA, entryB);

        assert.deepEqual(data.currentResults.map((row) => row.songKey), [rowA.songKey, rowB.songKey]);
        assert.deepEqual(data.bookmarks.bm1.songs, [rowA.songKey, rowB.songKey]);
        assert.deepEqual(notifiedFailures, [saveFailure]);
    } finally {
        cleanup();
    }
});

test("render: active playback card can move back left without jumping to the end", () => {
    const cleanup = installFakeDom();
    try {
        const rowA = makeRenderRow({ songKey: "a::1", title: "A" });
        const rowB = makeRenderRow({ songKey: "b::2", title: "B" });
        const rowC = makeRenderRow({ songKey: "c::3", title: "C" });
        const rowD = makeRenderRow({ songKey: "d::4", title: "D" });
        const data = createRenderDataState({
            currentResults: [rowA, rowB, rowC, rowD],
            displayLimit: 10,
            activeBookmark: "bm1",
            bookmarks: {
                bm1: {
                    name: "test",
                    songs: [rowA.songKey, rowB.songKey, rowC.songKey, rowD.songKey]
                }
            }
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel: document.createElement("div")
            }
        });
        const storageController = createBookmarkReorderFixture({
            data,
            saveBookmarks: () => ({ ok: true }),
            updateDisplay: () => controller.updateDisplay()
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks({
                moveSongInActiveBookmark: storageController.moveSongInActiveBookmark
            })
        });

        controller.updateDisplay();
        const entryA = ui.render.cardEntriesBySongKey.get(rowA.songKey);
        assert.ok(entryA);
        const entryB = ui.render.cardEntriesBySongKey.get(rowB.songKey);
        assert.ok(entryB);

        ui.playback.activeThumb = entryA.thumbDiv;
        ui.playback.activeThumb.appendChild(document.createElement("iframe"));
        const movedNodes: Node[] = [];
        const originalInsertBefore = ui.el.resultList.insertBefore.bind(ui.el.resultList);
        ui.el.resultList.insertBefore = (node, referenceNode) => {
            movedNodes.push(node);
            return originalInsertBefore(node, referenceNode);
        };

        dragCardOnto(ui.el.resultList, entryA, entryB);
        assert.deepEqual(data.currentResults.map((row) => row.songKey), [
            rowB.songKey,
            rowA.songKey,
            rowC.songKey,
            rowD.songKey
        ]);

        dragCardOnto(ui.el.resultList, entryA, entryB);

        assert.deepEqual(data.currentResults.map((row) => row.songKey), [
            rowA.songKey,
            rowB.songKey,
            rowC.songKey,
            rowD.songKey
        ]);
        assert.deepEqual(data.bookmarks.bm1.songs, [
            rowA.songKey,
            rowB.songKey,
            rowC.songKey,
            rowD.songKey
        ]);
        assert.deepEqual(
            Array.from(ui.el.resultList.children, (card) => {
                assert.ok(card instanceof HTMLElement);
                return card.dataset.songKey;
            }),
            [rowA.songKey, rowB.songKey, rowC.songKey, rowD.songKey]
        );
        assert.equal(
            movedNodes.includes(entryA.card),
            false,
            "active playback card should stay mounted to preserve current position"
        );
    } finally {
        cleanup();
    }
});
