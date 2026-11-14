import { getUiText, type ResultCountSummary } from "../../lib/ui-text.mjs";
import type { SiteLanguageUiRuntimeState } from "../../state.types.mjs";

/**
 * 結果一覧の上の件数表示に出す内容。言語を切り替えたときに今の言語で書き直せるよう、文言ではなく状態で持つ。
 * 件数表示を書くのはこの controller だけにし、読み込みと検索は状態を渡すだけにする。
 */
export type ResultCountState =
    | { kind: "connecting" }
    | { kind: "loadingData" }
    | { kind: "loadError" }
    | { kind: "results"; summary: ResultCountSummary };

type ResultCountControllerInput = {
    ui: {
        el: { resultCount?: Pick<HTMLElement, "innerText"> | null };
        language: SiteLanguageUiRuntimeState;
    };
};

/**
 * 結果一覧の上の件数表示を、状態から今の言語の文言で書く controller を作成する。
 * @param input 件数表示の要素とサイトの言語
 */
export function createResultCountController({ ui }: ResultCountControllerInput) {
    let state: ResultCountState = { kind: "connecting" };

    /**
     * 今の状態を、今の言語の文言で書く。言語を切り替えたときにも呼ぶ。
     */
    function render(): void {
        if (!ui.el.resultCount) return;
        const results = getUiText(ui.language.current).results;
        ui.el.resultCount.innerText = state.kind === "results"
            ? results.count(state.summary)
            : results[state.kind];
    }

    /**
     * 件数表示の状態を変えて書く。
     * @param next 新しい状態
     */
    function show(next: ResultCountState): void {
        state = next;
        render();
    }

    return { show, render };
}
