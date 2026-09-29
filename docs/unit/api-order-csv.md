# api/orderCsv（CSV一括注文 API 層）

- 略号: `OCA`
- 対象: `src/api/orderCsv.js`
- テスト: `src/api/orderCsv.spec.js`

いま繋いでいるのは `GET /orders/csv-spec`（CSV の列の仕様）だけ。パスとスキーマの突き合わせは
`api-contract.md`（`CON`）が見るので、ここでは**この層の変換**を守る。吸収している差は
列の並び（index 昇順）・例の型（string / integer / number → 文字列）・`condition` の null → 空文字・
`required` は `true` のときだけ必須、の 4 つ。

テンプレートDL・事前検証・一括受付（`csv-template` / `validate-csv` / `bulk-create`）は処理が未実装なので、
関数を足すときに行を足す。

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
