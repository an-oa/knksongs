import type { AppUiState } from "../../state.types.mjs";

type AutoHideHeaderControllerInput = {
    ui: Pick<AppUiState, "el">;
    isSidebarOpen?: () => boolean;
    scrollDeltaPx?: number;
};

type ScrollDirection = -1 | 0 | 1;

const DEFAULT_SCROLL_DELTA_PX = 16;
// ページを送るキー。検索窓の中でもページをスクロールするので、ホイールと同じく読み進める操作として扱う。
const PAGE_SCROLL_KEYS = new Set(["PageDown", "PageUp"]);

/**
 * ページスクロール方向に応じてヘッダーを退避・再表示する controller を作成する。
 */
export function createAutoHideHeaderController(input: AutoHideHeaderControllerInput) {
    const { ui } = input;
    const isSidebarOpen = input.isSidebarOpen || (() => false);
    const scrollDeltaPx = Number.isFinite(input.scrollDeltaPx) && Number(input.scrollDeltaPx) > 0
        ? Number(input.scrollDeltaPx)
        : DEFAULT_SCROLL_DELTA_PX;
    let lastScrollY = 0;
    let directionStartY = 0;
    let scrollDirection: ScrollDirection = 0;
    let isScrollUpdateScheduled = false;
    let isSetup = false;
    // ヘッダー内のキーボードフォーカスを理由に、表示を保つか。
    // ホイールや指、PageDown / PageUp でスクロールするか、スクロールバーなどヘッダーの外を押すと外し、
    // ヘッダー内へのフォーカスや、それ以外のキー操作・入力で戻す。
    let isFocusGuardActive = true;

    /**
     * 初期化済みのヘッダー要素を返す。
     * @returns {HTMLElement | null}
     */
    function getHeader(): HTMLElement | null {
        const header = ui.el.header;
        return header instanceof HTMLElement ? header : null;
    }

    /**
     * overscroll の負値を除いた現在のページスクロール位置を返す。
     * @returns {number}
     */
    function getPageScrollY(): number {
        if (Number.isFinite(window.scrollY)) return Math.max(0, window.scrollY);
        const scrollTop = document.scrollingElement?.scrollTop;
        return Number.isFinite(scrollTop) ? Math.max(0, Number(scrollTop)) : 0;
    }

    /**
     * ヘッダーの退避状態を更新する。
     * @param {boolean} isHidden
     */
    function setHeaderHidden(isHidden: boolean): void {
        const header = getHeader();
        if (!header) return;
        header.classList.toggle("is-auto-hidden", isHidden);
    }

    /**
     * 指定位置を起点としてスクロール方向と移動量の計測をやり直す。
     * @param {number} scrollY
     */
    function resetScrollTracking(scrollY: number): void {
        lastScrollY = scrollY;
        directionStartY = scrollY;
        scrollDirection = 0;
    }

    /**
     * ヘッダーを表示し、次の方向判定を現在位置から開始する。
     * @param {number} scrollY
     */
    function showHeaderFrom(scrollY: number): void {
        setHeaderHidden(false);
        resetScrollTracking(scrollY);
    }

    /**
     * ヘッダー内で現在フォーカス可視になっている要素があるか判定する。
     * @returns {boolean}
     */
    function hasFocusVisibleHeaderElement(): boolean {
        const header = getHeader();
        const activeElement = document.activeElement;
        return Boolean(
            header
            && activeElement instanceof Element
            && header.contains(activeElement)
            && activeElement.matches(":focus-visible")
        );
    }

    /**
     * ヘッダー内のキーボードフォーカスを理由に、スクロールしてもヘッダーを表示し続けるか判定する。
     * 検索窓は、マウスやタップで入れても :focus-visible になる。そのため、ホイールや指、PageDown / PageUp で
     * スクロールした後や、スクロールバーなどヘッダーの外を押した後は一覧を読み進めているとみなし、
     * フォーカスが残っていても隠せるようにする。
     * 矢印キーなどでのスクロールや、入力中に結果の描き直しやキーボード表示でページが動いたときは隠さない。
     * @returns 表示し続けるとき true
     */
    function isHeaderKeptByFocus(): boolean {
        return isFocusGuardActive && hasFocusVisibleHeaderElement();
    }

    /**
     * 上端付近で常に表示する範囲として、今のヘッダーの高さを返す。
     * 初期化時に一度だけ測ると、CSS が当たる前の高さを使い続けることがあるので、判定のたびに測る。
     * 狭い画面でヘッダーが 2 段になったときの高さにも、そのまま追従する。
     * @returns ヘッダーの高さ。ヘッダーがなければ 0
     */
    function getTopVisibilityBoundary(): number {
        const header = getHeader();
        return header ? Math.max(0, header.getBoundingClientRect().height) : 0;
    }

    /**
     * 現在位置と直前からの移動方向に応じてヘッダー表示を同期する。
     */
    function syncHeaderForScroll(): void {
        isScrollUpdateScheduled = false;
        const scrollY = getPageScrollY();
        if (isSidebarOpen() || isHeaderKeptByFocus() || scrollY <= getTopVisibilityBoundary()) {
            showHeaderFrom(scrollY);
            return;
        }
        if (scrollY === lastScrollY) return;

        const nextDirection: ScrollDirection = scrollY > lastScrollY ? 1 : -1;
        if (nextDirection !== scrollDirection) {
            scrollDirection = nextDirection;
            directionStartY = lastScrollY;
        }
        lastScrollY = scrollY;
        if (Math.abs(scrollY - directionStartY) < scrollDeltaPx) return;

        setHeaderHidden(nextDirection === 1);
        resetScrollTracking(scrollY);
    }

    /**
     * 同一フレーム内の scroll イベントをまとめて表示判定する。
     */
    function scheduleScrollSync(): void {
        if (isScrollUpdateScheduled) return;
        isScrollUpdateScheduled = true;
        requestAnimationFrame(syncHeaderForScroll);
    }

    /**
     * ヘッダー内へフォーカスが入ったとき、次の描画前にヘッダーを表示する。
     */
    function handleHeaderFocusIn(): void {
        isFocusGuardActive = true;
        showHeaderFrom(getPageScrollY());
    }

    /**
     * ホイールや指、ページを送るキーでのスクロール操作を受け、ヘッダー内のフォーカスによる表示の維持を外す。
     * 隠すかどうかは、続く scroll イベントでスクロールの向きを見て決める。
     */
    function handleScrollGesture(): void {
        isFocusGuardActive = false;
    }

    /**
     * ヘッダーの外でポインタを押したとき、ヘッダー内のフォーカスによる表示の維持を外す。
     * スクロールバーのつまみのドラッグやトラックのクリックには wheel も touchmove も届かないが、
     * ページへの pointerdown は届く。検索窓を押したときは、キーボードが開くときの自動スクロールで隠さないよう外さない。
     * 他の処理が伝播を止めても受けられるよう、捕捉の段階で受ける。
     * @param event 押されたポインタのイベント
     */
    function handlePointerDown(event: PointerEvent): void {
        const header = getHeader();
        if (header && event.target instanceof Element && header.contains(event.target)) return;
        isFocusGuardActive = false;
    }

    /**
     * ヘッダー内での文字入力やキー操作を受け、ヘッダーを表示してフォーカスによる表示の維持を戻す。
     * スクロールで隠れた後に検索窓へ続けて入力しても、入力欄が見えないままにならないようにする。
     * ブラウザやキーボードによっては文字入力で keydown が届かないことがあるため、input でも受ける。
     */
    function handleHeaderInput(): void {
        isFocusGuardActive = true;
        showHeaderFrom(getPageScrollY());
    }

    /**
     * ヘッダー内でのキー操作を受ける。ページを送るキーはスクロール操作として扱い、それ以外は入力として扱う。
     * @param event 押されたキーのイベント
     */
    function handleHeaderKeyDown(event: KeyboardEvent): void {
        if (PAGE_SCROLL_KEYS.has(event.key)) {
            handleScrollGesture();
            return;
        }
        handleHeaderInput();
    }

    /**
     * ヘッダー外へフォーカスが移ったら方向判定を現在位置から再開する。
     * @param {FocusEvent} event
     */
    function handleHeaderFocusOut(event: FocusEvent): void {
        const header = getHeader();
        if (header && event.relatedTarget instanceof Element && header.contains(event.relatedTarget)) return;
        resetScrollTracking(getPageScrollY());
    }

    /**
     * 通常再読込や bfcache 復帰で復元された位置でもヘッダーを最初は表示する。
     */
    function handlePageShow(): void {
        showHeaderFrom(getPageScrollY());
    }

    /**
     * 初期位置を記録し、ページ操作の監視を開始する。
     * 画面幅の変更ではヘッダーの高さが変わることがあるので、スクロールと同じく表示を判定し直す。
     */
    function setup(): void {
        if (isSetup) return;
        const header = getHeader();
        if (!header) return;
        isSetup = true;
        showHeaderFrom(getPageScrollY());
        window.addEventListener("scroll", scheduleScrollSync, { passive: true });
        window.addEventListener("resize", scheduleScrollSync);
        window.addEventListener("pageshow", handlePageShow);
        window.addEventListener("wheel", handleScrollGesture, { passive: true });
        window.addEventListener("touchmove", handleScrollGesture, { passive: true });
        window.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
        header.addEventListener("focusin", handleHeaderFocusIn);
        header.addEventListener("focusout", handleHeaderFocusOut);
        header.addEventListener("keydown", handleHeaderKeyDown);
        header.addEventListener("input", handleHeaderInput);
    }

    /**
     * プログラムでスクロール位置を合わせた後に、今の位置を方向判定の起点にし直す。
     * 利用者のスクロールではないので、ヘッダーの表示状態は変えない。
     */
    function resetScrollBaseline(): void {
        resetScrollTracking(getPageScrollY());
    }

    /**
     * サイドバーの開閉通知を受けてヘッダーを表示し、方向判定をやり直す。
     * 開閉状態そのものは入力された getter から参照する。
     */
    function handleSidebarOpenChange(): void {
        showHeaderFrom(getPageScrollY());
    }

    return {
        setup,
        handleSidebarOpenChange,
        resetScrollBaseline
    };
}
