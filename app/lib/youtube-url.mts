type YoutubeUrlInfo = {
    videoId: string;
    startSeconds: number;
    isVertical: boolean;
};

const ALLOWED_YOUTUBE_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be"
]);
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * YouTube URLから `videoId` と開始秒数を抽出する。
 * @param {string | URL | null | undefined} url
 * @returns {YoutubeUrlInfo}
 */
export function extractYoutubeInfo(url: string | URL | null | undefined): YoutubeUrlInfo {
    if (typeof url !== "string" && !(url instanceof URL)) {
        return { videoId: "", startSeconds: 0, isVertical: false };
    }
    try {
        const u = url instanceof URL ? url : new URL(url);
        const isShorts = /\/shorts\/[^/?#]+/.test(u.pathname);
        const id = (u.hostname === "youtu.be"
            ? u.pathname.slice(1)
            : (u.searchParams.get("v") || u.pathname.match(/\/shorts\/([^/?#]+)/)?.[1] || u.pathname.match(/\/live\/([^/?#]+)/)?.[1])) || "";
        const t = u.searchParams.get("t") || u.searchParams.get("start") || "0";
        return { videoId: id, startSeconds: parseInt(t, 10) || 0, isVertical: isShorts };
    } catch {
        return { videoId: "", startSeconds: 0, isVertical: false };
    }
}

/**
 * CSVと配布JSONの境界で、HTTPSのYouTube URLと再生情報を同じ規則で検証する。
 * @param url 検証するURL文字列
 * @returns URLから抽出した再生情報と検出した問題
 */
export function validateYoutubeUrl(url: string): { youtubeInfo: YoutubeUrlInfo; issues: string[] } {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return {
            youtubeInfo: extractYoutubeInfo(null),
            issues: ["url must be an absolute https: YouTube URL"]
        };
    }

    const issues: string[] = [];
    if (parsedUrl.protocol !== "https:") {
        issues.push("url protocol must be https:");
    }
    if (!ALLOWED_YOUTUBE_HOSTS.has(parsedUrl.hostname)) {
        issues.push("url host must be a supported YouTube host");
    }
    const youtubeInfo = extractYoutubeInfo(parsedUrl);
    if (!YOUTUBE_VIDEO_ID_PATTERN.test(youtubeInfo.videoId)) {
        issues.push(`extracted videoId must match ${YOUTUBE_VIDEO_ID_PATTERN}`);
    }
    if (!Number.isFinite(youtubeInfo.startSeconds) || youtubeInfo.startSeconds < 0) {
        issues.push("startSeconds must be a finite number greater than or equal to 0");
    }
    return { youtubeInfo, issues };
}
