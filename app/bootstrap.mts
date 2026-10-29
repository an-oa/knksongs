/**
 * アプリの composition root。
 *
 * 各 controller と UI の factory を生成して相互に配線し、起動時の初期化
 * (DOM 参照の収集・UI セットアップ・保存状態の復元・曲データ読み込み・初回検索)を行う。
 * 依存先は、状態と定数の ./state.mjs、検索・描画・再生・保存の ./controllers/*、
 * 画面部品 (サイドバー・ブックマークなど) と曲データ読込の ./ui/*。
 *
 * 検索・描画・再生の実処理は各 controller 側にあり、ここでは持たない。
 * controller 同士の循環参照は、getXxxController のような遅延 getter や null 初期化の let 変数で解く。
 */
import {
    RANDOM_DISPLAY_COUNT,
    MIN_PERFORMANCE_FOR_RANDOM,
    RESULT_DISPLAY_BATCH_SIZE,
    DEFAULT_FORMATS,
    SEARCH_STATE_KEY,
    BOOKMARK_STORAGE_KEY,
    BOOKMARK_STORAGE_VERSION,
    MAX_BOOKMARK_COUNT,
    MAX_SONGS_PER_BOOKMARK,
    MAX_BOOKMARK_NAME_LENGTH,
    UI_SYNC_PASSES,
    SEARCH_DEBOUNCE_MS,
    YT_IFRAME_API_SRC,
    YT_IFRAME_API_SELECTOR,
    YT_IFRAME_READY_POLL_MS,
    appState
} from "./state.mjs";
import { initialSongsSnapshot } from "./startup-data.mjs";
import { createSearchController } from "./controllers/search.mjs";
import { createSearchCoordinator } from "./controllers/search-coordinator.mjs";
import { createRenderController } from "./controllers/render.mjs";
import { createPlaybackSessionController } from "./controllers/playback-session.mjs";
import { createPlaybackSettingsController } from "./controllers/playback-settings.mjs";
import { createYoutubeController, extractYoutubeInfo } from "./controllers/youtube.mjs";
import { createBookmarkPersistenceController } from "./controllers/bookmark-persistence.mjs";
import { createStorageController } from "./controllers/storage.mjs";
import { createBookmarkUiController } from "./ui/bookmark/ui.mjs";
import { createBookmarkTransferController } from "./ui/bookmark/transfer.mjs";
import { isIOSWebKit } from "./lib/dom-utils.mjs";
import { scrollResultListToTop } from "./lib/results-scroll.mjs";
import {
    countSongCardsScrolledPast,
    countSongCardsToKeep,
    estimateInitialResultDisplayCount,
    estimateMasonryVisibleCardCount
} from "./lib/render/masonry-layout.mjs";
import { setupResultsViewportRefresh } from "./lib/render/results-viewport-refresh.mjs";
import {
    collectUiElements,
    applyThemeFromStorage,
    setupTheme
} from "./ui/core/elements.mjs";
import { createUiSyncController } from "./ui/core/sync.mjs";
import { createSiteLanguageController } from "./ui/core/site-language.mjs";
import type { SiteLanguage } from "./lib/site-language.mjs";
import { createResultCountController } from "./ui/result-summary/count.mjs";
import { applyStaticUiText } from "./ui/core/static-text.mjs";
import { createDataLoader } from "./ui/core/data.mjs";
import { createDateFilterController } from "./ui/date/filter.mjs";
import { createSearchUiActions } from "./ui/core/search-actions.mjs";
import { createSidebarController } from "./ui/sidebar/ui.mjs";
import { createAutoHideHeaderController } from "./ui/header/auto-hide.mjs";
import { createSearchFiltersController } from "./ui/search-filters/controller.mjs";
import { createResultSummaryController } from "./ui/result-summary/controller.mjs";
import { debugPlayback } from "./lib/playback-debug.mjs";
import type {
    AppDataState,
    AppUiState,
    AppYoutubeRuntimeState
} from "./state.types";

type SearchCallbacksInput = {
    getRenderController: () => ReturnType<typeof createRenderController>;
    getResultSummaryController: () => ReturnType<typeof createResultSummaryController>;
    resultCountController: ReturnType<typeof createResultCountController>;
    ui: AppUiState;
};

type RenderCallbacksInput = {
    getYoutubeController: () => ReturnType<typeof createYoutubeController>;
    getSidebarController: () => ReturnType<typeof createSidebarController>;
    getStorageController: () => ReturnType<typeof createStorageController>;
    getBookmarkUiController: () => ReturnType<typeof createBookmarkUiController> | null;
};

type StorageCallbacksInput = {
    getRenderController: () => ReturnType<typeof createRenderController>;
    dateFilterController: ReturnType<typeof createDateFilterController>;
    searchCoordinator: ReturnType<typeof createSearchCoordinator>;
    getBookmarkUiController: () => ReturnType<typeof createBookmarkUiController> | null;
};

type BookmarkUiCallbacksInput = {
    storageController: ReturnType<typeof createStorageController>;
    getSidebarController: () => ReturnType<typeof createSidebarController>;
};

type YoutubePlaybackHooksInput = {
    youtubeController: ReturnType<typeof createYoutubeController>;
    renderController: ReturnType<typeof createRenderController>;
    playbackSessionController: ReturnType<typeof createPlaybackSessionController>;
};

const appDataState: AppDataState = appState.data;

const appUiState: AppUiState = appState.ui;
const searchUiState = appUiState.search;
const youtubeRuntimeState: AppYoutubeRuntimeState = appState.youtube;

/**
 * 検索 controller から描画更新へ委譲する callback 群を作成する。
 */
function createSearchCallbacks({
    getRenderController,
    getResultSummaryController,
    resultCountController,
    ui
}: SearchCallbacksInput): Parameters<typeof createSearchController>[0]["callbacks"] {
    return {
        updateDisplay: () => getRenderController().updateDisplay(),
        showResultCount: (summary) => resultCountController.show({ kind: "results", summary }),
        onResultsApplied: () => getResultSummaryController().render(),
        scrollResultsPaneToTop: () => scrollResultListToTop(ui.el.resultList),
        getInitialDisplayCount: (defaultCount) => estimateInitialResultDisplayCount(ui.el.resultList, {
            defaultCount,
            showThumbnails: ui.playback.showThumbnails
        }),
        getRecommendedDisplayCount: () => estimateMasonryVisibleCardCount(ui.el.resultList, {
            minItemCount: RANDOM_DISPLAY_COUNT
        }),
        getScrolledPastResultCount: () => countSongCardsScrolledPast(ui.el.resultList),
        getResultCountToKeep: () => countSongCardsToKeep(ui.el.resultList, {
            requiredElement: ui.playback.activeThumb
        })
    };
}

/**
 * 描画 controller から YouTube・サイドバー・保存・ブックマーク UI へ委譲する callback 群を作成する。
 * controller 生成順の循環を避けるため、後続 controller は呼び出し時に getter で解決する。
 */
function createRenderCallbacks({
    getYoutubeController,
    getSidebarController,
    getStorageController,
    getBookmarkUiController
}: RenderCallbacksInput): Parameters<typeof createRenderController>[0]["callbacks"] {
    return {
        updateThumbnail: (thumbDiv, yt) => getYoutubeController().updateThumbnail(thumbDiv, yt),
        extractYoutubeInfo,
        playThumbnail: (thumbDiv, yt, options) => getYoutubeController().playThumbnail(thumbDiv, yt, options),
        restoreActivePlayback: () => getYoutubeController().restoreActivePlayback(),
        openBookmarkModal: (songKey) => getSidebarController().openBookmarkModal(songKey),
        removeSongFromActiveBookmark: (songKey) => {
            const bookmarkUiController = getBookmarkUiController();
            if (bookmarkUiController) bookmarkUiController.removeSongFromActiveBookmark(songKey);
        },
        moveSongInActiveBookmark: (fromSongKey, toSongKey) => getStorageController().moveSongInActiveBookmark(fromSongKey, toSongKey),
        notifyBookmarkSaveError: (result) => {
            const bookmarkUiController = getBookmarkUiController();
            if (bookmarkUiController) bookmarkUiController.notifyBookmarkSaveError(result);
        }
    };
}

/**
 * storage controller から日付・検索実行・ブックマーク UI へ委譲する callback 群を作成する。
 */
function createStorageCallbacks({
    getRenderController,
    dateFilterController,
    searchCoordinator,
    getBookmarkUiController
}: StorageCallbacksInput): Parameters<typeof createStorageController>[0]["callbacks"] {
    return {
        getDateSelectValue: (kind) => dateFilterController.getDateSelectValue(kind),
        applyPendingDateValues: () => dateFilterController.applyPendingDateValues(),
        updateDisplay: () => getRenderController().updateDisplay(),
        renderBookmarks: () => {
            const bookmarkUiController = getBookmarkUiController();
            if (bookmarkUiController) bookmarkUiController.renderBookmarks();
        },
        cancelScheduledSearch: () => searchCoordinator.cancelScheduledSearch(),
        scheduleSearch: (options) => searchCoordinator.scheduleSearch(options)
    };
}

/**
 * ブックマーク UI controller から状態管理とサイドバーへ委譲する callback 群を作成する。
 */
function createBookmarkUiCallbacks({
    storageController,
    getSidebarController
}: BookmarkUiCallbacksInput): Parameters<typeof createBookmarkUiController>[0]["callbacks"] {
    return {
        onSelectActiveBookmark: (bookmarkId) => storageController.selectActiveBookmark(bookmarkId),
        onClearActiveBookmark: () => storageController.clearActiveBookmark(),
        onAddSongToBookmark: (bookmarkId, songKey) => storageController.addSongToBookmark(bookmarkId, songKey),
        onCreateBookmark: (bookmarkName) => storageController.createBookmark(bookmarkName),
        onCreateBookmarkAndAdd: (bookmarkName, songKey) => storageController.createBookmarkAndAdd(bookmarkName, songKey),
        onDeleteBookmark: (bookmarkId) => storageController.deleteBookmark(bookmarkId),
        onRenameBookmark: (bookmarkId, newName) => storageController.renameBookmark(bookmarkId, newName),
        onRemoveSongFromBookmark: (bookmarkId, songKey) => storageController.removeSongFromBookmark(bookmarkId, songKey),
        onRequestCloseSidebar: () => getSidebarController().closeSidebarMenu()
    };
}

/**
 * YouTube 再生イベントを描画更新と連続再生セッションへ接続する。
 */
function wireYoutubePlaybackHooks({
    youtubeController,
    renderController,
    playbackSessionController
}: YoutubePlaybackHooksInput): void {
    youtubeController.setLayoutHook(() => renderController.refreshLayout());
    youtubeController.setPlaybackEndedHook(({ songKey }) => {
        debugPlayback("script", "continuePlayback requested from playback ended", {
            songKey
        });
        playbackSessionController.continuePlayback(songKey);
    });
    youtubeController.setPlaybackStartFailedHook(({ songKey, playbackMode, wasPlaybackStartUnconfirmed }) => {
        debugPlayback("script", "playback start failed hook received", {
            songKey,
            playbackMode,
            wasPlaybackStartUnconfirmed: Boolean(wasPlaybackStartUnconfirmed)
        });
        if (playbackMode !== "manual" && !wasPlaybackStartUnconfirmed) return;
        debugPlayback("script", wasPlaybackStartUnconfirmed
            ? "continuePlayback requested from unconfirmed playback start failure"
            : "continuePlayback requested from manual playback start failure", {
            songKey
        });
        playbackSessionController.continuePlayback(songKey);
    });
}

/**
 * アプリ controller 群を作成し、相互 callback を同じ composition 境界内で配線する。
 */
function createAppControllers() {
    /**
     * 形式フィルタの選択状態を appUiState.search.selectedFormats と同期する controller。
     * DEFAULT_FORMATS を基準に、検索条件の収集・復元・リセットから参照される。
     */
    const searchFiltersController = createSearchFiltersController({
        ui: appUiState,
        defaultFormats: DEFAULT_FORMATS
    });

    /**
     * 日付選択肢と選択中の期間を、検索処理とデータ更新処理から共有する controller。
     */
    const dateFilterController = createDateFilterController({
        ui: appUiState,
        onDateSelectionChange: () => searchUiActions.markFilterTouched({ immediate: true })
    });

    /**
     * 結果一覧の上の件数表示を書く controller。読み込みと検索は状態を渡すだけにし、文言はここで今の言語にする。
     */
    const resultCountController = createResultCountController({ ui: appUiState });

    /**
     * 検索 UI から条件を読み取り、表示対象の曲配列を appDataState.currentResults へ反映する controller。
     * 描画更新は renderController へ委譲し、結果リストのスクロール位置もここで揃える。
     */
    const searchController = createSearchController({
        data: appDataState,
        ui: appUiState,
        searchFiltersController,
        dateFilterController,
        constants: {
            RANDOM_DISPLAY_COUNT,
            MIN_PERFORMANCE_FOR_RANDOM,
            RESULT_DISPLAY_BATCH_SIZE
        },
        callbacks: createSearchCallbacks({
            getRenderController: () => renderController,
            getResultSummaryController: () => resultSummaryController,
            resultCountController,
            ui: appUiState
        })
    });

    /**
     * bookmarkUiController は生成前に呼ばれる描画callbackでも参照するため、nullで初期化する。
     */
    let bookmarkUiController: ReturnType<typeof createBookmarkUiController> | null = null;

    /**
     * appDataState.currentResults を DOM の検索結果カードへ反映する controller。
     * サムネイル再生、ブックマーク操作、カード再利用用キャッシュとの接続点もここに集約する。
     */
    const renderController = createRenderController({
        data: appDataState,
        ui: appUiState,
        isAllFormatsSelected: () => searchController.areAllFormatsSelected(),
        resultDisplayBatchSize: RESULT_DISPLAY_BATCH_SIZE,
        callbacks: createRenderCallbacks({
            getYoutubeController: () => youtubeController,
            getSidebarController: () => sidebarController,
            getStorageController: () => storageController,
            getBookmarkUiController: () => bookmarkUiController
        })
    });

    /**
     * 現在の検索結果と再生設定をもとに、連続再生や次曲送りのセッションを管理する controller。
     */
    const playbackSessionController = createPlaybackSessionController({
        data: appDataState,
        ui: appUiState,
        callbacks: {
            playSongByKey: (songKey) => renderController.playSongByKey(songKey),
            scrollSongIntoView: (songKey) => renderController.scrollSongIntoView(songKey)
        }
    });

    /**
     * サムネイル表示や連続再生など、再生設定 UI と保存値の同期を扱う controller。
     */
    const playbackSettingsController = createPlaybackSettingsController({
        ui: appUiState,
        callbacks: {
            ensureThumbnailPlaybackReady: () => youtubeController.ensureThumbnailPlaybackReady(),
            restoreActivePlayback: () => youtubeController.restoreActivePlayback(),
            updateDisplay: () => renderController.updateDisplay()
        }
    });

    /**
     * YouTube IFrame API の読み込み、サムネイル埋め込み、共有プレーヤー状態を扱う controller。
     */
    const youtubeController = createYoutubeController({
        ui: appUiState,
        youtube: youtubeRuntimeState,
        constants: {
            YT_IFRAME_API_SRC,
            YT_IFRAME_API_SELECTOR,
            YT_IFRAME_READY_POLL_MS
        }
    });

    /**
     * ブックマーク本体の永続化と、曲データ反映後の旧参照移行を扱う controller。
     * DataLoader より先に生成し、曲データの取得・反映と保存処理の生成順を分離する。
     */
    const bookmarkPersistenceController = createBookmarkPersistenceController({
        data: appDataState,
        constants: {
            storageKey: BOOKMARK_STORAGE_KEY,
            storageVersion: BOOKMARK_STORAGE_VERSION
        }
    });

    /**
     * 初期曲データを appDataState へ反映する loader。
     */
    const dataLoader = createDataLoader({
        data: appDataState,
        ui: appUiState,
        dataSource: { loadInitialSnapshot: () => initialSongsSnapshot },
        callbacks: {
            applyDateInputRange: (songs) => dateFilterController.applyDateInputRange(songs),
            clampDateInputsToBounds: (minKey, maxKey) => dateFilterController.clampDateInputsToBounds(minKey, maxKey),
            showResultCount: (state) => resultCountController.show(state)
        }
    });

    /**
     * 検索の即時実行とデバウンスを調整する coordinator。
     */
    const searchCoordinator = createSearchCoordinator({
        debounceMs: SEARCH_DEBOUNCE_MS,
        searchController
    });

    /**
     * localStorage 上の検索状態・ブックマーク保存データを読み書きする controller。
     * ブックマークの操作、インポート/エクスポート、保存後の再描画をまとめて扱う。
     */
    const storageController: ReturnType<typeof createStorageController> = createStorageController({
        data: appDataState,
        ui: appUiState,
        searchFiltersController,
        bookmarkPersistenceController,
        constants: {
            SEARCH_STATE_KEY,
            DEFAULT_FORMATS,
            BOOKMARK_STORAGE_VERSION,
            MAX_BOOKMARK_COUNT,
            MAX_SONGS_PER_BOOKMARK,
            MAX_BOOKMARK_NAME_LENGTH
        },
        callbacks: createStorageCallbacks({
            getRenderController: () => renderController,
            dateFilterController,
            searchCoordinator,
            getBookmarkUiController: () => bookmarkUiController
        })
    });

    /**
     * ブックマークパネルの表示、一覧の選択・作成・名前の変更・削除などのユーザー操作を扱う controller。
     * 永続化の実処理は storageController へ委譲する。
     */
    bookmarkUiController = createBookmarkUiController({
        data: appDataState,
        ui: appUiState,
        callbacks: createBookmarkUiCallbacks({
            storageController,
            getSidebarController: () => sidebarController
        })
    });

    /**
     * ブックマークパネルのエクスポート・インポートを扱う controller。
     * 書き出す・取り込むブックマークをダイアログで選ばせ、保存の実処理は storageController へ委譲する。
     */
    const bookmarkTransferController = createBookmarkTransferController({
        data: appDataState,
        ui: appUiState,
        callbacks: {
            onExportBookmarks: (bookmarkIds) => storageController.exportBookmarksAsJsonText(bookmarkIds),
            onPreviewBookmarkImport: (text) => storageController.previewBookmarkImport(text),
            onImportSelectedBookmarks: (text, bookmarkIds) =>
                storageController.importSelectedBookmarksFromJsonText(text, bookmarkIds),
            onReplaceAllBookmarks: (text) => storageController.replaceAllBookmarksFromJsonText(text)
        }
    });

    /**
     * ページスクロール方向とサイドバー表示状態に応じてヘッダー表示を管理する controller。
     */
    const autoHideHeaderController = createAutoHideHeaderController({
        ui: appUiState,
        isSidebarOpen: () => sidebarController.isOpen()
    });

    /**
     * 日付入力、検索実行、保存を明示的な依存として受け取り、検索 UI 操作を束ねる。
     */
    const searchUiActions = createSearchUiActions({
        ui: appUiState,
        search: searchUiState,
        searchFiltersController,
        dateFilterController,
        searchCoordinator,
        storageController
    });

    /**
     * サイドバー全体の開閉、設定パネル、ブックマークパネルを扱う controller。
     */
    const sidebarController: ReturnType<typeof createSidebarController> = createSidebarController({
        ui: appUiState,
        bookmarkUiController,
        callbacks: {
            onOpenChange: autoHideHeaderController.handleSidebarOpenChange
        }
    });

    /**
     * 結果一覧の上に適用中の検索条件を表示し、チップからの個別解除と一括解除を扱う controller。
     */
    const resultSummaryController = createResultSummaryController({
        ui: appUiState,
        conditions: {
            getQuery: () => appUiState.el.searchBox?.value ?? "",
            getDateValue: (kind) => dateFilterController.getDateSelectValue(kind),
            getSelectedFormats: () => DEFAULT_FORMATS.filter((format) => searchUiState.selectedFormats.has(format)),
            areAllFormatsSelected: () => searchFiltersController.areAllFormatsSelected(),
            isBooleanFilterEnabled: (key) => appUiState.el[key]?.checked === true,
            isBookmarkActive: () => appDataState.activeBookmark !== null
        },
        actions: {
            clearSearchQuery: searchUiActions.clearSearchQuery,
            clearDateFilter: searchUiActions.clearDateFilter,
            resetFormatFilters: searchUiActions.resetFormatFilters,
            clearBooleanFilter: searchUiActions.clearBooleanFilter,
            clearSearch: searchUiActions.clearSearch
        }
    });

    /**
     * 描画済みの文言を今の言語で描き直す。検索はやり直さないので、結果やおすすめの選曲は変わらない。
     */
    function refreshLanguageDependentText(): void {
        renderController.refreshText();
        resultSummaryController.render();
        searchFiltersController.refreshFormatLabels();
        dateFilterController.refreshDateSelectPlaceholders();
        searchUiActions.refreshQueryValidationMessage();
        youtubeController.refreshCloseButtonLabel();
        bookmarkUiController?.renderBookmarks();
    }

    /**
     * index.html の固定の文言と件数表示を、指定した言語で書く。件数表示は描画済みの状態から作り直す。
     * @param language サイトの言語
     */
    function applyLanguageText(language: SiteLanguage): void {
        applyStaticUiText(document, language);
        resultCountController.render();
    }

    /**
     * サイトの言語の決定・保存・言語ボタンを扱う controller。
     */
    const siteLanguageController = createSiteLanguageController({
        ui: appUiState,
        applyStaticText: applyLanguageText,
        refreshDynamicText: refreshLanguageDependentText
    });

    /**
     * bfcache 復帰やフォーカス復帰時に、保存済み設定と検索 UI を再同期する controller。
     */
    const uiSyncController = createUiSyncController({
        uiSyncPasses: UI_SYNC_PASSES,
        syncSearchUI: searchUiActions.syncSearchUI,
        applyThemeFromStorage: () => applyThemeFromStorage({ ui: appUiState }),
        applyPlaybackSettingsFromStorage: () => playbackSettingsController.applyPlaybackSettingsFromStorage(),
        applySiteLanguageFromStorage: () => {
            // 別タブで言語を変えた場合だけ、文言を置き換えて描き直す
            if (!siteLanguageController.syncFromStorage()) return;
            applyLanguageText(appUiState.language.current);
            refreshLanguageDependentText();
        }
    });

    wireYoutubePlaybackHooks({
        youtubeController,
        renderController,
        playbackSessionController
    });

    return {
        siteLanguageController,
        searchFiltersController,
        dateFilterController,
        searchController,
        searchCoordinator,
        renderController,
        playbackSettingsController,
        storageController,
        autoHideHeaderController,
        sidebarController,
        bookmarkTransferController,
        resultSummaryController,
        uiSyncController,
        searchUiActions,
        dataLoader,
        bookmarkPersistenceController
    };
}

const {
    siteLanguageController,
    searchFiltersController,
    dateFilterController,
    searchCoordinator,
    renderController,
    playbackSettingsController,
    storageController,
    autoHideHeaderController,
    sidebarController,
    bookmarkTransferController,
    resultSummaryController,
    uiSyncController,
    searchUiActions,
    dataLoader,
    bookmarkPersistenceController
} = createAppControllers();

let resultsViewportRefreshCleanup: (() => void) | null = null;

/**
 * DOM 参照の初期化と UI 各機能のセットアップを行う。
 */
async function initUI(): Promise<void> {
    appUiState.el = collectUiElements();
    if (isIOSWebKit()) document.documentElement.classList.add("ios");
    // 以降の初期化で作る選択肢や文言が最初から今の言語になるよう、言語を先に決める
    siteLanguageController.setup();

    searchFiltersController.setupFilterOptions({
        onFilterChange: searchUiActions.markFilterTouched
    });
    autoHideHeaderController.setup();
    sidebarController.setupUIHandlers();
    bookmarkTransferController.setupTransferHandlers();
    searchUiActions.setupSearchFormHandlers();
    dateFilterController.setupDateSelectHandlers({ isIOSWebKit });
    resultSummaryController.setup();
    storageController.restorePersistedState();
    setupTheme({ ui: appUiState });
    playbackSettingsController.setupPlaybackSettings();
    exposePlaybackSettingsConsoleApi();
    uiSyncController.setupSyncEvents();
    if (resultsViewportRefreshCleanup) resultsViewportRefreshCleanup();
    resultsViewportRefreshCleanup = setupResultsViewportRefresh({
        resultList: appUiState.el.resultList,
        refreshRecommendedDisplay: () => searchCoordinator.refreshRecommendedDisplay(),
        refreshLayout: () => renderController.refreshLayout(),
        onReadingPositionRestored: () => autoHideHeaderController.resetScrollBaseline()
    });
    const initialData = await dataLoader.loadInitialData();
    if (!initialData.loaded) return;
    bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();
    if (initialData.shouldResetConditions) {
        searchUiActions.resetSearchConditions(false);
    }
    searchCoordinator.search();
}

/**
 * アプリ起動時に初期化処理を開始する。
 */
function boot(): void {
    initUI().catch(reportInitError);
}

/**
 * 初期化失敗時のエラーを記録する。
 */
function reportInitError(error: unknown): void {
    console.error("initUI failed", error);
}

// startup からの dynamic import が DOMContentLoaded 後に完了した場合も起動する。
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
    boot();
}

/**
 * Inspect の console から隠し再生設定をページ内だけで操作できる API を公開する。
 */
function exposePlaybackSettingsConsoleApi(): void {
    window.knkPlaybackSettings = playbackSettingsController.createConsoleApi();
}
