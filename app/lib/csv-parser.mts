import { normalizeStreamRole } from "./stream-role.mjs";
import { parseDateKey } from "./date-key.mjs";
import { normalizeForSearch } from "./search-normalization.mjs";
import {
    buildBookmarkSongKey,
    buildLegacySongKey,
    buildSongKey,
    parseArchiveOrder
} from "./song-identity.mjs";
import { assertSongsDataQuality } from "./songs-data-quality.mjs";
import { extractYoutubeInfo } from "./youtube-url.mjs";

type CsvSongCandidate = {
    song: Omit<Song, "archiveOrder"> & { archiveOrder: number | null };
    csvRowNumber: number;
};

/**
 * 画面の向き列を正規化し、既知の値のみ返す。
 * @param {*} raw
 * @param {number} rowNumber
 * @returns {VideoOrientation}
 */
function parseVideoOrientation(raw, rowNumber) {
    const value = String(raw || "").trim();
    if (value === "縦") return "vertical";
    if (value === "横") return "landscape";
    if (value !== "") {
        console.warn(`CSV画面の向きが不正です: ${rowNumber}行目 "${value}"`);
    }
    return "";
}

/**
 * 終了時刻列の値を秒数へ変換し、空欄や不正値は `null` を返す。
 * @param {*} raw
 * @param {number} rowNumber
 */
function parseEndTimeSeconds(raw, rowNumber) {
    const value = String(raw || "").trim();
    if (value === "") return null;
    if (/^\d+$/.test(value)) {
        const seconds = Number.parseInt(value, 10);
        return Number.isFinite(seconds) ? seconds : null;
    }
    const parts = value.split(":");
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
        console.warn(`CSV終了時刻が不正です: ${rowNumber}行目 "${value}"`);
        return null;
    }
    const [hoursPart, minutesPart, secondsPart] = parts.length === 3
        ? parts
        : ["0", parts[0], parts[1]];
    const hours = Number.parseInt(hoursPart, 10);
    const minutes = Number.parseInt(minutesPart, 10);
    const seconds = Number.parseInt(secondsPart, 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds) ||
        minutes >= 60 || seconds >= 60) {
        console.warn(`CSV終了時刻が不正です: ${rowNumber}行目 "${value}"`);
        return null;
    }
    return (hours * 3600) + (minutes * 60) + seconds;
}

/**
 * RFC4180ベースでCSV文字列を2次元配列へ解析する。
 * @param {*} t
 */
function parseCsvRFC4180(t) {
    let res = [];
    let row = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (inQ) {
            if (c === '"' && t[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                inQ = false;
            } else {
                field += c;
            }
        } else {
            if (c === '"') {
                inQ = true;
            } else if (c === ',') {
                row.push(field);
                field = "";
            } else if (c === '\n' || c === '\r') {
                row.push(field);
                res.push(row);
                row = [];
                field = "";
                if (c === '\r' && t[i + 1] === '\n') i++;
            } else {
                field += c;
            }
        }
    }
    row.push(field);
    res.push(row);
    while (res.length > 0 && res[res.length - 1].every((v) => v === "")) {
        res.pop();
    }
    return res;
}

/**
 * CSVを検証・整形して、検索用正規化済みの曲データ配列へ変換する。
 * @param {*} csvText
 * @returns {Song[]}
 */
export function parseCsvToSongs(csvText) {
    const rows = parseCsvRFC4180(csvText);
    const header = rows[0];
    const required = ["公開範囲", "#", "##", "曲名", "アーティスト名", "キョクメイ", "アーティストメイ", "配信日", "形態", "歌枠リレー？", "ハモリあり？", "URL", "メモ"];
    const missing = required.filter((name) => !header.includes(name));
    if (missing.length > 0) {
        throw new Error(`CSVヘッダ不足: ${missing.join(", ")}`);
    }
    const body = rows.slice(1);
    const idxMap = Object.fromEntries(header.map((name, index) => [name, index]));
    const idx = (n) => idxMap[n];
    const endTimeIndex = header.includes("終了時刻") ? idx("終了時刻") : -1;
    const streamRoleIndex = header.includes("配信上の立場") ? idx("配信上の立場") : -1;
    const candidates: CsvSongCandidate[] = [];
    for (let i = 0; i < body.length; i++) {
        const r = body[i];
        const memo = r[idx("メモ")] || "";
        const memoUpper = memo.toUpperCase();
        const memoAllows = !memoUpper.includes("URL") && !memoUpper.includes("URI");
        const url = r[idx("URL")] || "";
        const archiveId = (r[idx("#")] || "").trim();
        if (r[idx("公開範囲")] !== "全体" ||
            archiveId === "" ||
            !memoAllows ||
            url.trim() === "") continue;
        const title = r[idx("曲名")];
        const artist = r[idx("アーティスト名")];
        const titleYomi = r[idx("キョクメイ")];
        const artistYomi = r[idx("アーティストメイ")];
        const archiveOrder = parseArchiveOrder(r[idx("##")]);
        const { videoId } = extractYoutubeInfo(url);
        const legacySongKey = buildLegacySongKey({ archiveId, archiveOrder, url });
        const song: CsvSongCandidate["song"] = {
            date: r[idx("配信日")],
            dateKey: parseDateKey(r[idx("配信日")]),
            archiveId,
            archiveOrder,
            videoId,
            songKey: buildSongKey({ archiveId, archiveOrder }),
            bookmarkSongKey: buildBookmarkSongKey({ videoId, archiveId, archiveOrder }),
            legacySongKey,
            format: r[idx("形態")],
            streamRole: streamRoleIndex >= 0 ? normalizeStreamRole(r[streamRoleIndex]) : "",
            videoOrientation: parseVideoOrientation(r[idx("画面の向き")], i + 2),
            isRelay: r[idx("歌枠リレー？")] === "◯",
            isHarmony: r[idx("ハモリあり？")] === "◯",
            title,
            artist,
            titleYomi,
            artistYomi,
            url,
            endSeconds: endTimeIndex >= 0 ? parseEndTimeSeconds(r[endTimeIndex], i + 2) : null,
            titleNorm: normalizeForSearch(title),
            artistNorm: normalizeForSearch(artist),
            titleYomiNorm: normalizeForSearch(titleYomi),
            artistYomiNorm: normalizeForSearch(artistYomi)
        };
        candidates.push({ song, csvRowNumber: i + 2 });
    }
    assertSongsDataQuality(candidates);
    return candidates.map((candidate) => candidate.song as Song);
}
