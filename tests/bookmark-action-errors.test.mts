import test from "node:test";
import assert from "node:assert/strict";
import { getBookmarkActionErrorMessage } from "../app/ui/bookmark/action-errors.mts";
import type { StorageActionFailure } from "../app/controllers/storage.mts";

/** 失敗の結果を、日本語と英語の文言にする。文言にしない理由なら null。 */
function readMessages(result: StorageActionFailure) {
    const message = getBookmarkActionErrorMessage(result);
    return message ? [message("ja"), message("en")] : null;
}

test("bookmark action errors: storage failures explain what the user can do", () => {
    assert.deepEqual(readMessages({ ok: false, reason: "storage_write_failed" }), [
        "ブックマークを保存できませんでした。ブラウザのストレージ設定をご確認ください。",
        "Couldn't save bookmarks. Check your browser's storage settings."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "storage_reload_required" }), [
        "別のタブでブックマークが更新された可能性があります。画面を再読み込みしてから、もう一度お試しください。",
        "Bookmarks may have been updated in another tab. Reload the page and try again."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "unsupported_storage_version", version: 4 }), [
        "このアプリより新しい形式のブックマークが保存されているため、変更できません。",
        "Bookmarks saved by a newer version of this site can't be changed here."
    ]);
});

test("bookmark action errors: limits name the limit when it is known", () => {
    assert.deepEqual(readMessages({ ok: false, reason: "max_bookmark_count", limit: 20 }), [
        "ブックマークは最大20件までです。不要なブックマークを削除してください。",
        "You can have up to 20 bookmarks. Delete a bookmark you no longer need."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "max_songs_per_bookmark", limit: 120 }), [
        "1つのブックマークに登録できる曲は最大120曲です。",
        "A bookmark can hold up to 120 songs."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "max_bookmark_name_length", limit: 64 }), [
        "ブックマーク名は最大64文字までです。",
        "Bookmark names can be up to 64 characters."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "max_bookmark_count", limit: Number.POSITIVE_INFINITY }), [
        "ブックマークの登録上限に達しています。不要なブックマークを削除してください。",
        "You have reached the bookmark limit. Delete a bookmark you no longer need."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "max_songs_per_bookmark", limit: Number.NaN }), [
        "1つのブックマークに登録できる曲数の上限に達しています。",
        "This bookmark has reached its song limit."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "max_bookmark_name_length", limit: Number.NaN }), [
        "ブックマーク名の文字数上限を超えています。",
        "The bookmark name is too long."
    ]);
});

test("bookmark action errors: input and lookup failures have their own messages", () => {
    assert.deepEqual(readMessages({ ok: false, reason: "empty_name" }), [
        "ブックマーク名を入力してください。",
        "Enter a bookmark name."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "duplicate_song" }), [
        "この曲はすでに選択したブックマークに追加されています。",
        "This song is already in the bookmark."
    ]);
    assert.deepEqual(readMessages({ ok: false, reason: "bookmark_not_found" }), [
        "ブックマークが見つかりません。画面を更新して再度お試しください。",
        "The bookmark was not found. Reload the page and try again."
    ]);
});

test("bookmark action errors: reasons with nothing to tell the user have no message", () => {
    assert.equal(readMessages({ ok: false, reason: "song_not_found" }), null);
    assert.equal(readMessages({ ok: false, reason: "invalid_name_type" }), null);
    // インポート専用の理由は、インポートの画面が文言にする。
    assert.equal(readMessages({ ok: false, reason: "invalid_json" }), null);
    assert.equal(readMessages({ ok: false, reason: "songs_not_ready" }), null);
});
