/**
 * テストごとに独立した値を持つ非同期テキストキャッシュを作る。
 * @param {string | null} initialValue 初期値
 */
export function createFakeTextCacheStore(initialValue: string | null = null) {
    let value = initialValue;
    let removeCount = 0;
    return {
        /** 現在の保存内容を返す。 */
        async getText() {
            return value;
        },
        /** テキストを保存する。 */
        async setText(nextValue: string) {
            value = String(nextValue);
            return true;
        },
        /** 保存済みの値を見て、置き換えてよいと判定されたときだけ保存する。 */
        async setTextIf(nextValue: string, canReplace: (current: string | null) => boolean) {
            if (!canReplace(value)) return false;
            value = String(nextValue);
            return true;
        },
        /** 保存内容を削除し、削除回数を記録する。 */
        async removeText() {
            value = null;
            removeCount += 1;
        },
        /** 非同期処理を待たずに保存内容を確認する。 */
        peek() {
            return value;
        },
        /** 削除処理が呼ばれた回数を返す。 */
        getRemoveCount() {
            return removeCount;
        }
    };
}
