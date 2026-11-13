import type { YoutubeSharedPlaybackState } from "./lib/youtube/shared-playback.mjs";
import type { RecommendedSearchCache } from "./lib/search-recommendation.mjs";
import type { SiteLanguage } from "./lib/site-language.mjs";

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
  resultConditions: HTMLElement | null;
  resultClearAll: HTMLButtonElement | null;
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
  languageBtn: HTMLButtonElement | null;
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
  bookmarkPanelNewName: HTMLInputElement | null;
  bookmarkPanelError: HTMLElement | null;
  bookmarkPanelCreateBtn: HTMLButtonElement | null;
  bookmarkPanelExportBtn: HTMLButtonElement | null;
  bookmarkPanelImportBtn: HTMLButtonElement | null;
  bookmarkPanelImportInput: HTMLInputElement | null;
  bookmarkList: HTMLElement | null;
  bookmarkNotificationRegion: HTMLElement | null;
}>;

/** 検索 UI の入力状態や派生キャッシュ。 */
export type SearchUiRuntimeState = {
  /** 選択中の形式フィルタ。 */
  selectedFormats: Set<string>;
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

/** ブックマークの曲参照を曲へ解決するための派生マップ。 */
export type LookupUiRuntimeState = {
  /** songKey から曲を引くマップ。ブックマークは songKey で曲を指す。 */
  songMapByKey: Map<string, Song>;
  /** ルックアップマップの元になった曲配列参照。 */
  songLookupSourceRef: Song[] | null;
};

/**
 * 検索結果カード 1 件を構成する DOM 要素一式。
 * 個別プロパティはカード内の DOM 要素の役割名なので、型全体の説明に集約する。
 * titleTextEl と artistTextEl は、曲名とアーティスト名の文字を入れる内側の要素。
 * 外側の titleEl と artistEl が 1 行の幅で切り、収まらない文字は内側を動かして流す。
 */
export type RenderCardEntry = {
  card: HTMLLIElement;
  thumbDiv: HTMLDivElement;
  content: HTMLElement;
  titleHeading: HTMLHeadingElement;
  titleEl: HTMLAnchorElement;
  titleTextEl: HTMLSpanElement;
  artistEl: HTMLDivElement;
  artistTextEl: HTMLSpanElement;
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

/** 画面の文言と、曲名・アーティスト名の表記に使う言語。 */
export type SiteLanguageUiRuntimeState = {
  /** 現在表示している言語。保存値またはブラウザの言語から復元し、言語ボタンで切り替える。 */
  current: SiteLanguage;
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
  /** 画面の文言と、曲名・アーティスト名の表記に使う言語。 */
  language: SiteLanguageUiRuntimeState;
  /** 設定パネルの状態。 */
  settingsPanel: SettingsPanelUiRuntimeState;
  /** ブックマークパネルの状態。 */
  bookmarkPanel: BookmarkPanelUiRuntimeState;
};

/** YouTube API 読み込みと共有プレーヤーのランタイム状態。 */
export type AppYoutubeRuntimeState = {
  /** YouTube IFrame API の読み込み Promise。 */
  apiPromise: Promise<unknown> | null;
  /** カード間で再利用する共有プレーヤー状態。 */
  sharedPlayback: YoutubeSharedPlaybackState | null;
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
