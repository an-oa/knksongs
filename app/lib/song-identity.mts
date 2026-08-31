export type SongIdentityRow = {
    archiveId?: unknown;
    archiveOrder?: unknown;
    videoId?: unknown;
    url?: unknown;
    songKey?: unknown;
    bookmarkSongKey?: unknown;
    legacySongKey?: unknown;
};

export type SongIdentityIssue =
    | {
        kind: "invalid-archive-order";
        index: number;
    }
    | {
        kind: "mismatched-key";
        index: number;
        fieldName: "songKey" | "bookmarkSongKey" | "legacySongKey";
        expected: string;
    }
    | {
        kind: "duplicate-key";
        index: number;
        firstIndex: number;
        fieldName: "songKey" | "bookmarkSongKey";
        value: string;
    };

export type SongReferenceIndex<Row extends SongIdentityRow> = {
    songByBookmarkKey: Map<string, Row>;
    songByKey: Map<string, Row>;
    bookmarkKeyByLegacyKey: Map<string, string>;
    bookmarkSongKeys: Set<string>;
};

/**
 * アーカイブ内の歌唱順を整数として解析し、空欄や整数でない値はnullを返す。
 * CSV変換と旧参照正規化で同じ規則を使うため、このmoduleが所有する。
 */
export function parseArchiveOrder(raw: unknown): number | null {
    const value = String(raw ?? "").trim();
    if (!/^-?\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

/** 現在仕様の曲キー（archiveId + archiveOrder）を生成する。 */
export function buildSongKey(input: SongIdentityRow): string {
    const archiveId = String(input.archiveId ?? "").trim();
    const orderPart = Number.isSafeInteger(input.archiveOrder)
        ? String(input.archiveOrder)
        : "";
    return [archiveId, orderPart].join("::");
}

/**
 * ブックマーク保存用の曲キー（videoId + archiveOrder）を生成する。
 * videoIdがない場合だけarchiveIdへフォールバックする。
 */
export function buildBookmarkSongKey(input: SongIdentityRow): string {
    const keyHead = String(input.videoId ?? "").trim() || String(input.archiveId ?? "").trim();
    const orderPart = Number.isSafeInteger(input.archiveOrder)
        ? String(input.archiveOrder)
        : "";
    return [keyHead, orderPart].join("::");
}

/** 旧仕様互換の曲キー（archiveId + archiveOrder + url）を生成する。 */
export function buildLegacySongKey(input: SongIdentityRow): string {
    return [
        String(input.archiveId ?? "").trim(),
        Number.isSafeInteger(input.archiveOrder) ? String(input.archiveOrder) : "",
        String(input.url ?? "").trim()
    ].join("::");
}

/** 曲行からブックマーク保存に使う参照キーを返す。 */
export function getBookmarkSongRef(row: SongIdentityRow | null | undefined): string {
    if (!row || typeof row !== "object") return "";
    if (typeof row.bookmarkSongKey === "string" && row.bookmarkSongKey.trim()) {
        return row.bookmarkSongKey.trim();
    }
    return typeof row.songKey === "string" ? row.songKey.trim() : "";
}

/** 旧形式の曲参照キーを現在のsongKey形式へ正規化する。 */
export function normalizeLegacySongRefToCurrent(ref: string | null | undefined): string | null {
    if (typeof ref !== "string") return null;
    const parts = ref.split("::");
    if (parts.length < 2) return null;
    const archiveId = (parts[0] || "").trim();
    const archiveOrder = parseArchiveOrder(parts[1]);
    if (!archiveId || archiveOrder === null) return null;
    return buildSongKey({ archiveId, archiveOrder });
}

/**
 * 曲参照の解決と旧形式移行に使うインデックスを構築する。
 * 重複は入力検証で拒否する前提とし、防御的に先に現れた行を保持する。
 */
export function buildSongReferenceIndex<Row extends SongIdentityRow>(
    songRows: readonly Row[]
): SongReferenceIndex<Row> {
    const songByBookmarkKey = new Map<string, Row>();
    const songByKey = new Map<string, Row>();
    const bookmarkKeyByLegacyKey = new Map<string, string>();
    const bookmarkSongKeys = new Set<string>();

    for (const row of songRows) {
        const bookmarkSongRef = getBookmarkSongRef(row);
        if (bookmarkSongRef) {
            bookmarkSongKeys.add(bookmarkSongRef);
            if (!songByBookmarkKey.has(bookmarkSongRef)) {
                songByBookmarkKey.set(bookmarkSongRef, row);
            }
        }
        if (typeof row.songKey === "string" && row.songKey && !songByKey.has(row.songKey)) {
            songByKey.set(row.songKey, row);
        }
        if (typeof row.legacySongKey === "string" && row.legacySongKey && bookmarkSongRef &&
            !bookmarkKeyByLegacyKey.has(row.legacySongKey)) {
            bookmarkKeyByLegacyKey.set(row.legacySongKey, bookmarkSongRef);
        }
    }

    return {
        songByBookmarkKey,
        songByKey,
        bookmarkKeyByLegacyKey,
        bookmarkSongKeys
    };
}

/** 指定キーについて、重複した曲行を識別子問題へ追加する。 */
function collectDuplicateKeyIssues(
    songRows: readonly (SongIdentityRow | null)[],
    fieldName: "songKey" | "bookmarkSongKey",
    issues: SongIdentityIssue[]
): void {
    const firstIndexByKey = new Map<string, number>();
    songRows.forEach((row, index) => {
        if (!row) return;
        const value = row[fieldName];
        if (typeof value !== "string" || !value) return;
        const firstIndex = firstIndexByKey.get(value);
        if (firstIndex !== undefined) {
            issues.push({ kind: "duplicate-key", index, firstIndex, fieldName, value });
            return;
        }
        firstIndexByKey.set(value, index);
    });
}

/**
 * 曲行のarchiveOrder、生成済みキー、一意性を検証する。
 * 呼び出し側はindexをCSV行番号またはJSON配列位置へ対応付けて表示する。
 */
export function validateSongIdentities(songRows: readonly unknown[]): SongIdentityIssue[] {
    const rows: Array<SongIdentityRow | null> = songRows.map((row) => {
        return row && typeof row === "object" && !Array.isArray(row)
            ? row as SongIdentityRow
            : null;
    });
    const issues: SongIdentityIssue[] = [];

    rows.forEach((row, index) => {
        if (!row) return;
        if (typeof row.archiveOrder !== "number" || !Number.isSafeInteger(row.archiveOrder)) {
            issues.push({ kind: "invalid-archive-order", index });
            return;
        }
        const expectedKeys = {
            songKey: buildSongKey(row),
            bookmarkSongKey: buildBookmarkSongKey(row),
            legacySongKey: buildLegacySongKey(row)
        } as const;
        for (const fieldName of Object.keys(expectedKeys) as (keyof typeof expectedKeys)[]) {
            if (row[fieldName] !== expectedKeys[fieldName]) {
                issues.push({
                    kind: "mismatched-key",
                    index,
                    fieldName,
                    expected: expectedKeys[fieldName]
                });
            }
        }
    });

    collectDuplicateKeyIssues(rows, "songKey", issues);
    collectDuplicateKeyIssues(rows, "bookmarkSongKey", issues);
    return issues;
}
