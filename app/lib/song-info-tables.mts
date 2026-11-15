/**
 * 曲データJSONに書く 2 つの表（曲の情報の表と曲行の表）と、アプリが使う曲行の配列を、相互に変換する module。
 *
 * 同じ曲は何度も歌われるので、曲名・アーティスト名・読み・英名とその正規化した値を曲行ごとに書くと、
 * 同じ内容の繰り返しがファイルの大半を占める。繰り返しを 1 つの表へまとめ、曲行からはキーで参照する。
 * 表は「同じ曲」ではなく「曲の情報の全項目が同じ行」でまとめる。値が 1 つでも違う行は別の行として表に入るので、
 * 分けた表を戻すと、元の曲行と同じ内容・同じ項目順になる。
 *
 * 表の構造や型の検証と、エラーの文言は ./songs-json.mts が担う。アプリの中で曲を指すキーは songKey のままで、
 * songInfoKey は JSON の中で 2 つの表を結ぶためだけに使う。
 */

/** 曲行のうち、曲の情報にあたる項目。同じ曲を歌った曲行の間で同じ値になる。 */
type SongInfoFields = Pick<Song,
    | "title" | "artist" | "titleYomi" | "artistYomi" | "titleEn" | "artistEn"
    | "titleNorm" | "artistNorm" | "titleYomiNorm" | "artistYomiNorm" | "titleEnNorm" | "artistEnNorm"
    | "artistSortNorm"
>;

/** 曲の情報の表の 1 行。 */
export type SongInfoEntry = {
    /**
     * この情報を持つ曲行のうち、最初に歌われた曲行の songKey。
     * ブックマークが保存する songKey と同じ形だが、表を結ぶためだけの値で、アプリは保存しない。
     */
    songInfoKey: string;
} & SongInfoFields;

/** 曲行の表の 1 行。曲の情報の項目を持たず、曲の情報の表の行を songInfoKey で指す。 */
export type SongRowEntry = Omit<Song, keyof SongInfoFields> & { songInfoKey: string };

/** 曲データJSONに書く 2 つの表。songs の並びは、曲行の配列（CSV の行順）のままにする。 */
export type SongInfoTables = {
    songInfos: SongInfoEntry[];
    songs: SongRowEntry[];
};

/** 2 つの表を曲行へ戻せない理由。index は問題のある行の位置。 */
export type SongInfoJoinIssue =
    | {
        /** 同じ songInfoKey を持つ行が、曲の情報の表の前のほうにある。 */
        kind: "duplicate-song-info-key";
        index: number;
        firstIndex: number;
        value: string;
    }
    | {
        /** 曲行が指す songInfoKey が、曲の情報の表にない。 */
        kind: "unknown-song-info-key";
        index: number;
        value: string;
    };

/**
 * 曲の情報の全項目を、表をまとめる単位を表す 1 つの文字列にする。
 * @param song 曲行
 * @returns 曲の情報の全項目が同じ曲行の間で同じになる文字列
 */
function buildSongInfoFieldsKey(song: Song): string {
    return JSON.stringify([
        song.title, song.artist, song.titleYomi, song.artistYomi, song.titleEn, song.artistEn,
        song.titleNorm, song.artistNorm, song.titleYomiNorm, song.artistYomiNorm, song.titleEnNorm, song.artistEnNorm,
        song.artistSortNorm
    ]);
}

/**
 * 先に歌われた曲行が前になるように比べる。配信日、動画ID、動画の中の歌唱順の順に比べる。
 * - シートの「#」（archiveId）は使わない。知らなかった配信が後から足されると、振り直されるため。
 * - 動画IDは文字コードの順で比べる。実行する環境の言語設定で結果が変わらないようにする。
 * - 配信日を読めない曲行は、後ろへ回す。
 * @param a 曲行
 * @param b 曲行
 * @returns a が先なら負、b が先なら正、決まらなければ 0
 */
function compareFirstSung(a: Song, b: Song): number {
    const aDateKey = a.dateKey ?? Number.POSITIVE_INFINITY;
    const bDateKey = b.dateKey ?? Number.POSITIVE_INFINITY;
    if (aDateKey !== bDateKey) return aDateKey < bDateKey ? -1 : 1;
    if (a.videoId !== b.videoId) return a.videoId < b.videoId ? -1 : 1;
    return a.archiveOrder - b.archiveOrder;
}

/**
 * 曲行の配列を、曲の情報の表と曲行の表に分ける。
 * 曲の情報の表は、最初に歌われた順に並べる。新しい配信で初めて歌われた曲は末尾に足されるので、
 * 曲データの更新で、前からある行の位置やキーは変わりにくい。
 * @param songs 検証済みの曲行。songKey が曲行ごとに違うこと
 * @returns 曲の情報の表と曲行の表
 */
export function splitSongInfoTables(songs: readonly Song[]): SongInfoTables {
    const fieldsKeys = songs.map(buildSongInfoFieldsKey);
    const indexesByFirstSung = songs.map((_song, index) => index)
        .sort((a, b) => compareFirstSung(songs[a], songs[b]));
    const songInfoKeyByFieldsKey = new Map<string, string>();
    const songInfos: SongInfoEntry[] = [];
    for (const index of indexesByFirstSung) {
        if (songInfoKeyByFieldsKey.has(fieldsKeys[index])) continue;
        const song = songs[index];
        songInfoKeyByFieldsKey.set(fieldsKeys[index], song.songKey);
        songInfos.push({
            songInfoKey: song.songKey,
            title: song.title,
            artist: song.artist,
            titleYomi: song.titleYomi,
            artistYomi: song.artistYomi,
            titleEn: song.titleEn,
            artistEn: song.artistEn,
            titleNorm: song.titleNorm,
            artistNorm: song.artistNorm,
            titleYomiNorm: song.titleYomiNorm,
            artistYomiNorm: song.artistYomiNorm,
            titleEnNorm: song.titleEnNorm,
            artistEnNorm: song.artistEnNorm,
            artistSortNorm: song.artistSortNorm
        });
    }
    return {
        songInfos,
        songs: songs.map((song, index) => ({
            date: song.date,
            dateKey: song.dateKey,
            archiveId: song.archiveId,
            archiveOrder: song.archiveOrder,
            videoId: song.videoId,
            songKey: song.songKey,
            // すべての曲行の情報を上で表に入れたので、必ず見つかる。
            songInfoKey: songInfoKeyByFieldsKey.get(fieldsKeys[index]) as string,
            format: song.format,
            streamRole: song.streamRole,
            videoOrientation: song.videoOrientation,
            isRelay: song.isRelay,
            isHarmony: song.isHarmony,
            url: song.url,
            endSeconds: song.endSeconds
        }))
    };
}

/**
 * 曲の情報の表と曲行の表を、曲行の配列へ戻す。
 * 戻した曲行の項目の順番は、CSV から変換した曲行（csv-parser）と同じにする。
 * contentHash は曲行の配列を文字列にして計算するので、順番が違うと、同じ内容でも hash が変わる。
 * @param tables 項目と値の型を検証済みの 2 つの表
 * @returns 曲行の配列。戻せないときは、最初に見つけた問題
 */
export function joinSongInfoTables(tables: SongInfoTables): Song[] | SongInfoJoinIssue {
    const { songInfos, songs: songRows } = tables;
    const songInfoIndexByKey = new Map<string, number>();
    for (let index = 0; index < songInfos.length; index++) {
        const value = songInfos[index].songInfoKey;
        const firstIndex = songInfoIndexByKey.get(value);
        if (firstIndex !== undefined) return { kind: "duplicate-song-info-key", index, firstIndex, value };
        songInfoIndexByKey.set(value, index);
    }
    const songs: Song[] = [];
    for (let index = 0; index < songRows.length; index++) {
        const row = songRows[index];
        const songInfoIndex = songInfoIndexByKey.get(row.songInfoKey);
        if (songInfoIndex === undefined) return { kind: "unknown-song-info-key", index, value: row.songInfoKey };
        const info = songInfos[songInfoIndex];
        songs.push({
            date: row.date,
            dateKey: row.dateKey,
            archiveId: row.archiveId,
            archiveOrder: row.archiveOrder,
            videoId: row.videoId,
            songKey: row.songKey,
            format: row.format,
            streamRole: row.streamRole,
            videoOrientation: row.videoOrientation,
            isRelay: row.isRelay,
            isHarmony: row.isHarmony,
            title: info.title,
            artist: info.artist,
            titleYomi: info.titleYomi,
            artistYomi: info.artistYomi,
            titleEn: info.titleEn,
            artistEn: info.artistEn,
            url: row.url,
            endSeconds: row.endSeconds,
            titleNorm: info.titleNorm,
            artistNorm: info.artistNorm,
            titleYomiNorm: info.titleYomiNorm,
            artistYomiNorm: info.artistYomiNorm,
            titleEnNorm: info.titleEnNorm,
            artistEnNorm: info.artistEnNorm,
            artistSortNorm: info.artistSortNorm
        });
    }
    return songs;
}
