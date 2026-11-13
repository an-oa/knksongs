import type { SearchBooleanFilterKey } from "./search-boolean-filters.mjs";
import type { SiteLanguage } from "./site-language.mjs";

/**
 * index.html に書いた固定の文言。data-i18n 系の属性にこのキーを書き、起動時と言語の切り替え時に置き換える。
 * 日本語の値は index.html の文言と同じにして、置き換え前後で表示が変わらないようにする。
 */
type StaticText = {
    siteTitle: string;
    siteName: string;
    siteSubName: string;
    sidebarTitle: string;
    close: string;
    clearConditions: string;
    dateRange: string;
    dateFromYear: string;
    dateFromMonth: string;
    dateFromDay: string;
    clearDateFrom: string;
    dateToYear: string;
    dateToMonth: string;
    dateToDay: string;
    clearDateTo: string;
    videoTypes: string;
    moreFilters: string;
    relayOnly: string;
    collabHostOnly: string;
    harmonyOnly: string;
    collabGuestOnly: string;
    bookmarks: string;
    bookmarksBack: string;
    newBookmarkName: string;
    newBookmarkPlaceholder: string;
    createBookmark: string;
    bookmarkTransfer: string;
    importBookmarks: string;
    exportBookmarks: string;
    settings: string;
    backToSidebar: string;
    settingsBack: string;
    displayGroup: string;
    thumbnails: string;
    darkMode: string;
    playbackGroup: string;
    privacyMode: string;
    privacyModeHelp: string;
    playArchiveToEnd: string;
    playArchiveToEndHelp: string;
    continuousPlayback: string;
    continuousPlaybackHelp: string;
    loopPlayback: string;
    loopPlaybackHelp: string;
    searchLabel: string;
    searchPlaceholder: string;
    openSidebar: string;
    filters: string;
    searchResults: string;
    activeFilters: string;
    clearAll: string;
    footerUnofficial: string;
    footerSource: string;
};

export type StaticTextKey = keyof StaticText;

/** 結果一覧の上の件数表示の種類。言語を切り替えたときに作り直せるよう、文言ではなく内容で持つ。 */
export type ResultCountSummary =
    | { kind: "search"; count: number }
    | { kind: "bookmark"; name: string; count: number }
    | { kind: "recommended" };

/** 画面に出す文言。固定の文言と、値を埋め込む文言を言語ごとに持つ。 */
export type UiText = {
    static: StaticText;
    /** カードのタグに出す形態の名前。CSV の値を受け取り、知らない値はそのまま返す。 */
    formatTag: (format: string) => string;
    /** 絞り込みと条件チップに出す形態の名前。歌みたはオリ曲と同じ項目として扱う。 */
    formatFilter: (format: string) => string;
    tags: { collab: string; relay: string; harmony: string };
    booleanFilters: Record<SearchBooleanFilterKey, string>;
    card: {
        untitled: string;
        unknownArtist: string;
        addToBookmark: string;
        removeFromBookmark: string;
        backToThumbnail: string;
        /** サムネイルの再生ボタンの説明。どの曲を再生するかを伝える。 */
        play: (title: string) => string;
        /** ブックマーク表示中の並べ替えハンドルの説明。キーボードでの動かし方も伝える。 */
        reorderHandle: string;
        /** キーボードで並べ替えた後に読み上げる、移動先の位置。 */
        reordered: (title: string, position: number, total: number) => string;
        /** カードの日付。日本語は CSV の表記のまま、英語は「Oct 8, 2026」の形にする。 */
        date: (song: Pick<Song, "date" | "dateKey">) => string;
    };
    results: {
        count: (summary: ResultCountSummary) => string;
        connecting: string;
        loadingData: string;
        loadError: string;
        /** 曲データを取得できなかったときに、結果一覧に出す説明。 */
        loadErrorDetail: string;
        /**
         * アプリのコードを読み込めなかったときに、結果一覧に出す説明。
         * 辞書を読めない状況で出すので、表示には startup-error.mts に持つ同じ文言を使う。
         */
        appLoadErrorDetail: string;
        /** 読み込みに失敗したときに出す、ページを読み込み直すボタン。 */
        reload: string;
        loading: string;
        selectFormats: string;
        notFound: string;
        emptyHint: string;
    };
    chips: {
        query: (query: string) => string;
        /** 日付の値は YYYY / YYYY-MM / YYYY-MM-DD 形式。 */
        dateFrom: (value: string) => string;
        dateTo: (value: string) => string;
        formats: (labels: string[]) => string;
        remove: (label: string) => string;
    };
    dateSelect: { year: string; month: string; day: string };
    searchErrors: {
        invalidDateOperator: string;
        unterminatedQuote: string;
        contradictoryDateRange: string;
    };
};

const ENGLISH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * YYYY / YYYY-MM / YYYY-MM-DD 形式の日付を、英語の「2026」「Oct 2026」「Oct 8, 2026」の形にする。
 * 形式に合わない値はそのまま返す。
 * @param value 年・年月・年月日の値
 * @returns 英語の日付
 */
function formatEnglishPartialDate(value: string): string {
    const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(value);
    if (!match) return value;
    const [, year, month, day] = match;
    if (!month) return year;
    const monthName = ENGLISH_MONTHS[Number(month) - 1];
    if (!monthName) return value;
    return day ? `${monthName} ${Number(day)}, ${year}` : `${monthName} ${year}`;
}

/**
 * YYYYMMDD 形式の日付キーを、英語の「Oct 8, 2026」の形にする。日付キーがない曲は CSV の表記を返す。
 * @param song 曲の日付
 * @returns 英語の日付
 */
function formatEnglishSongDate(song: Pick<Song, "date" | "dateKey">): string {
    if (song.dateKey === null) return song.date;
    const year = Math.floor(song.dateKey / 10000);
    const month = Math.floor(song.dateKey / 100) % 100;
    const day = song.dateKey % 100;
    return formatEnglishPartialDate(`${year}-${month}-${day}`);
}

const JAPANESE_FORMAT_FILTER_NAMES: Record<string, string> = { 歌みた: "オリ曲/歌みた" };

/** 絞り込みと条件チップに出す、マスターシートの英語版のビューと同じ形態の名前。 */
const ENGLISH_FORMAT_FILTER_NAMES: Record<string, string> = {
    配信: "Singing Stream",
    歌みた: "Originals & Covers",
    オリ曲: "Original Song",
    ショート: "Shorts",
    切り抜き: "Clip",
    収録: "Pre-recorded"
};

/**
 * カードのタグに出す形態の名前。カードの下の行は日付・タグ・ボタンで幅が狭いので、シートの名前を短くする。
 * カード1枚は1件なので単数形にする。Shorts は YouTube の機能の名前なのでそのまま使う。
 */
const ENGLISH_FORMAT_TAG_NAMES: Record<string, string> = {
    配信: "Stream",
    歌みた: "Cover",
    オリ曲: "Original",
    ショート: "Shorts",
    切り抜き: "Clip",
    収録: "Recording"
};

const JAPANESE_TEXT: UiText = {
    static: {
        siteTitle: "鐘輝かう 歌サーチ",
        siteName: "鐘輝かう",
        siteSubName: "歌サーチ",
        sidebarTitle: "絞り込み・設定",
        close: "閉じる",
        clearConditions: "条件をクリア",
        dateRange: "日付範囲",
        dateFromYear: "開始年",
        dateFromMonth: "開始月",
        dateFromDay: "開始日",
        clearDateFrom: "開始日をクリア",
        dateToYear: "終了年",
        dateToMonth: "終了月",
        dateToDay: "終了日",
        clearDateTo: "終了日をクリア",
        videoTypes: "動画の種類",
        moreFilters: "追加条件",
        relayOnly: "歌枠リレー",
        collabHostOnly: "コラボ(ホスト)",
        harmonyOnly: "ハモリあり",
        collabGuestOnly: "コラボ(ゲスト)",
        bookmarks: "ブックマーク",
        bookmarksBack: "← ブックマーク",
        newBookmarkName: "新規ブックマーク名",
        newBookmarkPlaceholder: "新規ブックマーク名",
        createBookmark: "作成",
        bookmarkTransfer: "ブックマークの入出力",
        importBookmarks: "インポート",
        exportBookmarks: "エクスポート",
        settings: "設定",
        backToSidebar: "検索・設定に戻る",
        settingsBack: "← 設定",
        displayGroup: "表示",
        thumbnails: "サムネイル表示",
        darkMode: "ダークモード",
        playbackGroup: "再生",
        privacyMode: "プライバシー強化",
        privacyModeHelp: "youtube-nocookie.com を使用します。",
        playArchiveToEnd: "アーカイブ全体を再生",
        playArchiveToEndHelp: "OFFでは曲の終わりで停止します。",
        continuousPlayback: "終了後、次の曲を再生",
        continuousPlaybackHelp: "現在の一覧で、次の曲へ順に進みます。",
        loopPlayback: "リピート再生",
        loopPlaybackHelp: "「終了後、次の曲を再生」がOFFでは1曲、ONでは一覧全体を繰り返します。",
        searchLabel: "曲名・アーティスト名・読みで検索",
        searchPlaceholder: "曲名・歌手・読み...",
        openSidebar: "絞り込み・設定を開く",
        filters: "絞り込み",
        searchResults: "検索結果",
        activeFilters: "適用中の条件",
        clearAll: "すべてクリア",
        footerUnofficial: "本サイトは非公式のファンメイドです。掲載している動画・楽曲等の著作権は各権利者に帰属します。",
        footerSource: "YouTube 上の公開情報を参照しており、コンテンツの再配布は行いません。"
    },
    formatTag: (format) => format,
    formatFilter: (format) => JAPANESE_FORMAT_FILTER_NAMES[format] ?? format,
    tags: { collab: "コラボ", relay: "リレー", harmony: "ハモリ" },
    booleanFilters: {
        collabHostOnly: "コラボ(ホスト)",
        collabGuestOnly: "コラボ(ゲスト)",
        relayOnly: "歌枠リレー",
        harmonyOnly: "ハモリあり"
    },
    card: {
        untitled: "無題",
        unknownArtist: "不明",
        addToBookmark: "ブックマークに追加",
        removeFromBookmark: "ブックマークから削除",
        backToThumbnail: "サムネイルに戻す",
        play: (title) => `「${title}」を再生`,
        reorderHandle: "並べ替え（矢印キーで前後へ移動）",
        reordered: (title, position, total) => `「${title}」を ${total} 件中 ${position} 番目へ移動しました`,
        date: (song) => song.date
    },
    results: {
        count: (summary) => {
            if (summary.kind === "recommended") return "おすすめを表示中";
            if (summary.kind === "bookmark") return `ブックマーク: ${summary.name} (${summary.count} 件)`;
            return `${summary.count} 件がヒット`;
        },
        connecting: "接続中...",
        loadingData: "データを読み込み中...",
        loadError: "読込エラー",
        loadErrorDetail: "曲データを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。",
        appLoadErrorDetail: "ページを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。",
        reload: "再読み込み",
        loading: "読み込み中...",
        selectFormats: "動画の種類を選択してください",
        notFound: "見つかりませんでした",
        emptyHint: "キーワードを減らすか、絞り込みを解除してみてください。"
    },
    chips: {
        query: (query) => `「${query}」`,
        dateFrom: (value) => `${value.replaceAll("-", "/")}〜`,
        dateTo: (value) => `〜${value.replaceAll("-", "/")}`,
        formats: (labels) => `種類: ${labels.length > 0 ? labels.join("・") : "なし"}`,
        remove: (label) => `${label}の条件を解除`
    },
    dateSelect: { year: "年", month: "月", day: "日" },
    searchErrors: {
        invalidDateOperator: "日付演算子は YYYY、YYYY-MM、YYYY-MM-DD 形式の実在する日付で入力してください。" +
            "文字列として検索する場合は二重引用符で囲んでください。",
        unterminatedQuote: "二重引用符が閉じられていません。",
        contradictoryDateRange: "since の日付は until の日付以前にしてください。"
    }
};

const ENGLISH_TEXT: UiText = {
    static: {
        siteTitle: "Kaneki Caw Song Search",
        siteName: "Kaneki Caw",
        siteSubName: "Song Search",
        sidebarTitle: "Filters & Settings",
        close: "Close",
        clearConditions: "Clear filters",
        dateRange: "Date range",
        dateFromYear: "Start year",
        dateFromMonth: "Start month",
        dateFromDay: "Start day",
        clearDateFrom: "Clear start date",
        dateToYear: "End year",
        dateToMonth: "End month",
        dateToDay: "End day",
        clearDateTo: "Clear end date",
        videoTypes: "Video type",
        moreFilters: "More filters",
        relayOnly: "Relay stream",
        collabHostOnly: "Collab (host)",
        harmonyOnly: "With harmony",
        collabGuestOnly: "Collab (guest)",
        bookmarks: "Bookmarks",
        bookmarksBack: "← Bookmarks",
        newBookmarkName: "New bookmark name",
        // 入力欄の幅に収まるよう、プレースホルダーは読み上げ用のラベルより短くする
        newBookmarkPlaceholder: "New bookmark",
        createBookmark: "Create",
        bookmarkTransfer: "Import and export bookmarks",
        importBookmarks: "Import",
        exportBookmarks: "Export",
        settings: "Settings",
        backToSidebar: "Back to filters & settings",
        settingsBack: "← Settings",
        displayGroup: "Display",
        thumbnails: "Thumbnails",
        darkMode: "Dark mode",
        playbackGroup: "Playback",
        privacyMode: "Enhanced privacy",
        privacyModeHelp: "Uses youtube-nocookie.com.",
        playArchiveToEnd: "Play the whole archive",
        playArchiveToEndHelp: "When off, playback stops at the end of the song.",
        continuousPlayback: "Play the next song when finished",
        continuousPlaybackHelp: "Moves through the current list in order.",
        loopPlayback: "Repeat",
        loopPlaybackHelp: "Repeats one song, or the whole list when “Play the next song when finished” is on.",
        searchLabel: "Search by song or artist name",
        searchPlaceholder: "Song or artist...",
        openSidebar: "Open filters and settings",
        filters: "Filters",
        searchResults: "Search results",
        activeFilters: "Active filters",
        clearAll: "Clear all",
        footerUnofficial: "This is an unofficial fan site. Copyrights of the videos and songs belong to their respective owners.",
        footerSource: "It refers to information published on YouTube and does not redistribute any content."
    },
    formatTag: (format) => ENGLISH_FORMAT_TAG_NAMES[format] ?? format,
    formatFilter: (format) => ENGLISH_FORMAT_FILTER_NAMES[format] ?? format,
    tags: { collab: "Collab", relay: "Relay", harmony: "Harmony" },
    booleanFilters: {
        collabHostOnly: "Collab (host)",
        collabGuestOnly: "Collab (guest)",
        relayOnly: "Relay stream",
        harmonyOnly: "With harmony"
    },
    card: {
        untitled: "Untitled",
        unknownArtist: "Unknown artist",
        addToBookmark: "Add to bookmark",
        removeFromBookmark: "Remove from bookmark",
        backToThumbnail: "Back to thumbnail",
        play: (title) => `Play “${title}”`,
        reorderHandle: "Reorder (use the arrow keys to move)",
        reordered: (title, position, total) => `Moved “${title}” to position ${position} of ${total}`,
        date: formatEnglishSongDate
    },
    results: {
        count: (summary) => {
            if (summary.kind === "recommended") return "Showing recommendations";
            if (summary.kind === "bookmark") return `Bookmark: ${summary.name} (${summary.count})`;
            return summary.count === 1 ? "1 result" : `${summary.count} results`;
        },
        connecting: "Connecting...",
        loadingData: "Loading data...",
        loadError: "Failed to load",
        loadErrorDetail: "The song data could not be loaded. Check your connection and reload the page.",
        appLoadErrorDetail: "The page could not be loaded. Check your connection and reload the page.",
        reload: "Reload",
        loading: "Loading...",
        selectFormats: "Select at least one video type",
        notFound: "No songs found",
        emptyHint: "Try fewer keywords or clear some filters."
    },
    chips: {
        query: (query) => `“${query}”`,
        dateFrom: (value) => `From ${formatEnglishPartialDate(value)}`,
        dateTo: (value) => `Until ${formatEnglishPartialDate(value)}`,
        formats: (labels) => `Types: ${labels.length > 0 ? labels.join(", ") : "None"}`,
        remove: (label) => `Remove filter: ${label}`
    },
    // 日付の選択欄は「年・月・日」の1文字に合わせた幅なので、英語は入力形式の表記で短くする
    dateSelect: { year: "YYYY", month: "MM", day: "DD" },
    searchErrors: {
        invalidDateOperator: "Enter a real date for since/until as YYYY, YYYY-MM, or YYYY-MM-DD. " +
            "To search for the text itself, put it in double quotes.",
        unterminatedQuote: "A double quote is not closed.",
        contradictoryDateRange: "The since date must be on or before the until date."
    }
};

/**
 * サイトの言語に応じた画面の文言を返す。
 * @param language サイトの言語
 * @returns 画面の文言
 */
export function getUiText(language: SiteLanguage): UiText {
    return language === "en" ? ENGLISH_TEXT : JAPANESE_TEXT;
}
