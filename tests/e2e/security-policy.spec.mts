import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { installNetworkMocks } from "./support/network-mocks.mts";
import { waitForInitialLoad } from "./support/ui-helpers.mts";

declare global {
    interface Window {
        __knkCspViolations: { directive: string; blockedUri: string }[];
    }
}

/** ページの読み込み前から CSP 違反を記録し、許可経路と遮断経路を観測する。 */
async function observePolicyViolations(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.__knkCspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
            window.__knkCspViolations.push({ directive: event.effectiveDirective, blockedUri: event.blockedURI });
        });
    });
}

test("CSP blocks injected inline scripts, event handlers and untrusted external scripts", async ({ page }) => {
    await observePolicyViolations(page);
    await installNetworkMocks(page);
    let externalRequests = 0;
    await page.route("https://untrusted.example/csp.js", async (route) => {
        externalRequests++;
        await route.fulfill({ contentType: "application/javascript", body: 'document.documentElement.dataset.cspExternal = "ran";' });
    });
    await page.goto("/");
    await waitForInitialLoad(page);
    expect(await page.evaluate(() => window.__knkCspViolations)).toEqual([]);
    await page.evaluate(() => {
        const inlineScript = document.createElement("script");
        inlineScript.textContent = 'document.documentElement.dataset.cspInline = "ran";';
        document.head.append(inlineScript);
        const button = document.createElement("button");
        button.setAttribute("onclick", 'document.documentElement.dataset.cspHandler = "ran";');
        document.body.append(button);
        button.click();
        const externalScript = document.createElement("script");
        externalScript.src = "https://untrusted.example/csp.js";
        document.head.append(externalScript);
    });
    await expect.poll(() => page.evaluate(() => window.__knkCspViolations.length)).toBe(3);
    expect(await page.locator("html").getAttribute("data-csp-inline")).toBeNull();
    expect(await page.locator("html").getAttribute("data-csp-handler")).toBeNull();
    expect(await page.locator("html").getAttribute("data-csp-external")).toBeNull();
    expect(externalRequests).toBe(0);
});

test("CSP permits early theme initialization and the YouTube widget and both embed hosts", async ({ page }) => {
    await observePolicyViolations(page);
    await installNetworkMocks(page);
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    const { promise: uiReady, resolve: releaseUi } = Promise.withResolvers<void>();
    await page.route("**/browser/bootstrap-*.mjs*", async (route) => {
        await uiReady;
        await route.continue();
    });
    try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#searchBox")).toBeDisabled();
        await expect(page.locator("html")).toHaveClass("dark-theme");
        expect(await page.locator("html").evaluate((element) => element.style.colorScheme)).toBe("dark");
    } finally {
        releaseUi();
    }
    await waitForInitialLoad(page);
    const widgetUrl = "https://www.youtube.com/s/player/csp-fixture/www-widgetapi.vflset/www-widgetapi.js";
    await page.route(widgetUrl, async (route) => {
        await route.fulfill({ contentType: "application/javascript", body: 'document.documentElement.dataset.cspWidget = "loaded";' });
    });
    await page.route("https://www.youtube-nocookie.com/embed/**", async (route) => {
        await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>privacy embed</title>" });
    });
    await page.evaluate(async (widgetUrl) => {
        const script = document.createElement("script");
        script.src = widgetUrl;
        const widgetLoaded = new Promise<void>((resolve, reject) => {
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("YouTube widget was blocked"));
        });
        document.head.append(script);
        await widgetLoaded;
        for (const host of ["www.youtube.com", "www.youtube-nocookie.com"]) {
            const iframe = document.createElement("iframe");
            iframe.src = `https://${host}/embed/csp-fixture`;
            const loaded = new Promise<void>((resolve) => { iframe.onload = () => resolve(); });
            document.body.append(iframe);
            await loaded;
        }
    }, widgetUrl);
    await expect(page.locator("html")).toHaveAttribute("data-csp-widget", "loaded");
    expect(await page.evaluate(() => window.__knkCspViolations)).toEqual([]);
});

test("CSP permits the CSV fallback and the Google Sheets redirect origin", async ({ page }) => {
    await observePolicyViolations(page);
    await installNetworkMocks(page);
    await page.route("**/data/songs*.json*", (route) => route.abort("failed"));
    const csv = await readFile(new URL("./fixtures/smoke-songs.csv", import.meta.url), "utf8");
    const redirectUrl = "https://doc-csp-sheets.googleusercontent.com/pub/fixture.csv";
    let redirectRequests = 0;
    await page.route(redirectUrl, async (route) => {
        redirectRequests++;
        await route.fulfill({ contentType: "text/csv", headers: { "access-control-allow-origin": "*" }, body: csv });
    });
    await page.goto("/");
    await waitForInitialLoad(page);
    // Playwrightのrouteはredirect後のURLを差し替えないため、redirect先の取得も独立して検証する。
    expect(await page.evaluate(async (url) => (await fetch(url)).text(), redirectUrl)).toBe(csv);
    expect(redirectRequests).toBe(1);
    expect(await page.evaluate(() => window.__knkCspViolations)).toEqual([]);
});
