import test from "node:test";
import assert from "node:assert/strict";
import {
    buildArchiveSongKey,
    buildSongByKeyMap,
    buildSongKey,
    buildSongKeyByArchiveKeyMap,
    findFirstSongIdentityIssue,
    normalizeLegacySongRefToArchiveKey,
    parseArchiveOrder,
    validateSongIdentities
} from "../app/lib/song-identity.mts";
import { createSongFixture } from "./fixtures/song.mts";

test("song identity: the song key is built from the video and the order, and the archive key from the archive", () => {
    const row = {
        archiveId: " archive-1 ",
        archiveOrder: 2,
        videoId: " video-1 "
    };

    assert.equal(buildSongKey(row), "video-1::2");
    assert.equal(buildArchiveSongKey(row), "archive-1::2");
    // videoId を読めない行だけ、archiveId で代用する。品質検証で落とす前の行でも、キーが重ならないようにする。
    assert.equal(buildSongKey({ ...row, videoId: "" }), "archive-1::2");
    assert.equal(buildSongKey({ ...row, archiveOrder: null }), "video-1::");
});

test("song identity: parses only complete safe integers", () => {
    assert.equal(parseArchiveOrder("001"), 1);
    assert.equal(parseArchiveOrder("1st"), null);
    assert.equal(parseArchiveOrder(""), null);
    assert.equal(parseArchiveOrder(Number.MAX_SAFE_INTEGER + 1), null);
});

test("song identity: legacy refs are normalized to the archive key only when they can be read", () => {
    assert.equal(normalizeLegacySongRefToArchiveKey("archive-1::2"), "archive-1::2");
    assert.equal(normalizeLegacySongRefToArchiveKey(" archive-1 :: 002 :: old-url"), "archive-1::2");
    assert.equal(normalizeLegacySongRefToArchiveKey("archive-1::invalid"), null);
    assert.equal(normalizeLegacySongRefToArchiveKey("::2"), null);
    assert.equal(normalizeLegacySongRefToArchiveKey("archive-1"), null);
});

test("song identity: lookup maps keep the first row defensively", () => {
    const first = { archiveId: "archive-1", archiveOrder: 1, songKey: "video-1::1" };
    const duplicate = { archiveId: "archive-1", archiveOrder: 1, songKey: "video-1::1" };
    const retake = { archiveId: "archive-1", archiveOrder: 1, songKey: "video-2::1" };

    assert.equal(buildSongByKeyMap([first, duplicate]).get("video-1::1"), first);
    assert.deepEqual([...buildSongKeyByArchiveKeyMap([first, retake])], [["archive-1::1", "video-1::1"]]);
});

test("song identity: the archive key map skips rows that cannot be pointed at by an old ref", () => {
    const map = buildSongKeyByArchiveKeyMap([
        { archiveId: "archive-1", archiveOrder: 1, songKey: "video-1::1" },
        { archiveId: "", archiveOrder: 2, songKey: "video-1::2" },
        { archiveId: "archive-1", archiveOrder: null, songKey: "video-1::" },
        { archiveId: "archive-1", archiveOrder: 4 }
    ]);

    assert.deepEqual([...map], [["archive-1::1", "video-1::1"]]);
});

test("song identity: detects mismatched and duplicate generated keys", () => {
    const first = createSongFixture();
    const duplicate = createSongFixture({ title: "Retake" });
    const mismatched = createSongFixture({
        archiveId: "archive-2",
        songKey: "wrong"
    });
    const issues = validateSongIdentities([first, duplicate, mismatched]);

    assert.deepEqual(issues, [
        { kind: "mismatched-key", index: 2, expected: "abc123def45::1" },
        { kind: "duplicate-archive-order", index: 1, firstIndex: 0, value: "archive-1::1" },
        { kind: "duplicate-key", index: 1, firstIndex: 0, value: "abc123def45::1" }
    ]);
});

test("song identity: the same archive and order under two videos is reported even though the song keys differ", () => {
    // シートで「#」を打ち間違えると、別の配信の曲が同じアーカイブの同じ歌唱順になる。曲キーは動画ごとなので重ならない。
    const first = createSongFixture();
    const otherVideo = createSongFixture({ videoId: "zyx987wvu65", songKey: "zyx987wvu65::1" });

    assert.deepEqual(validateSongIdentities([first, otherVideo]), [
        { kind: "duplicate-archive-order", index: 1, firstIndex: 0, value: "archive-1::1" }
    ]);
});

test("song identity: first-issue validation preserves diagnostic priority over earlier duplicates", () => {
    const first = createSongFixture();
    const invalidOrder = { ...createSongFixture(), archiveOrder: null };
    const rows = [first, { ...first }, invalidOrder];
    const issues = validateSongIdentities(rows);
    assert.deepEqual(issues.map((issue) => ({ kind: issue.kind, index: issue.index })), [
        { kind: "invalid-archive-order", index: 2 },
        // 歌唱順が整数でない行は、archiveId と歌唱順の組を作れないので、組の重複には数えない。
        { kind: "duplicate-archive-order", index: 1 },
        { kind: "duplicate-key", index: 1 },
        { kind: "duplicate-key", index: 2 }
    ]);
    for (const input of [[], [null, 42, []], [first], [first, { ...first }], rows,
        [createSongFixture({ songKey: "bad" })]]) {
        assert.deepEqual(findFirstSongIdentityIssue(input), validateSongIdentities(input)[0] ?? null);
    }
});

test("song identity: runtime validation stops before inspecting later rows after a mismatch", () => {
    const later = Object.defineProperty({}, "archiveOrder", { get() { throw new Error("later row was inspected"); } });
    assert.deepEqual(findFirstSongIdentityIssue([createSongFixture({ songKey: "bad" }), later]), {
        kind: "mismatched-key", index: 0, expected: "abc123def45::1"
    });
});
