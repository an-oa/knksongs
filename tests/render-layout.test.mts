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
    createDataTransferMock,
    invokeListener,
    getFakeElement,
    setGlobalValue
} from "./test-helpers.mts";

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
    showThumbnails?: boolean;
    scrollObserver?: IntersectionObserver | null;
    cardEntriesBySongKey?: Map<string, import("../app/state.types").RenderCardEntry>;
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
            activeThumb: input.activeThumb ?? null,
            showThumbnails: input.showThumbnails ?? false,
            scrollObserver: input.scrollObserver ?? null
        },
        render: {
            cardEntriesBySongKey: input.cardEntriesBySongKey ?? new Map<string, import("../app/state.types").RenderCardEntry>()
        },
        lookup: {
            songMapByBookmarkKey: new Map(),
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
        setupScrollObserver: callbacks.setupScrollObserver || (() => {}),
        removeSongFromActiveBookmark: callbacks.removeSongFromActiveBookmark || (() => {}),
        moveSongInActiveBookmark: callbacks.moveSongInActiveBookmark || (() => ({ ok: true, changed: false })),
        notifyBookmarkSaveError: callbacks.notifyBookmarkSaveError || (() => {})
    };
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
        assert.equal(heading.querySelector(".title")?.textContent, "Semantic Song");

        data.currentResults = [];
        controller.updateDisplay();

        assert.equal(ui.el.resultList.children[0].tagName, "LI");
        assert.equal(ui.el.resultList.children[0].classList.contains("result-empty-state"), true);
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
            showThumbnails: true,
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
            showThumbnails: true,
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
            bookmarkSongKey: `song-${index + 1}`,
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
            artistYomiNorm: ""
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

test("render: result tail fallback increases display limit without IntersectionObserver", () => {
    const cleanup = installFakeDom();
    const previousIntersectionObserver = globalThis.IntersectionObserver;
    setGlobalValue("IntersectionObserver", undefined);
    try {
        const rows = Array.from({ length: 60 }, (_, index) => makeRenderRow({
            songKey: `song-${index + 1}`,
            bookmarkSongKey: `song-${index + 1}`,
            url: `https://youtu.be/video${index + 1}`
        }));
        const resultTailSentinel = document.createElement("div");
        resultTailSentinel.hidden = true;
        getFakeElement(resultTailSentinel)._rect = { top: 1300, bottom: 1301, left: 0, right: 1, width: 1, height: 1 };
        const data = createRenderDataState({
            allSongsRaw: rows,
            bookmarks: {},
            activeBookmark: null,
            currentResults: rows,
            displayLimit: 48
        });
        const ui = createRenderUiState({
            el: {
                resultList: document.createElement("div"),
                resultTailSentinel
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });

        controller.updateDisplay();

        assert.equal(data.displayLimit, 48);
        assert.equal(ui.el.resultList.children.length, 48);
        assert.equal(resultTailSentinel.hidden, false);
        assert.equal(cleanup.window._events.get("scroll")?.size, 1);

        getFakeElement(resultTailSentinel)._rect = { top: 800, bottom: 801, left: 0, right: 1, width: 1, height: 1 };
        invokeListener(cleanup.window, "scroll", {});

        assert.equal(data.displayLimit, 60);
        assert.equal(ui.el.resultList.children.length, 60);
        assert.equal(resultTailSentinel.hidden, true);
        assert.equal(cleanup.window._events.has("scroll"), false);
    } finally {
        globalThis.IntersectionObserver = previousIntersectionObserver;
        cleanup();
    }
});

test("render: result tail fallback listens to the nearest scrollable ancestor", () => {
    const cleanup = installFakeDom();
    const previousIntersectionObserver = globalThis.IntersectionObserver;
    setGlobalValue("IntersectionObserver", undefined);
    try {
        const rows = Array.from({ length: 60 }, (_, index) => makeRenderRow({
            songKey: `song-${index + 1}`,
            bookmarkSongKey: `song-${index + 1}`,
            url: `https://youtu.be/video${index + 1}`
        }));
        const scrollContainer = document.createElement("section");
        getFakeElement(scrollContainer)._scrollHeight = 2000;
        getFakeElement(scrollContainer)._clientHeight = 400;
        getFakeElement(scrollContainer)._rect = { top: 100, bottom: 500, left: 0, right: 500, width: 500, height: 400 };
        cleanup.window.getComputedStyle = (element) => ({
            overflowY: element === scrollContainer ? "auto" : "visible"
        });

        const resultList = document.createElement("div");
        const resultTailSentinel = document.createElement("div");
        resultTailSentinel.hidden = true;
        getFakeElement(resultTailSentinel)._rect = { top: 1200, bottom: 1201, left: 0, right: 1, width: 1, height: 1 };
        scrollContainer.appendChild(resultList);
        scrollContainer.appendChild(resultTailSentinel);
        document.body.appendChild(scrollContainer);

        const data = createRenderDataState({
            allSongsRaw: rows,
            bookmarks: {},
            activeBookmark: null,
            currentResults: rows,
            displayLimit: 48
        });
        const ui = createRenderUiState({
            el: {
                resultList,
                resultTailSentinel
            }
        });
        const controller = createRenderController({
            data,
            ui,
            isAllFormatsSelected: () => true,
            callbacks: createRenderCallbacks()
        });

        controller.updateDisplay();

        assert.equal(data.displayLimit, 48);
        assert.equal(resultTailSentinel.hidden, false);
        assert.equal(getFakeElement(scrollContainer)._events.get("scroll")?.size, 1);
        assert.equal(cleanup.window._events.has("scroll"), false);
        assert.equal(cleanup.window._events.get("resize")?.size, 1);

        getFakeElement(resultTailSentinel)._rect = { top: 900, bottom: 901, left: 0, right: 1, width: 1, height: 1 };
        invokeListener(scrollContainer, "scroll", {});

        assert.equal(data.displayLimit, 60);
        assert.equal(ui.el.resultList.children.length, 60);
        assert.equal(resultTailSentinel.hidden, true);
        assert.equal(getFakeElement(scrollContainer)._events.has("scroll"), false);
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
        assert.equal(normalEntryA.dragHandle.draggable, false);
        assert.equal(normalEntryA.card.draggable, false);
        assert.equal(getFakeElement(normalEntryA.card)._events.has("dragstart"), false);

        data.activeBookmark = "bm1";
        controller.updateDisplay();
        const entryA = ui.render.cardEntriesBySongKey.get(rowA.songKey);
        assert.ok(entryA);
        const entryB = ui.render.cardEntriesBySongKey.get(rowB.songKey);
        assert.ok(entryB);
        assert.equal(entryA.dragHandle.hidden, false);
        assert.equal(entryA.dragHandle.draggable, true);

        const transfer1 = createDataTransferMock();
        invokeListener(entryA.dragHandle, "dragstart", {
            currentTarget: entryA.dragHandle,
            target: entryA.dragHandle,
            dataTransfer: transfer1,
            preventDefault() {}
        });
        invokeListener(entryB.card, "drop", {
            target: entryB.card,
            dataTransfer: transfer1,
            preventDefault() {}
        });
        assert.deepEqual(data.currentResults.map((row) => row.songKey), [rowB.songKey, rowA.songKey]);
        assert.deepEqual(data.bookmarks.bm1.songs, [rowB.songKey, rowA.songKey]);
        assert.equal(saveCount, 1);

        const transfer2 = createDataTransferMock();
        invokeListener(entryA.dragHandle, "dragstart", {
            currentTarget: entryA.dragHandle,
            target: entryA.dragHandle,
            dataTransfer: transfer2,
            preventDefault() {}
        });
        invokeListener(entryB.card, "drop", {
            target: entryB.card,
            dataTransfer: transfer2,
            preventDefault() {}
        });
        assert.deepEqual(data.currentResults.map((row) => row.songKey), [rowA.songKey, rowB.songKey]);
        assert.deepEqual(data.bookmarks.bm1.songs, [rowA.songKey, rowB.songKey]);
        assert.equal(saveCount, 2);
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

        const transfer = createDataTransferMock();
        invokeListener(entryA.dragHandle, "dragstart", {
            currentTarget: entryA.dragHandle,
            target: entryA.dragHandle,
            dataTransfer: transfer,
            preventDefault() {}
        });
        invokeListener(entryB.card, "drop", {
            target: entryB.card,
            dataTransfer: transfer,
            preventDefault() {}
        });

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
        const rowA = makeRenderRow({ songKey: "a::1", bookmarkSongKey: "videoA::1", title: "A" });
        const rowB = makeRenderRow({ songKey: "b::2", bookmarkSongKey: "videoB::2", title: "B" });
        const rowC = makeRenderRow({ songKey: "c::3", bookmarkSongKey: "videoC::3", title: "C" });
        const rowD = makeRenderRow({ songKey: "d::4", bookmarkSongKey: "videoD::4", title: "D" });
        const data = createRenderDataState({
            currentResults: [rowA, rowB, rowC, rowD],
            displayLimit: 10,
            activeBookmark: "bm1",
            bookmarks: {
                bm1: {
                    name: "test",
                    songs: [rowA.bookmarkSongKey, rowB.bookmarkSongKey, rowC.bookmarkSongKey, rowD.bookmarkSongKey]
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

        const transferRight = createDataTransferMock();
        invokeListener(entryA.dragHandle, "dragstart", {
            currentTarget: entryA.dragHandle,
            target: entryA.dragHandle,
            dataTransfer: transferRight,
            preventDefault() {}
        });
        invokeListener(entryB.card, "drop", {
            target: entryB.card,
            dataTransfer: transferRight,
            preventDefault() {}
        });
        assert.deepEqual(data.currentResults.map((row) => row.songKey), [
            rowB.songKey,
            rowA.songKey,
            rowC.songKey,
            rowD.songKey
        ]);

        const transferLeft = createDataTransferMock();
        invokeListener(entryA.dragHandle, "dragstart", {
            currentTarget: entryA.dragHandle,
            target: entryA.dragHandle,
            dataTransfer: transferLeft,
            preventDefault() {}
        });
        invokeListener(entryB.card, "drop", {
            target: entryB.card,
            dataTransfer: transferLeft,
            preventDefault() {}
        });

        assert.deepEqual(data.currentResults.map((row) => row.songKey), [
            rowA.songKey,
            rowB.songKey,
            rowC.songKey,
            rowD.songKey
        ]);
        assert.deepEqual(data.bookmarks.bm1.songs, [
            rowA.bookmarkSongKey,
            rowB.bookmarkSongKey,
            rowC.bookmarkSongKey,
            rowD.bookmarkSongKey
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
