type BookmarkImportMessageResult = {
    reason?: string;
    version?: number;
    limit?: number;
    bookmarkName?: string;
    bookmarkCount?: number;
    songCount?: number;
} | null | undefined;

/**
 * 数値を 2 桁表記へ整える。
 * @param {number} value
 * @returns {string}
 */
function padDatePart(value: number): string {
    return String(value).padStart(2, "0");
}

/**
 * ブックマークエクスポートの既定ファイル名を作る。
 * @param {Date} date
 * @returns {string}
 */
export function buildBookmarkExportFileName(date: Date): string {
    const year = date.getFullYear();
    const month = padDatePart(date.getMonth() + 1);
    const day = padDatePart(date.getDate());
    return `knksongs-bookmarks-${year}${month}${day}.json`;
}

/**
 * テキストを JSON ファイルとして保存する。
 * @param {string} text
 * @param {string} fileName
 * @param {string} mimeType
 */
export async function saveTextFile(text: string, fileName: string, mimeType: string): Promise<void> {
    const blob = new Blob([text], { type: mimeType });
    const savePicker = typeof window !== "undefined" && typeof window.showSaveFilePicker === "function"
        ? window.showSaveFilePicker.bind(window)
        : null;
    if (savePicker) {
        const handle = await savePicker({
            suggestedName: fileName,
            types: [
                {
                    description: "JSON",
                    accept: {
                        "application/json": [".json"]
                    }
                }
            ]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * 選択されたファイルのテキスト内容を読み込む。
 * @param {{ text?: () => Promise<string> } | Blob} file
 * @returns {Promise<string>}
 */
export function readFileText(file: { text?: () => Promise<string> } | Blob): Promise<string> {
    if (file && typeof file.text === "function") {
        return file.text();
    }
    return new Promise((resolve, reject) => {
        if (typeof FileReader !== "function") {
            reject(new Error("FileReader is unavailable"));
            return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result || "")));
        reader.addEventListener("error", () => reject(reader.error || new Error("Failed to read file")));
        reader.readAsText(file as Blob);
    });
}

/**
 * インポート失敗時の理由に応じた表示メッセージを返す。
 * @param {BookmarkImportMessageResult} result
 * @returns {string}
 */
export function getBookmarkImportErrorMessage(result: BookmarkImportMessageResult): string {
    if (!result || !result.reason) {
        return "ブックマークファイルを読み込めませんでした。";
    }
    if (result.reason === "invalid_json") {
        return "JSONとして読み込めないファイルです。";
    }
    if (result.reason === "invalid_bookmark_file" || result.reason === "invalid_text") {
        return "ブックマークの形式ではないファイルです。";
    }
    if (result.reason === "unsupported_version") {
        return "このアプリより新しい形式のブックマークファイルは読み込めません。";
    }
    if (result.reason === "storage_write_failed") {
        return "インポートしたブックマークを保存できませんでした。";
    }
    if (result.reason === "max_bookmark_count") {
        const limit = Number.isFinite(result.limit) ? result.limit : null;
        return limit === null
            ? "インポートできるブックマーク数の上限を超えています。"
            : `インポートできるブックマークは最大${limit}件です。`;
    }
    if (result.reason === "max_bookmark_name_length") {
        const limit = Number.isFinite(result.limit) ? result.limit : null;
        return limit === null
            ? "インポートできるブックマーク名の文字数上限を超えています。"
            : `ブックマーク名は最大${limit}文字までです。`;
    }
    if (result.reason === "max_songs_per_bookmark") {
        const limit = Number.isFinite(result.limit) ? result.limit : null;
        const name = typeof result.bookmarkName === "string" && result.bookmarkName
            ? `「${result.bookmarkName}」は`
            : "1つのブックマークに";
        return limit === null
            ? `${name}登録できる曲数の上限を超えています。`
            : `${name}最大${limit}曲までです。`;
    }
    return "ブックマークファイルを読み込めませんでした。";
}

/**
 * インポート確認メッセージを作る。
 * @param {BookmarkImportMessageResult} preview
 * @returns {string}
 */
export function buildBookmarkImportConfirmMessage(preview: BookmarkImportMessageResult): string {
    const bookmarkCount = Number.isFinite(preview && preview.bookmarkCount) ? preview.bookmarkCount : 0;
    const songCount = Number.isFinite(preview && preview.songCount) ? preview.songCount : 0;
    return [
        "現在のブックマークを置き換えます。",
        `${bookmarkCount}件のブックマーク、${songCount}曲をインポートします。`,
        "よろしいですか？"
    ].join("\n");
}
