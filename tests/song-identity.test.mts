import test from "node:test";
import assert from "node:assert/strict";
import {
    buildBookmarkSongKey,
    buildSongKey,
    buildSongReferenceIndex,
    findFirstSongIdentityIssue,
    normalizeLegacySongRefToCurrent,
    parseArchiveOrder,
    validateSongIdentities
} from "../app/lib/song-identity.mts";
import { createSongFixture } from "./fixtures/song.mts";

test("song identity: builds all keys from one canonical rule", () => {
    const row = {
        archiveId: " archive-1 ",
        archiveOrder: 2,
        videoId: " video-1 "
    };

    assert.equal(buildSongKey(row), "archive-1::2");
    assert.equal(buildBookmarkSongKey(row), "video-1::2");
});

test("song identity: parses only complete safe integers", () => {
    assert.equal(parseArchiveOrder("001"), 1);
    assert.equal(parseArchiveOrder("1st"), null);
    assert.equal(parseArchiveOrder(""), null);
    assert.equal(parseArchiveOrder(Number.MAX_SAFE_INTEGER + 1), null);
});

test("song identity: normalizes only recoverable legacy string refs", () => {
    assert.equal(normalizeLegacySongRefToCurrent(" archive-1 :: 002 :: old-url"), "archive-1::2");
    assert.equal(normalizeLegacySongRefToCurrent("archive-1::invalid"), null);
    assert.equal(normalizeLegacySongRefToCurrent("::2"), null);
});

test("song identity: reference index keeps the first row defensively", () => {
    const first = { songKey: "archive-1::1", bookmarkSongKey: "video-1::1" };
    const duplicate = { songKey: "archive-1::1", bookmarkSongKey: "video-1::1" };
    const index = buildSongReferenceIndex([first, duplicate]);

    assert.equal(index.songByKey.get("archive-1::1"), first);
    assert.equal(index.songByBookmarkKey.get("video-1::1"), first);
});

test("song identity: detects mismatched and duplicate generated keys", () => {
    const first = createSongFixture();
    const duplicate = createSongFixture({ title: "Retake" });
    const mismatched = createSongFixture({
        archiveId: "archive-2",
        songKey: "wrong"
    });
    const issues = validateSongIdentities([first, duplicate, mismatched]);

    assert.ok(issues.some((issue) => issue.kind === "duplicate-key" && issue.fieldName === "songKey"));
    assert.ok(issues.some((issue) => issue.kind === "duplicate-key" && issue.fieldName === "bookmarkSongKey"));
    assert.ok(issues.some((issue) => issue.kind === "mismatched-key" && issue.fieldName === "songKey"));
});

test("song identity: first-issue validation preserves diagnostic priority over earlier duplicates", () => {
    const first = createSongFixture();
    const invalidOrder = { ...createSongFixture(), archiveOrder: null };
    const rows = [first, { ...first }, invalidOrder];
    const issues = validateSongIdentities(rows);
    assert.deepEqual(issues.map((issue) => ({
        kind: issue.kind,
        index: issue.index,
        fieldName: "fieldName" in issue ? issue.fieldName : undefined
    })), [
        { kind: "invalid-archive-order", index: 2, fieldName: undefined },
        { kind: "duplicate-key", index: 1, fieldName: "songKey" },
        { kind: "duplicate-key", index: 2, fieldName: "songKey" },
        { kind: "duplicate-key", index: 1, fieldName: "bookmarkSongKey" },
        { kind: "duplicate-key", index: 2, fieldName: "bookmarkSongKey" }
    ]);
    for (const input of [[], [null, 42, []], [first], [first, { ...first }], rows,
        [createSongFixture({ songKey: "bad", bookmarkSongKey: "bad" })]]) {
        assert.deepEqual(findFirstSongIdentityIssue(input), validateSongIdentities(input)[0] ?? null);
    }
});

test("song identity: runtime validation stops before inspecting later rows after a mismatch", () => {
    const later = Object.defineProperty({}, "archiveOrder", { get() { throw new Error("later row was inspected"); } });
    assert.deepEqual(findFirstSongIdentityIssue([createSongFixture({ songKey: "bad" }), later]), {
        kind: "mismatched-key", index: 0, fieldName: "songKey", expected: "archive-1::1"
    });
});
