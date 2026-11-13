/** 読み込み直す前の取り直しを待つ上限。通信が止まっていても、ここで切り上げて読み込み直す。 */
export const MODULE_REFRESH_TIMEOUT_MS = 3000;

type PageReloadOptions = {
    /** 取り直しを待つ上限。省略時は MODULE_REFRESH_TIMEOUT_MS。 */
    timeoutMs?: number;
};

/**
 * HTML が先読み (modulepreload) を指定している module の URL を返す。
 * @returns 先読みを指定している module の URL
 */
function getPreloadedModuleUrls(): string[] {
    return Array.from(document.querySelectorAll('link[rel="modulepreload"]'))
        .map((link) => (link as HTMLLinkElement).href)
        .filter((url) => typeof url === "string" && url !== "");
}

/**
 * 指定した URL を、キャッシュを使わずに取り直す。失敗しても待ち時間を過ぎても、例外にせず終える。
 * @param urls 取り直す URL
 * @param timeoutMs 待つ上限
 */
async function refreshUrls(urls: string[], timeoutMs: number): Promise<void> {
    if (urls.length === 0 || typeof fetch !== "function") return;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    try {
        await Promise.allSettled(urls.map((url) => fetch(url, { cache: "reload", signal: abortController.signal })));
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * ページを読み込み直す。読み込みに失敗したときに出す「再読み込み」ボタンから使う。
 * その前に、HTML が先読みを指定している module を、キャッシュを使わずに取り直す。
 * WebKit は、先読みに失敗した module を覚えていて、読み込み直しても取りに行かないため、
 * そのまま読み込み直すと、通信が戻っていても同じ失敗を繰り返す。取り直しておくと、読み込み直した後は成功する。
 * 取り直しに失敗しても、待ち時間を過ぎても、読み込み直しは行う。
 * @param options 取り直しを待つ上限
 */
export async function reloadPage(options: PageReloadOptions = {}): Promise<void> {
    await refreshUrls(getPreloadedModuleUrls(), options.timeoutMs ?? MODULE_REFRESH_TIMEOUT_MS);
    window.location.reload();
}
