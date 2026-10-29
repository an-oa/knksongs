# AGENTS

## Commit Log Style

- 1行目は英語の件名で、`type: summary` 形式にする。
  - `type` には Conventional Commits の種別を使う。
  - `type` は現状 `feat` `fix` `refactor` `docs` `chore` `test` が使われている。
- 2行目は空行にする。
- 3行目以降は日本語の箇条書きにする。
- 箇条書きは `- ` で始め、必要なら次行を2スペースでインデントして折り返す。
- 折り返しは語句を細かく分断せず、日本語として自然な意味のまとまりで行う。
- 1行目に説明の主文をある程度まとめ、2行目以降は補足や後半句を続ける形を優先する。
- 助詞の直後や短すぎる語句単位では改行しない。
- 本文は 2-3 項目程度で、変更内容を機能単位で簡潔に書く。
- PowerShell 経由で `git commit -m` を実行するときは、
  本文中に Markdown 用のバッククォート `` ` `` を入れない。
  制御文字として解釈され、ファイル名やコマンドが壊れることがある。
- PowerShell 経由で `git commit -m` を実行するときは、
  コミット本文の改行に `\n` という文字列を書かない。
- 本文の改行は、`-m` に渡す文字列の中で
  実際の改行文字をそのまま入れる。
- `\n` を文字として書くと、
  そのままコミット本文へ記録されることがある。
- コミット本文でファイル名やコマンドを書く必要がある場合は、
  バッククォートなしの素の文字列で書く。
- 箇条書き間の空行を確実に避けたい場合は、本文を複数の `-m` に分けず、
  コミットメッセージ全体を一時ファイルに書いて `git commit -F <file>` で渡す。
- `git commit -F` 用のメッセージファイルでは、1行目の件名、2行目の空行、
  3行目以降の箇条書きを最終形そのままに記述し、コミット前に目視で空行位置を確認する。

### Commit Log Example

```text
feat: move settings into dedicated sidebar panel

- サイドメニューの表示設定を独立した設定パネルへ移し、
  ブックマークと同じ導線に揃えた。
- 設定パネルの開閉と Esc とフォーカス復帰を追加し、
  背面サイドバーを inert で制御するようにした。
- サイドメニュー内の表記を設定へ統一し、
  ブックマークの下に表示される順序へ調整した。
```

## Module Header Comments

- 人が最初にファイルを開いたとき、役割と範囲がすぐ分かるよう、入口になる module の先頭
  (import より前)に `/** ... */` で概要コメントを置く。
- 対象は composition root (`app/bootstrap.mts`)、状態を所有する module (`app/state.mts`)、
  各 `controllers/*.mts` など、複数の module を束ねる、または他から読まれる起点になる module。
  小さな helper や単機能の `lib/*.mts` には、関数 JSDoc で足りる場合は付けない。
- 書く内容は次の 3 点に絞り、本文を 3〜8 行程度に収める。
  `/**` `*/` の行と、段落を区切る空行は行数に数えない。
  - この module が担う役割
  - 依存する主な module のグループ (個々の import を 1 つずつ説明しない)
  - この module が担わないこと、または処理の置き場所
- import 先の関数名や引数など、コードを読めば分かる情報は書かない。
  コードと食い違って古くなりやすいため、グループ単位の説明にとどめる。
- 役割や依存の構成を変えたときは、概要コメントも同じ変更内で更新する。

## JavaScript / TypeScript Function Docs

- 実装側の `app/**/*.mts` では、関数の直前に `/** ... */` の JSDoc を置いて機能を説明する書き方が広く使われている。
- 特に `app/bootstrap.mts` `app/ui/bookmark/ui.mts` `app/controllers/search.mts`
  `app/controllers/storage.mts` `app/controllers/render.mts`
  `app/controllers/youtube.mts` では、この形式が主流になっている。
- 短い委譲関数や一部テスト補助関数では省略されている箇所もあるが、新しく関数を追加するときは、関数の先頭に JSDoc を付けて機能を説明する。
- 必要に応じて `@param` `@returns` を付け、既存コードの粒度に合わせて簡潔に書く。
- `.mts` では型を TypeScript の型注釈だけに書き、JSDoc の `@param` `@returns` には `{型}` を書かない。
  名前と説明だけを書く。例: `@param songKey 追加する曲の参照キー`。
- 既存コードに残る `@param {型}` `@returns {型}` は TS の型注釈との二重管理なので、
  その関数を触るときに `{型}` を削除する。型しか書かれていない行は、説明を補うか行ごと削除する。
  一括置換では整理しない。
- DOM 要素を受け取る関数では、呼び出し元だけに依存せず、
  必要に応じて `isHtmlElement` などの実行時チェックで境界を守る。
- module 内 helper を単体テストで直接検証するために export する場合は、`__test__` へ分けず通常の named export のままにしてよい。
  その場合は JSDoc に、本番コードでは同じ module 内または上位 API 経由で使う helper であり、
  境界条件を単体テストするために export していることを簡潔に残す。

## JavaScript Type References

- アプリ内の特定 module が所有する状態やデータ構造の型は、可能な限りその実装 module の近くに
  TypeScript の `type` / `interface` として置き、利用側では `import type` で参照元を明示する。
- `types/**/*.d.ts` の ambient 宣言は、ブラウザ API の拡張や複数 module にまたがる共有ドメイン型など、
  所有 module を自然に決めにくい型に限定する。
- 実装に所有者がある型を ambient に追加しない。やむを得ず追加する場合は、どの実装領域の型なのか、
  なぜ ambient に置く必要があるのかをコメントや近接する型名で分かるようにする。
- 型参照の記述量を減らすことより、依存方向が読めることを優先する。
  循環参照や所有境界の曖昧さに気づけるよう、型だけの参照でも参照元を隠さない。
- `AppState` や UI slice など実装の初期化・更新処理と強く結びつく型は、
  `types/*.d.ts` へ遠ざける前に、実装 module 側へ寄せられないか検討する。

## TypeScript Type Alias Readability

- 同じ事物に単なる別名を増やさない。
  `type FooController = ReturnType<typeof createFooController>` のような alias は、
  その module 内で独立した役割名として読む価値がある場合に限る。
- composition root や bootstrap では、別 module の factory 戻り値を表すだけの型 alias より、
  `ReturnType<typeof createFooController>` のように参照元がその場で読める表記を優先する。
- 一方で、`FooCallbacksInput` のように、その module 内 helper の入力形状や役割を表す型名は許容する。
- 複数 module で共有する安定した概念になった型だけ、所有 module から `export type` する。
  記述量を減らす目的だけで `export type` や local alias を増やさない。
- 型名で詳細を隠すより、依存元・由来・役割がファイル内で追えることを優先する。

## TypeScript Sources And Tests

- `app/**/*.mts` は TypeScript source として扱い、Node scriptsは `npm run build:ts` が `_build/app/**/*.mjs` に生成した module を読む。
  曲JSONの生成・検証スクリプトでは `#app/*` を使い、package.json の imports で型チェック時は app/*.mts、実行時は _build/app/*.mjs へ解決する。
  scripts本体は scripts/**/*.mts とし、Node 24.22.1の標準の型除去機能で直接実行する。scripts用のemitやtsxは追加しない。
  scripts/tsconfig.json の noEmit・strict・erasableSyntaxOnly・verbatimModuleSyntax で検査し、エディターも同じ設定を使う。生成型宣言は追加しない。
- Node単体テストの `tests/**/*.mts` は `tsx` 経由で `app/**/*.mts` を直接 import する。
  Node scriptsのテストはscripts経由で生成moduleも読むため、`npm run test:unit` は事前に `build:ts` を実行する。
  `npm run typecheck` と各領域の型検査、`npm run lint` は事前 build なしで実行し、生成物を更新しない。
  アプリも strict で型検査し、lintは app/scripts/tests の .mts source を直接対象とする。_build の生成物はlint対象外とする。
  Node scriptsは .mts source を直接参照し、scriptsと単体テストの型設定は allowJs: false とする。
  テスト用の型宣言は生成せず、tests/tsconfig.json で source を型チェックする。
- E2EのTSテストとhelperは `tests/e2e/tsconfig.json` で型チェックする。テスト専用のWindow拡張はE2E内に置く。
  曲fixture生成helperはアプリのTSソースを直接読み、ブラウザは `_site` の配布成果物を検証する。
  ブラウザ用YouTubeモックのTSソースはesbuildでJavaScriptへ変換し、APIの応答として配信する。
- `app` 配下は source tree とし、`app/**/*.mjs` を残さない。手編集は `.mts` 側へ行い、必要な `.mjs` は `npm run build:ts` で `_build/app` に作り直す。
- `.mts` source では TS の `type` / `interface` / `import type` を主に使い、同じ構造を JSDoc `@typedef` と二重管理しない。
  生成 `.mjs` 側で JSDoc 型を残す必要がある場合だけ、その理由を近接コメントで明示する。
- 生成 `.mjs` の先頭には `npm run build:ts` が手編集禁止ヘッダーを付ける。
  ヘッダー付き `.mjs` をレビューするときは、実装意図の確認元を対応する `app/**/*.mts` に置く。
- `.mts` や TypeScript emit 経路を変更したときは、`npm run check:ts-emit` で `_build/app` の生成 `.mjs` が存在し、
  `app` source tree に `.mjs` が残っていないことを確認する。
- `tsconfig.build.json` は `app/**/*.mts` だけを emit 対象にし、`allowJs: false` のまま保つ。
  既存 `.mjs` を TypeScript emit 対象へ巻き込むと、入力ファイル上書き防止で失敗しやすい。
- `npm run build` は `public/` の静的 asset と TypeScript 生成 module を `_build` へ作り、`.ts` / `.mts` source を含めない。
- ブラウザ用URLはbuild時にesbuildの内容ハッシュとCSSのcache busterで決定する。
- Pages artifact は `_build` の静的asset・browser bundle・曲JSONを `_site` へコピーする。
  `_build/app` はNode tests・scripts用に保ち、配布やURL書き換えの対象にしない。

## Naming

- boolean は true の意味がそのまま読める肯定形で命名し、否定形フラグによる二重否定を避ける。
- boolean state は、片方が常にもう片方の反転で導出できる場合は二重に保持せず、現在の UI/ドメイン上の肯定形だけを source of truth とする。

## Verification

- 初回または `node_modules` がない環境では、docs/DEVELOPMENT.md の環境準備に従い
  `npm install` を実行してから検証する。
- JavaScript や型定義を変更したときは、静的解析として `npm run typecheck` と
  `npm run lint` を基本の確認手順として実行する。
- `.mts` や TypeScript emit 経路を変更したときは、`npm run check:ts-emit` も実行する。
- TypeScript build や Pages artifact の入力経路に関わる変更では、`npm run build` も実行する。
- `tests/` 配下に Node のテストがあるため、JavaScript を変更したときは
  `npm run test:unit` も基本の確認手順として実行する。
- 単体テストの件数は、実行結果の個別 `test()` の pass/fail 件数を報告する。
  ファイル単位で表示される環境では、build 後に
  `node --import tsx --test --test-isolation=process "tests/*.test.mts"` を実行して確認する。
- 曲データや生成/検証スクリプトに関わる変更では、`npm run validate:songs-json` も実行する。
- YouTube 再生やサイドバー操作などブラウザ上の回帰に関わる変更では、
  `npm run test:e2e` も実行する。
- 構文だけを素早く確認したいときは `node --check <file>` を使い、その結果だけでテスト完了とは扱わない。
- コミット前後に確認結果を共有するときは、実行コマンドと lint/test の pass/fail 件数を簡潔に残す。
- ファイル移動や import の一括更新を含む変更では、移動直後に `node --check` を対象ファイルへ段階的に実行し、
  最後に `npm run typecheck`、`npm run lint`、`npm run test:unit` を回してから完了扱いにする。

## Branch Diff Review

- `stable..branch` のようなブランチ差分調査では、単なる機能要約だけでなく、
  必要に応じて PR review 形式でリスク中心に整理する。
- その場合は findings を先に並べ、重大度順に file/line references を付ける。
- 要約は findings の後に短く添え、挙動差分・回帰リスク・未テスト箇所を優先して扱う。
- ユーザーが明示的に機能要約のみを求めた場合は、この形式を強制しない。

## Complexity Reassessment

- 実装中に pending state、timeout、cancel、stale event guard などが増え始めたら、
  保守性コストが高い兆候として扱い、一度方針比較に戻る。
- 既存の仕組みを温存するための補正が複雑になる場合は、
  再生成・再初期化・破棄作り直しなど、構造的に単純な案も再評価する。
- iframe や外部 API の状態イベントに依存する実装では、
  表示制御で整合性を取る案が状態機械化しやすい。
  手動操作、自動処理、同一対象、別対象への切替を含めて、
  事前に分岐数とテスト量を見積もる。

## Refactor Safety

- ディレクトリ再編や import パス変更のような広範囲リファクタリングでは、
  「ファイル移動」と「参照更新」を別ステップで進め、各段階で確認する。
- PowerShell の広域な文字列置換や正規表現置換で `.js` `.mjs` `.html` を一括変更しない。
  記号や識別子が壊れることがあるため、必要ならファイル単位で小さく適用する。
- 大規模変更時は `git diff` や `rg` で import / `src=` / `href=` の残存参照を確認し、
  切り替え漏れを残さない。

## Persisted State Migration

- localStorage / IndexedDB などに保存する状態の schema や default の意味を変える場合は、
  既存 payload を暗黙の定数名だけで判定せず、必要に応じて明示的な version を持たせる。
- migration 条件は、意図した旧 version に限定する。
  将来の version まで巻き込む理由がない場合は `< CURRENT_VERSION` のような広い条件にしない。
- 旧 version 専用の helper を残す場合は、JSDoc やコメントで migration 用であることと、
  互換を打ち切るタイミングで削除可能であることを明記する。
- 「旧 default の全選択」と「新 schema でユーザーが明示的に選択した状態」は区別し、
  migration では保存済みユーザー意図を壊さない。

## Encoding And Line Endings

- 2026-04-25 時点で確認した `.js` `.mjs` `.html` `.css` `.md` は、すべて `UTF-8 BOMなし` かつ `LF`。
- 2026-04-29 時点で確認した `.github/workflows/*.yml` は、`UTF-8 BOMなし` かつ `LF`。
- リポジトリ直下に `.gitattributes` と `.editorconfig` は現状存在しない。

| Path | Encoding | Line Ending |
| --- | --- | --- |
| `AGENTS.md` | UTF-8 BOMなし | LF |
| `docs/DESIGN.md` | UTF-8 BOMなし | LF |
| `docs/DEVELOPMENT.md` | UTF-8 BOMなし | LF |
| `README.md` | UTF-8 BOMなし | LF |
| `docs/WORKFLOW.md` | UTF-8 BOMなし | LF |
| `public/index.html` | UTF-8 BOMなし | LF |
| `public/styles.css` | UTF-8 BOMなし | LF |
| `app/**/*.mts` / 生成 `_build/app/**/*.mjs` | UTF-8 BOMなし | LF |
| `scripts/**/*.mts` | UTF-8 BOMなし | LF |
| `tests/**/*.mts` / `tests/**/*.d.ts` | UTF-8 BOMなし | LF |
| `.github/workflows/*.yml` | UTF-8 BOMなし | LF |
| `playwright.config.mjs` | UTF-8 BOMなし | LF |
