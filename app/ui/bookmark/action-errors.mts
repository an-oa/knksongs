import { getBookmarkText } from "./text.mjs";
import type { LocalizedText } from "./text.mjs";
import type { StorageActionFailure } from "../../controllers/storage.mjs";

/**
 * 数値として使える上限だけを返す。
 * @param limit 失敗の結果に付いていた上限
 * @returns 有限の数ならその値、そうでなければ null
 */
function toFiniteLimit(limit: unknown): number | null {
    return typeof limit === "number" && Number.isFinite(limit) ? limit : null;
}

/**
 * ブックマークの作成・名前の変更・削除・曲の追加と削除・並べ替えの失敗を、利用者に出す文言の作り方へ変換する。
 * 出す場所 (通知・ダイアログ・パネルのエラー欄) は呼び出し元が決める。
 * 開いたままの表示は言語が変わると書き直すので、文言そのものではなく作り方を返す。
 * インポート専用の理由は ./import-export.mts が文言にするので、ここでは扱わない。
 * @param result 失敗した操作の結果
 * @returns 文言の作り方。利用者に伝える内容がない理由なら null
 */
export function getBookmarkActionErrorMessage(result: StorageActionFailure): LocalizedText | null {
    switch (result.reason) {
        case "unsupported_storage_version":
            return (language) => getBookmarkText(language).newerStorage;
        case "storage_reload_required":
            return (language) => getBookmarkText(language).reloadRequired;
        case "storage_write_failed":
            return (language) => getBookmarkText(language).saveFailed;
        case "bookmark_not_found":
            return (language) => getBookmarkText(language).notFound;
        case "duplicate_song":
            return (language) => getBookmarkText(language).alreadyAdded;
        case "empty_name":
            return (language) => getBookmarkText(language).nameRequired;
        case "max_bookmark_name_length": {
            const limit = toFiniteLimit(result.limit);
            return (language) => {
                const text = getBookmarkText(language);
                return limit === null ? text.nameTooLong : text.maxNameLength(limit);
            };
        }
        case "max_bookmark_count": {
            const limit = toFiniteLimit(result.limit);
            return (language) => {
                const text = getBookmarkText(language);
                return limit === null ? text.bookmarkLimitReached : text.maxBookmarks(limit);
            };
        }
        case "max_songs_per_bookmark": {
            const limit = toFiniteLimit(result.limit);
            return (language) => {
                const text = getBookmarkText(language);
                return limit === null ? text.songLimitReached : text.maxSongs(limit);
            };
        }
        default:
            return null;
    }
}
