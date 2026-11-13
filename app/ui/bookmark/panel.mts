import type { BookmarkRecord } from "../../state.types.mjs";
import type { SiteLanguage } from "../../lib/site-language.mjs";
import type { LocalizedText } from "./text.mjs";

/**
 * ブックマークの ID を、一覧に並べる順（作成日時の古い順）で返す。
 * 一覧の描画とエクスポートの選択肢を同じ順に並べるため、両方から使う。
 * @param bookmarks 保存済みのブックマーク
 */
export function getBookmarkIdsInListOrder(bookmarks: Record<string, BookmarkRecord>): string[] {
    return Object.keys(bookmarks).sort((a, b) => {
        return (bookmarks[a].createdAt || 0) - (bookmarks[b].createdAt || 0);
    });
}

/**
 * エラー欄ごとの、今出している文言の作り方。言語が変わったときに、同じ内容を新しい言語で書き直すために覚えておく。
 * 作成欄とエクスポート・インポートの両方が同じ欄へ書くので、欄の要素に結び付けて持つ。
 */
const panelErrorTexts = new WeakMap<HTMLElement, LocalizedText>();

/**
 * ブックマークパネル上部のエラー欄に文言を出す。null か空文字になる文言なら欄を隠す。
 * 作成欄の入力エラーと、エクスポート・インポートの失敗が同じ欄を使う。
 * @param errorEl エラー欄の要素
 * @param message 表示する文言の作り方。null なら欄を消す
 * @param language 今のサイトの言語
 */
export function setBookmarkPanelError(
    errorEl: HTMLElement | null | undefined,
    message: LocalizedText | null,
    language: SiteLanguage
): void {
    if (!errorEl) return;
    if (message) panelErrorTexts.set(errorEl, message);
    else panelErrorTexts.delete(errorEl);
    const text = message ? message(language) : "";
    errorEl.textContent = text;
    errorEl.hidden = !text;
}

/**
 * エラー欄に出している文言を、指定した言語で書き直す。何も出していなければ何もしない。
 * @param errorEl エラー欄の要素
 * @param language 新しいサイトの言語
 */
export function refreshBookmarkPanelError(errorEl: HTMLElement | null | undefined, language: SiteLanguage): void {
    if (!errorEl) return;
    const message = panelErrorTexts.get(errorEl);
    if (message) setBookmarkPanelError(errorEl, message, language);
}
