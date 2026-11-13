export type SongIdentityRow = {
    archiveId?: unknown;
    archiveOrder?: unknown;
    videoId?: unknown;
    songKey?: unknown;
    bookmarkSongKey?: unknown;
};

export type SongIdentityIssue =
    | {
        kind: "invalid-archive-order";
        index: number;
    }
    | {
        kind: "mismatched-key";
        index: number;
        fieldName: "songKey" | "bookmarkSongKey";
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
    return `${archiveId}::${orderPart}`;
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
    return `${keyHead}::${orderPart}`;
}

/** 曲行からブックマーク保存に使う参照キーを返す。 */
export function getBookmarkSongRef(row: SongIdentityRow | null | undefined): string {
    if (!row || typeof row !== "object") return "";
    if (typeof row.bookmarkSongKey === "string" && row.bookmarkSongKey.trim()) {
        return row.bookmarkSongKey.trim();
    }
    return typeof row.songKey === "string" ? row.songKey.trim() : "";
}

/**
 * 旧形式の曲参照キーを現在のsongKey形式へ正規化する。
 * 最初期の形式（archiveId::archiveOrder::url）も、先頭の archiveId と archiveOrder だけを読んで同じ曲へ対応づける。
 * URL は曲の特定に使わないので、曲データにはこの形式のキーを持たせない。
 * 旧ブックマークの移行用で、旧形式の互換を打ち切るときに削除できる。
 * @param ref ブックマークに保存されていた曲参照
 * @returns 現在のsongKey。archiveId と整数の archiveOrder を読み取れなければ null
 */
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
    }

    return {
        songByBookmarkKey,
        songByKey,
        bookmarkSongKeys
    };
}

/** 指定キーの重複を入力順に返す。呼び出し元が停止すれば残りの走査も行わない。 */
function* iterateDuplicateKeyIssues(
    songRows: readonly unknown[],
    fieldName: "songKey" | "bookmarkSongKey"
): Generator<SongIdentityIssue> {
    const firstIndexByKey = new Map<string, number>();
    for (let index = 0; index < songRows.length; index++) {
        const row = songRows[index];
        if (!isSongIdentityRow(row)) continue;
        const value = row[fieldName];
        if (typeof value !== "string" || !value) continue;
        const firstIndex = firstIndexByKey.get(value);
        if (firstIndex !== undefined) {
            yield { kind: "duplicate-key", index, firstIndex, fieldName, value };
        } else {
            firstIndexByKey.set(value, index);
        }
    }
}

/** 識別子を検証できる行かを判定し、配列の作り直しを避ける。 */
function isSongIdentityRow(row: unknown): row is SongIdentityRow {
    return Boolean(row) && typeof row === "object" && !Array.isArray(row);
}

/**
 * 共通の検証規則を診断順（行ごとの整合性、songKey重複、bookmarkSongKey重複）で返す。
 * 全件診断と実行時の早期終了で、検証条件と最初の問題の意味を共有する。
 */
function* iterateSongIdentityIssues(songRows: readonly unknown[]): Generator<SongIdentityIssue> {
    for (let index = 0; index < songRows.length; index++) {
        const row = songRows[index];
        if (!isSongIdentityRow(row)) continue;
        if (typeof row.archiveOrder !== "number" || !Number.isSafeInteger(row.archiveOrder)) {
            yield { kind: "invalid-archive-order", index };
            continue;
        }
        const songKeyIssue = getMismatchedKeyIssue(row, index, "songKey", buildSongKey(row));
        if (songKeyIssue) yield songKeyIssue;
        const bookmarkIssue = getMismatchedKeyIssue(row, index, "bookmarkSongKey", buildBookmarkSongKey(row));
        if (bookmarkIssue) yield bookmarkIssue;
    }
    yield* iterateDuplicateKeyIssues(songRows, "songKey");
    yield* iterateDuplicateKeyIssues(songRows, "bookmarkSongKey");
}

/** CSV品質診断向けに、曲キーの整合性と一意性の問題を従来と同じ順序で全件返す。 */
export function validateSongIdentities(songRows: readonly unknown[]): SongIdentityIssue[] {
    return Array.from(iterateSongIdentityIssues(songRows));
}

/** 実行時JSON検証向けに最初の問題で停止し、全件分の診断配列を作らない。 */
export function findFirstSongIdentityIssue(songRows: readonly unknown[]): SongIdentityIssue | null {
    return iterateSongIdentityIssues(songRows).next().value ?? null;
}

/** 生成規則と異なるキーだけ診断にし、正常な曲ごとの一時オブジェクトを省く。 */
function getMismatchedKeyIssue(
    row: SongIdentityRow,
    index: number,
    fieldName: "songKey" | "bookmarkSongKey",
    expected: string
): SongIdentityIssue | null {
    return row[fieldName] !== expected ? { kind: "mismatched-key", index, fieldName, expected } : null;
}
