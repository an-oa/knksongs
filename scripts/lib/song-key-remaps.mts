/**
 * 曲データの更新で、同じブックマークのキーが別の歌唱を指すようになった変更を見つけ、Issue の本文にする。
 * 曲データ更新の workflow で npm も build もせずに動かすので、Node 標準 API だけを使い、app の module は読まない。
 */

/** Issue に並べるキーの上限。超えた分は件数だけを書く。 */
const MAX_LISTED_REMAPS = 50;

/** songs.json の1行のうち、キーと歌唱の照合に使う項目。 */
type SongKeyRow = {
    songKey: string;
    title: string;
    titleNorm: string;
    artist: string;
    startSeconds: number;
};

/** 同じキーの前後の歌唱。 */
type SongKeySinging = Pick<SongKeyRow, "title" | "artist" | "startSeconds">;

export type SongKeyRemap = {
    key: string;
    before: SongKeySinging;
    after: SongKeySinging;
};

/**
 * YouTube URL の t または start から開始秒数を読む。読めなければ 0 を返す。
 * app/lib/youtube-url.mts の extractYoutubeInfo と同じ規則で読む。
 * @param url 曲の YouTube URL
 * @returns 開始秒数
 */
export function readStartSeconds(url: unknown): number {
    if (typeof url !== "string") return 0;
    try {
        const parsed = new URL(url);
        const value = parsed.searchParams.get("t") || parsed.searchParams.get("start") || "0";
        return parseInt(value, 10) || 0;
    } catch {
        return 0;
    }
}

/**
 * songs.json の内容から、キーと歌唱の照合に使う項目だけを読む。キーのない行は読み飛ばす。
 * 本番コードでは同じ module 内で使う helper であり、入力の形の境界を単体テストするために export している。
 * @param text songs.json の内容
 * @returns キーを持つ行
 */
export function parseSongKeyRows(text: string): SongKeyRow[] {
    const payload: unknown = JSON.parse(text);
    const songs = payload !== null && typeof payload === "object" && "songs" in payload ? payload.songs : null;
    if (!Array.isArray(songs)) throw new Error("songs.json must have a songs array");
    const rows: SongKeyRow[] = [];
    for (const song of songs) {
        if (song === null || typeof song !== "object") continue;
        const key = typeof song.songKey === "string" ? song.songKey.trim() : "";
        if (!key) continue;
        const title = typeof song.title === "string" ? song.title : "";
        rows.push({
            songKey: key,
            title,
            titleNorm: typeof song.titleNorm === "string" ? song.titleNorm : title,
            artist: typeof song.artist === "string" ? song.artist : "",
            startSeconds: readStartSeconds(song.url)
        });
    }
    return rows;
}

/**
 * 更新の前後で同じキーを持つ行を比べ、別の歌唱を指すようになったキーを返す。
 * 開始時刻と曲名の両方が変わったときだけ別の歌唱とみなす。曲名の表記の修正や、開始時刻の修正だけでは返さない。
 * 歌唱順を入れ替えたり途中に曲を足したりすると、後ろの番号のキーが別の歌唱を指すので、ここで見つかる。
 * @param beforeText 更新前の songs.json の内容
 * @param afterText 更新後の songs.json の内容
 * @returns 別の歌唱を指すようになったキー。更新後の並び順
 */
export function findSongKeyRemaps(beforeText: string, afterText: string): SongKeyRemap[] {
    const beforeByKey = new Map(parseSongKeyRows(beforeText).map((row) => [row.songKey, row]));
    const remaps: SongKeyRemap[] = [];
    for (const after of parseSongKeyRows(afterText)) {
        const before = beforeByKey.get(after.songKey);
        if (!before) continue;
        if (before.startSeconds === after.startSeconds || before.titleNorm === after.titleNorm) continue;
        remaps.push({
            key: after.songKey,
            before: { title: before.title, artist: before.artist, startSeconds: before.startSeconds },
            after: { title: after.title, artist: after.artist, startSeconds: after.startSeconds }
        });
    }
    return remaps;
}

/**
 * 秒数を h:mm:ss の形で書く。
 * @param totalSeconds 秒数
 * @returns 時・分・秒
 */
function formatStartTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 曲データ由来の文字列を1行に収める。改行などの制御文字は空白にする。
 * @param value 曲名やアーティスト名
 * @returns 1行の文字列
 */
function toSingleLine(value: string): string {
    return value.replace(/\p{Cc}/gu, " ");
}

/**
 * 1つの歌唱を「開始時刻 曲名 / アーティスト名」の形で書く。
 * @param singing 歌唱
 * @returns Issue に書く1行
 */
function formatSinging(singing: SongKeySinging): string {
    return `${formatStartTime(singing.startSeconds)} ${toSingleLine(singing.title)} / ${toSingleLine(singing.artist)}`;
}

/**
 * 別の歌唱を指すようになったキーを知らせる Issue の本文を作る。
 * 曲名などは公開スプレッドシート由来なので、mention やリンクとして解釈されないよう、コードブロックの中にだけ書く。
 * コードブロックの囲みは、中身にあるどのバッククォートの連続よりも長くして、途中で閉じられないようにする。
 * @param remaps 別の歌唱を指すようになったキー
 * @param context 対象の commit と workflow run
 * @returns Issue の本文
 */
export function buildSongKeyRemapIssueBody(
    remaps: SongKeyRemap[],
    context: { commitUrl: string; runUrl: string }
): string {
    const listed = remaps.slice(0, MAX_LISTED_REMAPS);
    const lines = listed.flatMap((remap) => [
        remap.key,
        `  before: ${formatSinging(remap.before)}`,
        `  after:  ${formatSinging(remap.after)}`
    ]);
    const content = lines.join("\n");
    const longestBacktickRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
    const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
    const omittedCount = remaps.length - listed.length;
    return [
        "### Bookmark keys moved to other songs",
        "",
        `The song data update changed the singing behind ${remaps.length} bookmark key(s). ` +
            "Bookmarks saved with these keys now open the song shown as after.",
        "Check whether the singing order in the spreadsheet was changed on purpose.",
        "",
        `- Commit: ${context.commitUrl}`,
        `- Run: ${context.runUrl}`,
        "",
        `${fence}text`,
        content,
        fence,
        ...(omittedCount > 0 ? ["", `And ${omittedCount} more key(s).`] : [])
    ].join("\n");
}
