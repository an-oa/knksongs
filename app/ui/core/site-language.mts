import type { AppUiState } from "../../state.types.mjs";
import { getStoredSettingText, setStoredSettingText } from "../../lib/storage/settings-storage.mjs";
import {
    parseSiteLanguageQuery,
    resolveSiteLanguage,
    SITE_LANGUAGE_QUERY_KEY,
    SITE_LANGUAGE_STORAGE_KEY,
    type SiteLanguage
} from "../../lib/site-language.mjs";

/** 英語で開いたときに、文言を置き換え終わるまで中身を隠す印。index.html の埋め込みスクリプトが付ける。 */
const PENDING_TEXT_CLASS = "i18n-pending";

type SiteLanguageUiState = Pick<AppUiState, "language"> & {
    el: Pick<AppUiState["el"], "languageBtn">;
};

type SiteLanguageControllerInput = {
    ui: SiteLanguageUiState;
    /** index.html に書いた固定の文言を、指定した言語へ置き換える。 */
    applyStaticText: (language: SiteLanguage) => void;
    /** 結果一覧や条件の表示など、描画済みの文言を今の言語で描き直す。 */
    refreshDynamicText: () => void;
};

/**
 * 言語ボタンの、切り替え先の言語ごとの言語タグと説明。ボタンに見せる文言は index.html に両方置いてある。
 * 日本語を読めない人にも見つけられるよう、切り替え先の言語そのもので書く。
 */
const LANGUAGE_BUTTON_LABELS = {
    en: { lang: "en", description: "Show the site in English" },
    ja: { lang: "ja", description: "日本語で表示" }
} as const satisfies Record<SiteLanguage, { lang: string; description: string }>;

/**
 * ブラウザの優先言語を、優先度の高い順で返す。取得できない環境では空配列を返す。
 * @returns ブラウザの優先言語
 */
function getPreferredLanguages(): readonly string[] {
    const browserNavigator = globalThis.navigator;
    if (!browserNavigator) return [];
    if (Array.isArray(browserNavigator.languages) && browserNavigator.languages.length > 0) {
        return browserNavigator.languages;
    }
    return typeof browserNavigator.language === "string" ? [browserNavigator.language] : [];
}

/**
 * URL の ?lang で指定された言語を返し、アドレス欄からは消す。そのまま共有しても言語の指定は残らない。
 * @returns 指定された言語。指定がなければ null
 */
function takeLanguageFromUrl(): SiteLanguage | null {
    if (typeof location === "undefined") return null;
    const language = parseSiteLanguageQuery(location.search);
    if (!language) return null;
    const url = new URL(location.href);
    url.searchParams.delete(SITE_LANGUAGE_QUERY_KEY);
    history.replaceState(history.state, "", url);
    return language;
}

/**
 * サイトの言語の決定・保存・言語ボタンを扱う controller を作成する。
 * 言語は候補から直接決め、保存は別に試みるだけにする。保存できない環境でも、このページで選んだ言語
 * (?lang または言語ボタン)を覚えておき、再同期で古い保存値やブラウザの言語に戻らないようにする。
 * @param input サイトの言語の状態と、文言を置き換える処理
 */
export function createSiteLanguageController({ ui, applyStaticText, refreshDynamicText }: SiteLanguageControllerInput) {
    /** このページで選んだ言語。まだ選んでいなければ null。 */
    let selectedLanguage: SiteLanguage | null = null;
    /** このページで選んだ言語を保存できたか。 */
    let isSelectionSaved = false;

    /**
     * ページの lang と言語ボタンを、今の言語に合わせる。
     * 言語ボタンには両方の文言を重ねてあり、CSS がボタンの lang と同じ言語の文言だけを見せる。
     */
    function applyLanguageToPage(): void {
        const language = ui.language.current;
        if (typeof document !== "undefined") document.documentElement.lang = language;
        const button = ui.el.languageBtn;
        if (!button) return;
        const target = LANGUAGE_BUTTON_LABELS[language === "en" ? "ja" : "en"];
        button.setAttribute("lang", target.lang);
        button.setAttribute("aria-label", target.description);
        button.setAttribute("title", target.description);
    }

    /**
     * 言語を選び、保存を試みる。保存できなくても、このページでは選んだ言語のままにする。
     * @param language 選んだ言語
     */
    function selectLanguage(language: SiteLanguage): void {
        selectedLanguage = language;
        ui.language.current = language;
        isSelectionSaved = setStoredSettingText(SITE_LANGUAGE_STORAGE_KEY, language);
    }

    /**
     * ブラウザの言語より優先する候補を、優先度の高い順で返す。
     * 保存できた選択は、別のタブで変えた言語に従えるよう保存値を先にする。
     * 保存できなかった選択は、保存値が古いままなので、このページで選んだ言語を先にする。
     * @returns ?lang や言語ボタンで選んだ言語と保存値
     */
    function getLanguageCandidates(): (string | null)[] {
        const storedLanguage = getStoredSettingText(SITE_LANGUAGE_STORAGE_KEY);
        return isSelectionSaved ? [storedLanguage, selectedLanguage] : [selectedLanguage, storedLanguage];
    }

    /**
     * 保存値・このページで選んだ言語・ブラウザの言語から言語を決め直し、ページの lang と言語ボタンへ反映する。
     * 別のタブで言語を変えた場合に、フォーカス復帰などの再同期で呼ぶ。
     * @returns 言語が変わった場合は true
     */
    function syncFromStorage(): boolean {
        const language = resolveSiteLanguage(getLanguageCandidates(), getPreferredLanguages());
        const changed = ui.language.current !== language;
        ui.language.current = language;
        applyLanguageToPage();
        return changed;
    }

    /**
     * ?lang・保存値・ブラウザの言語の順で言語を決めて固定の文言を合わせ、言語ボタンで切り替えられるようにする。
     * 起動時は結果一覧をまだ描いていないので、描画済みの文言の描き直しは切り替えたときだけ行う。
     * 固定の文言を合わせ終えたら、英語で開いたときに隠していた中身を表示する。
     */
    function setup(): void {
        const urlLanguage = takeLanguageFromUrl();
        if (urlLanguage) {
            selectLanguage(urlLanguage);
        } else {
            ui.language.current = resolveSiteLanguage(getLanguageCandidates(), getPreferredLanguages());
        }
        applyLanguageToPage();
        applyStaticText(ui.language.current);
        if (typeof document !== "undefined") document.documentElement.classList.remove(PENDING_TEXT_CLASS);
        const button = ui.el.languageBtn;
        if (!button) return;
        button.addEventListener("click", () => {
            selectLanguage(ui.language.current === "en" ? "ja" : "en");
            applyLanguageToPage();
            applyStaticText(ui.language.current);
            refreshDynamicText();
        });
    }

    return { setup, syncFromStorage };
}
