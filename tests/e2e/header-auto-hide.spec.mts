import { test, expect, type Locator, type Page } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { routeSongsJsonFixture } from "./support/songs-network.mts";
import { createScrollableResultSongs } from "./support/song-fixtures.mts";
import {
    closeSidebar,
    openSidebar,
    waitForInitialLoad
} from "./support/ui-helpers.mts";

test.beforeEach(async ({ page }) => {
    await installNetworkMocks(page);
    await page.goto("/");
    await page.evaluate(() => {
        localStorage.clear();
    });
    await page.reload();
    await waitForInitialLoad(page);
});

/**
 * スクロール可能な検索結果を読み込み、サイドバーを閉じた状態にする。
 */
async function loadScrollableResults(page: Page) {
    await routeSongsJsonFixture(page, createScrollableResultSongs(60));
    await page.reload();
    await waitForInitialLoad(page);
    await page.locator("#searchBox").fill("Scroll Artist");
    await expect(page.locator(".song-card")).toHaveCount(48);
    // scrollTo はホイールや指の操作を伴わないので、検索窓にフォーカスが残っていると入力中とみなして隠さない。
    // ここではスクロールの向きによる表示の切り替えを確かめるため、入力後にフォーカスを外す。
    // フォーカスを残したままの一連の操作は、下の「検索窓に入力した後」のテストで確かめる。
    await page.locator("#searchBox").blur();
}

/**
 * 利用者と同じく検索窓を押して検索語を入力し、フォーカスを残したまま、スクロールできる検索結果を表示する。
 * @param page 検証するページ
 * @param pressSearchBox 検索窓を押す操作。タッチ画面ではタップにする
 */
async function typeSearchForScrollableResults(page: Page, pressSearchBox: (searchBox: Locator) => Promise<void>) {
    await routeSongsJsonFixture(page, createScrollableResultSongs(60));
    await page.reload();
    await waitForInitialLoad(page);
    const searchBox = page.locator("#searchBox");
    await pressSearchBox(searchBox);
    await page.keyboard.type("Scroll Artist");
    await expect(page.locator(".song-card")).not.toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
        .toBeGreaterThan(600);
    await expect(searchBox).toBeFocused();
    await expect(page.locator(".header")).not.toHaveClass(/is-auto-hidden/);
}

/**
 * 次の描画まで待ち、スクロールに応じたヘッダーの表示判定を終わらせる。
 * @param page 検証するページ
 */
async function waitForAnimationFrames(page: Page) {
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
}

test("after typing in the search box, scrolling down with the wheel hides the header", async ({ page }) => {
    await typeSearchForScrollableResults(page, (searchBox) => searchBox.click());
    const header = page.locator(".header");
    const searchBox = page.locator("#searchBox");

    // 入力を終えて、フォーカスを外さずに一覧の上でホイールを回す。
    await page.mouse.move(640, 500);
    await page.mouse.wheel(0, 400);
    await expect(header).toHaveClass(/is-auto-hidden/);
    await expect(searchBox).toBeFocused();
    // WebKit はホイールのスクロールを滑らかに動かすので、隠れた時点ではまだ先頭の近くにいることがある。
    // ページの先頭付近ではヘッダーを常に表示するため、スクロールが止まるまで待ってから次へ進む。
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);

    // 続けてキーを押すと、検索窓が見えるようヘッダーを戻す。
    // 結果を描き直すとページの先頭へ戻って表示の理由が変わるので、カーソルを動かすだけのキーで確かめる。
    // ブラウザもカーソルを見せるためにページを少し戻すことがあるが、先頭付近までは戻らない。
    await page.keyboard.press("ArrowLeft");
    await expect(header).not.toHaveClass(/is-auto-hidden/);
    const headerHeight = await header.evaluate((element) => element.getBoundingClientRect().height);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(headerHeight);
});

test("while typing in the search box, the page moving by itself keeps the header visible", async ({ page }) => {
    await typeSearchForScrollableResults(page, (searchBox) => searchBox.click());
    const header = page.locator(".header");

    // 結果の描き直しやソフトウェアキーボードの表示では、利用者がスクロールしなくてもページが動く。
    await page.evaluate(() => window.scrollTo(0, 320));
    await waitForAnimationFrames(page);
    await expect(header).not.toHaveClass(/is-auto-hidden/);

    // 同じ位置から利用者がホイールで下へ進めば隠れる。
    await page.mouse.move(640, 500);
    await page.mouse.wheel(0, 200);
    await expect(header).toHaveClass(/is-auto-hidden/);
});

test.describe("on a touch screen", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

    test("after typing in the search box, swiping up hides the header", async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "指でなぞる操作は Chromium の DevTools Protocol でだけ送れる");
        await typeSearchForScrollableResults(page, (searchBox) => searchBox.tap());
        const header = page.locator(".header");

        // 入力を終えて、フォーカスを外さずに一覧を指で上へなぞり、下へ読み進める。
        // Playwright の touchscreen は tap しかないので、触れたまま動かす操作はこちらで送る。
        // Input.synthesizeScrollGesture は、この環境ではページをスクロールさせないため使わない。
        const client = await page.context().newCDPSession(page);
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y: 700 }] });
        for (let step = 1; step <= 10; step++) {
            await client.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [{ x: 206, y: 700 - step * 40 }]
            });
        }
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await client.detach();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
        await expect(header).toHaveClass(/is-auto-hidden/);
        await expect(page.locator("#searchBox")).toBeFocused();
    });
});

test("header hides on downward scroll and returns on upward scroll", async ({ page }) => {
    await loadScrollableResults(page);

    const header = page.locator(".header");
    await expect(header).not.toHaveClass(/is-auto-hidden/);

    await page.evaluate(() => window.scrollTo(0, 320));
    await expect(header).toHaveClass(/is-auto-hidden/);

    await page.evaluate(() => window.scrollBy(0, -20));
    await expect(header).not.toHaveClass(/is-auto-hidden/);

    await openSidebar(page);
    await page.evaluate(() => window.scrollBy(0, 80));
    await expect(header).not.toHaveClass(/is-auto-hidden/);

    await closeSidebar(page);
    await expect(header).not.toHaveClass(/is-auto-hidden/);

    await page.evaluate(() => window.scrollBy(0, 20));
    await expect(header).toHaveClass(/is-auto-hidden/);
});

test("header hides on downward scroll even when styles arrive after the app starts", async ({ page }) => {
    // styles.css の到着を遅らせ、CSS が当たる前にアプリが初期化される状況を作る。
    // アプリ本体は動的 import で読み込むので、WebKit では CSS を待たずに初期化され、
    // そのとき測ったヘッダーの高さを使い続けると、実際の高さより下までスクロールしても隠れなかった。
    await page.route("**/styles.css*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
    });
    await loadScrollableResults(page);

    const header = page.locator(".header");
    await expect(header).not.toHaveClass(/is-auto-hidden/);

    await page.evaluate(() => window.scrollTo(0, 320));
    await expect(header).toHaveClass(/is-auto-hidden/);
});

test("Tab focus reveals the hidden header before the next frame", async ({ page }) => {
    await loadScrollableResults(page);

    const header = page.locator(".header");
    const menuButton = page.locator("#open-sidebar");
    // ヘッダーの直後にある、結果の概要行の先頭の条件チップから Shift+Tab で戻る。
    const firstConditionChip = page.locator("#resultConditions .result-condition-chip").first();
    await firstConditionChip.focus();
    await expect(firstConditionChip).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, 320));
    await expect(header).toHaveClass(/is-auto-hidden/);

    await page.evaluate(() => {
        window.headerHiddenAtKeyboardFocusFrame = null;
        document.addEventListener("focusin", (event) => {
            if (!(event.target instanceof HTMLElement) || event.target.id !== "open-sidebar") return;
            requestAnimationFrame(() => {
                window.headerHiddenAtKeyboardFocusFrame = document.querySelector(".header")
                    ?.classList.contains("is-auto-hidden") ?? null;
            });
        }, { once: true });
    });

    await page.keyboard.press("Shift+Tab");

    await expect(menuButton).toBeFocused();
    await expect.poll(() => menuButton.evaluate((element) => element.matches(":focus-visible")))
        .toBe(true);
    await expect.poll(() => page.evaluate(() => window.headerHiddenAtKeyboardFocusFrame))
        .toBe(false);
    await expect(header).not.toHaveClass(/is-auto-hidden/);

    await page.evaluate(() => window.scrollBy(0, 80));
    await expect(header).not.toHaveClass(/is-auto-hidden/);
});

test("reduced motion keeps header visibility changes but removes sliding", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadScrollableResults(page);

    const header = page.locator(".header");
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).transitionDuration))
        .toBe("0s");

    await page.evaluate(() => window.scrollTo(0, 320));
    await expect(header).toHaveClass(/is-auto-hidden/);

    await page.evaluate(() => window.scrollBy(0, -20));
    await expect(header).not.toHaveClass(/is-auto-hidden/);
});
