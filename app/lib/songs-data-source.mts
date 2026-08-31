import { parseCsvToSongs } from "./csv-parser.mjs";
import {
    compareSongsJsonArtifactFreshness,
    parseSongsJsonMetaPayload,
    parseSongsJsonPayload,
    SONGS_JSON_SCHEMA_VERSION
} from "./songs-json.mjs";
import type { SongsJsonArtifactMetadata, SongsJsonPayload } from "./songs-json.mjs";

export const DEFAULT_SONGS_META_RESPONSE_TIMEOUT_MS = 2000;
export const DEFAULT_SONGS_JSON_RESPONSE_TIMEOUT_MS = 2000;
export const DEFAULT_SONGS_JSON_BODY_TIMEOUT_MS = 30000;
export const DEFAULT_SONGS_CSV_RESPONSE_TIMEOUT_MS = 3000;
export const DEFAULT_SONGS_CSV_BODY_TIMEOUT_MS = 30000;

type SongsJsonCache = {
    getText: () => Promise<string | null>;
    setText: (value: string) => Promise<boolean>;
    removeText: () => Promise<void>;
};

type SongsDataSourceInput = {
    publicSongsJsonUrl?: string;
    publicSongsMetaUrl?: string;
    publicCsvUrl: string;
    songsJsonCache?: SongsJsonCache;
    songsMetaResponseTimeoutMs?: number;
    songsJsonResponseTimeoutMs?: number;
    songsJsonBodyTimeoutMs?: number;
    csvResponseTimeoutMs?: number;
    csvBodyTimeoutMs?: number;
};

export type SongsSnapshot =
    | {
        songs: Song[];
        source: "cache";
        artifact: SongsJsonPayload;
    }
    | {
        songs: Song[];
        source: "network";
        artifact: SongsJsonPayload | null;
    };

type FetchRequestInit = RequestInit & {
    priority?: "low";
};

type NetworkSongsJsonCandidate = {
    jsonText: string;
    payload: SongsJsonPayload;
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
        songsMetaResponseTimeoutMs = DEFAULT_SONGS_META_RESPONSE_TIMEOUT_MS,
        songsJsonResponseTimeoutMs = DEFAULT_SONGS_JSON_RESPONSE_TIMEOUT_MS,
        songsJsonBodyTimeoutMs = DEFAULT_SONGS_JSON_BODY_TIMEOUT_MS,
        csvResponseTimeoutMs = DEFAULT_SONGS_CSV_RESPONSE_TIMEOUT_MS,
        csvBodyTimeoutMs = DEFAULT_SONGS_CSV_BODY_TIMEOUT_MS
    } = input;

    /**
     * response受信待ちと本文読込に別々の期限を設ける。
     * response受信後は短い待機期限を解除し、大きい本文を低速回線でも読み切れるようにする。
     * @param url 取得URL
     * @param cacheMode fetch cache mode
     * @param responseTimeoutMs response受信までの期限
     * @param bodyTimeoutMs response本文読込の期限
     * @param isBackgroundRequest 初期表示後の低優先度取得か
     * @returns response本文
     */
    async function fetchTextWithTimeout(
        url: string,
        cacheMode: RequestCache,
        responseTimeoutMs: number,
        bodyTimeoutMs: number,
        isBackgroundRequest: boolean
    ): Promise<string> {
        const abortController = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(
            () => abortController.abort(),
            responseTimeoutMs
        );
        const requestInit: FetchRequestInit = {
            cache: cacheMode,
            signal: abortController.signal
        };
        if (isBackgroundRequest) requestInit.priority = "low";
        try {
            const response = await fetch(url, requestInit);
            clearTimeout(timeoutId);
            timeoutId = null;
            if (!response.ok) throw new Error(`fetch failed: ${url}`);
            timeoutId = setTimeout(() => abortController.abort(), bodyTimeoutMs);
            return await response.text();
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    }

    /**
     * 非同期ストアから曲データJSONキャッシュを読み込む。
     * @returns キャッシュ文字列
     */
    async function getCachedSongsJsonText(): Promise<string | null> {
        if (!songsJsonCache) return null;
        try {
            return await songsJsonCache.getText();
        } catch (error) {
            console.warn("曲データJSONキャッシュを読み込めませんでした", error);
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
     * 曲データJSONを取得する。
     * @returns JSON文字列
     */
    async function fetchSongsJsonText(isBackgroundRequest: boolean): Promise<string> {
        if (!publicSongsJsonUrl) throw new Error("songs json url is not configured");
        return fetchTextWithTimeout(
            publicSongsJsonUrl,
            "no-cache",
            songsJsonResponseTimeoutMs,
            songsJsonBodyTimeoutMs,
            isBackgroundRequest
        );
    }

    /**
     * 曲データJSONのメタ情報を取得する。
     * @returns JSON文字列
     */
    async function fetchSongsMetaText(isBackgroundRequest: boolean): Promise<string> {
        if (!publicSongsMetaUrl) throw new Error("songs meta url is not configured");
        return fetchTextWithTimeout(
            publicSongsMetaUrl,
            "no-cache",
            songsMetaResponseTimeoutMs,
            songsMetaResponseTimeoutMs,
            isBackgroundRequest
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
            false
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
            return { songs, source: "network", artifact: null };
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
     * 曲データJSONをネットワークから取得して構造を検証する。
     * 鮮度比較・保存・通知は呼び出し側で行う。
     * @param isBackgroundRequest 初期表示後の低優先度取得か
     * @returns 検証済みネットワークJSON候補
     */
    async function loadNetworkSongsJsonCandidate(
        isBackgroundRequest: boolean
    ): Promise<NetworkSongsJsonCandidate> {
        const jsonText = await fetchSongsJsonText(isBackgroundRequest);
        return {
            jsonText,
            payload: parseSongsJsonPayload(jsonText)
        };
    }

    /**
     * 検証済みネットワークJSONを保存し、内容が変わった場合だけスナップショットを返す。
     * @param candidate ネットワークJSON候補
     * @param freshnessReference 鮮度比較対象
     * @param previousPayload 先に表示したJSONキャッシュ
     * @returns 表示内容が変わる場合は新しいスナップショット
     */
    async function acceptNetworkSongsJson(
        candidate: NetworkSongsJsonCandidate,
        freshnessReference: SongsJsonArtifactMetadata | null,
        previousPayload: SongsJsonPayload | null
    ): Promise<SongsSnapshot | null> {
        const { jsonText, payload } = candidate;
        if (payload.schemaVersion !== SONGS_JSON_SCHEMA_VERSION) {
            throw new Error("network songs json must use the current schemaVersion");
        }
        if (freshnessReference && !isCurrentJsonCandidate(payload, freshnessReference)) {
            throw new Error("songs json is older than or inconsistent with the freshness reference");
        }
        await setCachedSongsJsonText(jsonText);
        const hasSameDisplayedContent = Boolean(
            previousPayload &&
            previousPayload.contentHash === payload.contentHash
        );
        if (hasSameDisplayedContent) return null;
        return {
            songs: payload.songs,
            source: "network",
            artifact: payload
        };
    }

    /**
     * JSONキャッシュを検証し、不正なら削除する。
     * @returns 検証済みキャッシュ
     */
    async function loadValidatedSongsJsonCache(): Promise<SongsJsonPayload | null> {
        const cachedJson = await getCachedSongsJsonText();
        if (!cachedJson) return null;
        try {
            return parseSongsJsonPayload(cachedJson);
        } catch (error) {
            console.warn("曲データJSONキャッシュを読み込めませんでした", error);
            await removeCachedSongsJsonText();
            return null;
        }
    }

    /**
     * metaを取得して検証する。取得・検証に失敗してもJSON本体の取得は継続する。
     * @returns 検証済みmeta
     */
    async function loadSongsJsonMeta(
        isBackgroundRequest: boolean
    ): Promise<SongsJsonArtifactMetadata | null> {
        if (!publicSongsMetaUrl) return null;
        try {
            return parseSongsJsonMetaPayload(await fetchSongsMetaText(isBackgroundRequest));
        } catch (error) {
            console.warn("曲データJSONメタ情報の確認に失敗しました", error);
            return null;
        }
    }

    /**
     * 先に表示したJSONキャッシュを基準に、最新JSONを低優先度で確認する。
     * 取得失敗時は表示済みキャッシュを維持し、CSVへは進まない。
     * @param reference 初期表示に使ったスナップショット
     * @returns 内容が変わった場合は最新スナップショット
     */
    async function refreshSnapshot(reference: SongsSnapshot): Promise<SongsSnapshot | null> {
        if (reference.source !== "cache" || !publicSongsJsonUrl) return null;
        const cachedPayload = reference.artifact;
        const meta = await loadSongsJsonMeta(true);
        if (meta && isCurrentJsonCandidate(cachedPayload, meta)) return null;
        try {
            const candidate = await loadNetworkSongsJsonCandidate(true);
            return await acceptNetworkSongsJson(
                candidate,
                meta ?? cachedPayload,
                cachedPayload
            );
        } catch {
            // 表示済みの有効なJSONキャッシュを維持する。
            return null;
        }
    }

    /**
     * JSONキャッシュがない場合、metaとJSON本体を並行取得して待ち時間を抑える。
     * @returns 採用したネットワークJSONのスナップショット
     */
    async function loadInitialNetworkSongsJson(): Promise<SongsSnapshot | null> {
        if (!publicSongsJsonUrl) return null;
        try {
            const [meta, candidate] = await Promise.all([
                loadSongsJsonMeta(false),
                loadNetworkSongsJsonCandidate(false)
            ]);
            return await acceptNetworkSongsJson(candidate, meta, null);
        } catch {
            return null;
        }
    }

    /**
     * JSONを優先して読み込み、有効なJSONキャッシュ、ネットワークCSVの順にフォールバックする。
     * @returns 初期表示に使うスナップショット
     */
    async function loadInitialSnapshot(): Promise<SongsSnapshot | null> {
        const cachedPayload = await loadValidatedSongsJsonCache();
        if (cachedPayload) {
            return {
                songs: cachedPayload.songs,
                source: "cache",
                artifact: cachedPayload
            };
        }
        const networkSnapshot = await loadInitialNetworkSongsJson();
        return networkSnapshot ?? await loadCsvFallback();
    }

    return {
        loadInitialSnapshot,
        refreshSnapshot
    };
}
