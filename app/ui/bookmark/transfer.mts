import {
    buildBookmarkExportFileName,
    buildBookmarkExportSelectionState,
    buildBookmarkImportConfirmMessage,
    buildBookmarkImportOption,
    buildBookmarkImportResultMessage,
    buildBookmarkImportSelectionState,
    buildBookmarkReplaceMessage,
    buildBookmarkReplaceResultMessage,
    getBookmarkImportErrorMessage,
    getBookmarkMergeBlockerMessage,
    readFileText,
    saveTextFile
} from "./import-export.mjs";
import { getBookmarkIdsInListOrder, setBookmarkPanelError } from "./panel.mjs";
import { createBookmarkTransferDialogController } from "./transfer-dialog.mjs";
import type { BookmarkTransferDialogRequest, OpenBookmarkTransferDialog } from "./transfer-dialog.mjs";
import { MAX_BOOKMARK_IMPORT_BYTES } from "../../lib/storage/bookmark-transfer.mjs";
import type { SiteLanguage } from "../../lib/site-language.mjs";
import type { AppDataState, AppUiElements, SiteLanguageUiRuntimeState } from "../../state.types";
import { getBookmarkText } from "./text.mjs";
import type { LocalizedText } from "./text.mjs";
import type { BookmarkImportPreview, StorageActionResult } from "../../controllers/storage.mjs";

/** エクスポート・インポートから状態管理へ委譲する処理と、差し替えられる入出力。 */
export type BookmarkTransferCallbacks = {
    onExportBookmarks: (bookmarkIds: string[]) => StorageActionResult<{ ok: true; text: string; fileName?: string }>;
    onPreviewBookmarkImport: (text: string) => StorageActionResult<BookmarkImportPreview>;
    /** 選んだブックマークだけを取り込み、同じ ID は上書き、新しい ID は追加する。 */
    onImportSelectedBookmarks: (
        text: string,
        bookmarkIds: string[]
    ) => StorageActionResult<{ ok: true; addedCount: number; updatedCount: number }>;
    /** 今あるブックマークをすべて削除し、ファイルの内容で置換する。 */
    onReplaceAllBookmarks: (text: string) => StorageActionResult<{ ok: true; bookmarkCount: number; songCount: number }>;
    saveTextFile?: (text: string, fileName: string, mimeType: string) => Promise<void> | void;
    /**
     * ブックマークを選ぶダイアログ。省略時は body に作るモーダルダイアログを使う。
     * refreshText は、開いている間に言語が変わったときに文言を書き直す。
     */
    transferDialog?: {
        open: OpenBookmarkTransferDialog;
        refreshText: (language: SiteLanguage) => void;
    };
};

type BookmarkTransferControllerInput = {
    data: Pick<AppDataState, "bookmarks">;
    ui: {
        el: Pick<AppUiElements,
            "bookmarkPanelExportBtn" | "bookmarkPanelImportBtn" | "bookmarkPanelImportInput" | "bookmarkPanelError"
        >;
        /** ダイアログとメッセージの言語。 */
        language: SiteLanguageUiRuntimeState;
    };
    callbacks: BookmarkTransferCallbacks;
};

/** エクスポートのダイアログに並べるブックマーク 1 件。開いた時点の内容で決め、言語が変わっても同じ一覧のまま書き直す。 */
type ExportEntry = { id: string; name: string; songCount: number };

/**
 * ブックマークパネルのエクスポート・インポートを扱う controller を作成する。
 * 一覧の操作とは分け、ダイアログでの選択、ファイルの読み書き、取り込み方の分岐、結果の通知をまとめる。
 * 失敗の理由は、一覧の作成欄と共有するパネル上部のエラー欄に出す。
 */
export function createBookmarkTransferController({ data, ui, callbacks }: BookmarkTransferControllerInput) {
    const {
        onExportBookmarks,
        onPreviewBookmarkImport,
        onImportSelectedBookmarks,
        onReplaceAllBookmarks,
        saveTextFile: saveTextFileCallback = saveTextFile,
        transferDialog = createBookmarkTransferDialogController()
    } = callbacks;

    /**
     * 今のサイトの言語を返す。
     * @returns サイトの言語
     */
    function getLanguage() {
        return ui.language.current;
    }

    /**
     * パネル上部のエラー欄に、エクスポート・インポートの失敗を出す。言語が変わったら、同じ内容を新しい言語で書き直す。
     * @param message 表示する文言の作り方
     */
    function showBookmarkPanelError(message: LocalizedText): void {
        setBookmarkPanelError(ui.el.bookmarkPanelError, message, getLanguage());
    }

    /**
     * パネル上部のエラー欄を消す。
     */
    function clearBookmarkPanelError(): void {
        setBookmarkPanelError(ui.el.bookmarkPanelError, null, getLanguage());
    }

    /**
     * エクスポートのダイアログの表示内容を、指定した言語で作る。
     * @param entries 並べるブックマーク
     * @param language ダイアログの言語
     * @returns 表示内容と決定時の処理
     */
    function buildExportRequest(entries: ExportEntry[], language: SiteLanguage): BookmarkTransferDialogRequest<string[]> {
        const text = getBookmarkText(language);
        return {
            title: text.exportTitle,
            description: text.exportDescription,
            options: entries.map((entry) => ({
                id: entry.id,
                name: entry.name,
                details: [text.songCount(entry.songCount)],
                checked: true,
                disabled: false
            })),
            submitLabel: text.exportSubmit,
            selectAllLabel: text.selectAll,
            cancelLabel: text.cancel,
            describeSelection: (bookmarkIds) => buildBookmarkExportSelectionState(bookmarkIds, language),
            onSubmit: (bookmarkIds) => ({ ok: true, value: bookmarkIds }),
            returnFocusEl: ui.el.bookmarkPanelExportBtn
        };
    }

    /**
     * 書き出すブックマークをダイアログで選ばせ、選んだものを JSON ファイルとして保存する。
     * 保存先の選択はダイアログを閉じてから開き、取り消された場合は何もしない。
     */
    async function exportBookmarksFromPanel() {
        clearBookmarkPanelError();
        const sortedIds = getBookmarkIdsInListOrder(data.bookmarks);
        if (sortedIds.length === 0) {
            showBookmarkPanelError((language) => getBookmarkText(language).noExportable);
            return;
        }
        const entries = sortedIds.map((bookmarkId) => ({
            id: bookmarkId,
            name: data.bookmarks[bookmarkId].name,
            songCount: data.bookmarks[bookmarkId].songs.length
        }));
        const selectedIds = await transferDialog.open(
            (language) => buildExportRequest(entries, language),
            getLanguage()
        );
        if (!selectedIds) return;
        try {
            const result = onExportBookmarks(selectedIds);
            if (result.ok === false) {
                showBookmarkPanelError((language) => getBookmarkText(language).exportFailed);
                return;
            }
            const fileName = typeof result.fileName === "string" && result.fileName.trim()
                ? result.fileName.trim()
                : buildBookmarkExportFileName(new Date());
            await saveTextFileCallback(result.text, fileName, "application/json");
        } catch (error) {
            if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
            showBookmarkPanelError((language) => getBookmarkText(language).exportFailed);
        }
    }

    /**
     * ファイル選択ダイアログを開く。
     */
    function requestBookmarkImportFile() {
        const input = ui.el.bookmarkPanelImportInput;
        if (!input) return;
        clearBookmarkPanelError();
        input.value = "";
        input.click();
    }

    /**
     * インポートのダイアログの表示内容を、指定した言語で作る。
     * 選んだものは同じ ID なら上書き、新しい ID なら追加する。
     * 「インポート」の ▼ でブックマーク全体の置換へ切り替えると、選択を使わずファイルの内容で置換する。
     * @param text ファイルから読み込んだ文字列
     * @param preview 手元と照合したファイルの内容
     * @param language ダイアログの言語
     * @returns 表示内容と決定時の処理。決定時の値は取り込んだ結果のメッセージ
     */
    function buildImportRequest(
        text: string,
        preview: BookmarkImportPreview,
        language: SiteLanguage
    ): BookmarkTransferDialogRequest<string> {
        const mergeBlocked = preview.mergeBlocker !== null;
        const labels = getBookmarkText(language);
        return {
            title: labels.importTitle,
            description: labels.importDescription,
            notice: preview.mergeBlocker ? getBookmarkMergeBlockerMessage(preview.mergeBlocker, language) : undefined,
            options: preview.entries.map((entry) => buildBookmarkImportOption(entry, mergeBlocked, language)),
            submitLabel: labels.importSubmit,
            selectAllLabel: labels.selectAll,
            cancelLabel: labels.cancel,
            describeSelection: (bookmarkIds) => buildBookmarkImportSelectionState(preview, bookmarkIds, language),
            onSubmit: (bookmarkIds) => {
                const result = onImportSelectedBookmarks(text, bookmarkIds);
                if (result.ok === false) {
                    return { ok: false, message: (nextLanguage) => getBookmarkImportErrorMessage(result, nextLanguage) };
                }
                return { ok: true, value: buildBookmarkImportResultMessage(result, language) };
            },
            allItemsAction: {
                menuLabel: labels.importMenuLabel,
                selectionItem: {
                    label: labels.importSelectedLabel,
                    description: labels.importSelectedDescription
                },
                allItemsItem: {
                    label: labels.replaceAllLabel,
                    description: labels.replaceAllDescription
                },
                description: labels.replaceDescription,
                submitLabel: labels.replaceSubmit,
                message: buildBookmarkReplaceMessage(preview, language),
                run: () => {
                    if (!confirm(buildBookmarkImportConfirmMessage(preview, language))) return { ok: false, message: () => "" };
                    const result = onReplaceAllBookmarks(text);
                    if (result.ok === false) {
                        return { ok: false, message: (nextLanguage) => getBookmarkImportErrorMessage(result, nextLanguage) };
                    }
                    return { ok: true, value: buildBookmarkReplaceResultMessage(result.bookmarkCount, language) };
                }
            },
            returnFocusEl: ui.el.bookmarkPanelImportBtn
        };
    }

    /**
     * 選択された JSON ファイルを読み込み、取り込むブックマークを選ばせる。
     */
    async function importBookmarksFromSelectedFile() {
        const input = ui.el.bookmarkPanelImportInput;
        if (!input) return;
        const file = input.files?.[0] ?? null;
        if (!file) return;

        clearBookmarkPanelError();
        try {
            if (file.size > MAX_BOOKMARK_IMPORT_BYTES) {
                showBookmarkPanelError((language) => getBookmarkImportErrorMessage({
                    ok: false,
                    reason: "max_import_file_size",
                    limit: MAX_BOOKMARK_IMPORT_BYTES
                }, language));
                return;
            }
            const text = await readFileText(file);
            const preview = onPreviewBookmarkImport(text);
            if (preview.ok === false) {
                showBookmarkPanelError((language) => getBookmarkImportErrorMessage(preview, language));
                return;
            }
            if (preview.entries.length === 0) {
                showBookmarkPanelError((language) => getBookmarkText(language).noImportable);
                return;
            }
            const resultMessage = await transferDialog.open(
                (language) => buildImportRequest(text, preview, language),
                getLanguage()
            );
            if (resultMessage) alert(resultMessage);
        } catch {
            showBookmarkPanelError((language) => getBookmarkText(language).readFailed);
        } finally {
            input.value = "";
        }
    }

    /**
     * 開いているダイアログの文言を、今の言語で書き直す。言語の切り替えで使う。
     * パネル上部のエラー欄は、作成欄と共有するので、ブックマーク一覧の controller が書き直す。
     */
    function refreshText(): void {
        transferDialog.refreshText(getLanguage());
    }

    /**
     * エクスポート・インポートのボタンとファイル選択のイベントを登録する。
     */
    function setupTransferHandlers(): void {
        const exportBtn = ui.el.bookmarkPanelExportBtn;
        const importBtn = ui.el.bookmarkPanelImportBtn;
        const importInput = ui.el.bookmarkPanelImportInput;
        if (exportBtn) {
            exportBtn.addEventListener("click", exportBookmarksFromPanel);
        }
        if (importBtn) {
            importBtn.addEventListener("click", requestBookmarkImportFile);
        }
        if (importInput) {
            importInput.addEventListener("change", importBookmarksFromSelectedFile);
        }
    }

    return { setupTransferHandlers, refreshText };
}
