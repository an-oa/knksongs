import { test, expect, type Page } from "@playwright/test";
import { startFailingSiteServer } from "./support/failing-site-server.mts";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { getSongCard, waitForInitialLoad } from "./support/ui-helpers.mts";

const SONG_DATA_ROUTES = ["**/data/songs.json*", "**/data/songs-meta.json*", "https://docs.google.com/**"];

/**
 * 読み込めなくするアプリのコード。どれが失敗しても、同じ表示を出す。
 * refetchedRequestCount は、失敗を出すまでにサーバーへ届く、そのファイルへの要求の数 (最初の取得と、裏での取り直し)。
 */
const APP_CODE_FAILURES = [
    // UI のコード。入口の script は動くので、app/startup-error.mts が失敗を出す。
    { code: "the UI code", route: /\/browser\/bootstrap-[^/]+\.mjs/, refetchedRequestCount: 2 },
    // 入口の script。アプリのコードが 1 行も動かないので、index.html の埋め込みスクリプトが失敗を出す。先読みしないので取り直さない。
    { code: "the entry script", route: /\/browser\/startup-[^/]+\.mjs/, refetchedRequestCount: 1 },
    // 入口の script が import する共有のコード。これも埋め込みスクリプトが出す。
    { code: "the shared code", route: /\/browser\/chunk-[^/]+\.mjs/, refetchedRequestCount: 2 }
];

/**
 * 曲データの取得先 (生成済み JSON と、フォールバックの CSV) をすべて失敗させる。
 * @param page 操作するページ
 */
async function failSongData(page: Page) {
    for (const route of SONG_DATA_ROUTES) {
        await page.unroute(route);
        await page.route(route, (request) => request.abort());
    }
}

test("when the song data cannot be loaded, the page explains it and offers to reload", async ({ page }) => {
    await installNetworkMocks(page);
    await failSongData(page);
    await page.goto("/");

    await expect(page.locator("#resultCount")).toHaveText("読込エラー");
    const failure = page.locator("#resultList .result-load-error");
    await expect(failure).toContainText("曲データを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。");
    await expect(page.locator("#searchBox")).toBeDisabled();

    // 言語を切り替えても、読み込み中の表示には戻らない。
    await page.locator("#site-language-btn").click();
    await expect(failure).toContainText("The song data could not be loaded. Check your connection and reload the page.");
    await expect(page.locator("#resultCount")).toHaveText("Failed to load");
    await page.locator("#site-language-btn").click();

    // 通信が戻ってから再読み込みボタンを押すと、そのまま使える。
    await installNetworkMocks(page);
    await page.getByRole("button", { name: "再読み込み" }).click();
    await waitForInitialLoad(page);
    await expect(page.locator("#resultList .result-load-error")).toHaveCount(0);
    await page.locator("#searchBox").fill("Manual Song");
    await expect(getSongCard(page, "Manual Song")).toBeVisible();
});

test.describe("when the app code cannot be loaded", () => {
    for (const { locale, title, detail, reload } of [
        {
            locale: "ja-JP",
            title: "読込エラー",
            detail: "ページを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。",
            reload: "再読み込み"
        },
        {
            locale: "en-US",
            title: "Failed to load",
            detail: "The page could not be loaded. Check your connection and reload the page.",
            reload: "Reload"
        }
    ]) {
        test.describe(locale, () => {
            test.use({ locale });

            for (const { code, route } of APP_CODE_FAILURES) {
                test(`without ${code}, the page stops saying it is connecting and offers to reload`, async ({ page }) => {
                    await installNetworkMocks(page);
                    // コードの取得を、通信の失敗として途中で切る。
                    // 公開の直後に、古い HTML が消えた古いファイルを取りに行って 404 になった場合も、同じ経路で表示する。
                    await page.route(route, (request) => request.abort());
                    await page.goto("/");

                    await expect(page.locator("#resultCount")).toHaveText(title);
                    await expect(page.locator("#resultList .result-load-error")).toContainText(detail);
                    // 英語で開いたときに中身を隠す印は、文言を置き換える UI のコードが来ないので、ここで外す。
                    await expect(page.locator("html")).not.toHaveClass(/i18n-pending/);
                    await expect(page.locator("#resultList .result-load-error")).toBeVisible();
                    await expect(page.locator("#searchBox")).toBeDisabled();

                    await page.unroute(route);
                    await page.getByRole("button", { name: reload }).click();
                    await waitForInitialLoad(page);
                    await expect(page.locator("#resultList .result-load-error")).toHaveCount(0);
                    await page.locator("#searchBox").fill("Manual Song");
                    await expect(getSongCard(page, "Manual Song")).toBeVisible();
                });
            }
        });
    }

    for (const { code, route, refetchedRequestCount } of APP_CODE_FAILURES) {
        for (const { way, reloadPage } of [
            { way: "the browser's own reload", reloadPage: (page: Page) => page.reload() },
            { way: "the reload button", reloadPage: (page: Page) => page.getByRole("button", { name: "再読み込み" }).click() }
        ]) {
            test(`${way} recovers after the server failed to deliver ${code}`, async ({ page }) => {
                // WebKit は、サーバーから失敗を受け取った先読みを覚えていて、読み込み直しても取りに行かない。
                // 通信の差し替えでは再現しないので、実際のサーバーに失敗を返させる。
                const server = await startFailingSiteServer(route);
                try {
                    await installNetworkMocks(page);
                    await page.goto(server.url);
                    await expect(page.locator("#resultList .result-load-error")).toBeVisible();
                    // 失敗を出した時に、ページは先読みした module を裏で取り直す。サーバーはまだ失敗を返す。
                    await expect.poll(() => server.getFailedRequestCount()).toBe(refetchedRequestCount);

                    server.recover();
                    await reloadPage(page);
                    await waitForInitialLoad(page);
                    await expect(page.locator("#resultList .result-load-error")).toHaveCount(0);
                    await page.locator("#searchBox").fill("Manual Song");
                    await expect(getSongCard(page, "Manual Song")).toBeVisible();
                } finally {
                    await server.stop();
                }
            });
        }
    }
});
