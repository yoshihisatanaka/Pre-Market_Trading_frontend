# utils/orderCodeLabels（注文の区分コード → 名前）

- 略号: `OCL`
- 対象: `src/utils/orderCodeLabels.js`
- テスト: `src/utils/orderCodeLabels.spec.js`

CSV一括注文のプレビューと受付完了の表が使う、区分コード → 名前の表と整形の純関数。
名前は openapi.json に無く、`GET /orders/csv-spec` の `allowed_values` が同じものを返す。
**表はその写しなので、`src/mocks/fixtures/orderCsv.js` の `allowed_values` と過不足なく一致すること**を守る
（どちらかだけ直すとテストが落ちる）。期待値はフィクスチャの列から導き、名前を直接書かない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OCL-01 | フィクスチャの決済通貨区分の列 | `SETTLEMENT_CURRENCY_LABELS` を見る | その列の `allowed_values`（code → label）と過不足なく一致する | 実装済 |
| OCL-02 | フィクスチャの預り売買区分の列 | `DEPOSIT_CATEGORY_LABELS` を見る | その列の `allowed_values` と過不足なく一致する | 実装済 |
| OCL-03 | フィクスチャの取引の列 | `TRANSACTION_TYPE_LABELS` を見る | その列の `allowed_values` と過不足なく一致する | 実装済 |
| OCL-04 | フィクスチャの発注範囲の列 | `EXECUTION_SCOPE_LABELS` を見る | その列の `allowed_values` と過不足なく一致する（`'01'` のような 0 始まりのキーが崩れない） | 実装済 |
| OCL-05 | フィクスチャの指成区分の列 | `ORDER_TYPE_LABELS` を見る | その列の `allowed_values` と過不足なく一致する | 実装済 |
| OCL-06 | フィクスチャの売買区分の列 | `SIDE_LABELS` を見る | 買・売の名前が、売買区分の `allowed_values` の `3` / `1` の名前と一致する | 実装済 |
| OCL-07 | 表にあるコード | `codeLabel(表, コード)` を呼ぶ | 名前が返る | 実装済 |
| OCL-08 | 表に無いコード | `codeLabel(表, コード)` を呼ぶ | コードがそのまま返る（CSV に書かれた値を隠さない） | 実装済 |
| OCL-09 | 空文字・null・undefined | `codeLabel(表, 値)` を呼ぶ | いずれも `'—'` | 実装済 |
| OCL-10 | `toString` のような継承したキー | `codeLabel(表, 'toString')` を呼ぶ | 名前にならず、そのまま `'toString'` が返る | 実装済 |
| OCL-11 | 成行（指値単価あり・なし） | `orderPriceLabel(order)` を呼ぶ | 「成行」だけが返る（指値単価があっても出さない） | 実装済 |
| OCL-12 | 指値・指値単価あり | `orderPriceLabel(order)` を呼ぶ | 「指値 」の後に `formatUsdUnit(指値単価)` が続く | 実装済 |
| OCL-13 | 指値・指値単価が null | `orderPriceLabel(order)` を呼ぶ | 「指値 —」になる（今の実装の挙動を固定する） | 実装済 |
| OCL-14 | 知らない指成区分・空の指成区分 | `orderPriceLabel(order)` を呼ぶ | `'—'` になる | 実装済 |
