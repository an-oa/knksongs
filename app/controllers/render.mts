import { getHeaderHeight } from "../lib/dom-utils.mjs";
import { hasStreamRole } from "../lib/stream-role.mjs";
import { tracePlayback } from "../lib/playback-debug.mjs";
import { scheduleScrollElementIntoView } from "../lib/results-scroll.mjs";
import { createBookmarkDragReorderController } from "../lib/render/drag-reorder.mjs";
import type {
    BookmarkDragReorderSaveFailure,
    BookmarkDragReorderSaveResult
} from "../lib/render/drag-reorder.mjs";
import { applyMasonryLayout } from "../lib/render/masonry-layout.mjs";
import { createResultTailObserver } from "../lib/render/result-tail-observer.mjs";
import { getBookmarkSongRef } from "../lib/song-identity.mjs";
import {
    createYoutubePlaybackStartResult,
    YOUTUBE_PLAYBACK_START_STATUS
} from "../lib/youtube/playback-start-attempt.mjs";
import type { YoutubePlaybackStartResult } from "../lib/youtube/playback-start-attempt.mjs";
import type { YoutubeTarget } from "../lib/youtube/embed.mjs";
import { suppressYoutubeThumbnailContextMenu } from "../lib/youtube/thumbnail.mjs";
import type {
    AppDataState,
    PlaybackUiRuntimeState,
    RenderCardEntry,
    RenderUiRuntimeState,
    SearchUiRuntimeState
} from "../state.types";

const DEFAULT_RESULT_DISPLAY_BATCH_SIZE = 48;

type RenderUiElements = {
    resultList?: HTMLElement | null;
    resultTailSentinel?: HTMLElement | null;
};

type RenderUiState = {
    el: RenderUiElements;
    search: SearchUiRuntimeState;
    playback: PlaybackUiRuntimeState;
    render: RenderUiRuntimeState;
};

type ActiveCardRenderState = {
    activeThumb: Element | null;
    activeCard: HTMLElement | null;
    isActiveCardInNextNodes: boolean;
    hasEmbeddedPlayer: boolean;
};

type EmptyStateDescriptor = {
    kind: "loading" | "error" | "empty";
    message: string;
};

type ResultNodeBuildResult = {
    nodes: HTMLElement[];
    entries: RenderCardEntry[];
};

type DisplayState = {
    container: HTMLElement;
    results: Song[];
};

type RenderedDisplayState = {
    entries: RenderCardEntry[];
};

type RenderCallbacks = {
    updateThumbnail: (thumbDiv: HTMLElement, yt: YoutubeTarget) => void;
    extractYoutubeInfo: (url?: string) => YoutubeTarget;
    playThumbnail: (
        thumbDiv: HTMLElement,
        yt: YoutubeTarget,
        options?: { playbackMode?: string }
    ) => Promise<YoutubePlaybackStartResult> | YoutubePlaybackStartResult;
    restoreActivePlayback: () => void;
    openBookmarkModal: (songKey: string) => void;
    setupScrollObserver: () => void;
    removeSongFromActiveBookmark: (songKey: string) => void;
    saveBookmarks: (
        bookmarks: AppDataState["bookmarks"]
    ) => BookmarkDragReorderSaveResult;
    notifyBookmarkSaveError: (result: BookmarkDragReorderSaveFailure) => void;
};

type RenderControllerInput = {
    data: AppDataState;
    ui: RenderUiState;
    isAllFormatsSelected: () => boolean;
    resultDisplayBatchSize?: number;
    callbacks: RenderCallbacks;
};

/**
 * 検索結果カードの生成・差分反映・表示更新を担うレンダーコントローラーを作成する。
 * @param {RenderControllerInput} input
 */
export function createRenderController({
    data,
    ui,
    isAllFormatsSelected,
    resultDisplayBatchSize = 48,
    callbacks
}: RenderControllerInput) {
    const searchUiState = ui.search;
    const playbackUi = ui.playback;
    const renderUi = ui.render;
    const updateThumbnail = callbacks.updateThumbnail;
    const extractYoutubeInfo = callbacks.extractYoutubeInfo;
    const playThumbnail = callbacks.playThumbnail;
    const restoreActivePlayback = callbacks.restoreActivePlayback;
    const openBookmarkModal = callbacks.openBookmarkModal;
    const setupScrollObserver = callbacks.setupScrollObserver;
    const removeSongFromActiveBookmark = callbacks.removeSongFromActiveBookmark;
    const saveBookmarks = callbacks.saveBookmarks;
    const notifyBookmarkSaveError = callbacks.notifyBookmarkSaveError;
    const displayBatchSize = Number.isFinite(resultDisplayBatchSize) && resultDisplayBatchSize > 0
        ? Math.max(1, Math.floor(resultDisplayBatchSize))
        : DEFAULT_RESULT_DISPLAY_BATCH_SIZE;
    const dragReorderController = createBookmarkDragReorderController({
        data,
        getBookmarkSongRef: (row) => getBookmarkSongRef(row),
        saveBookmarks,
        onSaveFailure: notifyBookmarkSaveError,
        updateDisplay: () => updateDisplay()
    });
    const resultTailObservationController = createResultTailObserver({
        getSentinel: () => ui.el.resultTailSentinel,
        hasMoreResults,
        extendDisplayedResults
    });

    /**
     * 結果カードを構成するDOM要素一式を生成する。
     * @returns {RenderCardEntry}
     */
    function createCardElements() {
        const card = document.createElement("li");
        card.className = "song-card";
        card.draggable = false;

        const thumbDiv = document.createElement("div");
        thumbDiv.className = "thumb";
        suppressYoutubeThumbnailContextMenu(thumbDiv);

        const content = document.createElement("article");
        content.className = "content";

        const titleHeading = document.createElement("h2");
        titleHeading.className = "title-heading";

        const title = document.createElement("a");
        title.className = "title";

        const artist = document.createElement("div");
        artist.className = "artist";

        const footer = document.createElement("div");
        footer.className = "card-footer";

        const leftGroup = document.createElement("div");
        leftGroup.className = "footer-left";
        const date = document.createElement("span");
        leftGroup.append(date);

        const rightGroup = document.createElement("div");
        rightGroup.className = "footer-right";

        const tags = document.createElement("div");
        tags.className = "footer-tags";

        const actionBtn = document.createElement("button");
        actionBtn.type = "button";

        const dragHandle = document.createElement("div");
        dragHandle.className = "drag-handle";
        dragHandle.innerHTML = "⠿";
        dragHandle.hidden = true;
        dragHandle.draggable = false;

        dragHandle.addEventListener("dragstart", dragReorderController.onDragStart);
        dragHandle.addEventListener("dragend", dragReorderController.onDragEnd);
        card.addEventListener("dragover", dragReorderController.onDragOver);
        card.addEventListener("dragleave", dragReorderController.onDragLeave);
        card.addEventListener("drop", dragReorderController.onDrop);

        rightGroup.append(tags, actionBtn);
        footer.append(leftGroup, rightGroup);
        titleHeading.append(title);
        content.append(dragHandle, titleHeading, artist, footer);
        card.append(thumbDiv, content);

        return { card, thumbDiv, content, titleHeading, titleEl: title, artistEl: artist, dateEl: date, tagsEl: tags, actionBtn, dragHandle };
    }

    /**
     * 曲データをカード要素へ反映し、アクションボタンの挙動を設定する。
     * @param {RenderCardEntry} entry
     * @param {Song} row
     * @param {number} resultIndex
     */
    function updateCardFromRow(entry, row, resultIndex) {
        const bookmarkSongRef = getBookmarkSongRef(row);
        const yt = buildYoutubeTarget(row);
        const titleId = `result-title-${resultIndex + 1}`;
        entry.titleHeading.setAttribute("id", titleId);
        entry.content.setAttribute("aria-labelledby", titleId);
        updateThumbnail(entry.thumbDiv, yt);
        updateTitleLink(entry.titleEl, row);
        entry.artistEl.textContent = row.artist || "不明";
        entry.dateEl.textContent = row.date;
        updateFooterTags(entry.tagsEl, row);

        const isBookmarkActive = !!data.activeBookmark;
        const btn = entry.actionBtn;

        if (isBookmarkActive) {
            btn.textContent = "×";
            btn.className = "remove-from-bookmark-btn";
            btn.setAttribute("aria-label", "ブックマークから削除");
            btn.setAttribute("title", "ブックマークから削除");
            btn.onclick = () => {
                removeSongFromActiveBookmark(bookmarkSongRef);
            };
        } else {
            btn.textContent = "+";
            btn.className = "add-to-bookmark-btn";
            btn.setAttribute("aria-label", "ブックマークに追加");
            btn.setAttribute("title", "ブックマークに追加");
            btn.onclick = () => {
                openBookmarkModal(bookmarkSongRef);
            };
        }
    }

    /**
     * 曲行からサムネイル/埋め込み再生に必要な YouTube 情報を組み立てる。
     * @param {Song} row
     * @returns {YoutubeTarget}
     */
    function buildYoutubeTarget(row) {
        const extracted = extractYoutubeInfo(row.url);
        return {
            ...extracted,
            endSeconds: row.endSeconds,
            isVertical: row.videoOrientation
                ? row.videoOrientation === "vertical"
                : extracted.isVertical
        };
    }

    /**
     * タイトル表示とリンク属性を更新する。
     * @param {HTMLAnchorElement} titleEl
     * @param {Song} row
     */
    function updateTitleLink(titleEl, row) {
        titleEl.textContent = row.title || "無題";
        if (row.url) {
            titleEl.classList.add("title-link");
            titleEl.setAttribute("href", row.url);
            titleEl.setAttribute("target", "_blank");
            titleEl.setAttribute("rel", "noopener noreferrer");
        } else {
            titleEl.classList.remove("title-link");
            titleEl.removeAttribute("href");
            titleEl.removeAttribute("target");
            titleEl.removeAttribute("rel");
        }
    }

    /**
     * 形式・コラボ・リレー・ハモリのタグ表示を更新する。
     * @param {Element} tags
     * @param {{ format?: string, streamRole?: string, isRelay?: boolean, isHarmony?: boolean }} row
     */
    function updateFooterTags(tags, row) {
        tags.replaceChildren();
        if (row.format) {
            const fmt = document.createElement("span");
            fmt.className = "tag";
            fmt.textContent = row.format;
            tags.appendChild(fmt);
        }
        if (hasStreamRole(row.streamRole)) {
            const collab = document.createElement("span");
            collab.className = "tag tag-collab";
            collab.textContent = "コラボ";
            tags.appendChild(collab);
        }
        if (row.isRelay) {
            const relay = document.createElement("span");
            relay.className = "tag tag-relay";
            relay.textContent = "リレー";
            tags.appendChild(relay);
        }
        if (row.isHarmony) {
            const harmony = document.createElement("span");
            harmony.className = "tag tag-harmony";
            harmony.textContent = "ハモリ";
            tags.appendChild(harmony);
        }
    }

    /**
     * 空結果表示用のメッセージ要素を生成する。
     * @param {string} message
     * @returns {HTMLLIElement}
     */
    function createEmptyStateElement(message) {
        const empty = document.createElement("li");
        empty.className = "result-empty-state";
        empty.textContent = message;
        return empty;
    }

    /**
     * 現在状態に応じた空結果メッセージ種別を決定する。
     * @returns {EmptyStateDescriptor}
     */
    function getEmptyStateDescriptor(): EmptyStateDescriptor {
        if (!searchUiState.dataReady) {
            return { kind: "loading", message: "読み込み中..." };
        }
        if (!isAllFormatsSelected() && searchUiState.selectedFormats.size === 0) {
            return { kind: "error", message: "動画の種類を選択してください" };
        }
        return { kind: "empty", message: "見つかりませんでした" };
    }

    /**
     * 追加表示できる検索結果が残っているかを返す。
     * @returns {boolean}
     */
    function hasMoreResults(): boolean {
        return data.currentResults.length > data.displayLimit;
    }

    /**
     * 表示上限を結果件数の範囲に丸める。
     * @param {number} limit
     * @returns {number}
     */
    function clampDisplayLimit(limit: number): number {
        if (!Number.isFinite(limit)) return data.displayLimit;
        return Math.max(0, Math.min(data.currentResults.length, Math.floor(limit)));
    }

    /**
     * 表示上限を指定値まで広げ、変更があれば再描画する。
     * @param {number} nextLimit
     * @returns {boolean}
     */
    function extendDisplayLimitTo(nextLimit: number): boolean {
        const clampedLimit = clampDisplayLimit(nextLimit);
        if (clampedLimit <= data.displayLimit) return false;
        data.displayLimit = clampedLimit;
        updateDisplay();
        return true;
    }

    /**
     * 次の表示 batch 分だけ検索結果を追加表示する。
     * @returns {boolean}
     */
    function extendDisplayedResults(): boolean {
        return extendDisplayLimitTo(data.displayLimit + displayBatchSize);
    }

    /**
     * 曲キーに対応する描画エントリを返す。
     * @param {string} songKey
     * @returns {RenderCardEntry | null}
     */
    function getCardEntryBySongKey(songKey) {
        if (!songKey) return null;
        return renderUi.cardEntriesBySongKey.get(songKey) || null;
    }

    /**
     * 指定インデックスの曲が表示範囲外なら、表示上限を広げて描画する。
     * @param {number} index
     */
    function ensureResultVisible(index) {
        if (!Number.isFinite(index) || index < 0) return;
        if (index < data.displayLimit) return;
        const nextLimit = Math.ceil((index + 1) / displayBatchSize) * displayBatchSize;
        extendDisplayLimitTo(nextLimit);
    }

    /**
     * 曲キーに対応するカードを必要に応じて描画し、再生開始する。
     * @param {string} songKey
     * @returns {Promise<YoutubePlaybackStartResult>}
     */
    function playSongByKey(songKey) {
        const index = data.currentResults.findIndex((row) => row && row.songKey === songKey);
        if (index === -1) {
            return Promise.resolve(createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED));
        }
        ensureResultVisible(index);
        let entry = getCardEntryBySongKey(songKey);
        if (!entry) {
            updateDisplay();
            entry = getCardEntryBySongKey(songKey);
        }
        if (!entry) {
            return Promise.resolve(createYoutubePlaybackStartResult(YOUTUBE_PLAYBACK_START_STATUS.FAILED));
        }
        return Promise.resolve(playThumbnail(entry.thumbDiv, buildYoutubeTarget(data.currentResults[index]), {
            playbackMode: "autoplay"
        }))
            .then((playbackResult) => playbackResult);
    }

    /**
     * 指定曲のカードが見える位置まで、固定ヘッダーを避けてスクロールする。
     * @param {string} songKey
     */
    function scrollSongIntoView(songKey) {
        const entry = getCardEntryBySongKey(songKey);
        if (!entry) return;
        scheduleScrollElementIntoView(entry.card, {
            topOffset: getHeaderHeight(),
            behavior: "smooth",
            force: true
        });
    }

    /**
     * 空結果UIを描画し、再生状態と末尾監視をリセットする。
     * @param {HTMLElement} container
     */
    function renderEmptyResults(container) {
        restoreActivePlayback();
        const emptyState = getEmptyStateDescriptor();
        container.replaceChildren(createEmptyStateElement(emptyState.message));
        container.style.height = "";
        resultTailObservationController.disconnect();
    }

    /**
     * 描画更新前のアクティブカード・再生状態を収集する。
     * @param {HTMLElement} container
     * @param {HTMLElement[]} nodes
     * @returns {ActiveCardRenderState}
     */
    function collectActiveCardRenderState(container: HTMLElement, nodes: HTMLElement[]): ActiveCardRenderState {
        const activeThumb = playbackUi.activeThumb;
        const activeCard = activeThumb ? activeThumb.closest(".song-card") : null;
        const activeCardElement = activeCard instanceof HTMLElement ? activeCard : null;
        const isActiveCardInNextNodes =
            activeCardElement !== null &&
            container.contains(activeCardElement) &&
            nodes.includes(activeCardElement);
        const hasEmbeddedPlayer = Boolean(activeThumb && activeThumb.querySelector("iframe"));
        return { activeThumb, activeCard: activeCardElement, isActiveCardInNextNodes, hasEmbeddedPlayer };
    }

    /**
     * アクティブ再生カードが次表示に含まれない場合は再生を停止する。
     * @param {ActiveCardRenderState} activeState
     */
    function stopActivePlaybackIfHidden(activeState: ActiveCardRenderState) {
        if (!activeState.activeThumb) return;
        if (activeState.isActiveCardInNextNodes) return;
        tracePlayback("render", "stopActivePlaybackIfHidden", {
            activeSongKey: activeState.activeCard instanceof HTMLElement
                ? (activeState.activeCard.dataset.songKey || "")
                : "",
            hasEmbeddedPlayer: activeState.hasEmbeddedPlayer
        });
        restoreActivePlayback();
    }

    /**
     * 結果配列からカードノードを再利用しつつ構築する。
     * @param {Song[]} results
     * @returns {ResultNodeBuildResult}
     */
    function buildResultNodes(results: Song[]): ResultNodeBuildResult {
        const nextEntriesBySongKey = new Map<string, RenderCardEntry>();
        const entries = [];
        const nodes = [];
        for (let i = 0; i < results.length; i++) {
            const row = results[i];
            const rowKey = row.songKey;
            let entry = renderUi.cardEntriesBySongKey.get(rowKey);
            if (!entry) entry = createCardElements();

            entry.card.dataset.songKey = row.songKey;
            const isBookmarkActive = Boolean(data.activeBookmark);
            entry.card.draggable = false;
            entry.card.classList.remove("dragging", "drag-over");
            entry.dragHandle.hidden = !isBookmarkActive;
            entry.dragHandle.draggable = isBookmarkActive;

            updateCardFromRow(entry, results[i], i);
            nextEntriesBySongKey.set(rowKey, entry);
            entries.push(entry);
            nodes.push(entry.card);
        }
        renderUi.cardEntriesBySongKey = nextEntriesBySongKey;
        return { nodes, entries };
    }

    /**
     * 再生中カードを描画順維持対象として固定するか判定する。
     * @param {ActiveCardRenderState} activeState
     * @returns {HTMLElement | null}
     */
    function getPinnedActiveCard(activeState: ActiveCardRenderState): HTMLElement | null {
        if (!activeState.isActiveCardInNextNodes) return null;
        if (!activeState.hasEmbeddedPlayer) return null;
        return activeState.activeCard;
    }

    /**
     * 再生中カードの位置を保ったまま、結果ノードとの差分を反映する。
     * @param {HTMLElement} container
     * @param {HTMLElement[]} nodes
     * @param {HTMLElement | null} pinnedActiveCard
     */
    function reconcileNodesWithPinnedActive(container, nodes, pinnedActiveCard) {
        if (!pinnedActiveCard) return;
        const keepSet = new Set(nodes);
        Array.from(container.children).forEach((child) => {
            if (child === pinnedActiveCard) return;
            if (!(child instanceof HTMLElement) || !keepSet.has(child)) container.removeChild(child);
        });

        const pinnedIndex = nodes.indexOf(pinnedActiveCard);
        if (pinnedIndex === -1) return;

        for (let i = 0; i < pinnedIndex; i++) {
            const node = nodes[i];
            if (node !== pinnedActiveCard) {
                container.insertBefore(node, pinnedActiveCard);
            }
        }

        let anchor = null;
        for (let i = nodes.length - 1; i > pinnedIndex; i--) {
            const node = nodes[i];
            if (node === pinnedActiveCard) continue;
            container.insertBefore(node, anchor);
            anchor = node;
        }
    }

    /**
     * 結果ノード順にDOMを並べ替え、余分なノードを除去する。
     * @param {HTMLElement} container
     * @param {HTMLElement[]} nodes
     */
    function reconcileNodesByOrder(container, nodes) {
        const children = container.children;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const current = children[i];
            if (current !== node) {
                container.insertBefore(node, current || null);
            }
        }
        while (container.children.length > nodes.length) {
            const last = container.lastElementChild;
            if (!last) break;
            container.removeChild(last);
        }
    }

    /**
     * 再生状態を考慮した方法で結果ノードをDOMへ反映する。
     * @param {HTMLElement} container
     * @param {HTMLElement[]} nodes
     */
    function reconcileResultNodes(container, nodes) {
        const activeState = collectActiveCardRenderState(container, nodes);
        stopActivePlaybackIfHidden(activeState);
        const pinnedActiveCard = getPinnedActiveCard(activeState);
        if (pinnedActiveCard) {
            reconcileNodesWithPinnedActive(container, nodes, pinnedActiveCard);
            return;
        }
        reconcileNodesByOrder(container, nodes);
    }

    /**
     * DOM順を列固定で保ちつつカードを絶対配置する。
     * 同じ列のカードだけが上下に影響し、他列の位置は維持される。
     */
    function refreshLayout() {
        applyMasonryLayout(ui.el.resultList);
    }

    /**
     * 表示中カードのサムネイルをIntersectionObserverへ登録する。
     * @param {RenderCardEntry[]} entries
     */
    function observeVisibleThumbnails(entries) {
        if (!playbackUi.showThumbnails || !playbackUi.scrollObserver) return;
        for (const entry of entries) {
            playbackUi.scrollObserver.observe(entry.thumbDiv);
        }
    }

    /**
     * 描画に必要なコンテナ・結果・モード情報をまとめる。
     * @returns {DisplayState}
     */
    function collectDisplayState(): DisplayState {
        return {
            container: ui.el.resultList,
            results: data.currentResults.slice(0, data.displayLimit)
        };
    }

    /**
     * 描画前に監視状態を初期化し、必要なら監視を再設定する。
     */
    function prepareDisplayObservation() {
        if (playbackUi.scrollObserver) playbackUi.scrollObserver.disconnect();
        if (playbackUi.showThumbnails && !playbackUi.scrollObserver) setupScrollObserver();
    }

    /**
     * 表示状態に応じて空結果または結果カードを描画する。
     * @param {DisplayState} displayState
     * @returns {RenderedDisplayState | null}
     */
    function renderDisplayState(displayState: DisplayState): RenderedDisplayState | null {
        const { container, results } = displayState;
        if (results.length === 0) {
            renderEmptyResults(container);
            return null;
        }
        const { nodes, entries } = buildResultNodes(results);
        reconcileResultNodes(container, nodes);
        refreshLayout();
        return { entries };
    }

    /**
     * 描画後のサムネイル監視と末尾監視を更新する。
     * @param {RenderedDisplayState} rendered
     */
    function monitorDisplayState(rendered: RenderedDisplayState) {
        observeVisibleThumbnails(rendered.entries);
        resultTailObservationController.observe();
    }

    /**
     * 収集・描画・監視更新までの表示更新パイプラインを行う。
     */
    function updateDisplay() {
        tracePlayback("render", "updateDisplay", undefined);
        const displayState = collectDisplayState();
        prepareDisplayObservation();
        const rendered = renderDisplayState(displayState);
        if (!rendered) return;
        monitorDisplayState(rendered);
    }

    return {
        playSongByKey,
        scrollSongIntoView,
        updateDisplay,
        refreshLayout
    };
}
