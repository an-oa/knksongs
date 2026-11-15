import {
    getLocalStorageText,
    removeLocalStorageText
} from "./local-storage-text.mjs";

const DEFAULT_DB_NAME = "knksongs";
const DEFAULT_STORE_NAME = "songsJsonCache";

/** 保存済みの値 (なければ null) を見て、置き換えてよいかを同期で返す判定。 */
type CanReplaceCachedText = (current: string | null) => boolean;

type TextCacheStore = {
    getText: () => Promise<string | null>;
    setText: (value: string) => Promise<boolean>;
    /**
     * 保存済みの値を読み、置き換えてよいと判定されたときだけ保存する。保存したら true を返す。
     * 読み取りと保存をひと続きに行い、別のタブの保存が間に入らないようにする。
     */
    setTextIf: (value: string, canReplace: CanReplaceCachedText) => Promise<boolean>;
    removeText: () => Promise<void>;
};

type TextCacheStoreOptions = {
    cacheKey: string;
    dbName?: string;
    storeName?: string;
};

type LegacyLocalStorageTextCacheAdapterOptions = {
    cache: TextCacheStore;
    legacyKey?: string;
    legacyKeys?: string[];
    storage?: {
        getItem: (key: string) => string | null;
        removeItem: (key: string) => void;
    } | null;
    label?: string;
};

/**
 * IndexedDB が現在の実行環境で使えるか判定する。
 * @returns {boolean}
 */
function canUseIndexedDb() {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
}

/**
 * IndexedDB のリクエストを Promise として待つ。
 * @param {IDBRequest} request
 * @returns {Promise<*>}
 */
function waitForRequest<T = unknown>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
}

/**
 * IndexedDB のトランザクション完了を Promise として待つ。
 * @param {IDBTransaction} transaction
 * @returns {Promise<void>}
 */
function waitForTransaction(transaction: IDBTransaction) {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
}

/**
 * テキストキャッシュ用の IndexedDB を開く。
 * @param {{ dbName: string, storeName: string }} options
 * @returns {Promise<IDBDatabase>}
 */
function openTextCacheDatabase({
    dbName,
    storeName
}: { dbName: string, storeName: string }): Promise<IDBDatabase> {
    // テキストキャッシュ用の IndexedDB を開く。
    if (!canUseIndexedDb()) {
        return Promise.reject(new Error("IndexedDB is not available"));
    }
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: "key" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
        request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
}

/**
 * IndexedDB へテキストを保存するキャッシュストアを作成する。
 * @param {{ cacheKey: string, dbName?: string, storeName?: string }} options
 * @returns {TextCacheStore}
 */
export function createIndexedDbTextCacheStore(options: TextCacheStoreOptions): TextCacheStore {
    // IndexedDB へテキストを保存するキャッシュストアを作成する。
    const {
        cacheKey,
        dbName = DEFAULT_DB_NAME,
        storeName = DEFAULT_STORE_NAME
    } = options;

    /**
     * テキストキャッシュの object store を取得する。
     * @param {IDBTransactionMode} mode
     * @returns {Promise<{ db: IDBDatabase, transaction: IDBTransaction, store: IDBObjectStore }>}
     */
    async function openStore(mode: IDBTransactionMode): Promise<{
        db: IDBDatabase,
        transaction: IDBTransaction,
        store: IDBObjectStore
    }> {
        // テキストキャッシュの object store を取得する。
        const db = await openTextCacheDatabase({ dbName, storeName });
        try {
            const transaction = db.transaction(storeName, mode);
            return {
                db,
                transaction,
                store: transaction.objectStore(storeName)
            };
        } catch (error) {
            db.close();
            throw error;
        }
    }

    /**
     * IndexedDB 接続を閉じる。
     * @param {IDBDatabase} db
     */
    function closeDb(db: IDBDatabase) {
        db.close();
    }

    return {
        async getText() {
            if (!cacheKey) return null;
            const { db, store } = await openStore("readonly");
            try {
                const record = await waitForRequest<{ value?: unknown } | undefined>(store.get(cacheKey));
                return typeof record?.value === "string" ? record.value : null;
            } finally {
                closeDb(db);
            }
        },
        async setText(value) {
            if (!cacheKey) return false;
            const { db, transaction, store } = await openStore("readwrite");
            try {
                store.put({
                    key: cacheKey,
                    value,
                    updatedAt: Date.now()
                });
                await waitForTransaction(transaction);
                return true;
            } finally {
                closeDb(db);
            }
        },
        async setTextIf(value, canReplace) {
            if (!cacheKey) return false;
            const { db, transaction, store } = await openStore("readwrite");
            try {
                let isReplaced = false;
                const request = store.get(cacheKey);
                // 読み取りの完了通知の中で、続けて保存する。同じ読み書きのトランザクションなので、
                // 別のタブの保存は、読み取りと保存の間に入れない。判定が例外を投げたときは、トランザクションごと中止になる。
                request.onsuccess = () => {
                    const record = request.result as { value?: unknown } | undefined;
                    if (!canReplace(typeof record?.value === "string" ? record.value : null)) return;
                    store.put({
                        key: cacheKey,
                        value,
                        updatedAt: Date.now()
                    });
                    isReplaced = true;
                };
                await waitForTransaction(transaction);
                return isReplaced;
            } finally {
                closeDb(db);
            }
        },
        async removeText() {
            if (!cacheKey) return;
            const { db, transaction, store } = await openStore("readwrite");
            try {
                store.delete(cacheKey);
                await waitForTransaction(transaction);
            } finally {
                closeDb(db);
            }
        }
    };
}

/**
 * IndexedDB へ曲データJSON文字列を保存するキャッシュストアを作成する。
 * 本番コードでは汎用の text cache と同じ実装を使い、既存 API 名の互換を保つために export している。
 * @param {{ cacheKey: string, dbName?: string, storeName?: string }} options
 * @returns {TextCacheStore}
 */
export function createIndexedDbSongsJsonCacheStore(options: TextCacheStoreOptions): TextCacheStore {
    // 既存 API 名から汎用 IndexedDB text cache を使う。
    return createIndexedDbTextCacheStore(options);
}

/**
 * localStorage に残っている旧キャッシュ key を順に返す。
 * @param {string | undefined} legacyKey
 * @param {string[] | undefined} legacyKeys
 * @returns {string[]}
 */
function getLegacyCacheKeys(legacyKey: string | undefined, legacyKeys: string[] | undefined): string[] {
    // 旧単一 key 指定と複数 key 指定を同じ配列へ整える。
    return [legacyKey]
        .concat(Array.isArray(legacyKeys) ? legacyKeys : [])
        .filter((key, index, keys): key is string => typeof key === "string" && key.length > 0 && keys.indexOf(key) === index);
}

/**
 * localStorage の旧キャッシュ key から最初に見つかったテキストを返す。
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 * @param {string[]} legacyKeys
 * @returns {string | null}
 */
function getFirstLegacyCachedText(storage: Pick<Storage, "getItem"> | null | undefined, legacyKeys: string[]): string | null {
    // 現行 key、旧 key の順に移行元候補を探す。
    for (const key of legacyKeys) {
        const text = getLocalStorageText(storage, key);
        if (text) return text;
    }
    return null;
}

/**
 * localStorage に残る旧キャッシュ key をまとめて削除する。
 * @param {{ removeItem: (key: string) => void } | null | undefined} storage
 * @param {string[]} legacyKeys
 */
function removeLegacyCachedTexts(storage: Pick<Storage, "removeItem"> | null | undefined, legacyKeys: string[]): void {
    // 移行後に localStorage の容量を解放する。
    legacyKeys.forEach((key) => removeLocalStorageText(storage, key));
}

/**
 * 現行・旧キャッシュの読み取りと採用後の保存を分離するadapter。
 * getText/getLegacyTextは読み取り専用で、setText成功後だけ旧キャッシュを削除する。
 */
export function createLegacyLocalStorageTextCacheAdapter(
    options: LegacyLocalStorageTextCacheAdapterOptions
): TextCacheStore & { getLegacyText: () => string | null } {
    // localStorage に残る大きな旧キャッシュを IndexedDB などの非同期 cache へ移す。
    const {
        cache,
        legacyKey,
        legacyKeys: rawLegacyKeys,
        storage = null,
        label = "テキストキャッシュ"
    } = options;
    const legacyKeys = getLegacyCacheKeys(legacyKey, rawLegacyKeys);

    /**
     * 現行 cache への保存を実行し、保存できたときだけ旧 localStorage キャッシュを片付ける。
     * @param save 現行 cache へ保存する処理。保存したら true を返す
     * @returns 保存できたか
     */
    async function saveAndClearLegacy(save: () => Promise<boolean>): Promise<boolean> {
        try {
            const saved = await save();
            if (saved) removeLegacyCachedTexts(storage, legacyKeys);
            return saved;
        } catch (error) {
            console.warn(`${label}を保存できませんでした`, error);
            return false;
        }
    }

    /**
     * 非同期 cache へテキストを保存する。
     * @param value 保存するテキスト
     * @returns 保存できたか
     */
    function setText(value: string): Promise<boolean> {
        return saveAndClearLegacy(() => cache.setText(value));
    }

    /**
     * 現行 cache の保存済みの値を見て、置き換えてよいときだけ保存する。
     * @param value 保存するテキスト
     * @param canReplace 保存済みの値を見て、置き換えてよいかを返す判定
     * @returns 保存したか
     */
    function setTextIf(value: string, canReplace: CanReplaceCachedText): Promise<boolean> {
        return saveAndClearLegacy(() => cache.setTextIf(value, canReplace));
    }

    return {
        async getText() {
            // 読み取り中は保存・削除をせず、移行元の選択は呼び出し元へ渡す。
            try {
                const cachedText = await cache.getText();
                if (cachedText) return cachedText;
            } catch (error) {
                console.warn(`${label}を読み込めませんでした`, error);
            }
            return null;
        },
        /** 旧キャッシュを読み取るだけにし、採用後のsetText成功時に削除する。 */
        getLegacyText: () => getFirstLegacyCachedText(storage, legacyKeys),
        setText,
        setTextIf,
        async removeText() {
            // 現行 cache と旧 localStorage キャッシュをまとめて削除する。
            try {
                await cache.removeText();
            } catch (error) {
                console.warn(`${label}を削除できませんでした`, error);
            }
            removeLegacyCachedTexts(storage, legacyKeys);
        }
    };
}

/** 曲データJSONの旧キャッシュを、呼び出し元の検証・採用後に移行するadapter。 */
export function createLegacyLocalStorageSongsJsonCacheAdapter(options: LegacyLocalStorageTextCacheAdapterOptions) {
    // 旧localStorageキャッシュを非同期キャッシュへ移行する adapter を作成する。
    return createLegacyLocalStorageTextCacheAdapter({
        ...options,
        label: "曲データJSONキャッシュ"
    });
}
