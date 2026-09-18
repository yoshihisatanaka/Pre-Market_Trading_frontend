---
name: new-screen
description: 型に乗る画面（検索一覧 / CRUD マスタ）の雛形を一括生成する。openapi.json から一覧レスポンスとクエリ・パスキーを引き、src/api・stores・views・mocks（fixtures / handlers）・docs/e2e・docs/unit・router・navigation を既存の型（useListQuery / useCrudList / src/components/masters）に乗せて 1 回で出す。「〈画面名〉の画面を作って」「〈マスタ〉の雛形を出して」「/new-screen」で使う。画面固有の列・入力欄・文言はここでは決めない（生成後に別途書く）。コミットはしない。
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(docker compose run --rm frontend npm run *), Bash(docker compose run --rm frontend npx prettier *), Bash(git status *), Bash(git diff *)
---

# 画面の雛形を出す

引数: `<type> <kebab-name> <画面名> [openapi のパス]`

| 引数 | 例 | 意味 |
|---|---|---|
| `type` | `crud-master` / `search-list` | CRUD マスタ（検索 → 一覧 → 追加 / 編集 / 削除）か、読むだけの検索一覧か |
| `kebab-name` | `fx-rates` | ファイル名・ルートの末尾・`data-testid` の接頭辞になる |
| `画面名` | `為替マスタ` | `router` の `meta.title` と `navigation.js` の表示名 |
| パス（任意） | `/masters/fx` | 省略時は `docs/api/openapi.json` の `paths` から `kebab-name` に最も近いものを探す |

**目的は「参照実装を毎回読み直して骨格を書き起こす時間」を消すこと。** ここで決まるのは骨格だけで、
列・入力欄・文言・画面固有の分岐は生成後に手で書く（そこは画面ごとに違い、推測しない）。

## 0. 入力を確定する（openapi.json だけを読む）

`docs/api/openapi.json` から次を控える。**参照実装（symbols / customers）は 1 節の表に書いた 1 本ずつだけ読む。**

1. **一覧の GET**: パス、`parameters`（`in: query` の名前と型）、`200` の `$ref`（`*ListResponse`）→ その配列名と要素の `*Item`
2. **`*Item` の properties**: レスポンスキー（日本語のことが多い）と型。fixture はこの形で書く
3. **書き込み系**（`crud-master` のとき）: `POST`（`*Request`）/ `validate`（`is_update` と対象を渡すクエリの有無）/
   `PUT` `DELETE` の**パスパラメータ名と型**
   - パスキーが `{xxx_id}`（integer）なら **ID 対応済み**（CA / 残高調整 / 手数料パターン / 手数料優遇）。api 層は `id` をパスに載せる
   - それ以外（`{symbol}` / `{account_no}` / `{blackout_date}` など）は**業務キー**。api 層は `id` ではなく業務キーをパスに載せ、
     `*UpdateRequest` にその項目が無ければ**編集フォームで読み取り専用**にする（`CLAUDE.md`「リリースまでの進め方」）
4. **成熟度**: パスが無い（D）か、`200` のスキーマが無い（C）なら **fixture 契約提案モード**。
   ハンドラとフィクスチャの冒頭コメントに「実 API に無い。`docs/api/requests.md` #n の提案」と書き、
   `src/api/contract.spec.js` の `KNOWN_GAPS` に `path` の行を足す（依頼番号も付ける）
5. **略号**: E2E は 2〜4 文字・単体は 3 文字。`docs/e2e` と `docs/unit` を `略号:` で grep して**衝突が無いこと**を確かめる

## 1. 生成するファイル

`<Name>` は `kebab-name` のパスカルケース（`fx-rates` → `FxRate`）。`<name>` はキャメルケース（`fxRates`）。

| ファイル | 型（この 1 本だけ読む） | 中身 |
|---|---|---|
| `src/api/<name>.js` | `src/api/symbols.js` | 1 エンドポイント = 1 関数。`fetch<Name>s({ limit, offset, ...filters })` は `{ items, total }` を返す。`to<Name>()` で生の形 → camelCase。`crud-master` は `validate` / `create` / `update` / `delete` も。冒頭 JSDoc に「吸収している差」を列挙 |
| `src/stores/<name>.js` | `src/stores/symbols.js` | setup ストア。`useCrudList`（`crud-master`）または一覧取得だけ（`search-list`）。`PAGE_SIZE` を export |
| `src/views/<Name>ListView.vue` | `crud-master`: `src/views/SymbolListView.vue` / `search-list`: `src/views/CustomerListView.vue` | `MasterSearchCard` / `MasterListCard` / 4 状態 / `useListQuery`。`crud-master` は `MasterFormDialog` / `ConfirmDeleteDialog` と `<Teleport defer to="#topbar-actions">` の「新規追加」。`<h1>` は置かない |
| `src/mocks/fixtures/<name>.js` | `src/mocks/fixtures/symbols.js` | **`*Item` の生の形**（snake_case / 日本語キーのまま）。有効 56 件 + 取消済み 1 件を目安に生成で作る。`export const <name>s` / `canceled<Name>s` |
| `src/mocks/handlers/<name>.js` | `src/mocks/handlers/symbols.js` | 一覧（クエリを解釈・`include_deleted` で取消済みを外す・`total` / `limit` / `offset`）。`crud-master` は validate / POST / PUT / DELETE と `reset<Name>Rows()`。ヘルパは `./_shared` から |
| `src/mocks/handlers/index.js` | — | `import` 1 行、`handlers` の配列に `...<name>Handlers`、`resetMockState()` に `reset<Name>Rows()` を足す（`crud-master` のみ） |
| `src/router/index.js` | — | `path` / `name` / `component`（遅延 import）/ `meta.title` を 1 エントリ。`path` は `navigation.js` と一致させる |
| `src/components/layout/navigation.js` | — | 区分の中に 1 項目 |
| `docs/e2e/<kebab-name>.md` | `docs/e2e/_template-crud-master.md` または `_template-search-list.md` | 雛形をコピーし、略号・画面名・パス・件数・列名を差し替える。**全行 `未着手`** |
| `docs/unit/api-<kebab-name>.md` / `stores-<kebab-name>.md` / `views-<kebab-name>-list-view.md` | `docs/unit/_template-api.md` / `_template-store.md` / `_template-view.md` | 同上 |

`data-testid` は `<kebab-name>-` を接頭辞にし、共通部品には `testidPrefix="<kebab-name>"` を渡す。
画面が自分で描く `data-testid` はリテラルで書く（`docs/coding-standards.md` 1 節）。

## 2. 書きかたの約束（生成物に必ず入れるもの）

- api 層の冒頭 JSDoc: パス / クエリ名 / レスポンスキーの系統 / パスキーが ID か業務キーか / 成熟度（A〜D）
- store: `loading` / `error` / `isEmpty` と、古い応答を捨てる競合制御は `useCrudList` に任せる。自前で書かない
- view: **ローディング / エラー / 空 / データあり の 4 状態**をテンプレートに全部置く（中身が仮でもよい）
- fixture: 型は `*Item` の宣言どおり（integer は数値、nullable は `null`。空文字で埋めない）
- handlers: クエリ名は仕様の綴りをそのまま使う（api 層と同じ名前を **2 か所に**書く。契約テストが仕様と突き合わせる）
- docs: 雛形の `XX` / `〈画面名〉` / `/xxx` を**残さない**（grep して 0 件にする）

## 3. 生成後にやること・報告

1. `docker compose run --rm frontend npx prettier --write <生成したファイル>`
2. `docker compose run --rm frontend npm run verify` を **1 回**（未着手のシナリオは warning で通る）
3. 報告は次の表 1 つ。**次に手で書く固有部分**を列挙する（列・入力欄・文言・画面固有の分岐・fixture の値の意味）

| 項目 | 値 |
|---|---|
| 生成したファイル | 一覧 |
| 略号 | E2E / 単体 3 本 |
| openapi の成熟度 | A〜D と根拠のパス |
| パスキー | ID / 業務キー（編集で読み取り専用にした項目） |
| `KNOWN_GAPS` に足した行 | あれば |
| 固有部分の TODO | 列 / 入力欄 / 文言 / 分岐 |

## やらないこと

- コミット。E2E テスト本体の実装（`e2e-test-author` に委譲）。単体テスト本体の実装（`unit-test-author` に委譲）
- 画面固有の業務ロジックの推測（列の並び・必須項目・エラー文言は画面モック `docs/mock/` と要件で決める）
- `openapi.json` の編集。`src/components/ui/` や `src/composables/` の変更（型を変える回は別作業・`xhigh`）
