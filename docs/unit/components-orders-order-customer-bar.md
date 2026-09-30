# components/orders/OrderCustomerBar（新規注文の顧客バー）

- 略号: `NCB`
- 対象: `src/components/orders/OrderCustomerBar.vue`
- テスト: `src/components/orders/OrderCustomerBar.spec.js`

口座番号の照会で見つかった顧客（`src/api/customers.js` の Customer）を 1 段で見せる部品。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| NCB-01 | 顧客 1 件 | マウントする | 顧客名と顧客名カナが出る | 実装済 |
| NCB-02 | コンプラランク A / B / Y / Z と C | マウントする | A・B・Y・Z だけ「コンプラ X 要注意」が出る | 実装済 |
| NCB-03 | 年齢 85 と 84、空（法人） | マウントする | 85 だけ「85歳 高齢者」が出る | 実装済 |
| NCB-04 | 全取引停止 | マウントする | 「全取引停止」が出る | 実装済 |
| NCB-05 | 金額に null と 0 | マウントする | 円貨・外貨・成長投資枠が単位付きで出て、null は「—」、0 は「0 円」 | 実装済 |
