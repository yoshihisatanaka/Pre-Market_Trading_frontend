# api/dreamStatus（Dream登録状況 API 層）

- 略号: `DSA`
- 対象: `src/api/dreamStatus.js`
- テスト: `src/api/dreamStatus.spec.js`

ここだけが**バックエンドの形**（日本語のレスポンスキー・英語のクエリ名・integer の ID / 口座番号・
売買区分のコード・STS変更の日本語の本文）を知ってよい層なので、「実際に送り出すリクエストの形」と
「受け取った生データの変換」を守る。対象は一覧・状況コード一覧・STS変更（`PUT /orders/dream-status/{order_id}`）の 3 本。
パスとクエリ名が仕様に在るかは `api-contract.md`（`CON`）が見る。

取り違えやすい点は 4 つ。

- **クエリ名は英語、レスポンスのキーは日本語。** 部店は `branch_code` で送り `部店` で受ける
- **STS変更可は `true` のときだけ立てる。** 0/1 や文字列を真とみなさない（変更できない行にプルダウンが出る）
- **口座番号は数字だけのときに integer で送る。** 文字列のまま送ると 422 になる
- **STS変更の本文は日本語キー。** 受注番号・理由は前後の空白を落とし、空なら null で送る。
  更新日時は一覧取得時の値をそのまま送り返す楽観的ロックの合札（違えば 409）

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
| DSA-18 | PUT を記録する | 登録失敗の行の ID・遷移先・前後に空白のある受注番号と理由・更新日時で `changeDreamStatus()` | PUT `/api/orders/dream-status/<注文ID>`（数字だけのパス）に、本文が日本語キーの `{ 変更後状況, 受注番号, 理由, 更新日時 }` で届く。受注番号・理由は前後の空白が落ち、更新日時は渡した値のまま | 実装済 |
| DSA-19 | PUT を記録する | 受注番号・理由を空文字 / 空白だけ / 省略して `changeDreamStatus()` | 本文の `受注番号` / `理由` がどれも null（キー自体は載る） | 実装済 |
| DSA-20 | 既定モック。登録失敗の行を `'0'` へ | 行の更新日時を付けて `changeDreamStatus()` | `order` が camelCase のアプリ内モデル（`status` が `'0'`・`statusName` が「未登録」・`canChangeStatus` が false・`updatedAt` が送った値と違う）で、`message` がサーバの処理結果 | 実装済 |
| DSA-21 | 既定モック。取得時と違う更新日時 | `changeDreamStatus()` | status 409 の例外になり、detail が message に入る | 実装済 |
| DSA-22 | 一覧が `total` 付きの応答を返す（記録する） | `fetchDreamErrorCount()` | `GET /orders/dream-status` に `limit=1` / `offset=0` / `dream_status=ERROR`（画面を Dream登録状況「エラー」で絞ったときと同じ擬似コード）だけが載り、応答の `total` を数値で返す | 実装済 |
| DSA-23 | 一覧の応答に `total` が無い | `fetchDreamErrorCount()` | 0 を返す（例外にならない） | 実装済 |
