import { parseCsvToSongs } from "./csv-parser.mjs";
import {
    compareSongsJsonArtifactFreshness,
    parseSongsJsonMetaPayload,
    parseSongsJsonPayload
} from "./songs-json.mjs";
import type { SongsJsonArtifactMetadata, SongsJsonPayload } from "./songs-json.mjs";

export const DEFAULT_CACHED_SONGS_NETWORK_TIMEOUT_MS = 5000;
export const DEFAULT_SONGS_META_RESPONSE_TIMEOUT_MS = 2000;
export const DEFAULT_SONGS_JSON_RESPONSE_TIMEOUT_MS = 2000;
// キャッシュがないときは、待つのをやめても代わりに出せる曲データがないので、response を長く待つ。
export const DEFAULT_UNCACHED_SONGS_JSON_RESPONSE_TIMEOUT_MS = 10000;
export const DEFAULT_SONGS_JSON_BODY_TIMEOUT_MS = 30000;
// キャッシュで表示した後も続ける、公開JSONの取得全体の上限。
export const DEFAULT_SONGS_JSON_BACKGROUND_TIMEOUT_MS = 60000;
export const DEFAULT_SONGS_CSV_RESPONSE_TIMEOUT_MS = 3000;
export const DEFAULT_SONGS_CSV_BODY_TIMEOUT_MS = 30000;

type SongsJsonCache = {
    getText: () => Promise<string | null>;
    getLegacyText?: () => string | null;
    setText: (value: string) => Promise<boolean>;
    removeText: () => Promise<void>;
};

type SongsDataSourceInput = {
    publicSongsJsonUrl?: string;
    publicSongsMetaUrl?: string;
    publicCsvUrl: string;
    songsJsonCache?: SongsJsonCache;
    cachedSongsNetworkTimeoutMs?: number;
    songsMetaResponseTimeoutMs?: number;
    songsJsonResponseTimeoutMs?: number;
    uncachedSongsJsonResponseTimeoutMs?: number;
    songsJsonBodyTimeoutMs?: number;
    songsJsonBackgroundTimeoutMs?: number;
    csvResponseTimeoutMs?: number;
    csvBodyTimeoutMs?: number;
};

export type SongsSnapshot = {
    songs: Song[];
    source: "cache" | "network";
};

type NetworkSongsJsonCandidate = {
    jsonText: string;
    payload: SongsJsonPayload;
};

type CachedSongsJsonCandidate = {
    jsonText: string;
    needsMigration: boolean;
    payload: SongsJsonPayload | null;
};

/** 待つ側の期限では中断しない取得。response の受信と本文の読込を別々に待てる。 */
type TextDownload = {
    /** response を受信したら解決する。 */
    responded: Promise<void>;
    /** 本文を読み終えたら、その文字列で解決する。 */
    text: Promise<string>;
};

/**
 * 曲データの取得元とJSONキャッシュ更新を扱う data source を作成する。
 * @param input 公開データURLとJSONキャッシュ
 */
export function createSongsDataSource(input: SongsDataSourceInput) {
    const {
        publicSongsJsonUrl,
        publicSongsMetaUrl,
        publicCsvUrl,
        songsJsonCache,
        cachedSongsNetworkTimeoutMs = DEFAULT_CACHED_SONGS_NETWORK_TIMEOUT_MS,
        songsMetaResponseTimeoutMs = DEFAULT_SONGS_META_RESPONSE_TIMEOUT_MS,
        songsJsonResponseTimeoutMs = DEFAULT_SONGS_JSON_RESPONSE_TIMEOUT_MS,
        uncachedSongsJsonResponseTimeoutMs = DEFAULT_UNCACHED_SONGS_JSON_RESPONSE_TIMEOUT_MS,
        songsJsonBodyTimeoutMs = DEFAULT_SONGS_JSON_BODY_TIMEOUT_MS,
        songsJsonBackgroundTimeoutMs = DEFAULT_SONGS_JSON_BACKGROUND_TIMEOUT_MS,
        csvResponseTimeoutMs = DEFAULT_SONGS_CSV_RESPONSE_TIMEOUT_MS,
        csvBodyTimeoutMs = DEFAULT_SONGS_CSV_BODY_TIMEOUT_MS
    } = input;

    /** 各段階の待ち時間を共通期限までに制限し、期限切れなら次の通信を開始しない。 */
    function remainingTimeout(timeoutMs: number, deadline: number): number {
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new Error("songs network deadline exceeded");
        return Math.min(timeoutMs, remaining);
    }

    /**
     * response受信待ちと本文読込に別々の期限を設ける。
     * response受信後は短い待機期限を解除し、大きい本文を低速回線でも読み切れるようにする。
     * @param url 取得URL
     * @param cacheMode fetch cache mode
     * @param responseTimeoutMs response受信までの期限
     * @param bodyTimeoutMs response本文読込の期限
     * @param deadline metaとJSON本体に共通する通信期限（performance.now基準）
     * @returns response本文
     */
    async function fetchTextWithTimeout(
        url: string,
        cacheMode: RequestCache,
        responseTimeoutMs: number,
        bodyTimeoutMs: number,
        deadline: number
    ): Promise<string> {
        const abortController = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(
            () => abortController.abort(),
            remainingTimeout(responseTimeoutMs, deadline)
        );
        const requestInit: RequestInit = {
            cache: cacheMode,
            signal: abortController.signal
        };
        try {
            const response = await fetch(url, requestInit);
            clearTimeout(timeoutId);
            timeoutId = null;
            if (!response.ok) throw new Error(`fetch failed: ${url}`);
            timeoutId = setTimeout(
                () => abortController.abort(),
                remainingTimeout(bodyTimeoutMs, deadline)
            );
            const text = await response.text();
            // タイマー実行が遅れた場合も、期限後の応答は採用しない。
            remainingTimeout(bodyTimeoutMs, deadline);
            return text;
        } catch (error) {
            abortController.abort();
            throw error;
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    }

    /**
     * 取得全体に 1 つの上限だけを設けて取得を始める。
     * 待つ側の期限では中断しないので、表示をキャッシュへ切り替えた後も取得を続けられる。
     * @param url 取得URL
     * @param cacheMode fetch cache mode
     * @param totalTimeoutMs response受信から本文読込までの全体の上限
     * @returns response受信と本文読込を別々に待てる取得
     */
    function startTextDownload(url: string, cacheMode: RequestCache, totalTimeoutMs: number): TextDownload {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), totalTimeoutMs);
        const response = fetch(url, { cache: cacheMode, signal: abortController.signal }).then((received) => {
            if (!received.ok) throw new Error(`fetch failed: ${url}`);
            return received;
        });
        const text = response.then((received) => received.text()).catch((error: unknown) => {
            abortController.abort();
            throw error;
        }).finally(() => clearTimeout(timeoutId));
        const responded = response.then(() => {});
        // 待つ側が先に待つのをやめた後で失敗しても、未処理の rejection にしない。
        text.catch(() => {});
        responded.catch(() => {});
        return { responded, text };
    }

    /**
     * 処理を中断せずに、待つ時間だけを区切る。
     * 期限が来たら reject するが、渡した Promise の処理は続くので、後から完了した結果を別に使える。
     * @param promise 待つ処理
     * @param timeoutMs 待つ時間
     * @returns 期限内に完了すればその結果
     */
    function waitWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error("songs network wait timed out")), timeoutMs);
            promise.then((value) => {
                clearTimeout(timeoutId);
                resolve(value);
            }, (error: unknown) => {
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    }

    /**
     * 現行ストア、なければ旧localStorageから曲データJSONを読み取る。
     * @returns キャッシュ文字列と移行の要否
     */
    async function getCachedSongsJsonText(): Promise<{ jsonText: string; needsMigration: boolean } | null> {
        if (!songsJsonCache) return null;
        try {
            const jsonText = await songsJsonCache.getText();
            if (jsonText) return { jsonText, needsMigration: false };
        } catch (error) {
            console.warn("曲データJSONキャッシュを読み込めませんでした", error);
        }
        try {
            const jsonText = songsJsonCache.getLegacyText?.();
            return jsonText ? { jsonText, needsMigration: true } : null;
        } catch (error) {
            console.warn("旧曲データJSONキャッシュを読み込めませんでした", error);
            return null;
        }
    }

    /**
     * 非同期ストアへ曲データJSONキャッシュを保存する。
     * @param jsonText 保存するJSON文字列
     * @returns 保存できたか
     */
    async function setCachedSongsJsonText(jsonText: string): Promise<boolean> {
        if (!songsJsonCache) return false;
        try {
            return await songsJsonCache.setText(jsonText);
        } catch (error) {
            console.warn("曲データJSONキャッシュを保存できませんでした", error);
            return false;
        }
    }

    /**
     * 非同期ストアから不正な曲データJSONキャッシュを削除する。
     */
    async function removeCachedSongsJsonText(): Promise<void> {
        if (!songsJsonCache) return;
        try {
            await songsJsonCache.removeText();
        } catch (error) {
            console.warn("曲データJSONキャッシュを削除できませんでした", error);
        }
    }

    /**
     * キャッシュがないときの曲データJSONを取得する。
     * 待つのをやめても代わりに出せる曲データがないので、response はキャッシュがあるときより長く待つ。
     * @returns JSON文字列
     */
    async function fetchSongsJsonText(deadline: number): Promise<string> {
        if (!publicSongsJsonUrl) throw new Error("songs json url is not configured");
        return fetchTextWithTimeout(
            publicSongsJsonUrl,
            "no-cache",
            uncachedSongsJsonResponseTimeoutMs,
            songsJsonBodyTimeoutMs,
            deadline
        );
    }

    /**
     * 曲データJSONのメタ情報を取得する。
     * @returns JSON文字列
     */
    async function fetchSongsMetaText(deadline: number): Promise<string> {
        if (!publicSongsMetaUrl) throw new Error("songs meta url is not configured");
        return fetchTextWithTimeout(
            publicSongsMetaUrl,
            "no-cache",
            songsMetaResponseTimeoutMs,
            songsMetaResponseTimeoutMs,
            deadline
        );
    }

    /**
     * フォールバック用のCSVを取得する。
     * @returns CSV文字列
     */
    async function fetchCsvText(): Promise<string> {
        return fetchTextWithTimeout(
            publicCsvUrl,
            "no-store",
            csvResponseTimeoutMs,
            csvBodyTimeoutMs,
            Infinity
        );
    }

    /**
     * ネットワークCSVを最後の取得手段として読み込む。
     * CSVは実行時キャッシュへ保存せず、そのセッションだけで使用する。
     * @returns 読み込んだスナップショット
     */
    async function loadCsvFallback(): Promise<SongsSnapshot | null> {
        try {
            const csvText = await fetchCsvText();
            const songs = parseCsvToSongs(csvText);
            return { songs, source: "network" };
        } catch {
            return null;
        }
    }

    /**
     * metaに対してJSON候補が現在有効か判定する。
     * hash一致または候補側の生成日時が新しい場合だけ採用できる。
     * @param candidate JSON候補
     * @param meta 比較対象のmeta
     * @returns 採用できるか
     */
    function isCurrentJsonCandidate(
        candidate: SongsJsonArtifactMetadata,
        meta: SongsJsonArtifactMetadata
    ): boolean {
        const freshness = compareSongsJsonArtifactFreshness(candidate, meta);
        return freshness === "same-content" || freshness === "candidate-newer";
    }

    /**
     * キャッシュがないときに、曲データJSONをネットワークから取得して構造を検証する。
     * 公開metaとの比較と保存は呼び出し側で行う。
     * @param deadline metaとJSON本体に共通する通信期限（performance.now基準）
     * @returns 検証済みネットワークJSON候補
     */
    async function loadNetworkSongsJsonCandidate(
        deadline: number
    ): Promise<NetworkSongsJsonCandidate> {
        const jsonText = await fetchSongsJsonText(deadline);
        return {
            jsonText,
            payload: parseSongsJsonPayload(jsonText)
        };
    }

    /** 公開metaとの整合性を確認し、保存を開始して完了を待たず初期表示へ渡す。 */
    function acceptNetworkSongsJson(
        candidate: NetworkSongsJsonCandidate,
        meta: SongsJsonArtifactMetadata | null
    ): SongsSnapshot {
        const { jsonText, payload } = candidate;
        if (meta && !isCurrentJsonCandidate(payload, meta)) {
            throw new Error("songs json is older than or inconsistent with the public meta");
        }
        // 保存失敗はhelper内で処理する。表示データは検証済みのメモリ上の値を使う。
        void setCachedSongsJsonText(jsonText);
        return { songs: payload.songs, source: "network" };
    }

    /**
     * 表示の期限に間に合わなかった公開JSONを、公開metaと整合する場合だけ、次回の表示用に保存する。
     * 表示中の曲データは差し替えない。
     */
    function saveLateNetworkSongsJson(
        candidate: NetworkSongsJsonCandidate,
        meta: SongsJsonArtifactMetadata | null
    ): void {
        if (meta && !isCurrentJsonCandidate(candidate.payload, meta)) return;
        void setCachedSongsJsonText(candidate.jsonText);
    }

    /**
     * 有効なキャッシュがあるときに、キャッシュと内容が違う可能性のある公開JSONを取得する。
     * 共通期限までに採用できなければ例外にし、呼び出し元がキャッシュで表示する。
     * そのときも取得は中断せずに続け、後から完了すれば次回の表示用に保存する。
     * 中断すると、期限に間に合わない低速な回線では、何度開いても古いキャッシュのまま更新されない。
     * 期限をすでに過ぎている場合は、取得を始めない。
     * @param meta 公開meta。取得できなかった場合は null
     * @param deadline metaとJSON本体に共通する通信期限（performance.now基準）
     * @returns 期限内に採用できた公開JSONのスナップショット
     */
    async function loadUpdatedSongsJson(
        meta: SongsJsonArtifactMetadata | null,
        deadline: number
    ): Promise<SongsSnapshot> {
        if (!publicSongsJsonUrl) throw new Error("songs json url is not configured");
        const responseWaitMs = remainingTimeout(songsJsonResponseTimeoutMs, deadline);
        const download = startTextDownload(publicSongsJsonUrl, "no-cache", songsJsonBackgroundTimeoutMs);
        const candidate = download.text.then((jsonText): NetworkSongsJsonCandidate => ({
            jsonText,
            payload: parseSongsJsonPayload(jsonText)
        }));
        try {
            await waitWithin(download.responded, responseWaitMs);
            const received = await waitWithin(candidate, remainingTimeout(songsJsonBodyTimeoutMs, deadline));
            // タイマー実行が遅れた場合も、期限後の応答は表示に採用しない。
            remainingTimeout(songsJsonBodyTimeoutMs, deadline);
            return acceptNetworkSongsJson(received, meta);
        } catch (error) {
            // 取得や検証そのものが失敗していれば、保存せずに終わる。
            candidate.then((late) => saveLateNetworkSongsJson(late, meta), () => {});
            throw error;
        }
    }

    /**
     * JSONキャッシュを読み取り・検証する。保存・削除は採用データの決定後に行う。
     * @returns 読込元と検証結果。不正な内容も後片付け判断のため候補として返す。
     */
    async function loadValidatedSongsJsonCache(): Promise<CachedSongsJsonCandidate | null> {
        const candidate = await getCachedSongsJsonText();
        if (!candidate) return null;
        try {
            return { ...candidate, payload: parseSongsJsonPayload(candidate.jsonText) };
        } catch (error) {
            console.warn("曲データJSONキャッシュを読み込めませんでした", error);
            return { ...candidate, payload: null };
        }
    }

    /** 有効な旧キャッシュを採用した場合だけ移行保存を開始し、表示は完了を待たない。 */
    function acceptCachedSongsJson(candidate: CachedSongsJsonCandidate, payload: SongsJsonPayload): SongsSnapshot {
        if (candidate.needsMigration) void setCachedSongsJsonText(candidate.jsonText);
        return { songs: payload.songs, source: "cache" };
    }

    /**
     * metaを取得して検証する。取得・検証に失敗してもJSON本体の取得は継続する。
     * @returns 検証済みmeta
     */
    async function loadSongsJsonMeta(
        deadline: number
    ): Promise<SongsJsonArtifactMetadata | null> {
        if (!publicSongsMetaUrl) return null;
        try {
            return parseSongsJsonMetaPayload(await fetchSongsMetaText(deadline));
        } catch (error) {
            console.warn("曲データJSONメタ情報の確認に失敗しました", error);
            return null;
        }
    }

    /**
     * 公開側を基準に初期データを選ぶ。キャッシュはmetaのhash一致時か取得失敗時だけ使う。
     * キャッシュがある場合はmetaとJSON本体を待つ時間を合計5秒以内に制限し、間に合わなければキャッシュで表示する。
     * JSON本体の取得は表示後も続け、完了すれば次回の表示用に保存する。
     * キャッシュがない場合はmetaと本体を並行取得し、失敗時はCSVへ進む。
     */
    async function loadInitialSnapshot(): Promise<SongsSnapshot | null> {
        const cachedCandidate = await loadValidatedSongsJsonCache();
        const cachedPayload = cachedCandidate?.payload;
        if (publicSongsJsonUrl) {
            const deadline = cachedPayload
                ? performance.now() + cachedSongsNetworkTimeoutMs
                : Infinity;
            try {
                if (cachedPayload) {
                    const meta = await loadSongsJsonMeta(deadline);
                    if (meta?.contentHash === cachedPayload.contentHash && cachedCandidate) {
                        return acceptCachedSongsJson(cachedCandidate, cachedPayload);
                    }
                    return await loadUpdatedSongsJson(meta, deadline);
                }
                const [meta, candidate] = await Promise.all([
                    loadSongsJsonMeta(deadline),
                    loadNetworkSongsJsonCandidate(deadline)
                ]);
                return acceptNetworkSongsJson(candidate, meta);
            } catch {
                // 公開JSONを利用できなければ、有効なキャッシュへ退避する。
            }
        }
        if (cachedPayload && cachedCandidate) {
            return acceptCachedSongsJson(cachedCandidate, cachedPayload);
        }
        // 公開JSONを保存した場合は上書きで置き換える。削除を同時に走らせない。
        if (cachedCandidate) void removeCachedSongsJsonText();
        return loadCsvFallback();
    }

    return { loadInitialSnapshot };
}
