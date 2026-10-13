# api/orderCsv（CSV一括注文 API 層）

- 略号: `OCA`
- 対象: `src/api/orderCsv.js`
- テスト: `src/api/orderCsv.spec.js`

繋いでいるのは 4 本。`GET /orders/csv-spec`（CSV の列の仕様）・`GET /orders/csv-template`（テンプレートDL）・
`POST /orders/validate-csv`（事前検証）・`POST /orders/bulk-create`（一括受付）。
パスとスキーマの突き合わせは `api-contract.md`（`CON`）が見るので、ここでは**この層の変換**を守る。

- 列の仕様: 列の並び（index 昇順）・例の型（string / integer / number → 文字列）・`condition` の null → 空文字・
  `required` は `true` のときだけ必須（OCA-01〜08）
- テンプレート: バイト列のまま Blob にし（BOM を落とさない）、ファイル名は Content-Disposition から取る（OCA-09〜12）
- 事前検証: multipart で `file` を送り、日本語キー 22 列の行を camelCase の注文にする。
  `valid` / 売買区分 / 件数 / 行番号の欠けや知らない値は、正常や片方の向きに倒さない（OCA-13〜17）
- 一括受付: 事前検証の注文を日本語キーに戻し、`作成者` を足して送る（OCA-18〜21）
- 強制区分（2026-10-13 の方針変更。`docs/api/requests.md` #58）: CSV の「強制区分」列は廃止され、ヘッダーにあると
  事前検証が 400。事前検証はエラー行を強制区分=1 で検証し直し、`forceable` / `errors_if_forced` / `forced_overrides` を返す。
  この層は `forceable` を **NG かつ true のときだけ** true にし、`order.forced` は常に false で作る（CSV から読まない）。
  強制は画面で行ごとに決め、一括受付で `forced` の行だけ `強制区分` を 1 で送る。
  一括受付の `warnings`（「N行目: …」。N は送った orders の 1 始まりの位置）は `{ index, message }` に分ける（OCA-22〜31）
- MSW の仮規則（買い・数量 >= `ORDER_CSV_CASH_SHORT_QUANTITY` で買付余力不足。強制で救える）に当てて、
  事前検証の forceable の付与と、一括受付の 400 / warnings も押さえる（OCA-27〜30）

multipart は jsdom の FormData が MSW(node) を通らないので、テストの間だけ Node の FormData と File に差し替える
（`src/api/stalledOrders.spec.js` と同じ）。期待値は `src/mocks/fixtures/orderCsv.js` から導く。

テンプレートは `responseType: 'arraybuffer'` で受けて Blob にする（`src/api/fileDownload.js` の `toFileDownload`）。
MSW の XHR インターセプタは `blob` の本文を一度テキストに復号して BOM を落とすが、`arraybuffer` はバイト列のまま渡すので、
OCA-09 は単体テストで BOM まで確かめられる。失敗時の本文もバイト列で届き、`client.js` が JSON に戻すので detail が読める（OCA-12）。

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
| OCA-09 | 既定モック | `fetchOrderCsvTemplate()` を呼ぶ | `filename` が `ORDER_CSV_TEMPLATE_FILENAME`、`blob` の中身がテンプレート本文とバイト単位で同じ（先頭 3 バイトは BOM の EF BB BF） | 実装済 |
| OCA-10 | Content-Disposition が無い応答 | `fetchOrderCsvTemplate()` を呼ぶ | `filename` が `bulk_orders_template.csv` になる | 実装済 |
| OCA-11 | Content-Disposition が `filename=orders.csv`（引用符なし） | `fetchOrderCsvTemplate()` を呼ぶ | `filename` が `orders.csv` になる | 実装済 |
| OCA-12 | テンプレートが 500（`detail` 付き） | `fetchOrderCsvTemplate()` を呼ぶ | status 500 で、その `detail` を message に持つ `ApiError` が投げられる | 実装済 |
| OCA-13 | 既定モック・テンプレート本文の CSV | `validateOrderCsv(file)` を呼ぶ | multipart でファイル名付きの `file` が届く。件数・`allValid` がフィクスチャどおりで、`rowNumber` は 2 から。各行の `order` は元の日本語キーを camelCase にしたもの（`side` は `buy` / `sell`、`vwap` は真偽値、成行の `limitPrice` は null、`forced` は false）。`customerName` / `stockName` はフィクスチャのヘルパが返す値 | 実装済 |
| OCA-14 | NG と警告が混ざる応答（`orderCsvValidateWithErrorsResponse`） | `validateOrderCsv(file)` を呼ぶ | `errors` / `warnings` はそのまま返る。`details` が null の行は `stockName`、`customer_name` が null の行は `customerName` が空文字 | 実装済 |
| OCA-15 | `valid` が無い行・`売買区分` が知らないコードの行・件数が整数でない・`row_number` が無い行 | `validateOrderCsv(file)` を呼ぶ | それぞれ `valid` が false、`side` が空文字、件数が 0、`rowNumber` が null（正常や片方の向きに倒さない） | 実装済 |
| OCA-16 | ヘッダーの列が足りない CSV | `validateOrderCsv(file)` を呼ぶ | handler の detail（不足項目の一覧）を message に持つ status 400 の `ApiError` が投げられる | 実装済 |
| OCA-17 | file が無い | `validateOrderCsv(undefined)` を呼ぶ | status 422 の `ApiError` が投げられる | 実装済 |
| OCA-18 | 既定モック | 事前検証の `order` を `bulkCreateOrders(orders, { createdBy })` で送る | 届いた `orders[i]` が事前検証の `data` に `強制区分: 0` と `作成者` を足したものと一致する（往復で値が崩れない）。戻り値の `orderIds` は文字列で、`totalOrders` / `message` は応答のまま、`warnings` は空配列 | 実装済 |
| OCA-19 | 既定モック | `createdBy` を渡さずに `bulkCreateOrders(orders)` を呼ぶ | `作成者` が空文字で届き、422 にならない | 実装済 |
| OCA-20 | 既定モック | `bulkCreateOrders([])` を呼ぶ | handler の detail を message に持つ status 400 の `ApiError` が投げられる | 実装済 |
| OCA-21 | 一括受付が 422 | `bulkCreateOrders(orders)` を呼ぶ | status 422 の `ApiError` が投げられる | 実装済 |
| OCA-22 | NG の行の `forceable` が `true` / `false` / `null` / 欠落 / `'true'`（文字列）、正常の行の `forceable` が `true` の応答 | `validateOrderCsv(file)` を呼ぶ | `forceable` は NG で `true` の行だけ true、ほかは false（null・欠落・知らない値や正常の行を救えると読まない） | 実装済 |
| OCA-23 | 既定モック・テンプレートの CSV を事前検証した注文 | 2 行目の `order.forced` だけ true にして `bulkCreateOrders(orders)` で送る | 2 行目の `強制区分` が 1、ほかの行が 0 で届く | 実装済 |
| OCA-24 | 既定モック・22 列のあとに `強制区分` の列を足した CSV（廃止列。`ORDER_CSV_REMOVED_COLUMN_NAMES`） | `validateOrderCsv(file)` を呼ぶ | status 400 の `ApiError` で、message が「CSVに廃止された列が含まれています: ['強制区分']」で始まり「強制区分は CSV では指定できません」を含む | 実装済 |
| OCA-25 | 強制で救える行が混ざる応答（`orderCsvValidateForceableResponse`） | `validateOrderCsv(file)` を呼ぶ | 各行の `errorsIfForced` は `errors_if_forced` のまま、`forcedOverrides` は `{ チェック, 内容 }` を `{ check, content }` にしたもの。`forceable` は 3 行目だけ true | 実装済 |
| OCA-26 | `errors_if_forced` / `forced_overrides` が無い行、`data` に `強制区分: 1` が入った行（旧仕様の応答） | `validateOrderCsv(file)` を呼ぶ | `errorsIfForced` / `forcedOverrides` は空配列。`order.forced` は false（CSV の強制区分を読まない） | 実装済 |
| OCA-27 | 既定モック・`orderCsvValidateForceableResponse` の各行の `data` を並べた CSV（正常 / 買付余力不足 / 買付余力不足＋指値単価なし） | `validateOrderCsv(file)` を呼ぶ | MSW が返す各行の `valid` / `errors` / `forceable` / `errorsIfForced` / `forcedOverrides` が見本の行と一致する（買付余力不足だけの行は救え、指値単価の欠落が残る行は救えない） | 実装済 |
| OCA-28 | 既定モック・口座番号が数値にならない行の CSV | `validateOrderCsv(file)` を呼ぶ | その行は NG で、`forceable` が false、`errorsIfForced` / `forcedOverrides` が空（検証まで進まない行は救えない） | 実装済 |
| OCA-29 | 既定モック・買付余力不足の注文（`forced` が false）を 2 件目に含む注文 | `bulkCreateOrders(orders)` を呼ぶ | status 400 の `ApiError` で、message が「注文検証エラーが存在するため一括登録を中止しました: 2行目: 」＋ `orderCsvCashShortMessage` | 実装済 |
| OCA-30 | 既定モック・買付余力不足の注文を 2 件目に含み、その `forced` を true にした注文 | `bulkCreateOrders(orders)` を呼ぶ | 受け付けられ、`warnings` が `[{ index: 1, message: orderCsvCashShortForcedWarning(数量) }]` になる | 実装済 |
| OCA-31 | 一括受付の `warnings` が「3行目: …」・行番号の無い文言・「行目」の後に空白が無い文言の応答 / `warnings` が無い応答 | `bulkCreateOrders(orders)` を呼ぶ | 「3行目: X」は `{ index: 2, message: 'X' }`、形が違う文言は `{ index: null, message: 元の文言 }`。`warnings` が無ければ空配列 | 実装済 |
