export type SongIdentityRow = {
    archiveId?: unknown;
    archiveOrder?: unknown;
    videoId?: unknown;
    songKey?: unknown;
};

export type SongIdentityIssue =
    | {
        kind: "invalid-archive-order";
        index: number;
    }
    | {
        /** songKey が生成規則と一致しない。 */
        kind: "mismatched-key";
        index: number;
        expected: string;
    }
    | {
        /** 同じ songKey を持つ曲が前にある。 */
        kind: "duplicate-key";
        index: number;
        firstIndex: number;
        value: string;
    }
    | {
        /** archiveId と archiveOrder の組が同じ曲が前にある。value は buildArchiveSongKey の値。 */
        kind: "duplicate-archive-order";
        index: number;
        firstIndex: number;
        value: string;
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

/** キーの後半に使う歌唱順の文字列を返す。整数でなければ空文字。 */
function formatArchiveOrderPart(archiveOrder: unknown): string {
    return Number.isSafeInteger(archiveOrder) ? String(archiveOrder) : "";
}

/**
 * 曲キー（videoId + archiveOrder）を生成する。
 * 画面内での曲の参照と、ブックマークの保存の両方に、この 1 つのキーを使う。
 * videoIdがない場合だけarchiveIdへフォールバックする。
 * @param input キーの材料を持つ曲行
 * @returns 曲キー
 */
export function buildSongKey(input: SongIdentityRow): string {
    const keyHead = String(input.videoId ?? "").trim() || String(input.archiveId ?? "").trim();
    return `${keyHead}::${formatArchiveOrderPart(input.archiveOrder)}`;
}

/**
 * アーカイブ内の位置を表すキー（archiveId + archiveOrder）を生成する。
 * シートの「#」と「##」の組が曲ごとに違うことの検証に使う。
 * 2026-04 より前のブックマークはこの形で曲を指していたので、旧ブックマークの移行にも使う。
 * 曲データには持たせず、必要なときに曲行から作る。
 * @param input archiveId と archiveOrder を持つ曲行
 * @returns アーカイブ内の位置を表すキー
 */
export function buildArchiveSongKey(input: SongIdentityRow): string {
    return `${String(input.archiveId ?? "").trim()}::${formatArchiveOrderPart(input.archiveOrder)}`;
}

/**
 * 旧形式の曲参照を、アーカイブ内の位置を表すキー（buildArchiveSongKey の形）へ正規化する。
 * 旧形式は archiveId::archiveOrder と、その後ろに URL を付けた最初期の形式（archiveId::archiveOrder::url）の 2 つ。
 * どちらも先頭の archiveId と archiveOrder だけを読む。URL は曲の特定に使わない。
 * 旧ブックマークの移行用で、旧形式の互換を打ち切るときに削除できる。
 * @param ref ブックマークに保存されていた曲参照
 * @returns アーカイブ内の位置を表すキー。archiveId と整数の archiveOrder を読み取れなければ null
 */
export function normalizeLegacySongRefToArchiveKey(ref: string | null | undefined): string | null {
    if (typeof ref !== "string") return null;
    const parts = ref.split("::");
    if (parts.length < 2) return null;
    const archiveId = (parts[0] || "").trim();
    const archiveOrder = parseArchiveOrder(parts[1]);
    if (!archiveId || archiveOrder === null) return null;
    return buildArchiveSongKey({ archiveId, archiveOrder });
}

/**
 * 曲キーから曲行を引く対応表を作る。
 * 重複は入力検証で拒否する前提とし、防御的に先に現れた行を保持する。
 * @param songRows 曲行
 * @returns 曲キーから曲行への対応表
 */
export function buildSongByKeyMap<Row extends SongIdentityRow>(songRows: readonly Row[]): Map<string, Row> {
    const songByKey = new Map<string, Row>();
    for (const row of songRows) {
        if (typeof row.songKey === "string" && row.songKey && !songByKey.has(row.songKey)) {
            songByKey.set(row.songKey, row);
        }
    }
    return songByKey;
}

/**
 * アーカイブ内の位置を表すキーから、今の曲キーを引く対応表を作る。
 * 旧ブックマークの移行用で、旧形式の互換を打ち切るときに削除できる。
 * 重複は入力検証で拒否する前提とし、防御的に先に現れた行を保持する。
 * @param songRows 曲行
 * @returns アーカイブ内の位置を表すキーから曲キーへの対応表
 */
export function buildSongKeyByArchiveKeyMap(songRows: readonly SongIdentityRow[]): Map<string, string> {
    const songKeyByArchiveKey = new Map<string, string>();
    for (const row of songRows) {
        if (typeof row.songKey !== "string" || !row.songKey) continue;
        const archiveKey = getValidArchiveSongKey(row);
        if (archiveKey && !songKeyByArchiveKey.has(archiveKey)) songKeyByArchiveKey.set(archiveKey, row.songKey);
    }
    return songKeyByArchiveKey;
}

/**
 * archiveId と整数の archiveOrder がそろった行だけ、アーカイブ内の位置を表すキーを返す。
 * @param row 曲行
 * @returns アーカイブ内の位置を表すキー。材料が欠けていれば null
 */
function getValidArchiveSongKey(row: SongIdentityRow): string | null {
    if (!Number.isSafeInteger(row.archiveOrder) || !String(row.archiveId ?? "").trim()) return null;
    return buildArchiveSongKey(row);
}

/**
 * キーの重複を入力順に返す。呼び出し元が停止すれば残りの走査も行わない。
 * @param songRows 検証する曲行
 * @param kind 返す診断の種類
 * @param getKey 行からキーを取り出す関数。重複を調べない行では null か空文字を返す
 */
function* iterateDuplicateKeyIssues(
    songRows: readonly unknown[],
    kind: "duplicate-key" | "duplicate-archive-order",
    getKey: (row: SongIdentityRow) => unknown
): Generator<SongIdentityIssue> {
    const firstIndexByKey = new Map<string, number>();
    for (let index = 0; index < songRows.length; index++) {
        const row = songRows[index];
        if (!isSongIdentityRow(row)) continue;
        const value = getKey(row);
        if (typeof value !== "string" || !value) continue;
        const firstIndex = firstIndexByKey.get(value);
        if (firstIndex !== undefined) {
            yield { kind, index, firstIndex, value };
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
 * 共通の検証規則を診断順（行ごとの整合性、archiveId と archiveOrder の組の重複、songKey重複）で返す。
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
        const expected = buildSongKey(row);
        if (row.songKey !== expected) yield { kind: "mismatched-key", index, expected };
    }
    yield* iterateDuplicateKeyIssues(songRows, "duplicate-archive-order", getValidArchiveSongKey);
    yield* iterateDuplicateKeyIssues(songRows, "duplicate-key", (row) => row.songKey);
}

/** CSV品質診断向けに、曲キーの整合性と一意性の問題を診断順で全件返す。 */
export function validateSongIdentities(songRows: readonly unknown[]): SongIdentityIssue[] {
    return Array.from(iterateSongIdentityIssues(songRows));
}

/** 実行時JSON検証向けに最初の問題で停止し、全件分の診断配列を作らない。 */
export function findFirstSongIdentityIssue(songRows: readonly unknown[]): SongIdentityIssue | null {
    return iterateSongIdentityIssues(songRows).next().value ?? null;
}
