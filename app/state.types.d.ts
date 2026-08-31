import type { RecommendedSearchCache } from "./lib/search-recommendation.mjs";

/**
 * コメント粒度の方針:
 * - 状態遷移や保存値、派生キャッシュなど、名前だけでは意味や寿命を判断しにくいプロパティには個別コメントを置く。
 * - DOM 要素キャッシュや外部 API 形状のように、プロパティ名が要素名や API 名をそのまま表す束は型全体のコメントに集約する。
 */

/** localStorage に保存するブックマーク 1 件の内容。 */
export type BookmarkRecord = {
  /** ユーザーが付けたブックマーク名。 */
  name: string;
  /** 曲を指す現在形式または移行可能な旧文字列形式のキー。 */
  songs: string[];
  /** ブックマーク作成時刻。旧データでは存在しない場合がある。 */
  createdAt?: number;
};

/** アプリ全体で共有する曲データと検索結果の状態。 */
export type AppDataState = {
  /** 読み込み済みの全曲データ。 */
  allSongsRaw: Song[];
  /** バックグラウンド取得後、次の検索実行まで表示反映を保留している最新曲データ。 */
  pendingSongsRaw: Song[] | null;
  /** 現在の検索条件やブックマークで表示対象になっている曲データ。 */
  currentResults: Song[];
  /** 現在 DOM に表示する検索結果の上限件数。 */
  displayLimit: number;
  /** ブックマーク名をキーにした保存済みブックマーク。 */
  bookmarks: Record<string, BookmarkRecord>;
  /** 現在表示中のブックマーク名。通常検索時は null。 */
  activeBookmark: string | null;
};

/**
 * 起動時に収集して ui.el に保持する DOM 要素キャッシュ。
 * 個別プロパティは対応する DOM 要素キーそのものを表すため、型全体の説明に集約する。
 */
export type AppUiElements = Partial<{
  header: HTMLElement | null;
  sidebar: HTMLElement | null;
  sidebarSheet: Element | null;
  sidebarHeader: Element | null;
  sidebarScrollArea: Element | null;
  sidebarOverlay: HTMLElement | null;
  mainContent: Element | null;
  openSidebarBtn: HTMLElement | null;
  closeSidebarBtn: HTMLElement | null;
  resultList: HTMLElement | null;
  resultCount: HTMLElement | null;
  resultTailSentinel: HTMLElement | null;
  searchBox: HTMLInputElement | null;
  searchBoxError: HTMLElement | null;
  clearBtn: HTMLButtonElement | null;
  collabHostOnly: HTMLInputElement | null;
  collabGuestOnly: HTMLInputElement | null;
  relayOnly: HTMLInputElement | null;
  harmonyOnly: HTMLInputElement | null;
  dateFromYear: HTMLSelectElement | null;
  dateFromMonth: HTMLSelectElement | null;
  dateFromDay: HTMLSelectElement | null;
  dateToYear: HTMLSelectElement | null;
  dateToMonth: HTMLSelectElement | null;
  dateToDay: HTMLSelectElement | null;
  clearDateFromBtn: HTMLButtonElement | null;
  clearDateToBtn: HTMLButtonElement | null;
  themeToggle: HTMLInputElement | null;
  thumbToggle: HTMLInputElement | null;
  youtubeNoCookieToggle: HTMLInputElement | null;
  playArchiveToEndToggle: HTMLInputElement | null;
  continuousPlaybackToggle: HTMLInputElement | null;
  loopPlaybackToggle: HTMLInputElement | null;
  playbackSettingsGroup: HTMLElement | null;
  experimentalPlaybackSettingsGroup: HTMLElement | null;
  openSettingsPanelBtn: HTMLButtonElement | null;
  settingsSidebarPanel: HTMLElement | null;
  closeSettingsPanelBtn: HTMLButtonElement | null;
  closeSettingsSidebarBtn: HTMLButtonElement | null;
  formatsList: HTMLElement | null;
  openBookmarkPanelBtn: HTMLButtonElement | null;
  bookmarkSidebarPanel: HTMLElement | null;
  closeBookmarkPanelBtn: HTMLButtonElement | null;
  closeBookmarkSidebarBtn: HTMLButtonElement | null;
  bookmarkPanelCreate: HTMLElement | null;
  bookmarkPanelNewName: HTMLInputElement | null;
  bookmarkPanelError: HTMLElement | null;
  bookmarkPanelCreateBtn: HTMLButtonElement | null;
  bookmarkPanelExportBtn: HTMLButtonElement | null;
  bookmarkPanelImportBtn: HTMLButtonElement | null;
  bookmarkPanelImportInput: HTMLInputElement | null;
  bookmarkList: HTMLElement | null;
  bookmarkNotificationRegion: HTMLElement | null;
}> & Record<string, Element | null | undefined>;

/** 検索 UI の入力状態や派生キャッシュ。 */
export type SearchUiRuntimeState = {
  /** 選択中の形式フィルタ。 */
  selectedFormats: Set<string>;
  /** 検索デバウンス用のタイマー ID。 */
  debounceId: number;
  /** 条件未指定時に表示するおすすめ曲のキャッシュ。 */
  recommendedCache: RecommendedSearchCache | null;
  /** 曲データ読み込みが完了して検索可能かどうか。 */
  dataReady: boolean;
  /** ユーザーが検索語を編集したかどうか。 */
  userTouchedQuery: boolean;
  /** ユーザーが検索フィルタを編集したかどうか。 */
  userTouchedFilters: boolean;
  /** 保存済み検索条件の復元処理が完了したかどうか。 */
  hasRestoredSearchState: boolean;
};

/** 曲データ読み込み前に一時保持する日付セレクト復元値。 */
export type DateUiPendingValues = {
  /** 開始日側の `YYYY-MM-DD` 文字列。 */
  from: string | null;
  /** 終了日側の `YYYY-MM-DD` 文字列。 */
  to: string | null;
};

/** 日付フィルタ UI の境界値と選択肢生成用キャッシュ。 */
export type DateUiRuntimeState = {
  /** 読み込み済み曲データから計算した選択可能日付範囲。 */
  bounds: SearchDateRange | null;
  /** `YYYY-MM` ごとの選択可能な日一覧。 */
  index: Map<string, number[]> | null;
  /** 日付セレクト初期化後に適用する保留値。 */
  pendingValues: DateUiPendingValues | null;
};

/** サムネイル表示と連続再生に関わる UI ランタイム状態。 */
export type PlaybackUiRuntimeState = {
  /** サムネイルの遅延読み込みに使う IntersectionObserver。 */
  scrollObserver: IntersectionObserver | null;
  /** サムネイル画像を表示するかどうか。 */
  showThumbnails: boolean;
  /** 実験的な再生設定を表示するかどうか。 */
  showExperimentalPlaybackSettings: boolean;
  /** 埋め込み再生 URL に youtube-nocookie.com を使うかどうか。 */
  useYoutubeNoCookie: boolean;
  /** アーカイブ全体を曲の終了秒で止めずに再生するかどうか。 */
  playArchiveToEnd: boolean;
  /** 再生終了後に次の曲へ進むかどうか。 */
  continuousPlayback: boolean;
  /** 再生候補の末尾から先頭へ戻るかどうか。 */
  loopPlayback: boolean;
  /** 現在 iframe 再生を保持しているサムネイル要素。 */
  activeThumb: HTMLElement | null;
};

/** 再生設定 controller が扱う真偽値設定。 */
export type PlaybackSettingsUiSlice = Pick<
  PlaybackUiRuntimeState,
  "showThumbnails" |
  "showExperimentalPlaybackSettings" |
  "useYoutubeNoCookie" |
  "playArchiveToEnd" |
  "continuousPlayback" |
  "loopPlayback"
>;

/** ブックマーク参照や曲キー検索に使う派生マップ。 */
export type LookupUiRuntimeState = {
  /** ブックマーク保存用キーから曲を引くマップ。 */
  songMapByBookmarkKey: Map<string, Song>;
  /** 現在の songKey から曲を引くマップ。 */
  songMapByKey: Map<string, Song>;
  /** ルックアップマップの元になった曲配列参照。 */
  songLookupSourceRef: Song[] | null;
};

/**
 * 検索結果カード 1 件を構成する DOM 要素一式。
 * 個別プロパティはカード内の DOM 要素の役割名なので、型全体の説明に集約する。
 */
export type RenderCardEntry = {
  card: HTMLLIElement;
  thumbDiv: HTMLDivElement;
  content: HTMLElement;
  titleHeading: HTMLHeadingElement;
  titleEl: HTMLAnchorElement;
  artistEl: HTMLDivElement;
  dateEl: HTMLSpanElement;
  tagsEl: HTMLDivElement;
  actionBtn: HTMLButtonElement;
  dragHandle: HTMLDivElement;
};

/** 検索結果描画で再利用する DOM キャッシュ。 */
export type RenderUiRuntimeState = {
  /** songKeyから既存カードDOMを引くマップ。 */
  cardEntriesBySongKey: Map<string, RenderCardEntry>;
};

/** 設定パネルを閉じた後のフォーカス復帰先。 */
export type SettingsPanelUiRuntimeState = {
  /** パネルを閉じた後にフォーカスを戻す要素。 */
  returnFocusEl: HTMLElement | null;
};

/** ブックマークパネルで未確定の追加操作。 */
export type BookmarkPanelPendingAction = {
  /** 追加対象の曲キー。 */
  songKey: string;
} | null;

/** ブックマークパネルの操作状態とフォーカス復帰情報。 */
export type BookmarkPanelUiRuntimeState = {
  /** ブックマーク選択待ちの曲追加操作。 */
  pendingAction: BookmarkPanelPendingAction;
  /** パネルを閉じた後のフォーカス復帰先。 */
  returnFocusEl: HTMLElement | null;
  /** パネル終了時にサイドバーも閉じるかどうか。 */
  exitClosesSidebar: boolean;
};

/** アプリ全体で共有する UI ランタイム状態。 */
export type AppUiState = {
  /** DOM 要素キャッシュ。 */
  el: AppUiElements;
  /** 検索 UI の状態。 */
  search: SearchUiRuntimeState;
  /** 日付フィルタ UI の状態。 */
  date: DateUiRuntimeState;
  /** 再生 UI の状態。 */
  playback: PlaybackUiRuntimeState;
  /** 曲参照用の派生マップ。 */
  lookup: LookupUiRuntimeState;
  /** 検索結果描画用の DOM キャッシュ。 */
  render: RenderUiRuntimeState;
  /** 設定パネルの状態。 */
  settingsPanel: SettingsPanelUiRuntimeState;
  /** ブックマークパネルの状態。 */
  bookmarkPanel: BookmarkPanelUiRuntimeState;
};

/**
 * YouTube IFrame API の Player として利用する最小限のメソッド。
 * 個別メソッドは外部 API 名をそのまま写すため、型全体の説明に集約する。
 */
export type YoutubePlayerLike = {
  getIframe?: () => Element | null;
  getPlayerState?: () => number;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  stopVideo?: () => void;
  destroy?: () => void;
};

/** 共有プレーヤー初期化待ち中の最新 iframe 紐付け要求。 */
export type YoutubeSharedPlaybackPendingAttach = {
  /** プレーヤー化する iframe。 */
  iframe: HTMLIFrameElement | null;
  /** iframe を紐付ける再生セッション ID。 */
  playbackSessionId: number;
};

/** YouTube 再生開始の成否待ちを表す状態。 */
export type YoutubePlaybackStartAttempt = {
  /** 再生開始待ち対象のセッション ID。 */
  sessionId: number;
  /** 再生開始結果を呼び出し元へ返す Promise resolver。 */
  resolve: (result: { status: string }) => void;
  /** セットアップまたは再生開始待ちのタイマー ID。 */
  timeoutId: ReturnType<typeof setTimeout> | null;
  /** 失敗時の復元やログに使う再生開始コンテキスト。 */
  context: {
    thumbDiv?: Element | null;
    playbackMode?: string;
  };
};

/** 複数カード間で再利用する YouTube 共有 iframe / Player の状態。 */
export type YoutubeSharedPlaybackState = {
  /** 共有 iframe に紐付いた YouTube Player。 */
  player: YoutubePlayerLike | null;
  /** Player 初期化中に共有する Promise。 */
  playerPromise: Promise<YoutubePlayerLike | null> | null;
  /** Player 初期化待ち中に処理する最新の iframe 紐付け要求。 */
  pendingAttach: YoutubeSharedPlaybackPendingAttach | null;
  /** 共有プレーヤーとして使う iframe。 */
  iframe: HTMLIFrameElement | null;
  /** 共有プレーヤーを閉じるボタン。 */
  closeButton: HTMLButtonElement | null;
  /** iframe をカード外へ退避するための隠しノード。 */
  parkingNode: HTMLElement | null;
  /** 現在共有プレーヤーを表示しているサムネイル。 */
  hostThumb: HTMLElement | null;
  /** 現在の共有プレーヤー再生セッション ID。 */
  sessionId: number;
  /** 再生開始待ち中の attempt。 */
  playbackStartAttempt: YoutubePlaybackStartAttempt | null;
  /** 再生開始が未確定のまま保持されているセッション ID。 */
  unconfirmedPlaybackStartSessionId: number;
};

/** YouTube API 読み込みと共有プレーヤーのランタイム状態。 */
export type AppYoutubeRuntimeState = {
  /** YouTube IFrame API の読み込み Promise。 */
  apiPromise: Promise<unknown> | null;
  /** カード間で再利用する共有プレーヤー状態。 */
  sharedPlayback: YoutubeSharedPlaybackState | null;
};

/**
 * YouTube IFrame API が window に公開する namespace。
 * 個別プロパティは外部 API の公開名を写すため、型全体の説明に集約する。
 */
export type YoutubeIframeApiGlobal = {
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
  Player: new (
    iframe: Element,
    options: {
      host?: string;
      events?: {
        onReady?: (event: { target?: YoutubePlayerLike }) => void;
        onStateChange?: (event: { data?: number; target?: YoutubePlayerLike }) => void;
        onError?: (event: { data?: number; target?: YoutubePlayerLike }) => void;
      };
    }
  ) => YoutubePlayerLike;
};

/** アプリ全体の状態ルート。 */
export type AppState = {
  /** 曲データと検索結果の状態。 */
  data: AppDataState;
  /** UI と派生キャッシュの状態。 */
  ui: AppUiState;
  /** YouTube API と共有プレーヤーの状態。 */
  youtube: AppYoutubeRuntimeState;
};
