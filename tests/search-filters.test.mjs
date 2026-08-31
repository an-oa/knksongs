import test from "node:test";
import assert from "node:assert/strict";
import {
    filterSongsByCriteria,
    matchesCollabRoleFilters
} from "../_build/app/lib/search-filters.mjs";
import { normalizeForSearch } from "../_build/app/lib/search-normalization.mjs";
import { parseSearchQuery } from "../_build/app/lib/search-query.mjs";

let autoSongId = 0;

function makeRow(input) {
    const title = input.title ?? "";
    const artist = input.artist ?? "";
    const titleYomi = input.titleYomi ?? "";
    const artistYomi = input.artistYomi ?? "";
    const songKey = input.songKey ?? `song-${++autoSongId}`;
    return {
        archiveId: input.archiveId ?? "",
        archiveOrder: input.archiveOrder ?? 1,
        songKey,
        bookmarkSongKey: input.bookmarkSongKey ?? songKey,
        dateKey: input.dateKey ?? null,
        format: input.format ?? "配信",
        streamRole: input.streamRole ?? "",
        isRelay: !!input.isRelay,
        isHarmony: !!input.isHarmony,
        titleNorm: normalizeForSearch(title),
        artistNorm: normalizeForSearch(artist),
        titleYomiNorm: normalizeForSearch(titleYomi),
        artistYomiNorm: normalizeForSearch(artistYomi)
    };
}

const BASE_SEARCH_STATE = {
    dateFromKey: null,
    dateToKey: null,
    relayOnly: false,
    harmonyOnly: false
};

/**
 * 本番と同じく検索語を一度解析してから曲一覧を絞り込む。
 * @param {Song[]} rows
 * @param {SearchState} searchState
 * @param {Set<string>} selectedFormats
 * @returns {Song[]}
 */
function filterSongsForTest(rows, searchState, selectedFormats) {
    return filterSongsByCriteria(rows, searchState, selectedFormats, parseSearchQuery(searchState.queryRaw));
}

test("filterSongsByCriteria: query/date/format/flags", () => {
    const rows = [
        makeRow({ title: "青い月", artist: "A", dateKey: 20240110, format: "配信", isRelay: true }),
        makeRow({ title: "赤い星", artist: "B", dateKey: 20240120, format: "歌みた", isHarmony: true }),
        makeRow({ title: "白い雲", artist: "C", dateKey: 20240201, format: "ショート" })
    ];
    const selectedFormats = new Set(["配信", "歌みた"]);
    const searchState = {
        queryRaw: "赤い",
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: 20240101,
        dateToKey: 20240131
    };

    const hit = filterSongsForTest(rows, searchState, selectedFormats);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].artistNorm, normalizeForSearch("B"));
});

test("filterSongsByCriteria: date operators use inclusive bounds", () => {
    const rows = [
        makeRow({ title: "Before", dateKey: 20240109 }),
        makeRow({ title: "From", dateKey: 20240110 }),
        makeRow({ title: "To", dateKey: 20240120 }),
        makeRow({ title: "After", dateKey: 20240121 }),
        makeRow({ title: "Unknown", dateKey: null })
    ];
    const searchState = {
        queryRaw: "since:2024-1-10 until:2024-01-20",
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: null,
        dateToKey: null
    };

    const hit = filterSongsForTest(rows, searchState, new Set(["配信"]));
    assert.deepEqual(hit.map((row) => row.titleNorm), ["from", "to"]);
});

test("filterSongsByCriteria: invalid date operators return no songs", () => {
    const rows = [makeRow({ title: "Target", dateKey: 20240110 })];
    const searchState = {
        queryRaw: "target since:2024-02-30",
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: null,
        dateToKey: null
    };

    const hit = filterSongsForTest(rows, searchState, new Set(["配信"]));
    assert.deepEqual(hit, []);
});

test("filterSongsByCriteria: quoted operator-like phrases search titles and artists literally", () => {
    const rows = [
        makeRow({ title: "Song until:2026", artist: "A" }),
        makeRow({ title: "Other", artist: "since:2024-7 unit" }),
        makeRow({ title: "Until Bound", artist: "A", dateKey: 20261231 })
    ];
    const baseState = {
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: null,
        dateToKey: null
    };

    const titleHit = filterSongsForTest(
        rows,
        { ...baseState, queryRaw: '"Song until:2026"' },
        new Set(["配信"])
    );
    const artistHit = filterSongsForTest(
        rows,
        { ...baseState, queryRaw: '"since:2024-7"' },
        new Set(["配信"])
    );

    assert.deepEqual(titleHit.map((row) => row.titleNorm), ["song until:2026"]);
    assert.deepEqual(artistHit.map((row) => row.titleNorm), ["other"]);
});

test("filterSongsByCriteria: an unclosed quoted phrase returns no songs", () => {
    const rows = [makeRow({ title: "Song until:2026" })];
    const hit = filterSongsForTest(rows, {
        queryRaw: '"Song until:2026',
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: null,
        dateToKey: null
    }, new Set(["配信"]));

    assert.deepEqual(hit, []);
});

test("filterSongsByCriteria: text date operators intersect with date select bounds", () => {
    const rows = [
        makeRow({ title: "Target", dateKey: 20240110 }),
        makeRow({ title: "Target", dateKey: 20240115 }),
        makeRow({ title: "Target", dateKey: 20240120 })
    ];
    const searchState = {
        queryRaw: "target since:2024-01-01 until:2024-01-31",
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: 20240112,
        dateToKey: 20240118
    };

    const hit = filterSongsForTest(rows, searchState, new Set(["配信"]));
    assert.deepEqual(hit.map((row) => row.dateKey), [20240115]);
});

test("filterSongsByCriteria: オリ曲 is included when 歌みた is selected", () => {
    const rows = [
        makeRow({ title: "覚声", artist: "PSYBELL", dateKey: 20260315, format: "オリ曲" })
    ];
    const searchState = {
        queryRaw: "覚声",
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: null,
        dateToKey: null
    };

    const hit = filterSongsForTest(rows, searchState, new Set(["歌みた"]));
    assert.equal(hit.length, 1);
    assert.equal(hit[0].format, "オリ曲");
});

test("filterSongsByCriteria: AND keywords and harmony flag", () => {
    const rows = [
        makeRow({ title: "Star Light", artist: "Kana", dateKey: 20240101, format: "配信", isHarmony: true }),
        makeRow({ title: "Star", artist: "Kana", dateKey: 20240101, format: "配信", isHarmony: false })
    ];
    const selectedFormats = new Set(["配信"]);
    const searchState = {
        queryRaw: "star kana",
        relayOnly: false,
        harmonyOnly: true,
        dateFromKey: null,
        dateToKey: null
    };

    const hit = filterSongsForTest(rows, searchState, selectedFormats);
    assert.equal(hit.length, 1);
});

test("filterSongsByCriteria: collab role filters keep selected host and guest rows", () => {
    const rows = [
        makeRow({ title: "Solo", streamRole: "" }),
        makeRow({ title: "Host", streamRole: "ホスト" }),
        makeRow({ title: "Guest", streamRole: "ゲスト" })
    ];
    const baseState = {
        queryRaw: "",
        relayOnly: false,
        harmonyOnly: false,
        dateFromKey: null,
        dateToKey: null
    };

    const allRows = filterSongsForTest(rows, baseState, new Set(["配信"]));
    const hostRows = filterSongsForTest(rows, { ...baseState, collabHostOnly: true }, new Set(["配信"]));
    const guestRows = filterSongsForTest(rows, { ...baseState, collabGuestOnly: true }, new Set(["配信"]));
    const collabRows = filterSongsForTest(
        rows,
        { ...baseState, collabHostOnly: true, collabGuestOnly: true },
        new Set(["配信"])
    );

    assert.deepEqual(allRows.map((row) => row.titleNorm), ["solo", "host", "guest"]);
    assert.deepEqual(hostRows.map((row) => row.titleNorm), ["host"]);
    assert.deepEqual(guestRows.map((row) => row.titleNorm), ["guest"]);
    assert.deepEqual(collabRows.map((row) => row.titleNorm), ["host", "guest"]);
});

test("filterSongsByCriteria: matches normalized phrase whitespace and escaped quotes", () => {
    const rows = [
        makeRow({ title: "Foo   Bar" }),
        makeRow({ title: 'Don’t say "lazy"' })
    ];
    const selectedFormats = new Set(["配信"]);
    const whitespaceHit = filterSongsForTest(
        rows,
        { ...BASE_SEARCH_STATE, queryRaw: '"  foo   bar  "' },
        selectedFormats
    );
    const quoteHit = filterSongsForTest(
        rows,
        { ...BASE_SEARCH_STATE, queryRaw: String.raw`"Don’t say \"lazy\""` },
        selectedFormats
    );

    assert.deepEqual(whitespaceHit.map((row) => row.titleNorm), ["foo bar"]);
    assert.deepEqual(quoteHit.map((row) => row.titleNorm), ['don’t say "lazy"']);
});

test("filterSongsByCriteria: consumes the supplied parse result without parsing queryRaw again", () => {
    const parsedQuery = parseSearchQuery("target");
    const rows = [makeRow({ title: "Target" })];
    const hit = filterSongsByCriteria(
        rows,
        { ...BASE_SEARCH_STATE, queryRaw: "until:2026-13" },
        new Set(["配信"]),
        parsedQuery
    );

    assert.equal(hit.length, 1);
});

test("collab role helpers: match selected host and guest rows", () => {
    assert.equal(matchesCollabRoleFilters({ streamRole: "" }, {}), true);
    assert.equal(matchesCollabRoleFilters({ streamRole: "ホスト" }, { collabHostOnly: true }), true);
    assert.equal(matchesCollabRoleFilters({ streamRole: "ゲスト" }, { collabHostOnly: true }), false);
    assert.equal(matchesCollabRoleFilters({ streamRole: "ゲスト" }, { collabGuestOnly: true }), true);
    assert.equal(
        matchesCollabRoleFilters({ streamRole: "ホスト" }, { collabHostOnly: true, collabGuestOnly: true }),
        true
    );
    assert.equal(
        matchesCollabRoleFilters({ streamRole: "ゲスト" }, { collabHostOnly: true, collabGuestOnly: true }),
        true
    );
});
