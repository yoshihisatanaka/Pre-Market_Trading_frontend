# api/dreamStatus（Dream登録状況 API 層）

- 略号: `DSA`
- 対象: `src/api/dreamStatus.js`
- テスト: `src/api/dreamStatus.spec.js`

ここだけが**バックエンドの形**（日本語のレスポンスキー・英語のクエリ名・integer の ID / 口座番号・
売買区分のコード）を知ってよい層なので、「実際に送り出すリクエストの形」と「受け取った生データの変換」を守る。
パスとクエリ名が仕様に在るかは `api-contract.md`（`CON`）が見る。

取り違えやすい点は 3 つ。

- **クエリ名は英語、レスポンスのキーは日本語。** 部店は `branch_code` で送り `部店` で受ける
- **STS変更可は `true` のときだけ立てる。** 0/1 や文字列を真とみなさない（変更できない行にプルダウンが出る）
- **口座番号は数字だけのときに integer で送る。** 文字列のまま送ると 422 になる

期待値はフィクスチャ（`src/mocks/fixtures/dreamStatus.js`）から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| DSA-01 | 既定モック | `fetchDreamOrders()` | `{ items, total }` を返し、`total` がフィクスチャの全件数、`items` が 1 ページ（既定の limit）ぶん | 実装済 |
| DSA-02 | 既定モック | `fetchDreamOrders()`（引数なし） | パスが `/api/orders/dream-status` で、クエリは `limit=50` / `offset=0` だけ | 実装済 |
| DSA-03 | 既定モック | 全条件を渡して `fetchDreamOrders()` | `branch_code` / `account_no` / `symbol` / `dream_status` / `start_date` / `end_date` / `receipt_number` の英語名で送る | 実装済 |
| DSA-04 | 既定モック | 全条件を空文字で `fetchDreamOrders()` | 空の条件はクエリに載らず、`limit` / `offset` だけになる | 実装済 |
| DSA-05 | 既定モック | 数字だけの口座番号（前後に空白あり）を渡す | `account_no` に数字だけが載る | 実装済 |
| DSA-06 | 既定モック | 数字以外を含む口座番号（`123-456` / `abc` / 空白だけ）を渡す | `account_no` は送られない | 実装済 |
| DSA-07 | 既定モック | `limit` / `offset` を渡す | その値がそのまま送られる | 実装済 |
| DSA-08 | 応答が DreamOrderItem 1 件 | `fetchDreamOrders()` | 日本語キーが camelCase のアプリ内モデルになる（`ID` → 文字列の `id`、`Dream状況` → `status`、`受注番号` → `receiptNumber`、`Dream完了日時` → `completedAt`、`口座番号` → 文字列の `accountNumber`、`更新日時` → `updatedAt` など） | 実装済 |
| DSA-09 | `STS変更可` が true の行と false の行 | `fetchDreamOrders()` | true の行は `canChangeStatus` が true で `statusTransitions` が `{ code, name }` の配列、false の行は false と空配列 | 実装済 |
| DSA-10 | `STS変更可` が `1` / `'true'` / 欠落の行 | `fetchDreamOrders()` | いずれも `canChangeStatus` が false（true 以外を真とみなさない） | 実装済 |
| DSA-11 | 売買区分が `'1'` / `'3'` / 未知のコードの行 | `fetchDreamOrders()` | `side` が `'sell'` / `'buy'` / `''`（どちらかに丸めない） | 実装済 |
| DSA-12 | nullable な項目がすべて `null` の行 | `fetchDreamOrders()` | 文字列項目は `''`、口座番号は `''`、数量は `null` のまま（数量 0 は 0 のまま） | 実装済 |
| DSA-13 | 応答に `orders` / `total` が無い | `fetchDreamOrders()` | `items` が空配列、`total` が 0 で返り、例外にならない | 実装済 |
| DSA-14 | 一覧 API が 500 | `fetchDreamOrders()` | 例外になる（detail が message に入る） | 実装済 |
| DSA-15 | 既定モック | `fetchDreamStatusCodes()` | `{ code, name, group }` の配列がサーバの並びのまま返る（末尾は擬似コード `ERROR` で group が `絞込`） | 実装済 |
| DSA-16 | 応答に `statuses` が無い | `fetchDreamStatusCodes()` | 空配列を返す | 実装済 |
| DSA-17 | コード一覧 API が 500 | `fetchDreamStatusCodes()` | 例外になる | 実装済 |
