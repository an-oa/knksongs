/**
 * ブラウザでアプリを起動する入口。HTML から最初に実行される小さい module。
 *
 * まず ./startup-data.mts を読んで曲データの取得を始め、その完了を待たずに ./bootstrap.mts を読み込む。
 * build では bootstrap.mts が別ファイルに分かれるため、曲データと UI のコードの取得が並行して進む。
 *
 * UI の初期化はここで行わず、bootstrap.mts に任せる。
 * ここへ処理を足すと、そのぶん曲データの取得を始めるのが遅れる。
 */
import "./startup-data.mjs";

void import("./bootstrap.mjs").catch((error: unknown) => {
    console.error("アプリの読み込みに失敗しました", error);
});
