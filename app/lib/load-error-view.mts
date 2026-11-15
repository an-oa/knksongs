/** 読み込み失敗の表示に出す文言。 */
export type LoadErrorViewText = {
    /** 何を読み込めなかったかと、利用者にできることの説明。 */
    detail: string;
    /** ページを読み込み直すボタンの文言。 */
    reload: string;
};

/**
 * 読み込みに失敗したことを結果一覧に出す項目を作る。説明と、ページを読み込み直すボタンを置く。
 * 曲データを取得できなかったときの表示 (描画 controller) と、アプリのコード自体を読み込めなかったときの表示
 * (startup-error.mts) で同じ見た目を使う。後者は UI のコードを使えないので、文言は呼び出し元から受け取る。
 * @param text 表示する説明とボタンの文言
 * @param onReload ボタンを押したときに呼ぶ、ページを読み込み直す処理
 * @returns 結果一覧に置く項目
 */
export function createLoadErrorElement(text: LoadErrorViewText, onReload: () => void): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "result-empty-state result-load-error";
    const detail = document.createElement("p");
    detail.className = "result-empty-state-title";
    detail.textContent = text.detail;
    const reloadButton = document.createElement("button");
    reloadButton.type = "button";
    reloadButton.className = "result-reload-btn";
    reloadButton.textContent = text.reload;
    reloadButton.addEventListener("click", onReload);
    item.append(detail, reloadButton);
    return item;
}
