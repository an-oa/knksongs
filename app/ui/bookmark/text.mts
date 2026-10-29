import type { SiteLanguage } from "../../lib/site-language.mjs";

/**
 * ブックマークの画面・通知・確認・エラーに出す文言。
 * 件数を埋め込む文言は関数にし、英語では単数と複数を書き分ける。
 */
export type BookmarkText = {
    /** 一覧と作成 */
    empty: string;
    rename: string;
    renameLabel: string;
    deleteLabel: string;
    renamePrompt: string;
    deleteConfirm: (name: string) => string;
    nameRequired: string;
    nameTooLong: string;
    maxNameLength: (limit: number) => string;
    alreadyAdded: string;
    /** 上限と保存の失敗 */
    bookmarkLimitReached: string;
    maxBookmarks: (limit: number) => string;
    songLimitReached: string;
    maxSongs: (limit: number) => string;
    notFound: string;
    newerStorage: string;
    reloadRequired: string;
    saveFailed: string;
    /** 通知 */
    closeNotification: string;
    unknownSong: string;
    created: (name: string) => string;
    deleted: (name: string) => string;
    createdAndSaved: (name: string, song: string) => string;
    saved: (name: string, song: string) => string;
    removed: (name: string, song: string) => string;
    /** エクスポートとインポートのダイアログ */
    selectAll: string;
    cancel: string;
    songCount: (count: number) => string;
    noExportable: string;
    exportTitle: string;
    exportDescription: string;
    exportSubmit: string;
    exportFailed: string;
    exportSelected: (count: number) => string;
    exportSelectPrompt: string;
    importTitle: string;
    importDescription: string;
    importSubmit: string;
    importMenuLabel: string;
    importSelectedLabel: string;
    importSelectedDescription: string;
    replaceAllLabel: string;
    replaceAllDescription: string;
    replaceDescription: string;
    replaceSubmit: string;
    noImportable: string;
    readFailed: string;
    importSelectPrompt: string;
    importSelectionSummary: (addedCount: number, updatedCount: number) => string;
    importResult: (addedCount: number, updatedCount: number) => string;
    badgeNew: string;
    badgeUnchanged: string;
    badgeOverwrite: string;
    sameNameExists: string;
    songsAdded: (count: number) => string;
    songsRemoved: (count: number) => string;
    orderChanged: string;
    songCountWithChanges: (count: number, changes: string[]) => string;
    renamedFrom: (previousName: string) => string;
    /** インポートの失敗と確認 */
    importCountLimit: (limit: number, available: number) => string;
    maxImportFileSize: (megabytes: number) => string;
    songsNotReady: string;
    importExceedsTotalSize: (megabytes: number) => string;
    importNewerStorage: string;
    invalidJson: string;
    invalidBookmarkFile: string;
    unsupportedVersion: string;
    importSaveFailed: string;
    importMaxBookmarkCount: (limit: number | null) => string;
    importMaxNameLength: (limit: number | null) => string;
    importMaxSongs: (bookmarkName: string | null, limit: number | null) => string;
    replaceConfirm: (currentBookmarkCount: number, bookmarkCount: number, songCount: number) => string;
    replaceMessage: (currentBookmarkCount: number, bookmarkCount: number) => string;
    replaceResult: (bookmarkCount: number) => string;
    mergeBlockedByNewerStorage: string;
    mergeBlockedByReload: string;
    mergeBlockedBySaveFailure: string;
};

const JAPANESE_BOOKMARK_TEXT: BookmarkText = {
    empty: "ブックマークはまだありません。",
    rename: "変更",
    renameLabel: "ブックマーク名を変更",
    deleteLabel: "ブックマークを削除",
    renamePrompt: "新しいブックマーク名を入力してください:",
    deleteConfirm: (name) => `ブックマーク「${name}」を削除しますか？`,
    nameRequired: "ブックマーク名を入力してください。",
    nameTooLong: "ブックマーク名の文字数上限を超えています。",
    maxNameLength: (limit) => `ブックマーク名は最大${limit}文字までです。`,
    alreadyAdded: "この曲はすでに選択したブックマークに追加されています。",
    bookmarkLimitReached: "ブックマークの登録上限に達しています。不要なブックマークを削除してください。",
    maxBookmarks: (limit) => `ブックマークは最大${limit}件までです。不要なブックマークを削除してください。`,
    songLimitReached: "1つのブックマークに登録できる曲数の上限に達しています。",
    maxSongs: (limit) => `1つのブックマークに登録できる曲は最大${limit}曲です。`,
    notFound: "ブックマークが見つかりません。画面を更新して再度お試しください。",
    newerStorage: "このアプリより新しい形式のブックマークが保存されているため、変更できません。",
    reloadRequired: "別のタブでブックマークが更新された可能性があります。画面を再読み込みしてから、もう一度お試しください。",
    saveFailed: "ブックマークを保存できませんでした。ブラウザのストレージ設定をご確認ください。",
    closeNotification: "通知を閉じる",
    unknownSong: "曲名不明",
    created: (name) => `ブックマーク「${name}」を作成しました。`,
    deleted: (name) => `ブックマーク「${name}」を削除しました。`,
    createdAndSaved: (name, song) => `ブックマーク「${name}」を作成し、「${song}」を保存しました。`,
    saved: (name, song) => `ブックマーク「${name}」に「${song}」を保存しました。`,
    removed: (name, song) => `ブックマーク「${name}」から「${song}」を削除しました。`,
    selectAll: "すべて選択",
    cancel: "キャンセル",
    songCount: (count) => `${count}曲`,
    noExportable: "エクスポートできるブックマークがありません。",
    exportTitle: "ブックマークのエクスポート",
    exportDescription: "エクスポートするブックマークを選んでください。",
    exportSubmit: "エクスポート",
    exportFailed: "ブックマークをエクスポートできませんでした。",
    exportSelected: (count) => `${count}件を選択中`,
    exportSelectPrompt: "エクスポートするブックマークを選んでください。",
    importTitle: "ブックマークのインポート",
    importDescription: "インポートするブックマークを選んでください。手元にある同じブックマークは、ファイルの内容で上書きします。",
    importSubmit: "インポート",
    importMenuLabel: "取り込み方を選ぶ",
    importSelectedLabel: "選んだブックマークを取り込む",
    importSelectedDescription: "同じものは上書きし、ほかは残します",
    replaceAllLabel: "ブックマーク全体を置換",
    replaceAllDescription: "今あるブックマークはすべて削除します",
    replaceDescription: "今あるブックマークをすべて削除し、ファイルのブックマークだけにします。",
    replaceSubmit: "置換",
    noImportable: "インポートできるブックマークがファイルにありません。",
    readFailed: "ブックマークファイルを読み込めませんでした。",
    importSelectPrompt: "インポートするブックマークを選んでください。",
    importSelectionSummary: (addedCount, updatedCount) => [
        ...(addedCount > 0 ? [`${addedCount}件を追加`] : []),
        ...(updatedCount > 0 ? [`${updatedCount}件を上書き`] : [])
    ].join("・"),
    importResult: (addedCount, updatedCount) => {
        if (addedCount > 0 && updatedCount > 0) return `ブックマークを${addedCount}件追加し、${updatedCount}件上書きしました。`;
        if (addedCount > 0) return `ブックマークを${addedCount}件追加しました。`;
        if (updatedCount > 0) return `ブックマークを${updatedCount}件上書きしました。`;
        return "ブックマークに変更はありませんでした。";
    },
    badgeNew: "新規",
    badgeUnchanged: "変更なし",
    badgeOverwrite: "上書き",
    sameNameExists: "同じ名前のブックマークがあります",
    songsAdded: (count) => `${count}曲追加`,
    songsRemoved: (count) => `${count}曲削除`,
    orderChanged: "並び順の変更",
    songCountWithChanges: (count, changes) => `${count}曲（${changes.join("、")}）`,
    renamedFrom: (previousName) => `名前が「${previousName}」から変わります`,
    importCountLimit: (limit, available) => available > 0
        ? `ブックマークは最大${limit}件です。追加できるのはあと${available}件です。`
        : `ブックマークは最大${limit}件です。追加するには、不要なブックマークを削除してください。`,
    maxImportFileSize: (megabytes) => `インポートできるファイルは最大${megabytes} MBです。`,
    songsNotReady: "曲データの読み込みが終わってから、もう一度お試しください。",
    importExceedsTotalSize: (megabytes) =>
        `インポート後のブックマーク全体が${megabytes} MBを超えるため、インポートできません。選ぶブックマークを減らしてください。`,
    importNewerStorage: "このアプリより新しい形式のブックマークが保存されているため、追加・上書きはできません。",
    invalidJson: "JSONとして読み込めないファイルです。",
    invalidBookmarkFile: "ブックマークの形式ではないファイルです。",
    unsupportedVersion: "このアプリより新しい形式のブックマークファイルは読み込めません。",
    importSaveFailed: "インポートしたブックマークを保存できませんでした。",
    importMaxBookmarkCount: (limit) => limit === null
        ? "インポートできるブックマーク数の上限を超えています。"
        : `インポートできるブックマークは最大${limit}件です。`,
    importMaxNameLength: (limit) => limit === null
        ? "インポートできるブックマーク名の文字数上限を超えています。"
        : `ブックマーク名は最大${limit}文字までです。`,
    importMaxSongs: (bookmarkName, limit) => {
        const name = bookmarkName ? `「${bookmarkName}」は` : "1つのブックマークに";
        return limit === null ? `${name}登録できる曲数の上限を超えています。` : `${name}最大${limit}曲までです。`;
    },
    replaceConfirm: (currentBookmarkCount, bookmarkCount, songCount) => [
        "現在のブックマークをすべて削除し、ファイルの内容で置換します。",
        ...(currentBookmarkCount > 0 ? [`削除するブックマーク：${currentBookmarkCount}件`] : []),
        `置換後のブックマーク：${bookmarkCount}件（${songCount}曲）`,
        "よろしいですか？"
    ].join("\n"),
    replaceMessage: (currentBookmarkCount, bookmarkCount) => currentBookmarkCount > 0
        ? `今ある${currentBookmarkCount}件を削除し、ファイルの${bookmarkCount}件で置換します。`
        : `ファイルの${bookmarkCount}件で置換します。`,
    replaceResult: (bookmarkCount) => `ブックマークを、ファイルの${bookmarkCount}件で置換しました。`,
    mergeBlockedByNewerStorage: "このアプリより新しい形式のブックマークが保存されているため、追加・上書きはできません。「インポート」の ▼ から「ブックマーク全体を置換」を選ぶと、ファイルの内容で置換できます。",
    mergeBlockedByReload: "別のタブでブックマークが更新された可能性があります。追加・上書きするには、画面を再読み込みしてから、もう一度お試しください。",
    mergeBlockedBySaveFailure: "ブックマークを保存できない状態のため、追加・上書きはできません。ブラウザのストレージ設定をご確認ください。"
};

/**
 * 英語の件数付きの名詞を返す。1 のときだけ単数にする。
 * @param count 件数
 * @param singular 単数形
 * @param plural 複数形
 * @returns 件数付きの名詞
 */
function countNoun(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

const ENGLISH_BOOKMARK_TEXT: BookmarkText = {
    empty: "No bookmarks yet.",
    rename: "Edit",
    renameLabel: "Edit bookmark name",
    deleteLabel: "Delete bookmark",
    renamePrompt: "Enter a new bookmark name:",
    deleteConfirm: (name) => `Delete the bookmark “${name}”?`,
    nameRequired: "Enter a bookmark name.",
    nameTooLong: "The bookmark name is too long.",
    maxNameLength: (limit) => `Bookmark names can be up to ${limit} characters.`,
    alreadyAdded: "This song is already in the bookmark.",
    bookmarkLimitReached: "You have reached the bookmark limit. Delete a bookmark you no longer need.",
    maxBookmarks: (limit) => `You can have up to ${countNoun(limit, "bookmark", "bookmarks")}. Delete a bookmark you no longer need.`,
    songLimitReached: "This bookmark has reached its song limit.",
    maxSongs: (limit) => `A bookmark can hold up to ${countNoun(limit, "song", "songs")}.`,
    notFound: "The bookmark was not found. Reload the page and try again.",
    newerStorage: "Bookmarks saved by a newer version of this site can't be changed here.",
    reloadRequired: "Bookmarks may have been updated in another tab. Reload the page and try again.",
    saveFailed: "Couldn't save bookmarks. Check your browser's storage settings.",
    closeNotification: "Close notification",
    unknownSong: "Unknown song",
    created: (name) => `Created the bookmark “${name}”.`,
    deleted: (name) => `Deleted the bookmark “${name}”.`,
    createdAndSaved: (name, song) => `Created the bookmark “${name}” and saved “${song}”.`,
    saved: (name, song) => `Saved “${song}” to the bookmark “${name}”.`,
    removed: (name, song) => `Removed “${song}” from the bookmark “${name}”.`,
    selectAll: "Select all",
    cancel: "Cancel",
    songCount: (count) => countNoun(count, "song", "songs"),
    noExportable: "There are no bookmarks to export.",
    exportTitle: "Export bookmarks",
    exportDescription: "Choose the bookmarks to export.",
    exportSubmit: "Export",
    exportFailed: "Couldn't export bookmarks.",
    exportSelected: (count) => `${count} selected`,
    exportSelectPrompt: "Choose the bookmarks to export.",
    importTitle: "Import bookmarks",
    importDescription: "Choose the bookmarks to import. Bookmarks you already have are overwritten with the file's contents.",
    importSubmit: "Import",
    importMenuLabel: "Choose how to import",
    importSelectedLabel: "Import selected bookmarks",
    importSelectedDescription: "Overwrites matching bookmarks and keeps the rest",
    replaceAllLabel: "Replace all bookmarks",
    replaceAllDescription: "Deletes all your current bookmarks",
    replaceDescription: "Deletes all your current bookmarks and keeps only the bookmarks in the file.",
    replaceSubmit: "Replace",
    noImportable: "The file has no bookmarks to import.",
    readFailed: "Couldn't read the bookmark file.",
    importSelectPrompt: "Choose the bookmarks to import.",
    importSelectionSummary: (addedCount, updatedCount) => [
        ...(addedCount > 0 ? [`Add ${addedCount}`] : []),
        ...(updatedCount > 0 ? [`Overwrite ${updatedCount}`] : [])
    ].join(", "),
    importResult: (addedCount, updatedCount) => {
        if (addedCount > 0 && updatedCount > 0) {
            return `Added ${countNoun(addedCount, "bookmark", "bookmarks")} and overwrote ${updatedCount}.`;
        }
        if (addedCount > 0) return `Added ${countNoun(addedCount, "bookmark", "bookmarks")}.`;
        if (updatedCount > 0) return `Overwrote ${countNoun(updatedCount, "bookmark", "bookmarks")}.`;
        return "No bookmarks were changed.";
    },
    badgeNew: "New",
    badgeUnchanged: "No changes",
    badgeOverwrite: "Overwrite",
    sameNameExists: "A bookmark with the same name exists",
    songsAdded: (count) => `${count} added`,
    songsRemoved: (count) => `${count} removed`,
    orderChanged: "order changed",
    songCountWithChanges: (count, changes) => `${countNoun(count, "song", "songs")} (${changes.join(", ")})`,
    renamedFrom: (previousName) => `Renamed from “${previousName}”`,
    importCountLimit: (limit, available) => available > 0
        ? `You can have up to ${countNoun(limit, "bookmark", "bookmarks")}. You can add ${available} more.`
        : `You can have up to ${countNoun(limit, "bookmark", "bookmarks")}. Delete bookmarks you no longer need to add more.`,
    maxImportFileSize: (megabytes) => `Import files can be up to ${megabytes} MB.`,
    songsNotReady: "Wait until the song data has loaded, then try again.",
    importExceedsTotalSize: (megabytes) =>
        `After importing, your bookmarks would exceed ${megabytes} MB. Choose fewer bookmarks.`,
    importNewerStorage: "Bookmarks saved by a newer version of this site can't be added to or overwritten.",
    invalidJson: "This file isn't valid JSON.",
    invalidBookmarkFile: "This isn't a bookmark file.",
    unsupportedVersion: "Bookmark files from a newer version of this site can't be read.",
    importSaveFailed: "Couldn't save the imported bookmarks.",
    importMaxBookmarkCount: (limit) => limit === null
        ? "The file has more bookmarks than can be imported."
        : `You can import up to ${countNoun(limit, "bookmark", "bookmarks")}.`,
    importMaxNameLength: (limit) => limit === null
        ? "A bookmark name in the file is too long."
        : `Bookmark names can be up to ${limit} characters.`,
    importMaxSongs: (bookmarkName, limit) => {
        const name = bookmarkName ? `“${bookmarkName}”` : "A bookmark";
        return limit === null
            ? `${name} has more songs than a bookmark can hold.`
            : `${name} can hold up to ${countNoun(limit, "song", "songs")}.`;
    },
    replaceConfirm: (currentBookmarkCount, bookmarkCount, songCount) => [
        "This deletes all your current bookmarks and replaces them with the file's contents.",
        ...(currentBookmarkCount > 0 ? [`Bookmarks to delete: ${currentBookmarkCount}`] : []),
        `Bookmarks after replacing: ${bookmarkCount} (${countNoun(songCount, "song", "songs")})`,
        "Continue?"
    ].join("\n"),
    replaceMessage: (currentBookmarkCount, bookmarkCount) => currentBookmarkCount > 0
        ? `Deletes your ${currentBookmarkCount} current ${currentBookmarkCount === 1 ? "bookmark" : "bookmarks"} and replaces them with the ${bookmarkCount} in the file.`
        : `Replaces your bookmarks with the ${bookmarkCount} in the file.`,
    replaceResult: (bookmarkCount) => `Replaced your bookmarks with the ${bookmarkCount} in the file.`,
    mergeBlockedByNewerStorage: "Bookmarks saved by a newer version of this site can't be added to or overwritten. Choose “Replace all bookmarks” from the ▼ next to “Import” to replace them with the file's contents.",
    mergeBlockedByReload: "Bookmarks may have been updated in another tab. To add or overwrite bookmarks, reload the page and try again.",
    mergeBlockedBySaveFailure: "Bookmarks can't be saved right now, so they can't be added or overwritten. Check your browser's storage settings."
};

/**
 * サイトの言語に応じたブックマークの文言を返す。
 * @param language サイトの言語
 * @returns ブックマークの文言
 */
export function getBookmarkText(language: SiteLanguage): BookmarkText {
    return language === "en" ? ENGLISH_BOOKMARK_TEXT : JAPANESE_BOOKMARK_TEXT;
}
