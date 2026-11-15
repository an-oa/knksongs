import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";

const SITE_ROOT_URL = new URL("../../../_site/", import.meta.url);
const CONTENT_TYPES: Record<string, string> = {
    ".css": "text/css",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json",
    ".mjs": "text/javascript",
    ".png": "image/png",
    ".svg": "image/svg+xml"
};

/**
 * 配布成果物 (_site) を返す HTTP サーバーを立てる。指定した path は、復旧させるまで 503 で失敗させる。
 * WebKit は、サーバーから実際に失敗を受け取った先読みを覚えていて、読み込み直しても取りに行かない。
 * Playwright の通信の差し替え (page.route) で失敗させた場合はこの挙動にならないので、実際のサーバーで失敗させる。
 * @param failingPath 失敗させる path の条件
 * @returns サーバーの URL、失敗させた回数、復旧と停止の操作
 */
export async function startFailingSiteServer(failingPath: RegExp) {
    const state = { isFailing: true, failedRequestCount: 0 };
    const server = createServer((request, response) => {
        const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
        if (state.isFailing && failingPath.test(path)) {
            state.failedRequestCount += 1;
            response.writeHead(503, { "content-type": "text/plain" }).end("unavailable");
            return;
        }
        const relativePath = path.endsWith("/") ? `${path}index.html` : path;
        readFile(new URL(`.${relativePath}`, SITE_ROOT_URL)).then((body) => {
            response.writeHead(200, { "content-type": CONTENT_TYPES[extname(relativePath)] ?? "application/octet-stream" }).end(body);
        }, () => {
            response.writeHead(404, { "content-type": "text/plain" }).end("not found");
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}/`,
        /** 失敗させた要求の数を返す。 */
        getFailedRequestCount: () => state.failedRequestCount,
        /** 以後の要求を成功させる。 */
        recover() { state.isFailing = false; },
        /** サーバーを止める。開いたままの接続も閉じる。 */
        async stop() {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
    };
}
