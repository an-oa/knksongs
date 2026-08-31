import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvToSongs } from "../_build/app/lib/csv-parser.mjs";

test("csv: explicit video orientation is parsed from 画面の向き", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,,縦,全体,配信,,,1,KING,Kanaria feat. GUMI,キング,カナリアフィーチャリンググミ,https://www.youtube.com/watch?v=abc123def45&t=10s,0:09:41,"
    ].join("\n");
    const songs = parseCsvToSongs(csv);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].videoOrientation, "vertical");
    assert.equal(songs[0].streamRole, "");
    assert.equal(songs[0].endSeconds, 581);
});

test("csv: 配信上の立場 column keeps 収録 rows parseable", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "161,2025/11/23,ゲスト,横,全体,収録,◯,◯,1,GIRA×2★SEVEN,HE★VENS,ギラギラセブン,ヘブンズ,https://www.youtube.com/watch?v=1QvjYDqhWsk&t=152s,0:07:41,#藤音カナデ さん主催"
    ].join("\n");
    const songs = parseCsvToSongs(csv);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].archiveId, "161");
    assert.equal(songs[0].format, "収録");
    assert.equal(songs[0].streamRole, "ゲスト");
    assert.equal(songs[0].videoOrientation, "landscape");
    assert.equal(songs[0].isRelay, true);
    assert.equal(songs[0].isHarmony, true);
    assert.equal(songs[0].endSeconds, 461);
});

test("csv: missing 配信上の立場 column keeps legacy csv cache parseable", () => {
    const csv = [
        "#,配信日,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,縦,全体,配信,,,1,KING,Kanaria feat. GUMI,キング,カナリアフィーチャリンググミ,https://www.youtube.com/watch?v=abc123def45&t=10s,0:09:41,"
    ].join("\n");
    const songs = parseCsvToSongs(csv);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].streamRole, "");
    assert.equal(songs[0].videoOrientation, "vertical");
});

test("csv: invalid 画面の向き value warns and falls back to auto detection", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,,縦型,全体,配信,,,1,KING,Kanaria feat. GUMI,キング,カナリアフィーチャリンググミ,https://www.youtube.com/watch?v=abc123def45&t=10s,0:09:41,"
    ].join("\n");
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => {
        warnings.push(String(message));
    };
    try {
        const songs = parseCsvToSongs(csv);
        assert.equal(songs.length, 1);
        assert.equal(songs[0].videoOrientation, "");
    } finally {
        console.warn = originalWarn;
    }
    assert.deepEqual(warnings, ['CSV画面の向きが不正です: 2行目 "縦型"']);
});

test("csv: invalid 終了時刻 value warns and falls back to null", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,,縦,全体,配信,,,1,KING,Kanaria feat. GUMI,キング,カナリアフィーチャリンググミ,https://www.youtube.com/watch?v=abc123def45&t=10s,0:99:41,"
    ].join("\n");
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => {
        warnings.push(String(message));
    };
    try {
        const songs = parseCsvToSongs(csv);
        assert.equal(songs.length, 1);
        assert.equal(songs[0].endSeconds, null);
    } finally {
        console.warn = originalWarn;
    }
    assert.deepEqual(warnings, ['CSV終了時刻が不正です: 2行目 "0:99:41"']);
});

test("csv: missing 終了時刻 column keeps backward compatibility", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,メモ",
        "1,2026/03/11,,横,全体,配信,,,1,KING,Kanaria feat. GUMI,キング,カナリアフィーチャリンググミ,https://www.youtube.com/watch?v=abc123def45&t=10s,"
    ].join("\n");
    const songs = parseCsvToSongs(csv);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].endSeconds, null);
    assert.equal(songs[0].videoOrientation, "landscape");
});

test("csv: 配信上の立場 keeps blank, guest, and host values as streamRole", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,,縦,全体,配信,,,1,KING,Kanaria feat. GUMI,キング,カナリアフィーチャリンググミ,https://www.youtube.com/watch?v=abc123def45&t=10s,0:09:41,",
        "1,2026/03/11,ゲスト,縦,全体,配信,,,2,Guest Song,Guest Artist,ゲストソング,ゲストアーティスト,https://www.youtube.com/watch?v=guest123abc&t=20s,0:10:41,",
        "1,2026/03/11,ホスト,縦,全体,配信,,,3,Host Song,Host Artist,ホストソング,ホストアーティスト,https://www.youtube.com/watch?v=host123abcd&t=30s,0:11:41,"
    ].join("\n");
    const songs = parseCsvToSongs(csv);
    assert.equal(songs.length, 3);
    assert.deepEqual(songs.map((song) => song.title), ["KING", "Guest Song", "Host Song"]);
    assert.deepEqual(songs.map((song) => song.streamRole), ["", "ゲスト", "ホスト"]);
});

test("csv: missing 配信上の立場 column keeps backward compatibility", () => {
    const csv = [
        "#,配信日,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,縦,全体,配信,,,1,KING,Kanaria feat. GUMI,キング,カナリアフィーチャリンググミ,https://www.youtube.com/watch?v=abc123def45&t=10s,0:09:41,"
    ].join("\n");
    const songs = parseCsvToSongs(csv);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].title, "KING");
});

test("csv: public rows without URLs remain in the master but are excluded from derived songs", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,,横,全体,歌みた,,,1,Archived Song,Artist,アーカイブドソング,アーティスト,,,,",
        "2,2026/03/12,,横,全体,歌みた,,,1,Playable Song,Artist,プレイアブルソング,アーティスト,https://www.youtube.com/watch?v=abc123def45,,"
    ].join("\n");

    const songs = parseCsvToSongs(csv);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].title, "Playable Song");
    assert.equal(Object.hasOwn(songs[0], "sourceIndex"), false);
});

test("csv: invalid non-empty URLs stop conversion and identify the master row", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "0,2026/03/10,,横,非公開,歌みた,,,1,Hidden Song,Artist,ヒドゥンソング,アーティスト,https://www.youtube.com/watch?v=hidden12345,,",
        "1,2026/03/11,,横,全体,歌みた,,,1,Broken Song,Artist,ブロークンソング,アーティスト,https://example.com/watch?v=abc123def45,,"
    ].join("\n");

    assert.throws(
        () => parseCsvToSongs(csv),
        /CSV 3行目「Broken Song」: url host must be a supported YouTube host/
    );
});

test("csv: archiveOrder must contain an integer only", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,,横,全体,配信,,,1st,Broken Order,Artist,ブロークンオーダー,アーティスト,https://www.youtube.com/watch?v=abc123def45,,"
    ].join("\n");

    assert.throws(
        () => parseCsvToSongs(csv),
        /CSV 2行目「Broken Order」: archiveOrder must be an integer/
    );
});

test("csv: duplicate song keys report both source rows", () => {
    const csv = [
        "#,配信日,配信上の立場,画面の向き,公開範囲,形態,歌枠リレー？,ハモリあり？,##,曲名,アーティスト名,キョクメイ,アーティストメイ,URL,終了時刻,メモ",
        "1,2026/03/11,,横,全体,配信,,,1,First Take,Artist,ファーストテイク,アーティスト,https://www.youtube.com/watch?v=abc123def45,,",
        "1,2026/03/11,,横,全体,配信,,,1,Retake,Artist,リテイク,アーティスト,https://www.youtube.com/watch?v=xyz123def45,,"
    ].join("\n");

    assert.throws(
        () => parseCsvToSongs(csv),
        /CSV 3行目「Retake」: songKey .* duplicates CSV 2行目「First Take」/
    );
});
