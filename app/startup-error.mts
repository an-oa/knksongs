/**
 * アプリのコードを読み込めなかったとき、または初期化の途中で失敗したときに、画面へ失敗を出す module。
 *
 * startup.mts が bootstrap.mts の読み込みに失敗したときと、bootstrap.mts の初期化が例外で止まったときに使う。
 * 何も出さないと、件数表示が「接続中...」のまま止まり、利用者には待つべきか読み込み直すべきかが分からない。
 * 公開の直後に、古い HTML が消えた古いファイルを取りに行ったときなどに起こる。
 *
 * UI のコード (文言の辞書や各 controller) を読めない状況で動くので、それらに依存せず、要素の id と
 * この module に持つ文言だけで表示する。文言は辞書 (./lib/ui-text.mts) と同じにし、単体テストで一致を確かめる。
 * 辞書を import すると、startup.mts が最初に読むコードが増えて、曲データの取得を始めるのが遅れる。
 */
import { createLoadErrorElement } from "./lib/load-error-view.mjs";
import { reloadPage } from "./lib/page-reload.mjs";

/** 読み込み失敗の表示に出す文言。言語は index.html の埋め込みスクリプトが決めた <html lang> に合わせる。 */
export const STARTUP_ERROR_TEXT = {
    ja: {
        title: "読込エラー",
        detail: "ページを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。",
        reload: "再読み込み"
    },
    en: {
        title: "Failed to load",
        detail: "The page could not be loaded. Check your connection and reload the page.",
        reload: "Reload"
    }
} as const;

/**
 * 件数表示と結果一覧に、読み込みに失敗したことと、ページを読み込み直すボタンを出す。
 * 英語で開いたときに中身を隠している印 (i18n-pending) も外し、失敗をすぐ見せる。
 */
export function showStartupLoadError(): void {
    const root = document.documentElement;
    root.classList.remove("i18n-pending");
    const text = STARTUP_ERROR_TEXT[root.lang === "en" ? "en" : "ja"];
    const resultCount = document.getElementById("resultCount");
    if (resultCount) resultCount.textContent = text.title;
    const resultList = document.getElementById("resultList");
    if (!resultList) return;
    resultList.replaceChildren(createLoadErrorElement(text, () => { void reloadPage(); }));
    // 複数列の配置で付けた高さが残っていると、表示の下に空白ができる。
    resultList.style.height = "";
}
