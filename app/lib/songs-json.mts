import { findFirstSongIdentityIssue, type SongIdentityIssue } from "./song-identity.mjs";
import {
    joinSongInfoTables,
    splitSongInfoTables,
    type SongInfoEntry,
    type SongInfoJoinIssue,
    type SongInfoTables,
    type SongRowEntry
} from "./song-info-tables.mjs";
import { validateYoutubeUrl } from "./youtube-url.mjs";

export const SONGS_JSON_SCHEMA_VERSION = 8;

export type SongsJsonArtifactMetadata = {
    schemaVersion: typeof SONGS_JSON_SCHEMA_VERSION;
    contentHash: string;
    generatedAt: string;
};

/** 読み込んで検証した曲データ。JSON の 2 つの表を、曲行の配列へ戻してある。 */
export type SongsJsonPayload = SongsJsonArtifactMetadata & {
    songs: Song[];
};

/** songs.json とそのキャッシュに書く形。曲の情報の表と、その行をキーで指す曲行の表を持つ。 */
export type SongsJsonDocument = SongsJsonArtifactMetadata & SongInfoTables;

export type SongsJsonArtifactFreshness =
    | "same-content"
    | "candidate-newer"
    | "candidate-older"
    | "incomparable";

type SongFieldKind = "string" | "integer" | "nullable-number" | "boolean" | "video-orientation";

/** 1 行に書ける項目の名前と、その値の構造型。Entry は検証後の行の型。 */
type EntrySchema<Entry> = {
    fieldNames: (keyof Entry & string)[];
    fieldKindByName: Map<string, SongFieldKind>;
};

/** 曲行のうち、曲の情報の表へ移す項目。 */
const SONG_INFO_FIELD_KINDS = {
    title: "string",
    artist: "string",
    titleEn: "string",
    artistEn: "string",
    titleNorm: "string",
    artistNorm: "string",
    titleYomiNorm: "string",
    artistYomiNorm: "string",
    titleEnNorm: "string",
    artistEnNorm: "string",
    artistSortNorm: "string"
} as const satisfies Record<Exclude<keyof SongInfoEntry, "songInfoKey">, SongFieldKind>;

/** 曲行のうち、曲行の表に残す項目。 */
const SONG_ROW_FIELD_KINDS = {
    date: "string",
    dateKey: "nullable-number",
    archiveId: "string",
    archiveOrder: "integer",
    videoId: "string",
    songKey: "string",
    format: "string",
    streamRole: "string",
    videoOrientation: "video-orientation",
    isRelay: "boolean",
    isHarmony: "boolean",
    url: "string",
    endSeconds: "nullable-number"
} as const satisfies Record<Exclude<keyof SongRowEntry, "songInfoKey">, SongFieldKind>;

/**
 * 項目と構造型の対応から、行の検証に使う定義を作る。
 * @param fieldKinds 行に書ける全項目と、その値の構造型
 * @returns 行の検証に使う定義
 */
function createEntrySchema<Entry>(fieldKinds: Record<keyof Entry & string, SongFieldKind>): EntrySchema<Entry> {
    return {
        fieldNames: Object.keys(fieldKinds) as (keyof Entry & string)[],
        fieldKindByName: new Map<string, SongFieldKind>(Object.entries(fieldKinds))
    };
}

const VIDEO_ORIENTATIONS = new Set<VideoOrientation>(["", "vertical", "landscape"]);
/** アプリが使う曲行。JSON を書く前の入力の検証に使う。 */
const SONG_SCHEMA = createEntrySchema<Song>({ ...SONG_ROW_FIELD_KINDS, ...SONG_INFO_FIELD_KINDS });
/** JSON の曲の情報の表の 1 行。 */
const SONG_INFO_ENTRY_SCHEMA = createEntrySchema<SongInfoEntry>({ songInfoKey: "string", ...SONG_INFO_FIELD_KINDS });
/** JSON の曲行の表の 1 行。 */
const SONG_ROW_ENTRY_SCHEMA = createEntrySchema<SongRowEntry>({ ...SONG_ROW_FIELD_KINDS, songInfoKey: "string" });

/**
 * 曲データJSONのcontentHashを検証する。
 * @param contentHash 検証するhash
 * @returns 検証済みhash
 */
function parseContentHash(contentHash: unknown): string {
    if (typeof contentHash !== "string" || contentHash.trim() === "") {
        throw new Error("songs json payload requires a contentHash");
    }
    return contentHash;
}

/**
 * 曲データJSONの生成日時をUTCのISO 8601形式として検証する。
 * @param generatedAt 検証する生成日時
 * @returns 検証済みの生成日時
 */
function parseGeneratedAt(generatedAt: unknown): string {
    if (typeof generatedAt !== "string") {
        throw new Error("songs json payload requires a generatedAt");
    }
    const timestamp = Date.parse(generatedAt);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== generatedAt) {
        throw new Error("songs json payload generatedAt must be a UTC ISO 8601 timestamp");
    }
    return generatedAt;
}

/**
 * JSON文字列をオブジェクトとして解析する。
 * @param jsonText JSON文字列
 * @returns 解析済みオブジェクト
 */
function parseJsonObject(jsonText: string): Record<string, unknown> {
    const payload: unknown = JSON.parse(jsonText);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("songs json payload must be an object");
    }
    return payload as Record<string, unknown>;
}

/**
 * 曲データJSONのschemaVersionを検証する。
 * 旧schemaは保存済みキャッシュを破棄して再取得するため受け付けない。
 * @param schemaVersion 検証するschema version
 * @returns 検証済みschema version
 */
function parseSupportedSchemaVersion(schemaVersion: unknown): typeof SONGS_JSON_SCHEMA_VERSION {
    if (schemaVersion !== SONGS_JSON_SCHEMA_VERSION) {
        throw new Error(`unsupported songs json schema: ${schemaVersion}`);
    }
    return schemaVersion;
}

/**
 * JSON上の曲フィールドが宣言された構造型に一致するか判定する。
 * @param fieldKind フィールドの構造型
 * @param value 検証する値
 */
function matchesSongFieldKind(fieldKind: SongFieldKind, value: unknown): boolean {
    if (fieldKind === "string") return typeof value === "string";
    if (fieldKind === "integer") return typeof value === "number" && Number.isSafeInteger(value);
    if (fieldKind === "nullable-number") {
        return value === null || (typeof value === "number" && Number.isFinite(value));
    }
    if (fieldKind === "boolean") return typeof value === "boolean";
    return typeof value === "string" && VIDEO_ORIENTATIONS.has(value as VideoOrientation);
}

/**
 * 曲フィールドの構造型をエラー表示用の説明へ変換する。
 * @param fieldKind フィールドの構造型
 * @returns 期待する値の説明
 */
function describeSongFieldKind(fieldKind: SongFieldKind): string {
    if (fieldKind === "string") return "a string";
    if (fieldKind === "integer") return "an integer";
    if (fieldKind === "nullable-number") return "a finite number or null";
    if (fieldKind === "boolean") return "a boolean";
    return 'one of "", "vertical", or "landscape"';
}

/**
 * 1 行について、定義にある必須フィールドと値の型を検証する。定義にないフィールドは受け付けない。
 * URLの意味的検証は構造確認後に行い、表示用の文字列の品質はCSV変換時に検証する。
 * @param entry 検証する行
 * @param location エラーに書く行の場所
 * @param schema 行に書ける項目と値の構造型
 */
function assertEntryStructure<Entry>(
    entry: unknown,
    location: string,
    schema: EntrySchema<Entry>
): asserts entry is Entry {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`${location} must be an object`);
    }
    const entryRecord = entry as Record<string, unknown>;
    const fieldNames = Object.keys(entryRecord);
    // own keyが既知の全項目と一致する正常系は、値の型も同じ走査で確認する。
    // 不正時だけ従来の診断を組み立て、欠落・余剰・型不一致の区別を保つ。
    if (fieldNames.length === schema.fieldNames.length && fieldNames.every((fieldName) => {
        const fieldKind = schema.fieldKindByName.get(fieldName);
        return fieldKind !== undefined && matchesSongFieldKind(fieldKind, entryRecord[fieldName]);
    })) return;

    for (const fieldName of fieldNames) {
        if (!schema.fieldKindByName.has(fieldName)) {
            throw new Error(`${location}.${fieldName} is not allowed`);
        }
    }
    for (const fieldName of schema.fieldNames) {
        if (!Object.hasOwn(entryRecord, fieldName)) {
            throw new Error(`${location}.${fieldName} is required`);
        }
        const fieldKind = schema.fieldKindByName.get(fieldName) as SongFieldKind;
        if (!matchesSongFieldKind(fieldKind, entryRecord[fieldName])) {
            throw new Error(`${location}.${fieldName} must be ${describeSongFieldKind(fieldKind)}`);
        }
    }
}

/** 曲リンクと再生用IDを、CSV生成時と同じYouTube URL条件で検証する。 */
function assertSongYoutubeFields(song: Song, index: number): void {
    const location = `songs json payload songs[${index}]`;
    const result = validateYoutubeUrl(song.url);
    if (result.issues.length > 0) {
        throw new Error(`${location}: ${result.issues[0]}`);
    }
    if (song.videoId !== result.youtubeInfo.videoId) {
        throw new Error(`${location}.videoId must equal the videoId extracted from url`);
    }
}

/** 曲識別子の問題をJSON配列位置付きの診断へ変換する。 */
function formatSongIdentityIssue(issue: SongIdentityIssue): string {
    const location = `songs json payload songs[${issue.index}]`;
    if (issue.kind === "invalid-archive-order") {
        return `${location}.archiveOrder must be an integer`;
    }
    if (issue.kind === "mismatched-key") {
        return `${location}.songKey must equal ${JSON.stringify(issue.expected)}`;
    }
    const firstLocation = `songs json payload songs[${issue.firstIndex}]`;
    if (issue.kind === "duplicate-archive-order") {
        return `${location} archiveId and archiveOrder ${JSON.stringify(issue.value)} duplicate ${firstLocation}`;
    }
    return `${location}.songKey ${JSON.stringify(issue.value)} duplicates ${firstLocation}.songKey`;
}

/** 2 つの表を曲行へ戻せない理由を、JSON配列位置付きの診断へ変換する。 */
function formatSongInfoJoinIssue(issue: SongInfoJoinIssue): string {
    if (issue.kind === "unknown-song-info-key") {
        return `songs json payload songs[${issue.index}].songInfoKey ${JSON.stringify(issue.value)} is not in songInfos`;
    }
    const location = `songs json payload songInfos[${issue.index}]`;
    const firstLocation = `songs json payload songInfos[${issue.firstIndex}]`;
    return `${location}.songInfoKey ${JSON.stringify(issue.value)} duplicates ${firstLocation}.songInfoKey`;
}

/**
 * 構造を確認済みの曲行について、識別子とYouTube URLを確認する。
 * @param songs 構造を確認済みの曲行
 * @returns 検証済み曲配列
 */
function assertSongIdentitiesAndUrls(songs: Song[]): Song[] {
    const identityIssue = findFirstSongIdentityIssue(songs);
    if (identityIssue) {
        throw new Error(formatSongIdentityIssue(identityIssue));
    }
    songs.forEach((song, index) => assertSongYoutubeFields(song, index));
    return songs;
}

/**
 * JSON を書く前の曲行について、各曲行の構造・識別子・YouTube URLを確認する。
 * @param songs 検証する曲行の配列
 * @returns 検証済み曲配列
 */
function parseSongsArray(songs: unknown): Song[] {
    if (!Array.isArray(songs)) {
        throw new Error("songs json payload requires a songs array");
    }
    songs.forEach((song, index) => assertEntryStructure(song, `songs json payload songs[${index}]`, SONG_SCHEMA));
    return assertSongIdentitiesAndUrls(songs);
}

/**
 * JSON の 2 つの表について、各行の構造を確認して曲行へ戻し、識別子とYouTube URLを確認する。
 * 表が生成規則どおりに分けられているか（使われない行がないことなど）は、ここでは確かめない。
 * 曲行へ戻せれば表示には困らないためで、生成した成果物の検証（scripts/songs-json-artifact.mts）が確かめる。
 * @param songInfos 検証する曲の情報の表
 * @param songRows 検証する曲行の表
 * @returns 検証済み曲配列
 */
function parseSongTables(songInfos: unknown, songRows: unknown): Song[] {
    if (!Array.isArray(songInfos)) {
        throw new Error("songs json payload requires a songInfos array");
    }
    if (!Array.isArray(songRows)) {
        throw new Error("songs json payload requires a songs array");
    }
    songInfos.forEach((entry, index) => {
        assertEntryStructure(entry, `songs json payload songInfos[${index}]`, SONG_INFO_ENTRY_SCHEMA);
    });
    songRows.forEach((entry, index) => {
        assertEntryStructure(entry, `songs json payload songs[${index}]`, SONG_ROW_ENTRY_SCHEMA);
    });
    const songs = joinSongInfoTables({ songInfos, songs: songRows });
    if (!Array.isArray(songs)) {
        throw new Error(formatSongInfoJoinIssue(songs));
    }
    return assertSongIdentitiesAndUrls(songs);
}

/**
 * 読み込み済みの曲データを、songs.json に書く形（曲の情報の表と曲行の表）にする。
 * 検証済みの内容を受け取る前提で、ここでは検証し直さない。
 * @param payload 検証済みの曲データ
 * @returns songs.json に書く形
 */
export function toSongsJsonDocument(payload: SongsJsonPayload): SongsJsonDocument {
    return {
        schemaVersion: payload.schemaVersion,
        contentHash: payload.contentHash,
        generatedAt: payload.generatedAt,
        ...splitSongInfoTables(payload.songs)
    };
}

/**
 * 曲行の配列を検証し、現在のJSONスキーマで songs.json に書く形にする。
 * @param songs 曲配列
 * @param contentHash 曲配列のhash
 * @param generatedAt contentHashが生成された日時
 * @returns songs.json に書く形
 */
export function buildSongsJsonDocument(
    songs: unknown[],
    contentHash: string,
    generatedAt: string
): SongsJsonDocument {
    return toSongsJsonDocument({
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: parseContentHash(contentHash),
        generatedAt: parseGeneratedAt(generatedAt),
        songs: parseSongsArray(songs)
    });
}

/**
 * 曲データJSONのメタ情報を現在のJSONスキーマへ包む。
 * @param contentHash 曲配列のhash
 * @param generatedAt contentHashが生成された日時
 * @returns 現在のスキーマで包んだメタ情報
 */
export function buildSongsJsonMetaPayload(
    contentHash: string,
    generatedAt: string
): SongsJsonArtifactMetadata {
    return {
        schemaVersion: SONGS_JSON_SCHEMA_VERSION,
        contentHash: parseContentHash(contentHash),
        generatedAt: parseGeneratedAt(generatedAt)
    };
}

/**
 * 2つの曲データJSON成果物について、候補側の鮮度を判定する。
 * hash一致時は日時を参照せず、hash不一致で日時を比較できない場合はincomparableを返す。
 * @param candidate 採用候補の成果物メタ情報
 * @param reference 比較基準の成果物メタ情報
 * @returns 候補側から見た鮮度
 */
export function compareSongsJsonArtifactFreshness(
    candidate: SongsJsonArtifactMetadata,
    reference: SongsJsonArtifactMetadata
): SongsJsonArtifactFreshness {
    if (candidate.contentHash === reference.contentHash) {
        return "same-content";
    }
    const candidateTimestamp = Date.parse(candidate.generatedAt);
    const referenceTimestamp = Date.parse(reference.generatedAt);
    if (candidateTimestamp > referenceTimestamp) return "candidate-newer";
    if (candidateTimestamp < referenceTimestamp) return "candidate-older";
    return "incomparable";
}

/**
 * 曲データJSONを検証して、現在のスキーマの内容を返す。2 つの表は曲行の配列へ戻す。
 * @param jsonText JSON文字列
 * @returns 検証済みの成果物メタ情報と曲配列
 */
export function parseSongsJsonPayload(jsonText: string): SongsJsonPayload {
    const payload = parseJsonObject(jsonText);
    const schemaVersion = parseSupportedSchemaVersion(payload.schemaVersion);
    return {
        schemaVersion,
        contentHash: parseContentHash(payload.contentHash),
        generatedAt: parseGeneratedAt(payload.generatedAt),
        songs: parseSongTables(payload.songInfos, payload.songs)
    };
}

/**
 * 曲データJSONのメタ情報を検証して返す。
 * @param jsonText JSON文字列
 * @returns 検証済みのメタ情報
 */
export function parseSongsJsonMetaPayload(jsonText: string): SongsJsonArtifactMetadata {
    const payload = parseJsonObject(jsonText);
    const schemaVersion = parseSupportedSchemaVersion(payload.schemaVersion);
    return {
        schemaVersion,
        contentHash: parseContentHash(payload.contentHash),
        generatedAt: parseGeneratedAt(payload.generatedAt)
    };
}
