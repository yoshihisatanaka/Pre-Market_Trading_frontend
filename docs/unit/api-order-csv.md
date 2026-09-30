# api/orderCsv（CSV一括注文 API 層）

- 略号: `OCA`
- 対象: `src/api/orderCsv.js`
- テスト: `src/api/orderCsv.spec.js`

繋いでいるのは 4 本。`GET /orders/csv-spec`（CSV の列の仕様）・`GET /orders/csv-template`（テンプレートDL）・
`POST /orders/validate-csv`（事前検証）・`POST /orders/bulk-create`（一括受付）。
パスとスキーマの突き合わせは `api-contract.md`（`CON`）が見るので、ここでは**この層の変換**を守る。

- 列の仕様: 列の並び（index 昇順）・例の型（string / integer / number → 文字列）・`condition` の null → 空文字・
  `required` は `true` のときだけ必須（OCA-01〜08）
- テンプレート: Blob のまま受け取り（BOM を落とさない）、ファイル名は Content-Disposition から取る（OCA-09〜12）
- 事前検証: multipart で `file` を送り、日本語キー 22 列の行を camelCase の注文にする。
  `valid` / 売買区分 / 件数 / 行番号の欠けや知らない値は、正常や片方の向きに倒さない（OCA-13〜17）
- 一括受付: 事前検証の注文を日本語キーに戻し、`作成者` を足して送る（OCA-18〜21）

multipart は jsdom の FormData が MSW(node) を通らないので、テストの間だけ Node の FormData と File に差し替える
（`src/api/stalledOrders.spec.js` と同じ）。期待値は `src/mocks/fixtures/orderCsv.js` から導く。

OCA-09 は保留。MSW(node) の XHR インターセプタは `responseType: 'blob'` の本文を一度テキストに復号してから
Blob を作り直すので、BOM が単体テストの環境で落ちる（製品コードの挙動と切り分けられない）。BOM が残ることは
E2E（実ブラウザの MSW）か実 API で確かめる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OCA-01 | 既定モック | `fetchOrderCsvSpec()` を呼ぶ | フィクスチャの全列が返り、各列のキーは `index / name / required / description / example / condition` の 6 つだけ（`type` / `allowed_values` は外に出さない） | 実装済 |
| OCA-02 | 列が index の降順で並んだ応答 | `fetchOrderCsvSpec()` を呼ぶ | index の昇順に並べ直して返る | 実装済 |
| OCA-03 | 既定モック（例が string / integer / number の列が混在） | `fetchOrderCsvSpec()` を呼ぶ | どの列の `example` も文字列で、値は元の例を文字列にしたもの（`1000113` → `'1000113'`） | 実装済 |
| OCA-04 | `example` が null の列と、`example` が無い列 | `fetchOrderCsvSpec()` を呼ぶ | どちらも `example` が空文字になる | 実装済 |
| OCA-05 | 既定モック（指値単価だけ condition あり） | `fetchOrderCsvSpec()` を呼ぶ | 指値単価の `condition` はフィクスチャの文言のまま、ほかの列の `condition` は空文字 | 実装済 |
| OCA-06 | `required` が `false` / 欠落 / `'true'`（文字列）/ `1` の列 | `fetchOrderCsvSpec()` を呼ぶ | どれも `required` が `false` になる（必須に倒さない） | 実装済 |
| OCA-07 | 応答に `columns` が無い（`{}`） | `fetchOrderCsvSpec()` を呼ぶ | 例外にならず空配列が返る | 実装済 |
| OCA-08 | API が 500（`detail` 付き）を返す | `fetchOrderCsvSpec()` を呼ぶ | その `detail` を message に持つ `ApiError` が投げられる | 実装済 |
| OCA-09 | 既定モック | `fetchOrderCsvTemplate()` を呼ぶ | `filename` が `ORDER_CSV_TEMPLATE_FILENAME`、`blob` の中身がテンプレート本文とバイト単位で同じ（先頭 3 バイトは BOM の EF BB BF） | 保留 |
| OCA-10 | Content-Disposition が無い応答 | `fetchOrderCsvTemplate()` を呼ぶ | `filename` が `bulk_orders_template.csv` になる | 実装済 |
| OCA-11 | Content-Disposition が `filename=orders.csv`（引用符なし） | `fetchOrderCsvTemplate()` を呼ぶ | `filename` が `orders.csv` になる | 実装済 |
| OCA-12 | テンプレートが 500（`detail` 付き） | `fetchOrderCsvTemplate()` を呼ぶ | status 500 の `ApiError` が投げられる。本文が Blob なので detail は読めず、message は status 既定の文言になる（今の仕様を固定する） | 実装済 |
| OCA-13 | 既定モック・テンプレート本文の CSV | `validateOrderCsv(file)` を呼ぶ | multipart でファイル名付きの `file` が届く。件数・`allValid` がフィクスチャどおりで、`rowNumber` は 2 から。各行の `order` は元の日本語キーを camelCase にしたもの（`side` は `buy` / `sell`、`vwap` は真偽値、成行の `limitPrice` は null）。`customerName` / `stockName` はフィクスチャのヘルパが返す値 | 実装済 |
| OCA-14 | NG と警告が混ざる応答（`orderCsvValidateWithErrorsResponse`） | `validateOrderCsv(file)` を呼ぶ | `errors` / `warnings` はそのまま返る。`details` が null の行は `stockName`、`customer_name` が null の行は `customerName` が空文字 | 実装済 |
| OCA-15 | `valid` が無い行・`売買区分` が知らないコードの行・件数が整数でない・`row_number` が無い行 | `validateOrderCsv(file)` を呼ぶ | それぞれ `valid` が false、`side` が空文字、件数が 0、`rowNumber` が null（正常や片方の向きに倒さない） | 実装済 |
| OCA-16 | ヘッダーの列が足りない CSV | `validateOrderCsv(file)` を呼ぶ | handler の detail（不足項目の一覧）を message に持つ status 400 の `ApiError` が投げられる | 実装済 |
| OCA-17 | file が無い | `validateOrderCsv(undefined)` を呼ぶ | status 422 の `ApiError` が投げられる | 実装済 |
| OCA-18 | 既定モック | 事前検証の `order` を `bulkCreateOrders(orders, { createdBy })` で送る | 届いた `orders[i]` が事前検証の `data` に `作成者` を足したものと一致する（往復で値が崩れない）。戻り値の `orderIds` は文字列で、`totalOrders` / `message` は応答のまま | 実装済 |
| OCA-19 | 既定モック | `createdBy` を渡さずに `bulkCreateOrders(orders)` を呼ぶ | `作成者` が空文字で届き、422 にならない | 実装済 |
| OCA-20 | 既定モック | `bulkCreateOrders([])` を呼ぶ | handler の detail を message に持つ status 400 の `ApiError` が投げられる | 実装済 |
| OCA-21 | 一括受付が 422 | `bulkCreateOrders(orders)` を呼ぶ | status 422 の `ApiError` が投げられる | 実装済 |
