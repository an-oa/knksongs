import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { parseCsvToSongs } from "../../../app/lib/csv-parser.mts";
import { buildSongsJsonMetaPayload, buildSongsJsonPayload } from "../../../app/lib/songs-json.mts";
import { createSongsContentHash } from "../../../scripts/songs-content-hash.mts";

const SONGS_JSON_ROUTE = "**/data/songs.json*";
const SONGS_META_ROUTE = "**/data/songs-meta.json*";
const csvFixturePromise = readFile(new URL("../fixtures/smoke-songs.csv", import.meta.url), "utf8");
const songsJsonFixturePromise = csvFixturePromise.then((csv) => buildSongsJsonFixture(parseCsvToSongs(csv)));

/** 曲配列からsongs.jsonとmeta.jsonの応答を作る。 */
function buildSongsJsonFixture(songs: Song[], generatedAt = "2026-08-14T00:00:00.000Z") {
    const contentHash = createSongsContentHash(songs);
    return {
        json: JSON.stringify(buildSongsJsonPayload(songs, contentHash, generatedAt)),
        meta: JSON.stringify(buildSongsJsonMetaPayload(contentHash, generatedAt))
    };
}

/** metaのルートだけを置き換える。取得中のJSONの応答には触れない。 */
async function registerSongsMetaRoute(page: Page, meta: string): Promise<void> {
    await page.unroute(SONGS_META_ROUTE);
    await page.route(SONGS_META_ROUTE, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json; charset=utf-8",
            body: meta
        });
    });
}

/** JSONとmetaのルートを置き換え、必要な場合だけJSON応答の直前に待機する。 */
async function registerSongsJsonRoutes(
    page: Page,
    fixture: ReturnType<typeof buildSongsJsonFixture>,
    beforeSongsResponse?: () => Promise<void>
): Promise<void> {
    await registerSongsMetaRoute(page, fixture.meta);
    await page.unroute(SONGS_JSON_ROUTE);
    await page.route(SONGS_JSON_ROUTE, async (route) => {
        if (beforeSongsResponse) await beforeSongsResponse();
        await route.fulfill({
            status: 200,
            contentType: "application/json; charset=utf-8",
            body: fixture.json
        });
    });
}

/** 初期表示用の曲JSON・meta・CSVをローカルfixtureへ差し替える。 */
export async function installSongsNetworkMocks(page: Page): Promise<void> {
    const csvFixture = await csvFixturePromise;
    await registerSongsJsonRoutes(page, await songsJsonFixturePromise);
    await page.route("https://docs.google.com/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "text/csv; charset=utf-8",
            body: csvFixture
        });
    });
}

/** テストごとに曲JSONとmetaの応答を指定曲配列へ差し替える。 */
export async function routeSongsJsonFixture(page: Page, songs: Song[]): Promise<void> {
    await registerSongsJsonRoutes(page, buildSongsJsonFixture(songs));
}

/**
 * 既定の曲データを、指定した生成日時で公開し直したものへ、JSONとmetaの応答を差し替える。
 * CSVを元の内容へ戻して再生成した場合にあたる。内容のhashは既定の曲データと同じで、生成日時だけが新しい。
 * @param page 応答を差し替えるページ
 * @param generatedAt 公開し直したときの生成日時
 * @param scope metaだけを差し替えるときは "meta"。取得中のJSONの応答には触れない
 */
export async function routeRepublishedDefaultSongs(page: Page, generatedAt: string, scope: "meta" | "all" = "all"): Promise<void> {
    const fixture = buildSongsJsonFixture(parseCsvToSongs(await csvFixturePromise), generatedAt);
    if (scope === "meta") await registerSongsMetaRoute(page, fixture.meta);
    else await registerSongsJsonRoutes(page, fixture);
}

/** JSONの要求開始を通知し、テスト側が解放するまで応答を保留する。 */
export async function routeDeferredSongsJsonFixture(page: Page, songs: Song[], generatedAt = "2026-08-15T00:00:00.000Z") {
    const { promise: requestStarted, resolve: markRequestStarted } = Promise.withResolvers<void>();
    const { promise: responseRelease, resolve: releaseResponse } = Promise.withResolvers<void>();
    await registerSongsJsonRoutes(page, buildSongsJsonFixture(songs, generatedAt), async () => {
        markRequestStarted();
        await responseRelease;
    });
    return { requestStarted, releaseResponse };
}
