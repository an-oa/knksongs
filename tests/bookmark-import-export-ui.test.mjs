import test from "node:test";
import assert from "node:assert/strict";
import {
    buildBookmarkExportFileName,
    buildBookmarkImportConfirmMessage,
    getBookmarkImportErrorMessage,
    readFileText
} from "../_build/app/ui/bookmark/import-export.mjs";

test("bookmark import export ui: builds dated export filenames", () => {
    const fileName = buildBookmarkExportFileName(new Date(2026, 3, 9));

    assert.equal(fileName, "knksongs-bookmarks-20260409.json");
});

test("bookmark import export ui: maps import results to user-facing messages", () => {
    assert.equal(
        getBookmarkImportErrorMessage({ ok: false, reason: "invalid_json" }),
        "JSONとして読み込めないファイルです。"
    );
    assert.equal(
        getBookmarkImportErrorMessage({ ok: false, reason: "unsupported_version", version: 4 }),
        "このアプリより新しい形式のブックマークファイルは読み込めません。"
    );
    assert.equal(
        getBookmarkImportErrorMessage({ ok: false, reason: "storage_write_failed" }),
        "インポートしたブックマークを保存できませんでした。"
    );
    assert.equal(
        getBookmarkImportErrorMessage({ ok: false, reason: "max_bookmark_count", limit: 20 }),
        "インポートできるブックマークは最大20件です。"
    );
    assert.equal(
        getBookmarkImportErrorMessage({ ok: false, reason: "max_bookmark_name_length", limit: 64 }),
        "ブックマーク名は最大64文字までです。"
    );
    assert.equal(
        getBookmarkImportErrorMessage({
            ok: false,
            reason: "max_songs_per_bookmark",
            limit: 120,
            bookmarkName: "Set List"
        }),
        "「Set List」は最大120曲までです。"
    );
});

test("bookmark import export ui: builds replacement confirmation text", () => {
    assert.equal(
        buildBookmarkImportConfirmMessage({ bookmarkCount: 2, songCount: 5 }),
        [
            "現在のブックマークを置き換えます。",
            "2件のブックマーク、5曲をインポートします。",
            "よろしいですか？"
        ].join("\n")
    );
});

test("bookmark import export ui: reads text from File-like objects", async () => {
    const text = await readFileText({
        text: async () => "{\"version\":2,\"bookmarks\":{}}"
    });

    assert.equal(text, "{\"version\":2,\"bookmarks\":{}}");
});
