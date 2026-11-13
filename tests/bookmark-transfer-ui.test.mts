import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarkTransferController } from "../app/ui/bookmark/transfer.mts";
import { getBookmarkImportErrorMessage } from "../app/ui/bookmark/import-export.mts";
import { refreshBookmarkPanelError } from "../app/ui/bookmark/panel.mts";
import type { BookmarkTransferCallbacks } from "../app/ui/bookmark/transfer.mts";
import type { BookmarkTransferDialogRequest } from "../app/ui/bookmark/transfer-dialog.mts";
import type { BookmarkPromptDialogRequest } from "../app/ui/bookmark/prompt-dialog.mts";
import type { AppDataState } from "../app/state.types";
import type { SiteLanguage } from "../app/lib/site-language.mts";
import { installFakeDom, invokeListener } from "./test-helpers.mts";

/** 偽のダイアログで行う操作。submit は選んだ ID で決定し、allItems は ▼ で全体を対象にして決定し、cancel は取り消す。 */
type TransferDialogChoice =
    | { action: "submit"; selectedIds?: string[] }
    | { action: "allItems" }
    | { action: "cancel" };

/** インポート確認の既定値。ファイル内の新しいブックマーク 1 件を、手元 2 件の状態で照合した結果。 */
const DEFAULT_IMPORT_PREVIEW = {
    ok: true,
    entries: [{
        id: "imported-1",
        name: "Imported",
        songCount: 2,
        status: "new",
        changes: null,
        hasSameNameBookmark: false
    }],
    bookmarkCount: 1,
    songCount: 2,
    currentBookmarkCount: 2,
    maxBookmarkCount: 20,
    mergeBlocker: null
} as const satisfies ReturnType<BookmarkTransferCallbacks["onPreviewBookmarkImport"]>;

/**
 * エクスポート・インポートのテスト用に、パネルのボタン・ファイル選択・エラー欄だけで controller を作る。
 * 一覧やサイドバーは用意しない。ダイアログは偽物に差し替え、渡された要求と操作の結果を記録する。
 */
function createTransferHarness(options: {
    bookmarks?: AppDataState["bookmarks"];
    onExportBookmarksResult?: ReturnType<BookmarkTransferCallbacks["onExportBookmarks"]>;
    onPreviewBookmarkImportResult?: ReturnType<BookmarkTransferCallbacks["onPreviewBookmarkImport"]>;
    onReplaceAllBookmarksResult?: ReturnType<BookmarkTransferCallbacks["onReplaceAllBookmarks"]>;
    onImportSelectedBookmarksResult?: ReturnType<BookmarkTransferCallbacks["onImportSelectedBookmarks"]>;
    /** 偽のダイアログでの操作。省略時は既定のチェック状態のまま決定する。 */
    transferDialogChoice?: TransferDialogChoice;
    /** サイトの言語。省略時は日本語。 */
    language?: SiteLanguage;
    /** 偽の確認ダイアログで決定するかどうか。省略時は決定する。 */
    confirmAccepted?: boolean;
} = {}) {
    const bookmarkPanelExportBtn = document.createElement("button");
    const bookmarkPanelImportBtn = document.createElement("button");
    const bookmarkPanelImportInput = document.createElement("input");
    const bookmarkPanelError = document.createElement("div");
    bookmarkPanelImportInput.type = "file";
    bookmarkPanelError.hidden = true;
    const ui = {
        el: { bookmarkPanelExportBtn, bookmarkPanelImportBtn, bookmarkPanelImportInput, bookmarkPanelError },
        language: { current: options.language ?? "ja" }
    };
    const data: Pick<AppDataState, "bookmarks"> = {
        bookmarks: options.bookmarks || {
            "bookmark-1": { name: "First", createdAt: 10, songs: ["song-a"] },
            "bookmark-2": { name: "Second", createdAt: 20, songs: ["song-b", "song-c"] }
        }
    };
    const calls: {
        exportBookmarkArgs: string[][];
        previewImportArgs: string[];
        replaceAllArgs: string[];
        importSelectedArgs: [string, string[]][];
        savedFiles: { text: string; fileName: string; mimeType: string }[];
        transferDialogRequests: BookmarkTransferDialogRequest<unknown>[];
        /** 偽のダイアログが受け取った、言語ごとの表示内容を作る関数。 */
        transferDialogBuilders: ((language: SiteLanguage) => BookmarkTransferDialogRequest<unknown>)[];
        transferDialogRefreshLanguages: SiteLanguage[];
        transferDialogErrors: string[];
        /** 偽の確認ダイアログが受け取った表示内容。 */
        confirmRequests: BookmarkPromptDialogRequest[];
        /** 利用者へ通知した文言。通知した時点のサイトの言語で読む。 */
        notifications: string[];
    } = {
        exportBookmarkArgs: [],
        previewImportArgs: [],
        replaceAllArgs: [],
        importSelectedArgs: [],
        savedFiles: [],
        transferDialogRequests: [],
        transferDialogBuilders: [],
        transferDialogRefreshLanguages: [],
        transferDialogErrors: [],
        confirmRequests: [],
        notifications: []
    };
    const callbacks: BookmarkTransferCallbacks = {
        onExportBookmarks(bookmarkIds) {
            calls.exportBookmarkArgs.push(bookmarkIds);
            return options.onExportBookmarksResult ?? {
                ok: true,
                text: "{\"version\":3,\"bookmarks\":{}}\n"
            };
        },
        onPreviewBookmarkImport(text) {
            calls.previewImportArgs.push(text);
            return options.onPreviewBookmarkImportResult ?? DEFAULT_IMPORT_PREVIEW;
        },
        onImportSelectedBookmarks(text, bookmarkIds) {
            calls.importSelectedArgs.push([text, bookmarkIds]);
            return options.onImportSelectedBookmarksResult ?? { ok: true, addedCount: 1, updatedCount: 0 };
        },
        onReplaceAllBookmarks(text) {
            calls.replaceAllArgs.push(text);
            return options.onReplaceAllBookmarksResult ?? {
                ok: true,
                bookmarkCount: 1,
                songCount: 2
            };
        },
        async saveTextFile(text, fileName, mimeType) {
            calls.savedFiles.push({ text, fileName, mimeType });
        },
        transferDialog: {
            async open<T>(
                buildRequest: (language: SiteLanguage) => BookmarkTransferDialogRequest<T>,
                language: SiteLanguage
            ): Promise<T | null> {
                const request = buildRequest(language);
                calls.transferDialogBuilders.push(buildRequest);
                calls.transferDialogRequests.push(request);
                const choice = options.transferDialogChoice ?? { action: "submit" };
                if (choice.action === "cancel") return null;
                const result = choice.action === "allItems"
                    ? await request.allItemsAction?.run()
                    : request.onSubmit(choice.selectedIds ?? request.options
                        .filter((option) => option.checked && !option.disabled)
                        .map((option) => option.id));
                if (!result) return null;
                if (!result.ok) {
                    // 本物のダイアログは開いたまま理由を出す。ここでは理由を記録し、利用者が閉じたものとして扱う。
                    const message = result.message(language);
                    if (message) calls.transferDialogErrors.push(message);
                    return null;
                }
                return result.value;
            },
            refreshText(language) {
                calls.transferDialogRefreshLanguages.push(language);
            }
        },
        promptDialog: {
            async open(buildRequest, language) {
                const request = buildRequest(language);
                calls.confirmRequests.push(request);
                if (options.confirmAccepted === false) return false;
                return request.onSubmit("").ok;
            }
        },
        onNotify(message) {
            calls.notifications.push(message(ui.language.current));
        }
    };

    const controller = createBookmarkTransferController({ data, ui, callbacks });
    return { ui, data, calls, controller };
}

/**
 * 偽のファイル選択で、指定した文字列のファイルを選んだことにする。
 * @param input ファイル選択の input
 * @param text ファイルの内容
 */
function selectImportFile(input: HTMLInputElement, text: string) {
    Object.defineProperty(input, "files", {
        value: [new File([text], "bookmarks.json", { type: "application/json" })],
        configurable: true
    });
}

test("bookmark transfer ui: export dialog lists bookmarks in creation order and saves the chosen ones", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness({
            transferDialogChoice: { action: "submit", selectedIds: ["bookmark-2"] }
        });
        controller.setupTransferHandlers();

        await invokeListener(ui.el.bookmarkPanelExportBtn, "click", {});

        assert.equal(calls.transferDialogRequests.length, 1);
        const [request] = calls.transferDialogRequests;
        assert.equal(request.title, "ブックマークのエクスポート");
        assert.equal(request.submitLabel, "エクスポート");
        assert.equal(request.allItemsAction, undefined);
        assert.equal(request.returnFocusEl, ui.el.bookmarkPanelExportBtn);
        assert.deepEqual(request.options, [
            { id: "bookmark-1", name: "First", details: ["1曲"], checked: true, disabled: false },
            { id: "bookmark-2", name: "Second", details: ["2曲"], checked: true, disabled: false }
        ]);
        assert.deepEqual(request.describeSelection([]), {
            message: "エクスポートするブックマークを選んでください。",
            isError: false,
            canSubmit: false
        });
        assert.deepEqual(calls.exportBookmarkArgs, [["bookmark-2"]]);
        assert.equal(calls.savedFiles.length, 1);
        assert.equal(calls.savedFiles[0].text, "{\"version\":3,\"bookmarks\":{}}\n");
        assert.match(calls.savedFiles[0].fileName, /^knksongs-bookmarks-\d{8}\.json$/);
        assert.equal(calls.savedFiles[0].mimeType, "application/json");
        assert.equal(ui.el.bookmarkPanelError.hidden, true);
    } finally {
        restoreDom();
    }
});

test("bookmark transfer ui: English export dialog uses English labels and counts", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness({ language: "en", transferDialogChoice: { action: "cancel" } });
        controller.setupTransferHandlers();

        await invokeListener(ui.el.bookmarkPanelExportBtn, "click", {});

        const [request] = calls.transferDialogRequests;
        assert.equal(request.title, "Export bookmarks");
        assert.equal(request.submitLabel, "Export");
        assert.equal(request.selectAllLabel, "Select all");
        assert.equal(request.cancelLabel, "Cancel");
        assert.deepEqual(request.options.map((option) => option.details), [["1 song"], ["2 songs"]]);
        assert.equal(request.describeSelection([]).message, "Choose the bookmarks to export.");
        assert.equal(request.describeSelection(["bookmark-1"]).message, "1 selected");
    } finally {
        restoreDom();
    }
});

test("bookmark transfer ui: English import dialog uses English labels, badges, and results", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness({ language: "en" });
        controller.setupTransferHandlers();

        selectImportFile(ui.el.bookmarkPanelImportInput, "{}");
        await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});

        const [request] = calls.transferDialogRequests;
        assert.equal(request.title, "Import bookmarks");
        assert.equal(request.submitLabel, "Import");
        assert.deepEqual(request.options[0].badge, "New");
        assert.deepEqual(request.options[0].details, ["2 songs"]);
        assert.equal(request.allItemsAction?.menuLabel, "Choose how to import");
        assert.equal(request.allItemsAction?.allItemsItem.label, "Replace all bookmarks");
        assert.equal(request.allItemsAction?.message, "Deletes your 2 current bookmarks and replaces them with the 1 in the file.");
        assert.equal(request.describeSelection(["imported-1"]).message, "Add 1");
        assert.deepEqual(calls.notifications, ["Added 1 bookmark."]);
    } finally {
        restoreDom();
    }
});

test("bookmark transfer ui: canceling the export dialog saves nothing", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness({ transferDialogChoice: { action: "cancel" } });
        controller.setupTransferHandlers();

        await invokeListener(ui.el.bookmarkPanelExportBtn, "click", {});

        assert.equal(calls.transferDialogRequests.length, 1);
        assert.deepEqual(calls.exportBookmarkArgs, []);
        assert.deepEqual(calls.savedFiles, []);
        assert.equal(ui.el.bookmarkPanelError.hidden, true);
    } finally {
        restoreDom();
    }
});

test("bookmark transfer ui: export without bookmarks shows an error instead of the dialog", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness({ bookmarks: {} });
        controller.setupTransferHandlers();

        await invokeListener(ui.el.bookmarkPanelExportBtn, "click", {});

        assert.equal(calls.transferDialogRequests.length, 0);
        assert.deepEqual(calls.savedFiles, []);
        assert.equal(ui.el.bookmarkPanelError.hidden, false);
        assert.equal(ui.el.bookmarkPanelError.textContent, "エクスポートできるブックマークがありません。");
    } finally {
        restoreDom();
    }
});

test("bookmark transfer ui: import dialog lists file bookmarks and imports the chosen ones", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness();
        controller.setupTransferHandlers();

        let filePickerOpened = false;
        ui.el.bookmarkPanelImportInput.click = () => {
            filePickerOpened = true;
        };
        invokeListener(ui.el.bookmarkPanelImportBtn, "click", {});
        assert.equal(filePickerOpened, true);

        const importText = "{\"version\":3,\"bookmarks\":{}}";
        selectImportFile(ui.el.bookmarkPanelImportInput, importText);
        await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});

        assert.deepEqual(calls.previewImportArgs, [importText]);
        assert.equal(calls.transferDialogRequests.length, 1);
        const [request] = calls.transferDialogRequests;
        assert.equal(request.title, "ブックマークのインポート");
        assert.equal(request.submitLabel, "インポート");
        assert.equal(request.notice, undefined);
        assert.equal(request.returnFocusEl, ui.el.bookmarkPanelImportBtn);
        const allItemsAction = request.allItemsAction;
        assert.ok(allItemsAction);
        assert.equal(allItemsAction.menuLabel, "取り込み方を選ぶ");
        assert.deepEqual(allItemsAction.selectionItem, {
            label: "選んだブックマークを取り込む",
            description: "同じものは上書きし、ほかは残します"
        });
        assert.deepEqual(allItemsAction.allItemsItem, {
            label: "ブックマーク全体を置換",
            description: "今あるブックマークはすべて削除します"
        });
        assert.equal(allItemsAction.submitLabel, "置換");
        assert.equal(allItemsAction.description, "今あるブックマークをすべて削除し、ファイルのブックマークだけにします。");
        assert.equal(allItemsAction.message, "今ある2件を削除し、ファイルの1件で置換します。");
        assert.deepEqual(request.options, [
            { id: "imported-1", name: "Imported", badge: "新規", details: ["2曲"], checked: true, disabled: false }
        ]);
        assert.deepEqual(request.describeSelection(["imported-1"]), {
            message: "1件を追加",
            isError: false,
            canSubmit: true
        });
        assert.deepEqual(calls.importSelectedArgs, [[importText, ["imported-1"]]]);
        assert.deepEqual(calls.replaceAllArgs, []);
        assert.deepEqual(calls.confirmRequests, []);
        assert.deepEqual(calls.notifications, ["ブックマークを1件追加しました。"]);
        assert.equal(ui.el.bookmarkPanelImportInput.value, "");
        assert.equal(ui.el.bookmarkPanelError.hidden, true);
    } finally {
        restoreDom();
    }
});

for (const accepted of [true, false]) {
    test(`bookmark transfer ui: replacing every bookmark from the import dialog waits for confirmation (${accepted ? "accepted" : "declined"})`, async () => {
        const restoreDom = installFakeDom();
        try {
            const { ui, calls, controller } = createTransferHarness({
                transferDialogChoice: { action: "allItems" },
                confirmAccepted: accepted
            });
            controller.setupTransferHandlers();
            const importText = "{\"version\":3,\"bookmarks\":{}}";
            selectImportFile(ui.el.bookmarkPanelImportInput, importText);

            await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});

            assert.equal(calls.confirmRequests.length, 1);
            const [confirmRequest] = calls.confirmRequests;
            assert.equal(confirmRequest.title, "ブックマーク全体の置換");
            assert.equal(confirmRequest.message, [
                "現在のブックマークをすべて削除し、ファイルの内容で置換します。",
                "削除するブックマーク：2件",
                "置換後のブックマーク：1件（2曲）",
                "よろしいですか？"
            ].join("\n"));
            assert.equal(confirmRequest.submitLabel, "置換");
            assert.equal(confirmRequest.isDestructive, true);
            assert.equal(confirmRequest.input, undefined);
            assert.deepEqual(calls.replaceAllArgs, accepted ? [importText] : []);
            assert.deepEqual(calls.importSelectedArgs, []);
            assert.deepEqual(calls.notifications, accepted ? ["ブックマークを、ファイルの1件で置換しました。"] : []);
            assert.deepEqual(calls.transferDialogErrors, []);
        } finally {
                restoreDom();
        }
    });
}

test("bookmark transfer ui: import dialog explains stored data that blocks adding or overwriting", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness({
            onPreviewBookmarkImportResult: {
                ...DEFAULT_IMPORT_PREVIEW,
                mergeBlocker: { ok: false, reason: "unsupported_storage_version", version: 4 }
            },
            transferDialogChoice: { action: "cancel" }
        });
        controller.setupTransferHandlers();
        selectImportFile(ui.el.bookmarkPanelImportInput, "{}");

        await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});

        const [request] = calls.transferDialogRequests;
        assert.equal(
            request.notice,
            "このアプリより新しい形式のブックマークが保存されているため、追加・上書きはできません。「インポート」の ▼ から「ブックマーク全体を置換」を選ぶと、ファイルの内容で置換できます。"
        );
        assert.deepEqual(request.options.map(({ checked, disabled }) => ({ checked, disabled })), [
            { checked: false, disabled: true }
        ]);
        assert.deepEqual(request.describeSelection([]), { message: "", isError: false, canSubmit: false });
        assert.equal(request.allItemsAction?.submitLabel, "置換");
    } finally {
        restoreDom();
    }
});

test("bookmark transfer ui: import of a file without bookmarks shows an error instead of the dialog", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness({
            onPreviewBookmarkImportResult: { ...DEFAULT_IMPORT_PREVIEW, entries: [], bookmarkCount: 0, songCount: 0 }
        });
        controller.setupTransferHandlers();
        selectImportFile(ui.el.bookmarkPanelImportInput, "{\"version\":3,\"bookmarks\":{}}");

        await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});

        assert.equal(calls.transferDialogRequests.length, 0);
        assert.equal(ui.el.bookmarkPanelError.hidden, false);
        assert.equal(ui.el.bookmarkPanelError.textContent, "インポートできるブックマークがファイルにありません。");
    } finally {
        restoreDom();
    }
});

test("bookmark transfer ui: import error is shown without replacing bookmarks", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, calls, controller } = createTransferHarness({
            onPreviewBookmarkImportResult: { ok: false, reason: "invalid_json" }
        });
        controller.setupTransferHandlers();

        const importText = "{";
        selectImportFile(ui.el.bookmarkPanelImportInput, importText);
        await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});

        assert.deepEqual(calls.previewImportArgs, [importText]);
        assert.equal(calls.transferDialogRequests.length, 0);
        assert.deepEqual(calls.replaceAllArgs, []);
        assert.deepEqual(calls.importSelectedArgs, []);
        assert.deepEqual(calls.confirmRequests, []);
        assert.equal(ui.el.bookmarkPanelError.hidden, false);
        assert.equal(ui.el.bookmarkPanelError.textContent, "JSONとして読み込めないファイルです。");
    } finally {
        restoreDom();
    }
});

for (const { result, importMessage } of [
    {
        result: { ok: false, reason: "storage_write_failed" },
        importMessage: "インポートしたブックマークを保存できませんでした。"
    },
    {
        result: { ok: false, reason: "storage_reload_required" },
        importMessage: "別のタブでブックマークが更新された可能性があります。画面を再読み込みしてから、もう一度お試しください。"
    },
    {
        result: { ok: false, reason: "unsupported_storage_version", version: 4 },
        importMessage: "このアプリより新しい形式のブックマークが保存されているため、追加・上書きはできません。"
    }
] as const) {
    test(`bookmark transfer ui: ${result.reason} export result shows an error without saving a file`, async () => {
        const restoreDom = installFakeDom();
        try {
            const { ui, calls, controller } = createTransferHarness({ onExportBookmarksResult: result });
            controller.setupTransferHandlers();
            await invokeListener(ui.el.bookmarkPanelExportBtn, "click", {});

            assert.deepEqual(calls.exportBookmarkArgs, [["bookmark-1", "bookmark-2"]]);
            assert.deepEqual(calls.savedFiles, []);
            assert.equal(ui.el.bookmarkPanelError.hidden, false);
            assert.equal(ui.el.bookmarkPanelError.textContent, "ブックマークをエクスポートできませんでした。");
        } finally {
            restoreDom();
        }
    });

    for (const phase of ["preview", "merge", "replace"] as const) {
        test(`bookmark transfer ui: ${result.reason} ${phase} result prevents import success`, async () => {
            const restoreDom = installFakeDom();
                    try {
                const { ui, calls, controller } = createTransferHarness({
                    ...(phase === "preview" ? { onPreviewBookmarkImportResult: result } : {}),
                    ...(phase === "merge" ? { onImportSelectedBookmarksResult: result } : {}),
                    ...(phase === "replace"
                        ? { onReplaceAllBookmarksResult: result, transferDialogChoice: { action: "allItems" } as const }
                        : {})
                });
                controller.setupTransferHandlers();
                const importText = '{"version":3,"bookmarks":{}}';
                selectImportFile(ui.el.bookmarkPanelImportInput, importText);
                await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});

                assert.deepEqual(calls.previewImportArgs, [importText]);
                assert.deepEqual(calls.importSelectedArgs, phase === "merge" ? [[importText, ["imported-1"]]] : []);
                assert.deepEqual(calls.replaceAllArgs, phase === "replace" ? [importText] : []);
                assert.equal(calls.confirmRequests.length, phase === "replace" ? 1 : 0);
                assert.deepEqual(calls.notifications, []);
                if (phase === "preview") {
                    // 確認画面を出す前の失敗は、パネルに理由を出す。
                    assert.equal(calls.transferDialogRequests.length, 0);
                    assert.equal(ui.el.bookmarkPanelError.hidden, false);
                    assert.equal(ui.el.bookmarkPanelError.textContent, importMessage);
                } else {
                    // 確認画面での失敗は、開いたままのダイアログに理由を出す。
                    assert.deepEqual(calls.transferDialogErrors, [importMessage]);
                    assert.equal(ui.el.bookmarkPanelError.hidden, true);
                }
                assert.equal(ui.el.bookmarkPanelImportInput.value, "");
            } finally {
                        restoreDom();
            }
        });
    }
}

test("bookmark transfer ui: the open dialog is rebuilt in the new language with the bookmarks it opened with", async () => {
    const restoreDom = installFakeDom();
    try {
        const { ui, data, calls, controller } = createTransferHarness({ transferDialogChoice: { action: "cancel" } });
        controller.setupTransferHandlers();

        await invokeListener(ui.el.bookmarkPanelExportBtn, "click", {});
        // 開いた後にブックマークが変わっても、書き直すのは開いた時点の一覧。
        delete data.bookmarks["bookmark-2"];
        const [buildRequest] = calls.transferDialogBuilders;
        const english = buildRequest("en");

        assert.equal(english.title, "Export bookmarks");
        assert.deepEqual(english.options.map((option) => [option.id, option.details]), [
            ["bookmark-1", ["1 song"]],
            ["bookmark-2", ["2 songs"]]
        ]);
        assert.equal(english.describeSelection(["bookmark-1"]).message, "1 selected");

        ui.language.current = "en";
        controller.refreshText();
        assert.deepEqual(calls.transferDialogRefreshLanguages, ["en"]);
    } finally {
        restoreDom();
    }
});

test("bookmark transfer ui: import failures and panel errors can be rewritten in the new language", async () => {
    const restoreDom = installFakeDom();
    try {
        const failure = { ok: false, reason: "storage_write_failed" } as const;
        const { ui, calls, controller } = createTransferHarness({ onImportSelectedBookmarksResult: failure });
        controller.setupTransferHandlers();

        selectImportFile(ui.el.bookmarkPanelImportInput, "{}");
        await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});
        assert.deepEqual(calls.transferDialogErrors, [getBookmarkImportErrorMessage(failure, "ja")]);

        // ダイアログは、失敗の理由を言語が変わったときに書き直せる形で受け取る。
        const result = calls.transferDialogBuilders[0]("ja").onSubmit(["imported-1"]);
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.message("en"), getBookmarkImportErrorMessage(failure, "en"));
        assert.notEqual(result.message("en"), result.message("ja"));
    } finally {
        restoreDom();
    }

    const restoreDomForPanel = installFakeDom();
    try {
        const { ui, controller } = createTransferHarness({
            onPreviewBookmarkImportResult: { ok: false, reason: "invalid_json" }
        });
        controller.setupTransferHandlers();

        selectImportFile(ui.el.bookmarkPanelImportInput, "{");
        await invokeListener(ui.el.bookmarkPanelImportInput, "change", {});
        assert.equal(ui.el.bookmarkPanelError.textContent, "JSONとして読み込めないファイルです。");

        refreshBookmarkPanelError(ui.el.bookmarkPanelError, "en");
        assert.equal(
            ui.el.bookmarkPanelError.textContent,
            getBookmarkImportErrorMessage({ ok: false, reason: "invalid_json" }, "en")
        );
        assert.equal(ui.el.bookmarkPanelError.hidden, false);
    } finally {
        restoreDomForPanel();
    }
});
