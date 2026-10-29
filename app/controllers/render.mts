/**
 * 検索結果カードの描画を担う controller。
 *
 * data.currentResults を、カード要素を再利用しながら一覧へ差分反映する。
 * 再生中のカードは位置を保ち、表示から外れたら再生を止める。
 * masonry レイアウト (../lib/render)、末尾到達での追加表示、ブックマーク内のドラッグ並べ替え、
 * 空結果の表示、言語切り替え時の文言の書き直しもここで行う。
 *
 * 表示する結果の決定は ./search.mts が行い、ここは受け取って描くだけにする。
 * 再生は ./youtube.mts、並べ替えの保存は ./storage.mts、ブックマークへの追加と削除は
 * サイドバーとブックマーク UI へ、callbacks 経由で委ねる。
 */
import { getHeaderHeight } from "../lib/dom-utils.mjs";
import { hasStreamRole } from "../lib/stream-role.mjs";
import { tracePlayback } from "../lib/playback-debug.mjs";
import { scheduleScrollElementIntoView } from "../lib/results-scroll.mjs";
import { createBookmarkDragReorderController } from "../lib/render/drag-reorder.mjs";
import type { StorageActionFailure, StorageActionResult } from "./storage.mjs";
import { applyMasonryLayout } from "../lib/render/masonry-layout.mjs";
import { createResultTailObserver } from "../lib/render/result-tail-observer.mjs";
import { getBookmarkSongRef } from "../lib/song-identity.mjs";
import { getSongDisplayArtist, getSongDisplayTitle, type SongDisplayName } from "../lib/song-display-name.mjs";
import type { SiteLanguage } from "../lib/site-language.mjs";
import { getUiText, type UiText } from "../lib/ui-text.mjs";
import {
    createYoutubePlaybackStartResult,
    YOUTUBE_PLAYBACK_START_STATUS
} from "../lib/youtube/playback-start-attempt.mjs";
import type { YoutubePlaybackMode, YoutubePlaybackStartResult } from "../lib/youtube/playback-start-attempt.mjs";
import type { YoutubeTarget } from "../lib/youtube/embed.mjs";
import { suppressYoutubeThumbnailContextMenu } from "../lib/youtube/thumbnail.mjs";
import type {
    AppDataState,
    PlaybackUiRuntimeState,
    RenderCardEntry,
    RenderUiRuntimeState,
    SearchUiRuntimeState,
    SiteLanguageUiRuntimeState
} from "../state.types";

const DEFAULT_RESULT_DISPLAY_BATCH_SIZE = 48;

type RenderUiElements = {
    resultList?: HTMLElement | null;
    resultTailSentinel?: HTMLElement | null;
};

type RenderUiState = {
    el: RenderUiElements;
    search: Pick<SearchUiRuntimeState, "dataReady" | "selectedFormats">;
    playback: Pick<PlaybackUiRuntimeState, "activeThumb">;
    render: RenderUiRuntimeState;
    language: SiteLanguageUiRuntimeState;
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

type DisplayState = {
    container: HTMLElement;
    results: Song[];
};

type RenderCallbacks = {
    updateThumbnail: (thumbDiv: HTMLElement, yt: YoutubeTarget) => void;
    extractYoutubeInfo: (url?: string) => YoutubeTarget;
    playThumbnail: (
        thumbDiv: HTMLElement,
        yt: YoutubeTarget,
        options?: { playbackMode?: YoutubePlaybackMode }
    ) => Promise<YoutubePlaybackStartResult> | YoutubePlaybackStartResult;
    restoreActivePlayback: () => void;
    openBookmarkModal: (songKey: string) => void;
    removeSongFromActiveBookmark: (songKey: string) => void;
    moveSongInActiveBookmark: (fromSongKey: string, toSongKey: string) => StorageActionResult<{ ok: true; changed: boolean }>;
    notifyBookmarkSaveError: (result: StorageActionFailure) => void;
};

type RenderControllerInput = {
    data: Pick<AppDataState, "currentResults" | "displayLimit" | "activeBookmark" | "bookmarks">;
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
    const removeSongFromActiveBookmark = callbacks.removeSongFromActiveBookmark;
    const moveSongInActiveBookmark = callbacks.moveSongInActiveBookmark;
    const notifyBookmarkSaveError = callbacks.notifyBookmarkSaveError;
    const displayBatchSize = Number.isFinite(resultDisplayBatchSize) && resultDisplayBatchSize > 0
        ? Math.max(1, Math.floor(resultDisplayBatchSize))
        : DEFAULT_RESULT_DISPLAY_BATCH_SIZE;
    const dragReorderController = createBookmarkDragReorderController({
        data,
        moveSongInActiveBookmark,
        onSaveFailure: notifyBookmarkSaveError,
        refreshDisplay: () => updateDisplay(),
        getResultList: () => ui.el.resultList ?? null
    });
    /** 並べ替えのドラッグを受けるように設定した一覧。描き直すたびに設定し直さないよう覚えておく。 */
    let reorderListenerTarget: HTMLElement | null = null;
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

        dragHandle.addEventListener("pointerdown", dragReorderController.onHandlePointerDown);

        rightGroup.append(tags, actionBtn);
        footer.append(leftGroup, rightGroup);
        titleHeading.append(title);
        content.append(dragHandle, titleHeading, artist, footer);
        card.append(thumbDiv, content);

        return { card, thumbDiv, content, titleHeading, titleEl: title, artistEl: artist, dateEl: date, tagsEl: tags, actionBtn, dragHandle };
    }

    /**
     * 曲データをカード要素へ反映し、アクションボタンの挙動を設定する。
     * 曲名などの文言は updateCardText で、今の言語で書く。
     * @param entry 反映先のカード要素
     * @param row 表示する曲
     * @param resultIndex 結果一覧での位置
     */
    function updateCardFromRow(entry: RenderCardEntry, row: Song, resultIndex: number) {
        const bookmarkSongRef = getBookmarkSongRef(row);
        const yt = buildYoutubeTarget(row);
        const titleId = `result-title-${resultIndex + 1}`;
        entry.titleHeading.setAttribute("id", titleId);
        entry.content.setAttribute("aria-labelledby", titleId);
        updateThumbnail(entry.thumbDiv, yt);
        updateTitleLinkTarget(entry.titleEl, row);

        const btn = entry.actionBtn;
        if (data.activeBookmark) {
            btn.textContent = "×";
            btn.className = "remove-from-bookmark-btn";
            btn.onclick = () => {
                removeSongFromActiveBookmark(bookmarkSongRef);
            };
        } else {
            btn.textContent = "+";
            btn.className = "add-to-bookmark-btn";
            btn.onclick = () => {
                openBookmarkModal(bookmarkSongRef);
            };
        }
        updateCardText(entry, row);
    }

    /**
     * カードの文言(曲名・アーティスト名・日付・タグ・ボタンの説明)を、今の言語で書く。
     * サムネイルやクリックの処理は触らないので、言語の切り替えではこれだけを呼べばよい。
     * @param entry 反映先のカード要素
     * @param row 表示する曲
     */
    function updateCardText(entry: RenderCardEntry, row: Song) {
        const language = ui.language.current;
        const text = getUiText(language);
        applyDisplayName(entry.titleEl, getSongDisplayTitle(row, language), text.card.untitled, language);
        applyDisplayName(entry.artistEl, getSongDisplayArtist(row, language), text.card.unknownArtist, language);
        entry.dateEl.textContent = text.card.date(row);
        updateFooterTags(entry.tagsEl, row, text);
        const actionLabel = data.activeBookmark ? text.card.removeFromBookmark : text.card.addToBookmark;
        entry.actionBtn.setAttribute("aria-label", actionLabel);
        entry.actionBtn.setAttribute("title", actionLabel);
    }

    /**
     * 曲行からサムネイル/埋め込み再生に必要な YouTube 情報を組み立てる。
     * @param {Song} row
     * @returns {YoutubeTarget}
     */
    function buildYoutubeTarget(row: Song): YoutubeTarget {
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
     * 名前を要素へ表示し、名前の言語がページの言語と違うときだけ言語タグを付ける。
     * 英語のページで英名のない曲は日本語名を出すので、その名前に lang="ja" を付ける。
     * @param el 表示先の要素
     * @param name 表示する名前とその言語
     * @param fallback 名前が空のときの表示。ページの言語で書く
     * @param pageLanguage ページの言語
     */
    function applyDisplayName(el: HTMLElement, name: SongDisplayName, fallback: string, pageLanguage: SiteLanguage) {
        el.textContent = name.text || fallback;
        if (name.text && name.lang !== pageLanguage) {
            el.setAttribute("lang", name.lang);
        } else {
            el.removeAttribute("lang");
        }
    }

    /**
     * 曲名のリンク先を更新する。曲名の文字は updateCardText で書く。
     * @param titleEl 曲名のリンク要素
     * @param row 表示する曲
     */
    function updateTitleLinkTarget(titleEl: HTMLAnchorElement, row: Song) {
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
     * @param tags タグを並べる要素
     * @param row 表示する曲
     * @param text サイトの言語の文言
     */
    function updateFooterTags(tags: Element, row: Song, text: UiText) {
        tags.replaceChildren();
        if (row.format) {
            const fmt = document.createElement("span");
            fmt.className = "tag";
            fmt.textContent = text.formatTag(row.format);
            tags.appendChild(fmt);
        }
        if (hasStreamRole(row.streamRole)) {
            const collab = document.createElement("span");
            collab.className = "tag tag-collab";
            collab.textContent = text.tags.collab;
            tags.appendChild(collab);
        }
        if (row.isRelay) {
            const relay = document.createElement("span");
            relay.className = "tag tag-relay";
            relay.textContent = text.tags.relay;
            tags.appendChild(relay);
        }
        if (row.isHarmony) {
            const harmony = document.createElement("span");
            harmony.className = "tag tag-harmony";
            harmony.textContent = text.tags.harmony;
            tags.appendChild(harmony);
        }
    }

    /**
     * 空結果表示用の要素を生成する。
     * 0件のときはゴーグルのアイコンと、条件を見直すための案内を添える。
     * @param descriptor 表示する空結果の種別と文言
     * @returns 結果一覧に置く空結果の項目
     */
    function createEmptyStateElement(descriptor: EmptyStateDescriptor) {
        const empty = document.createElement("li");
        empty.className = "result-empty-state";
        if (descriptor.kind !== "empty") {
            empty.textContent = descriptor.message;
            return empty;
        }
        const icon = document.createElement("img");
        icon.className = "result-empty-state-icon";
        icon.src = "goggles.svg";
        icon.alt = "";
        const title = document.createElement("p");
        title.className = "result-empty-state-title";
        title.textContent = descriptor.message;
        const hint = document.createElement("p");
        hint.className = "result-empty-state-hint";
        hint.textContent = getUiText(ui.language.current).results.emptyHint;
        empty.append(icon, title, hint);
        return empty;
    }

    /**
     * 現在状態に応じた空結果メッセージ種別を、サイトの言語の文言で決定する。
     * @returns 空結果の種別と文言
     */
    function getEmptyStateDescriptor(): EmptyStateDescriptor {
        const results = getUiText(ui.language.current).results;
        if (!searchUiState.dataReady) {
            return { kind: "loading", message: results.loading };
        }
        if (!isAllFormatsSelected() && searchUiState.selectedFormats.size === 0) {
            return { kind: "error", message: results.selectFormats };
        }
        return { kind: "empty", message: results.notFound };
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
    function getCardEntryBySongKey(songKey: string) {
        if (!songKey) return null;
        return renderUi.cardEntriesBySongKey.get(songKey) || null;
    }

    /**
     * 指定インデックスの曲が表示範囲外なら、表示上限を広げて描画する。
     * @param {number} index
     */
    function ensureResultVisible(index: number) {
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
    function playSongByKey(songKey: string) {
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
        }));
    }

    /**
     * 指定曲のカードが見える位置まで、固定ヘッダーを避けてスクロールする。
     * @param {string} songKey
     */
    function scrollSongIntoView(songKey: string) {
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
    function renderEmptyResults(container: HTMLElement) {
        restoreActivePlayback();
        const emptyState = getEmptyStateDescriptor();
        container.replaceChildren(createEmptyStateElement(emptyState));
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
     * @param results 表示する曲の配列
     * @returns 表示順に並べたカード要素
     */
    function buildResultNodes(results: Song[]): HTMLElement[] {
        const nextEntriesBySongKey = new Map<string, RenderCardEntry>();
        const nodes = [];
        for (let i = 0; i < results.length; i++) {
            const row = results[i];
            const rowKey = row.songKey;
            let entry = renderUi.cardEntriesBySongKey.get(rowKey);
            if (!entry) entry = createCardElements();

            entry.card.dataset.songKey = row.songKey;
            const isBookmarkActive = Boolean(data.activeBookmark);
            entry.card.draggable = false;
            // ドラッグ中に並べ替えのプレビューや続きの読み込みで描き直しても、移動元の半透明は保つ。
            entry.card.classList.toggle("dragging", isBookmarkActive && dragReorderController.isDraggingSong(rowKey));
            entry.dragHandle.hidden = !isBookmarkActive;

            updateCardFromRow(entry, results[i], i);
            nextEntriesBySongKey.set(rowKey, entry);
            nodes.push(entry.card);
        }
        renderUi.cardEntriesBySongKey = nextEntriesBySongKey;
        return nodes;
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
    function reconcileNodesWithPinnedActive(container: HTMLElement, nodes: HTMLElement[], pinnedActiveCard: HTMLElement | null) {
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

        let anchor: HTMLElement | null = null;
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
    function reconcileNodesByOrder(container: HTMLElement, nodes: HTMLElement[]) {
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
    function reconcileResultNodes(container: HTMLElement, nodes: HTMLElement[]) {
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
     * 描画に必要なコンテナ・結果・モード情報をまとめる。
     * 並べ替えのドラッグ中は、移動元を見せている位置へ移した順序で描く。保存されている順序は変えない。
     * @returns 描画先のコンテナと表示する曲。コンテナがなければ null
     */
    function collectDisplayState(): DisplayState | null {
        const container = ui.el.resultList;
        if (!container) return null;
        return {
            container,
            results: dragReorderController.orderForPreview(data.currentResults.slice(0, data.displayLimit))
        };
    }

    /**
     * 結果一覧で、並べ替えのドラッグのポインタを受けるようにする。
     * ドラッグの間は一覧がポインタをキャプチャするので、カードの間の隙間や一覧の外のイベントも一覧に届く。
     * @param container 結果カードを並べた一覧
     */
    function listenForReorderDrags(container: HTMLElement): void {
        if (reorderListenerTarget === container) return;
        reorderListenerTarget = container;
        container.addEventListener("pointermove", dragReorderController.onListPointerMove);
        container.addEventListener("pointerup", dragReorderController.onListPointerUp);
        container.addEventListener("pointercancel", dragReorderController.onListPointerCancel);
        container.addEventListener("lostpointercapture", dragReorderController.onListPointerCancel);
    }

    /**
     * 表示状態に応じて空結果または結果カードを描画する。
     * @param displayState 描画先のコンテナと表示する曲
     * @returns 結果カードを描画した場合は true、空結果を描画した場合は false
     */
    function renderDisplayState(displayState: DisplayState): boolean {
        const { container, results } = displayState;
        listenForReorderDrags(container);
        if (results.length === 0) {
            renderEmptyResults(container);
            return false;
        }
        reconcileResultNodes(container, buildResultNodes(results));
        refreshLayout();
        return true;
    }

    /**
     * 収集・描画・末尾監視の更新までの表示更新パイプラインを行う。
     */
    function updateDisplay() {
        tracePlayback("render", "updateDisplay", undefined);
        const displayState = collectDisplayState();
        if (!displayState) return;
        if (!renderDisplayState(displayState)) return;
        resultTailObservationController.observe();
    }

    /**
     * 表示中のカードと空の結果の文言を、今の言語で書き直す。言語の切り替えで使う。
     * サムネイルや再生・クリックの処理には触らず、文字の長さで高さが変わるので配置だけを計算し直す。
     */
    function refreshText() {
        const container = ui.el.resultList;
        if (!container) return;
        // 空の結果は renderEmptyResults が一覧の唯一の子として置くので、同じく一覧ごと置き換える。
        if (container.querySelector(".result-empty-state")) {
            container.replaceChildren(createEmptyStateElement(getEmptyStateDescriptor()));
            return;
        }
        for (const row of data.currentResults.slice(0, data.displayLimit)) {
            const entry = renderUi.cardEntriesBySongKey.get(row.songKey);
            if (entry) updateCardText(entry, row);
        }
        refreshLayout();
    }

    return {
        playSongByKey,
        scrollSongIntoView,
        updateDisplay,
        refreshText,
        refreshLayout
    };
}
