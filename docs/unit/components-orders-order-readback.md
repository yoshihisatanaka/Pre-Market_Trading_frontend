# components/orders/OrderReadback（注文内容の読み上げ）

- 略号: `NRB`
- 対象: `src/components/orders/OrderReadback.vue`
- テスト: `src/components/orders/OrderReadback.spec.js`

props（`buildOrderReadback` / `buildEstimateReadback` の戻り値）をそのまま並べるだけの部品。
文字列の組み立ては `docs/unit/utils-order-entry-form.md` が見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| NRB-01 | 読み上げの見本 | マウントする | 顧客名・部店／口座番号・銘柄・売買・価格・数量・市場／期限・注文条件・受注情報がそれぞれの欄に出る | 実装済 |
| NRB-02 | tone が buy / sell | マウントする | ルートに `is-buy` / `is-sell` が付く | 実装済 |
| NRB-03 | 銘柄名が空 | マウントする | 銘柄欄はティッカーだけで、銘柄名の小見出しは出ない | 実装済 |
| NRB-04 | 概算の見本 | マウントする | 外貨・円貨の概算と注記、「手数料・税金等を含みません。」が出る | 実装済 |
