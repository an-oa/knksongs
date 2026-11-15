import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvToSongs } from "../app/lib/csv-parser.mts";
import { joinSongInfoTables, splitSongInfoTables } from "../app/lib/song-info-tables.mts";
import { createSongFixture } from "./fixtures/song.mts";

/**
 * 既定の曲（KING）を、指定した配信で歌った曲行を作る。
 * @param videoId 動画ID
 * @param archiveOrder 動画の中の歌唱順
 * @param date 配信日（YYYY/MM/DD）。読めない配信日は null
 * @param overrides 上書きする項目
 * @returns 曲行
 */
function createSungSong(
    videoId: string,
    archiveOrder: number,
    date: string | null,
    overrides: Partial<Song> = {}
): Song {
    return createSongFixture({
        date: date ?? "",
        dateKey: date ? Number(date.replaceAll("/", "")) : null,
        archiveId: `archive-${videoId}`,
        archiveOrder,
        videoId,
        songKey: `${videoId}::${archiveOrder}`,
        url: `https://www.youtube.com/watch?v=${videoId}&t=${archiveOrder * 100}s`,
        ...overrides
    });
}

/** 既定の曲とは別の曲の情報。 */
const OTHER_SONG_INFO: Partial<Song> = {
    title: "Other",
    titleYomi: "アザー",
    titleEn: "Other",
    titleNorm: "other",
    titleYomiNorm: "アザー",
    titleEnNorm: "other"
};

test("song info tables: rows of the same song share one entry keyed by the first singing", () => {
    // 曲行は新しい順に並ぶ。
    const newest = createSungSong("video00000c", 3, "2026/05/01");
    const middle = createSungSong("video00000b", 1, "2026/04/01");
    const oldest = createSungSong("video00000a", 2, "2026/03/01");
    const tables = splitSongInfoTables([newest, middle, oldest]);

    assert.deepEqual(tables.songInfos.map((songInfo) => songInfo.songInfoKey), ["video00000a::2"]);
    assert.deepEqual(tables.songs.map((row) => [row.songKey, row.songInfoKey]), [
        ["video00000c::3", "video00000a::2"],
        ["video00000b::1", "video00000a::2"],
        ["video00000a::2", "video00000a::2"]
    ]);
    assert.deepEqual(Object.keys(tables.songInfos[0]), [
        "songInfoKey", "title", "artist", "titleYomi", "artistYomi", "titleEn", "artistEn",
        "titleNorm", "artistNorm", "titleYomiNorm", "artistYomiNorm", "titleEnNorm", "artistEnNorm", "artistSortNorm"
    ]);
    assert.deepEqual(Object.keys(tables.songs[0]), [
        "date", "dateKey", "archiveId", "archiveOrder", "videoId", "songKey", "songInfoKey",
        "format", "streamRole", "videoOrientation", "isRelay", "isHarmony", "url", "endSeconds"
    ]);
});

test("song info tables: the first singing is decided by date, then video id, then order in the video", () => {
    // 同じ日の 2 本の配信は動画IDの文字コード順、同じ動画の中は歌唱順の数値で比べる（10 より 2 が先）。
    const sameDayLaterVideo = createSungSong("videoB00000", 1, "2026/03/01");
    const sameVideoTenth = createSungSong("videoA00000", 10, "2026/03/01");
    const sameVideoSecond = createSungSong("videoA00000", 2, "2026/03/01");
    // 大文字は小文字より文字コードが小さい。言語設定で並びが変わらないことも、この順で確かめる。
    const upperCaseVideo = createSungSong("Videoa00000", 5, "2026/03/01", OTHER_SONG_INFO);
    const lowerCaseVideo = createSungSong("videoa00000", 1, "2026/03/01", OTHER_SONG_INFO);
    // 配信日を読めない曲行は、後ろへ回す。
    const undated = createSungSong("video000000", 1, null);

    const tables = splitSongInfoTables([undated, lowerCaseVideo, sameDayLaterVideo, sameVideoTenth, upperCaseVideo, sameVideoSecond]);
    assert.deepEqual(tables.songInfos.map((songInfo) => [songInfo.title, songInfo.songInfoKey]), [
        ["Other", "Videoa00000::5"],
        ["KING", "videoA00000::2"]
    ]);

    const onlyUndated = splitSongInfoTables([createSungSong("video00000z", 1, null), createSungSong("video00000y", 1, null)]);
    assert.deepEqual(onlyUndated.songInfos.map((songInfo) => songInfo.songInfoKey), ["video00000y::1"]);
});

test("song info tables: the tables do not depend on the row order or on the archive ids", () => {
    const songs = [
        createSungSong("video00000c", 1, "2026/05/01", OTHER_SONG_INFO),
        createSungSong("video00000c", 2, "2026/05/01"),
        createSungSong("video00000b", 1, "2026/04/01"),
        createSungSong("video00000a", 1, "2026/03/01", OTHER_SONG_INFO)
    ];
    const tables = splitSongInfoTables(songs);
    assert.deepEqual(tables.songInfos.map((songInfo) => [songInfo.title, songInfo.songInfoKey]), [
        ["Other", "video00000a::1"],
        ["KING", "video00000b::1"]
    ]);

    // シートの行の並びが変わっても、曲の情報の表は変わらない。
    assert.deepEqual(splitSongInfoTables([...songs].reverse()).songInfos, tables.songInfos);
    // シートの「#」が振り直されても、曲の情報の表と、曲行が指すキーは変わらない。
    const renumbered = splitSongInfoTables(songs.map((song, index) => ({ ...song, archiveId: `renumbered-${index}` })));
    assert.deepEqual(renumbered.songInfos, tables.songInfos);
    assert.deepEqual(renumbered.songs.map((row) => row.songInfoKey), tables.songs.map((row) => row.songInfoKey));
});

test("song info tables: a newer stream appends its new songs and keeps the existing entries", () => {
    const existing = [
        createSungSong("video00000b", 1, "2026/04/01", OTHER_SONG_INFO),
        createSungSong("video00000a", 1, "2026/03/01")
    ];
    const newStream = [
        createSungSong("video00000c", 1, "2026/05/01", { title: "New", titleNorm: "new" }),
        createSungSong("video00000c", 2, "2026/05/01")
    ];
    const before = splitSongInfoTables(existing);
    const after = splitSongInfoTables([...newStream, ...existing]);

    assert.deepEqual(after.songInfos.slice(0, before.songInfos.length), before.songInfos);
    assert.deepEqual(after.songInfos.slice(before.songInfos.length).map((songInfo) => [songInfo.title, songInfo.songInfoKey]), [
        ["New", "video00000c::1"]
    ]);
    assert.deepEqual(after.songs.slice(newStream.length), before.songs);
});

test("song info tables: fixing the song info of every row keeps the key", () => {
    const songs = [createSungSong("video00000b", 1, "2026/04/01"), createSungSong("video00000a", 1, "2026/03/01")];
    const fixed = songs.map((song) => ({ ...song, artist: "Kanaria", artistNorm: "kanaria" }));

    const before = splitSongInfoTables(songs);
    const after = splitSongInfoTables(fixed);
    assert.deepEqual(after.songs, before.songs);
    assert.deepEqual(after.songInfos, [{ ...before.songInfos[0], artist: "Kanaria", artistNorm: "kanaria" }]);
});

test("song info tables: rows that differ in any song info field keep their own values", () => {
    const base = createSungSong("video00000a", 1, "2026/03/01");
    const infoFields = Object.keys(splitSongInfoTables([base]).songInfos[0]).filter((field) => field !== "songInfoKey");
    assert.equal(infoFields.length, 13);

    for (const field of infoFields) {
        // 1 つの項目だけが違う行。同じ曲の表記の食い違いでも、どちらの値も捨てない。
        const variant = createSungSong("video00000b", 1, "2026/04/01", { [field]: "different" });
        const tables = splitSongInfoTables([variant, base]);
        assert.deepEqual(tables.songInfos.map((songInfo) => songInfo.songInfoKey), ["video00000a::1", "video00000b::1"], field);
        assert.deepEqual(joinSongInfoTables(tables), [variant, base], field);
    }
});

test("song info tables: joining restores the songs with the field order of the CSV conversion", () => {
    const songs = parseCsvToSongs([
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,Song Title,Artist Name,Artist Sort Name,URL,終了時刻,メモ",
        "3,2026/05/01,,横,全体,配信,,◯,1,KING,Kanaria feat. GUMI,キング,カナリア,KING,Kanaria feat. GUMI,Kanaria,https://www.youtube.com/watch?v=video00000c&t=10s,0:03:00,",
        "3,2026/05/01,ゲスト,横,全体,配信,◯,,2,Other,Artist,アザー,アーティスト,,,,https://www.youtube.com/watch?v=video00000c&t=200s,,",
        "2,2026/04/01,,縦,全体,ショート,,,1,KING,Kanaria feat. GUMI,キング,カナリア,KING,Kanaria feat. GUMI,Kanaria,https://www.youtube.com/shorts/video00000b,,",
        "1,2026/03/01,,横,全体,歌みた,,,1,KING,Kanaria feat. GUMI,キング,カナリア,KING,Kanaria feat. GUMI,Kanaria,https://www.youtube.com/watch?v=video00000a,,"
    ].join("\n"));
    assert.equal(songs.length, 4);
    const tables = splitSongInfoTables(songs);
    assert.equal(tables.songInfos.length, 2);

    // contentHash は曲行の配列を文字列にして計算する。項目の順番が違うと、同じ内容でも hash が変わる。
    assert.equal(JSON.stringify(joinSongInfoTables(tables)), JSON.stringify(songs));
});

test("song info tables: joining reports the first row that cannot be resolved", () => {
    const tables = splitSongInfoTables([
        createSungSong("video00000b", 1, "2026/04/01", OTHER_SONG_INFO),
        createSungSong("video00000a", 1, "2026/03/01")
    ]);

    assert.deepEqual(joinSongInfoTables({ ...tables, songInfos: [tables.songInfos[0]] }), {
        kind: "unknown-song-info-key",
        index: 0,
        value: "video00000b::1"
    });
    assert.deepEqual(joinSongInfoTables({ ...tables, songInfos: [...tables.songInfos, { ...tables.songInfos[0] }] }), {
        kind: "duplicate-song-info-key",
        index: 2,
        firstIndex: 0,
        value: "video00000a::1"
    });
    assert.deepEqual(joinSongInfoTables({ songInfos: [], songs: [] }), []);
});
