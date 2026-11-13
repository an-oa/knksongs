import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    buildSongKeyRemapIssueBody,
    findSongKeyRemaps,
    parseSongKeyRows,
    readStartSeconds
} from "../scripts/lib/song-key-remaps.mts";
import { writeSongKeyRemapIssueBody } from "../scripts/song-key-remap-issue.mts";

type SingingInput = { title: string; artist?: string; startSeconds: number; titleNorm?: string };

/**
 * 1本の動画の歌唱を、歌唱順の番号を振った songs.json の内容にする。
 * @param singings 歌唱順に並べた歌唱
 * @returns songs.json の内容
 */
function buildSongsJson(singings: SingingInput[]): string {
    return JSON.stringify({
        songs: singings.map((singing, index) => ({
            songKey: `video000001::${index + 1}`,
            title: singing.title,
            titleNorm: singing.titleNorm ?? singing.title.toLowerCase(),
            artist: singing.artist ?? "Artist",
            url: `https://www.youtube.com/watch?v=video000001&t=${singing.startSeconds}s`
        }))
    });
}

const ORIGINAL_SINGINGS: SingingInput[] = [
    { title: "First", startSeconds: 60 },
    { title: "Second", startSeconds: 300 },
    { title: "Third", startSeconds: 600 }
];

test("song key remaps: a song inserted in the middle moves the keys after it", () => {
    const before = buildSongsJson(ORIGINAL_SINGINGS);
    const after = buildSongsJson([
        ORIGINAL_SINGINGS[0],
        { title: "Inserted", startSeconds: 180 },
        ORIGINAL_SINGINGS[1],
        ORIGINAL_SINGINGS[2]
    ]);

    assert.deepEqual(findSongKeyRemaps(before, after), [
        {
            key: "video000001::2",
            before: { title: "Second", artist: "Artist", startSeconds: 300 },
            after: { title: "Inserted", artist: "Artist", startSeconds: 180 }
        },
        {
            key: "video000001::3",
            before: { title: "Third", artist: "Artist", startSeconds: 600 },
            after: { title: "Second", artist: "Artist", startSeconds: 300 }
        }
    ]);
});

test("song key remaps: spelling fixes, start time fixes, and added or removed keys are not reported", () => {
    const before = buildSongsJson(ORIGINAL_SINGINGS);

    // 曲名の表記の修正では、正規化した曲名も変わるが、開始時刻は変わらない。
    const spellingFixed = buildSongsJson([
        { title: "First (Fixed)", startSeconds: 60 },
        ...ORIGINAL_SINGINGS.slice(1)
    ]);
    // 開始時刻の修正では、曲名は変わらない。
    const startFixed = buildSongsJson([
        ORIGINAL_SINGINGS[0],
        { title: "Second", startSeconds: 310 },
        ORIGINAL_SINGINGS[2]
    ]);
    // 曲名の大文字・小文字だけの違いは、正規化した曲名が同じなので別の歌唱とみなさない。
    const caseChanged = buildSongsJson([
        { title: "FIRST", startSeconds: 90, titleNorm: "first" },
        ...ORIGINAL_SINGINGS.slice(1)
    ]);
    const appended = buildSongsJson([...ORIGINAL_SINGINGS, { title: "Fourth", startSeconds: 900 }]);
    const removedLast = buildSongsJson(ORIGINAL_SINGINGS.slice(0, 2));

    for (const after of [spellingFixed, startFixed, caseChanged, appended, removedLast]) {
        assert.deepEqual(findSongKeyRemaps(before, after), []);
    }
});

test("song key remaps: rows without a bookmark key are skipped and a missing songs array fails", () => {
    const rows = parseSongKeyRows(JSON.stringify({
        songs: [
            { title: "No key", url: "https://www.youtube.com/watch?v=video000001&t=5s" },
            { songKey: "  video000001::1  ", title: "Keyed", artist: "Artist" },
            null
        ]
    }));
    assert.deepEqual(rows, [{
        songKey: "video000001::1",
        title: "Keyed",
        titleNorm: "Keyed",
        artist: "Artist",
        startSeconds: 0
    }]);
    assert.throws(() => parseSongKeyRows("[]"), /songs array/);
});

test("song key remaps: start seconds are read from t or start like the app does", () => {
    assert.equal(readStartSeconds("https://www.youtube.com/watch?v=video000001&t=388s"), 388);
    assert.equal(readStartSeconds("https://www.youtube.com/watch?v=video000001&start=42"), 42);
    assert.equal(readStartSeconds("https://youtu.be/video000001"), 0);
    assert.equal(readStartSeconds("not a url"), 0);
    assert.equal(readStartSeconds(undefined), 0);
});

test("song key remaps: the issue body keeps spreadsheet text inside a code block", () => {
    const body = buildSongKeyRemapIssueBody([{
        key: "video000001::2",
        before: { title: "Before ``` @someone", artist: "Line\nBreak", startSeconds: 3725 },
        after: { title: "[link](https://example.com)", artist: "<b>Artist</b>", startSeconds: 59 }
    }], {
        commitUrl: "https://github.com/an-oa/knksongs/commit/abc",
        runUrl: "https://github.com/an-oa/knksongs/actions/runs/1"
    });

    assert.match(body, /changed the singing behind 1 bookmark key\(s\)/);
    assert.match(body, /^- Commit: https:\/\/github\.com\/an-oa\/knksongs\/commit\/abc$/m);
    assert.match(body, /^- Run: https:\/\/github\.com\/an-oa\/knksongs\/actions\/runs\/1$/m);
    const fenceStart = body.indexOf("````text\n");
    const fenceEnd = body.lastIndexOf("\n````");
    assert.ok(fenceStart > 0 && fenceEnd > fenceStart, "the fence is longer than the backticks in the titles");
    const outside = body.slice(0, fenceStart) + body.slice(fenceEnd + 5);
    for (const text of ["@someone", "example.com", "<b>", "Line"]) {
        assert.ok(!outside.includes(text), `${text} stays inside the code block`);
    }
    assert.match(body, /^ {2}before: 1:02:05 Before ``` @someone \/ Line Break$/m);
    assert.match(body, /^ {2}after: {2}0:00:59 \[link\]\(https:\/\/example\.com\) \/ <b>Artist<\/b>$/m);
});

test("song key remaps: the issue body lists at most 50 keys and counts the rest", () => {
    const remaps = Array.from({ length: 52 }, (_, index) => ({
        key: `video000001::${index + 1}`,
        before: { title: `Before ${index}`, artist: "Artist", startSeconds: index },
        after: { title: `After ${index}`, artist: "Artist", startSeconds: index + 1 }
    }));
    const body = buildSongKeyRemapIssueBody(remaps, { commitUrl: "commit", runUrl: "run" });

    assert.match(body, /behind 52 bookmark key\(s\)/);
    assert.match(body, /^video000001::50$/m);
    assert.doesNotMatch(body, /^video000001::51$/m);
    assert.match(body, /And 2 more key\(s\)\.$/);
});

test("song key remaps: the CLI writes an issue body only when keys moved", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "knksongs-key-remaps-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const previousSongsJsonPath = join(directory, "previous.json");
    const currentSongsJsonPath = join(directory, "current.json");
    const issueBodyPath = join(directory, "issue.md");
    const options = { previousSongsJsonPath, currentSongsJsonPath, issueBodyPath, commitUrl: "commit", runUrl: "run" };
    await writeFile(previousSongsJsonPath, buildSongsJson(ORIGINAL_SINGINGS));

    await writeFile(currentSongsJsonPath, buildSongsJson([...ORIGINAL_SINGINGS, { title: "Fourth", startSeconds: 900 }]));
    assert.equal(await writeSongKeyRemapIssueBody(options), 0);
    await assert.rejects(stat(issueBodyPath), { code: "ENOENT" });

    await writeFile(currentSongsJsonPath, buildSongsJson([ORIGINAL_SINGINGS[1], ORIGINAL_SINGINGS[0], ORIGINAL_SINGINGS[2]]));
    assert.equal(await writeSongKeyRemapIssueBody(options), 2);
    const body = await readFile(issueBodyPath, "utf8");
    assert.match(body, /^video000001::1$/m);
    assert.match(body, /^video000001::2$/m);
    assert.doesNotMatch(body, /^video000001::3$/m);
});
