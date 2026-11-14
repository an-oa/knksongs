import type { Page } from "@playwright/test";
import { SONGS_JSON_CACHE_KEY } from "../../../app/config.mts";

/**
 * 実ブラウザのIndexedDBから現在の曲データJSONキャッシュを読み込む。
 */
export async function readSongsJsonCacheText(page: Page) {
    return page.evaluate(async (cacheKey) => {
        return new Promise<string | null>((resolve, reject) => {
            const opening = indexedDB.open("knksongs", 1);
            // 読み取り補助が空のDBを作り、アプリのschema初期化を妨げないようにする。
            opening.onupgradeneeded = () => opening.transaction?.abort();
            opening.onerror = () => opening.error?.name === "AbortError" ? resolve(null) : reject(opening.error);
            opening.onsuccess = () => {
                const db = opening.result;
                if (!db.objectStoreNames.contains("songsJsonCache")) {
                    db.close();
                    resolve(null);
                    return;
                }
                const request = db.transaction("songsJsonCache", "readonly").objectStore("songsJsonCache").get(cacheKey);
                request.onsuccess = () => {
                    db.close();
                    resolve(typeof request.result?.value === "string" ? request.result.value : null);
                };
                request.onerror = () => { db.close(); reject(request.error); };
            };
        });
    }, SONGS_JSON_CACHE_KEY);
}

/** 次のページ読み込みから曲キャッシュの削除を記録し、観測用の読み取り関数を返す。 */
export async function observeSongsCacheDeletions(page: Page) {
    await page.addInitScript(() => {
        const cacheDeletions: Parameters<IDBObjectStore["delete"]>[0][] = [];
        window.cacheDeletions = cacheDeletions;
        const remove = IDBObjectStore.prototype.delete;
        IDBObjectStore.prototype.delete = function (key) {
            cacheDeletions.push(key);
            return remove.call(this, key);
        };
    });
    return () => page.evaluate(() => window.cacheDeletions);
}

/**
 * 次のページ読み込みから、曲データJSONを保存しようとした回数を数え、観測用の読み取り関数を返す。
 * 保存済みの値を見たうえで保存を見送った場合も、1 回に数える。保存の処理が終わったことを待つために使う。
 */
export async function observeSongsCacheSaveAttempts(page: Page) {
    await page.addInitScript((cacheKey) => {
        window.songsCacheSaveAttempts = 0;
        const counted = new WeakSet<IDBTransaction>();
        /** 曲データJSONのキーを読み書きする書き込み用のトランザクションを、完了した時点で 1 回に数える。 */
        const countWhenDone = (store: IDBObjectStore, key: unknown) => {
            const { transaction } = store;
            if (store.name !== "songsJsonCache" || transaction.mode !== "readwrite" || key !== cacheKey) return;
            if (counted.has(transaction)) return;
            counted.add(transaction);
            transaction.addEventListener("complete", () => {
                window.songsCacheSaveAttempts = (window.songsCacheSaveAttempts ?? 0) + 1;
            });
        };
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
            countWhenDone(this, query);
            return get.call(this, query);
        };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (this: IDBObjectStore, record: unknown, key?: IDBValidKey) {
            countWhenDone(this, record !== null && typeof record === "object" && "key" in record ? record.key : undefined);
            return key === undefined ? put.call(this, record) : put.call(this, record, key);
        };
    }, SONGS_JSON_CACHE_KEY);
    return () => page.evaluate(() => window.songsCacheSaveAttempts ?? 0);
}

/** 取得済みの曲キャッシュを旧localStorage形式へ移し、IndexedDBから取り除く。 */
export async function prepareLegacySongsCache(page: Page): Promise<void> {
    const text = await readSongsJsonCacheText(page);
    if (text === null) throw new Error("Expected the initial songs cache before migrating it");
    await page.evaluate(async (text) => {
        localStorage.setItem("cachedSongsJson", text);
        await new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open("knksongs", 1);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
                const db = opening.result;
                const transaction = db.transaction("songsJsonCache", "readwrite");
                transaction.objectStore("songsJsonCache").delete("cachedSongsJson");
                transaction.oncomplete = () => { db.close(); resolve(); };
                transaction.onabort = () => { db.close(); reject(transaction.error); };
            };
        });
    }, text);
}

/** 次のページ読み込みで曲キャッシュの保存完了通知を保留し、待機・解放操作を返す。 */
export async function deferSongsCacheCompletion(page: Page) {
    await page.addInitScript(() => {
        const put = IDBObjectStore.prototype.put;
        const setCompletion = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete")?.set;
        if (!setCompletion) throw new Error("IDBTransaction.oncomplete setter is unavailable");
        IDBObjectStore.prototype.put = function (this: IDBObjectStore, record: unknown, ...args: [key?: IDBValidKey]) {
            if (record !== null && typeof record === "object" && "value" in record &&
                typeof record.value === "string" && this.name === "songsJsonCache") {
                Object.defineProperty(this.transaction, "oncomplete", {
                    set(this: IDBTransaction, handler: IDBTransaction["oncomplete"]) {
                        if (handler === null) {
                            setCompletion.call(this, null);
                            return;
                        }
                        setCompletion.call(this, (event: Event) => {
                            window.releaseCacheCompletion = () => handler.call(this, event);
                        });
                    }
                });
            }
            return put.call(this, record, ...args);
        };
    });
    return {
        /** 保存が終わり、アプリへの完了通知だけが保留されるまで待つ。 */
        waitUntilHeld: () => page.waitForFunction(() => typeof window.releaseCacheCompletion === "function"),
        /** 保留した通知をアプリへ渡す。 */
        release: () => page.evaluate(() => {
            if (!window.releaseCacheCompletion) throw new Error("Cache completion callback is unavailable");
            window.releaseCacheCompletion();
        })
    };
}
