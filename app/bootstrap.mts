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
    STOP_PLAYBACK_ON_SCROLL_OUT,
    appState
} from "./state.mjs";
import {
    PUBLIC_SONGS_JSON_URL,
    PUBLIC_SONGS_META_URL,
    PUBLIC_CSV_URL,
    SONGS_JSON_CACHE_KEY,
    LEGACY_CSV_CACHE_KEY,
    CSV_CACHE_KEY
} from "./config.mjs";
import { createSearchController } from "./controllers/search.mjs";
import { createSearchCoordinator } from "./controllers/search-coordinator.mjs";
import { createRenderController } from "./controllers/render.mjs";
import { createPlaybackSessionController } from "./controllers/playback-session.mjs";
import { createPlaybackSettingsController } from "./controllers/playback-settings.mjs";
import { createYoutubeController, extractYoutubeInfo } from "./controllers/youtube.mjs";
import { createBookmarkPersistenceController } from "./controllers/bookmark-persistence.mjs";
import { createStorageController } from "./controllers/storage.mjs";
import { createBookmarkUiController } from "./ui/bookmark/ui.mjs";
import { scrollResultListToTop } from "./lib/results-scroll.mjs";
import { estimateMasonryVisibleCardCount } from "./lib/render/masonry-layout.mjs";
import { setupResultsViewportRefresh } from "./lib/render/results-viewport-refresh.mjs";
import {
    collectUiElements,
    applyThemeFromStorage,
    setupTheme
} from "./ui/core/elements.mjs";
import { createUiSyncController } from "./ui/core/sync.mjs";
import { createDataLoader } from "./ui/core/data.mjs";
import { createDateFilterController } from "./ui/date/filter.mjs";
import { createSearchUiActions } from "./ui/core/search-actions.mjs";
import { createSidebarController } from "./ui/sidebar/ui.mjs";
import { createAutoHideHeaderController } from "./ui/header/auto-hide.mjs";
import { createSearchFiltersController } from "./ui/search-filters/controller.mjs";
import { debugPlayback } from "./lib/playback-debug.mjs";
import { createBrowserSongsDataSource } from "./ui/core/data-source.mjs";
import type {
    AppDataState,
    AppUiState,
    AppYoutubeRuntimeState
} from "./state.types";

type SearchCallbacksInput = {
    getRenderController: () => ReturnType<typeof createRenderController>;
    ui: AppUiState;
};

type RenderCallbacksInput = {
    getYoutubeController: () => ReturnType<typeof createYoutubeController>;
    getSidebarController: () => ReturnType<typeof createSidebarController>;
    getStorageController: () => ReturnType<typeof createStorageController>;
    getBookmarkUiController: () => ReturnType<typeof createBookmarkUiController> | null;
};

type StorageCallbacksInput = {
    dateFilterController: ReturnType<typeof createDateFilterController>;
    searchCoordinator: ReturnType<typeof createSearchCoordinator>;
    getBookmarkUiController: () => ReturnType<typeof createBookmarkUiController> | null;
};

type BookmarkUiCallbacksInput = {
    storageController: ReturnType<typeof createStorageController>;
    getSidebarController: () => ReturnType<typeof createSidebarController> | null;
};

type SidebarCallbacksInput = {
    getBookmarkUiController: () => ReturnType<typeof createBookmarkUiController> | null;
    youtubeController: ReturnType<typeof createYoutubeController>;
    dateFilterController: ReturnType<typeof createDateFilterController>;
    markFilterTouched: ReturnType<typeof createSearchUiActions>["markFilterTouched"];
    markQueryTouched: ReturnType<typeof createSearchUiActions>["markQueryTouched"];
    resetDateSelectGroup: ReturnType<typeof createSearchUiActions>["resetDateSelectGroup"];
    clearSearch: ReturnType<typeof createSearchUiActions>["clearSearch"];
    onOpenChange: (open: boolean) => void;
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
    ui
}: SearchCallbacksInput): Parameters<typeof createSearchController>[0]["callbacks"] {
    return {
        updateDisplay: () => getRenderController().updateDisplay(),
        scrollResultsPaneToTop: () => scrollResultListToTop(ui.el.resultList),
        getRecommendedDisplayCount: () => estimateMasonryVisibleCardCount(ui.el.resultList, {
            minItemCount: RANDOM_DISPLAY_COUNT
        })
    };
}

/**
 * 描画 controller から検索・YouTube・サイドバー・保存へ委譲する callback 群を作成する。
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
        setupScrollObserver: () => getYoutubeController().setupScrollObserver(),
        removeSongFromActiveBookmark: (songKey) => getSidebarController().removeSongFromActiveBookmark(songKey),
        saveBookmarks: (bookmarks) => getStorageController().saveBookmarks(bookmarks),
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
    dateFilterController,
    searchCoordinator,
    getBookmarkUiController
}: StorageCallbacksInput): Parameters<typeof createStorageController>[0]["callbacks"] {
    return {
        getDateSelectValue: (kind) => dateFilterController.getDateSelectValue(kind),
        applyPendingDateValues: () => dateFilterController.applyPendingDateValues(),
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
        onExportBookmarks: () => storageController.exportBookmarksAsJsonText(),
        onPreviewBookmarkImport: (text) => storageController.parseBookmarkImportText(text),
        onImportBookmarksText: (text) => storageController.importBookmarksFromJsonText(text),
        onRequestCloseSidebar: () => {
            const sidebarController = getSidebarController();
            if (sidebarController) sidebarController.closeSidebarMenu();
        }
    };
}

/**
 * サイドバー controller から各 controller へ委譲する callback 群を作成する。
 */
function createSidebarCallbacks({
    getBookmarkUiController,
    youtubeController,
    dateFilterController,
    markFilterTouched,
    markQueryTouched,
    resetDateSelectGroup,
    clearSearch,
    onOpenChange
}: SidebarCallbacksInput): Parameters<typeof createSidebarController>[0]["callbacks"] {
    return {
        getBookmarkUiController,
        isIOSWebKit: () => youtubeController.isIOSWebKit(),
        markFilterTouched,
        markQueryTouched,
        clampDateInputsIfNeeded: () => dateFilterController.clampDateInputsIfNeeded(),
        syncDateSelectOptions: (kind) => dateFilterController.syncDateSelectOptions(kind),
        resetDateSelectGroup,
        clearSearch,
        onOpenChange
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
    const dateFilterController = createDateFilterController({ ui: appUiState });

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
            RESULT_DISPLAY_BATCH_SIZE,
            DEFAULT_FORMATS
        },
        callbacks: createSearchCallbacks({
            getRenderController: () => renderController,
            ui: appUiState
        })
    });

    /**
     * storageController、sidebarController、bookmarkUiController は先に作る controller の callback から
     * 遅延参照するため、生成後に代入する。
     */
    let storageController: ReturnType<typeof createStorageController>;
    let sidebarController: ReturnType<typeof createSidebarController>;
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
            updateDisplay: () => renderController.updateDisplay(),
            setupScrollObserver: () => youtubeController.setupScrollObserver()
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
            YT_IFRAME_READY_POLL_MS,
            STOP_PLAYBACK_ON_SCROLL_OUT
        }
    });

    /**
     * 曲データの取得元を束ねる data source。
     * 公開 JSON とmetaによる鮮度確認を優先し、失敗時は保存済みJSON、公開CSVへfallbackする。
     */
    const songsDataSource = createBrowserSongsDataSource({
        publicSongsJsonUrl: PUBLIC_SONGS_JSON_URL,
        publicSongsMetaUrl: PUBLIC_SONGS_META_URL,
        publicCsvUrl: PUBLIC_CSV_URL,
        songsJsonCacheKey: SONGS_JSON_CACHE_KEY,
        obsoleteCsvCacheKey: CSV_CACHE_KEY,
        obsoleteLegacyCsvCacheKey: LEGACY_CSV_CACHE_KEY
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
     * 初期曲データと保留中の更新データを appDataState へ反映する loader。
     */
    const dataLoader = createDataLoader({
        data: appDataState,
        ui: appUiState,
        dataSource: songsDataSource,
        constants: {
            minPerformanceCount: MIN_PERFORMANCE_FOR_RANDOM
        },
        callbacks: {
            applyDateInputRange: (songs) => dateFilterController.applyDateInputRange(songs),
            clampDateInputsToBounds: (minKey, maxKey) => dateFilterController.clampDateInputsToBounds(minKey, maxKey)
        }
    });

    /**
     * 最新曲データの反映と検索実行を一つの操作として調整する coordinator。
     */
    const searchCoordinator = createSearchCoordinator({
        search: searchUiState,
        debounceMs: SEARCH_DEBOUNCE_MS,
        searchController,
        dataLoader,
        callbacks: {
            reconcileBookmarksAfterSongsCommitted: () => {
                bookmarkPersistenceController.migrateLegacyBookmarkSongRefs();
            }
        }
    });

    /**
     * localStorage 上の検索状態・ブックマーク保存データを読み書きする controller。
     * ブックマークの操作、インポート/エクスポート、保存後の再描画をまとめて扱う。
     */
    storageController = createStorageController({
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
            dateFilterController,
            searchCoordinator,
            getBookmarkUiController: () => bookmarkUiController
        })
    });

    /**
     * ブックマークパネルの表示、追加・削除・インポートなどのユーザー操作を扱う controller。
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
     * ページスクロール方向とサイドバー表示状態に応じてヘッダー表示を管理する controller。
     */
    const autoHideHeaderController = createAutoHideHeaderController({
        ui: appUiState,
        isSidebarOpen: () => appUiState.el.sidebar?.classList.contains("active") === true
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
     * サイドバー全体の開閉、設定パネル、ブックマークパネル、検索リセット導線を扱う controller。
     */
    sidebarController = createSidebarController({
        ui: appUiState,
        callbacks: createSidebarCallbacks({
            getBookmarkUiController: () => bookmarkUiController,
            youtubeController,
            dateFilterController,
            markFilterTouched: searchUiActions.markFilterTouched,
            markQueryTouched: searchUiActions.markQueryTouched,
            resetDateSelectGroup: searchUiActions.resetDateSelectGroup,
            clearSearch: searchUiActions.clearSearch,
            onOpenChange: autoHideHeaderController.handleSidebarOpenChange
        })
    });

    /**
     * bfcache 復帰やフォーカス復帰時に、保存済み設定と検索 UI を再同期する controller。
     */
    const uiSyncController = createUiSyncController({
        uiSyncPasses: UI_SYNC_PASSES,
        syncSearchUI: searchUiActions.syncSearchUI,
        applyThemeFromStorage: () => applyThemeFromStorage({ ui: appUiState }),
        applyPlaybackSettingsFromStorage: () => playbackSettingsController.applyPlaybackSettingsFromStorage()
    });

    wireYoutubePlaybackHooks({
        youtubeController,
        renderController,
        playbackSessionController
    });

    return {
        searchFiltersController,
        searchController,
        searchCoordinator,
        renderController,
        playbackSettingsController,
        youtubeController,
        storageController,
        autoHideHeaderController,
        sidebarController,
        uiSyncController,
        searchUiActions,
        dataLoader,
        bookmarkPersistenceController
    };
}

const {
    searchFiltersController,
    searchController,
    searchCoordinator,
    renderController,
    playbackSettingsController,
    youtubeController,
    storageController,
    autoHideHeaderController,
    sidebarController,
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
    if (youtubeController.isIOSWebKit()) document.documentElement.classList.add("ios");

    searchFiltersController.setupFilterOptions({
        onFilterChange: searchUiActions.markFilterTouched
    });
    autoHideHeaderController.setup();
    sidebarController.setupUIHandlers();
    storageController.restorePersistedState();
    setupTheme({ ui: appUiState });
    playbackSettingsController.setupPlaybackSettings();
    exposePlaybackSettingsConsoleApi();
    youtubeController.setupScrollObserver();
    uiSyncController.setupSyncEvents();
    if (resultsViewportRefreshCleanup) resultsViewportRefreshCleanup();
    resultsViewportRefreshCleanup = setupResultsViewportRefresh({
        resultList: appUiState.el.resultList,
        refreshRecommendedDisplay: () => searchController.refreshRecommendedDisplay(),
        refreshLayout: () => renderController.refreshLayout(),
        setupScrollObserver: () => youtubeController.setupScrollObserver()
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

document.addEventListener("DOMContentLoaded", boot);

/**
 * Inspect の console から隠し再生設定をページ内だけで操作できる API を公開する。
 */
function exposePlaybackSettingsConsoleApi(): void {
    window.knkPlaybackSettings = playbackSettingsController.createConsoleApi();
}
