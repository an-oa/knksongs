import { defineConfig, devices } from "@playwright/test";

/** E2E で _site を配信するポートの既定値。 */
const DEFAULT_E2E_PORT = 4173;

/**
 * E2E で _site を配信するポートを返す。環境変数 E2E_PORT があれば、その番号を使う。
 * 同じ機械で別の E2E が動いているときに、ポートを分けて実行できるようにする。
 * @returns 配信に使うポート
 */
function resolveE2ePort() {
    const raw = process.env.E2E_PORT;
    if (raw === undefined || raw === "") return DEFAULT_E2E_PORT;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error(`E2E_PORT must be an integer from 1024 to 65535, but got ${JSON.stringify(raw)}`);
    }
    return port;
}

const e2ePort = resolveE2ePort();
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 30_000,
    expect: {
        timeout: 5_000
    },
    fullyParallel: true,
    retries: 0,
    reporter: "list",
    use: {
        baseURL: e2eBaseUrl,
        // サイトの言語はブラウザの言語で初期値が変わる。既存のテストは日本語の画面を前提にするため、日本語のブラウザとして動かす。
        // 言語ごとの初期表記は tests/e2e/site-language.spec.mts で locale を指定して検証する。
        locale: "ja-JP",
        headless: true,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure"
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"]
            }
        },
        {
            name: "webkit",
            use: {
                ...devices["Desktop Safari"]
            }
        },
        {
            name: "firefox",
            use: {
                ...devices["Desktop Firefox"]
            }
        }
    ],
    webServer: {
        command: `python3 -m http.server ${e2ePort} --bind 127.0.0.1 --directory _site`,
        url: e2eBaseUrl,
        // すでに動いているサーバーは使い回さず、ポートが使用中なら開始時に失敗させる。
        // 使い回すと、同じ機械の別の作業が同じポートで配信している別の _site を相手にテストが動き、
        // 無関係な失敗や、見かけだけの成功が出る。その場合は E2E_PORT で別のポートを指定する。
        reuseExistingServer: false
    }
});
