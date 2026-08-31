import { extractYoutubeInfo } from "./youtube-url.mjs";
import {
    validateSongIdentities,
    type SongIdentityIssue
} from "./song-identity.mjs";

export type SongDataQualityCandidate = {
    song: unknown;
    csvRowNumber: number;
};

const ALLOWED_YOUTUBE_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be"
]);
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * 値を曲データ検証用の表示文字列へ整形する。
 * @param value 表示する値
 * @returns JSON互換の表示文字列
 */
function formatIssueValue(value: unknown): string {
    if (value === undefined) return "undefined";
    return JSON.stringify(value);
}

/**
 * 曲データの場所を、マスターCSVを修正できる行番号と曲名で整形する。
 * @param candidate 検証中の曲データと変換元CSV行番号
 * @param index 候補配列上の位置
 * @returns CSV上の場所
 */
function formatSongLocation(
    candidate: SongDataQualityCandidate,
    index: number
): string {
    const csvRowNumber = Number.isInteger(candidate.csvRowNumber) ? candidate.csvRowNumber : index + 2;
    const song = candidate.song && typeof candidate.song === "object" && !Array.isArray(candidate.song)
        ? candidate.song as Record<string, unknown>
        : {};
    const title = typeof song.title === "string" ? song.title.trim() : "";
    const location = `CSV ${csvRowNumber}行目`;
    return title ? `${location}「${title}」` : location;
}

/**
 * URL文字列からhostを抽出する。
 * @param url 検証するURL
 * @returns URLとして解析できない場合は空文字
 */
function parseUrlHost(url: unknown): string {
    try {
        return new URL(String(url)).hostname;
    } catch {
        return "";
    }
}

/**
 * 曲データの文字列フィールドが空でないことを検証する。
 * @param candidate 検証中の曲データと変換元CSV行番号
 * @param index 変換後の曲配列上の位置
 * @param issues 検出した問題の追加先
 */
function validateRequiredTextFields(
    candidate: SongDataQualityCandidate,
    index: number,
    issues: string[]
): void {
    const song = candidate.song as Record<string, unknown>;
    for (const fieldName of ["title", "artist", "url"]) {
        if (typeof song[fieldName] !== "string" || song[fieldName].trim() === "") {
            issues.push(`${formatSongLocation(candidate, index)}: ${fieldName} must not be empty`);
        }
    }
}

/**
 * CSVから変換された曲データのURLとYouTube IDを検証する。
 * 本番コードではvalidateSongsDataQuality経由で使い、境界条件の単体テスト用にexportしている。
 * @param candidate 検証中の曲データと変換元CSV行番号
 * @param index 変換後の曲配列上の位置
 * @param issues 検出した問題の追加先
 * @returns URLから抽出した再生情報
 */
export function validateSongYoutubeFields(
    candidate: SongDataQualityCandidate,
    index: number,
    issues: string[]
): ReturnType<typeof extractYoutubeInfo> {
    const song = candidate.song as Record<string, unknown>;
    const host = parseUrlHost(song.url);
    if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
        issues.push(`${formatSongLocation(candidate, index)}: url host must be a supported YouTube host`);
    }

    const youtubeInfo = extractYoutubeInfo(typeof song.url === "string" ? song.url : "");
    if (!YOUTUBE_VIDEO_ID_PATTERN.test(youtubeInfo.videoId)) {
        issues.push(
            `${formatSongLocation(candidate, index)}: extracted videoId must match ${YOUTUBE_VIDEO_ID_PATTERN}`
        );
    }
    if (!Number.isFinite(youtubeInfo.startSeconds) || youtubeInfo.startSeconds < 0) {
        issues.push(
            `${formatSongLocation(candidate, index)}: ` +
            "startSeconds must be a finite number greater than or equal to 0"
        );
    }
    return youtubeInfo;
}

/**
 * 曲データの終了秒数を検証する。nullは動画末尾まで再生する正常値として扱う。
 * @param candidate 検証中の曲データと変換元CSV行番号
 * @param index 変換後の曲配列上の位置
 * @param startSeconds URLから抽出した開始秒数
 * @param issues 検出した問題の追加先
 */
function validateEndSeconds(
    candidate: SongDataQualityCandidate,
    index: number,
    startSeconds: number,
    issues: string[]
): void {
    const song = candidate.song as Record<string, unknown>;
    if (song.endSeconds === null || song.endSeconds === undefined) return;
    if (typeof song.endSeconds !== "number" ||
        !Number.isFinite(song.endSeconds) ||
        song.endSeconds < 0) {
        issues.push(
            `${formatSongLocation(candidate, index)}: ` +
            "endSeconds must be a finite number greater than or equal to 0"
        );
        return;
    }
    if (song.endSeconds <= startSeconds) {
        issues.push(`${formatSongLocation(candidate, index)}: endSeconds must be greater than startSeconds`);
    }
}

/** 曲識別子の構造化された問題をCSV行番号付きの診断へ変換する。 */
function formatSongIdentityIssue(
    issue: SongIdentityIssue,
    candidates: readonly SongDataQualityCandidate[]
): string {
    const location = formatSongLocation(candidates[issue.index], issue.index);
    if (issue.kind === "invalid-archive-order") {
        return `${location}: archiveOrder must be an integer`;
    }
    if (issue.kind === "mismatched-key") {
        return `${location}: ${issue.fieldName} must equal ${JSON.stringify(issue.expected)}`;
    }
    const firstLocation = formatSongLocation(candidates[issue.firstIndex], issue.firstIndex);
    return `${location}: ${issue.fieldName} ${JSON.stringify(issue.value)} duplicates ${firstLocation}`;
}

/**
 * マスターCSVから変換された公開対象曲の品質条件を全件検証する。
 * @param candidates CSVから変換された曲データと元行番号の組
 * @returns CSV上の修正位置を含む問題一覧
 */
export function validateSongsDataQuality(
    candidates: readonly SongDataQualityCandidate[]
): string[] {
    const issues: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const song = candidate.song;
        if (!song || typeof song !== "object" || Array.isArray(song)) {
            issues.push(`${formatSongLocation(candidate, index)}: song must be an object, got ${formatIssueValue(song)}`);
            continue;
        }
        validateRequiredTextFields(candidate, index, issues);
        const youtubeInfo = validateSongYoutubeFields(candidate, index, issues);
        validateEndSeconds(candidate, index, youtubeInfo.startSeconds, issues);
    }
    const identityIssues = validateSongIdentities(candidates.map((candidate) => candidate.song));
    issues.push(...identityIssues.map((issue) => formatSongIdentityIssue(issue, candidates)));
    return issues;
}

/**
 * マスターCSVから変換された公開対象曲を検証し、問題があればJSON生成前に停止する。
 * @param candidates CSVから変換された曲データと元行番号の組
 */
export function assertSongsDataQuality(
    candidates: readonly SongDataQualityCandidate[]
): void {
    const issues = validateSongsDataQuality(candidates);
    if (issues.length > 0) {
        throw new Error(`CSV song data validation failed:\n${issues.join("\n")}`);
    }
}
