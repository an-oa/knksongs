import {
    getLocalStorageText,
    removeLocalStorageText,
    setLocalStorageText
} from "./local-storage-text.mjs";

/** 設定用の保存領域を取得し、アクセス禁止時はページ内の設定適用を続ける。 */
function getSettingsStorage(): Storage | null {
    try {
        return globalThis.localStorage;
    } catch (error) {
        console.warn("設定の保存領域にアクセスできませんでした", error);
        return null;
    }
}

/** 保存設定を読み込み、失敗時は呼び出し元が既定値を使えるよう null を返す。 */
export function getStoredSettingText(key: string): string | null {
    return getLocalStorageText(getSettingsStorage(), key);
}

/** 設定を保存する。失敗してもページ内の画面・再生への反映は継続する。 */
export function setStoredSettingText(key: string, value: string): boolean {
    return setLocalStorageText(getSettingsStorage(), key, value);
}

/** 旧設定を削除し、失敗しても現在の設定の初期化を継続する。 */
export function removeStoredSetting(key: string): void {
    removeLocalStorageText(getSettingsStorage(), key);
}
