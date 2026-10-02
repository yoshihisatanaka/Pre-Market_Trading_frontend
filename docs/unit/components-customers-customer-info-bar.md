# components/customers/CustomerInfoBar（顧客詳細の顧客カード）

- 略号: `CIB`
- 対象: `src/components/customers/CustomerInfoBar.vue`
- テスト: `src/components/customers/CustomerInfoBar.spec.js`

顧客詳細の各タブの上に出す顧客カード。props は `customer`（`src/api/customers.js` の Customer）と
`valuation`（`stores/customerDetail.js` の預りの合計 `{ valueJpy, profitLossJpy }`。読めていないあいだは `null`）。
注意表示の判定規則（85 歳以上・コンプラランク A・B・Y・Z）は `src/utils/customerCautions.js` の公開定数
（`ELDERLY_AGE` / `CAUTION_RANKS`）から期待値を導く。props の入出力だけを見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CIB-01 | 顧客 1 件（部店・口座番号・顧客名・カナ・投資方針名あり） | マウントする | 部店・口座番号・顧客名・カナ・投資方針がそのまま出る | 実装済 |
| CIB-02 | 部店・口座番号・顧客名・投資方針名が空、カナが空 | マウントする | 空の項目は「—」で、カナは要素ごと出ない | 実装済 |
| CIB-03 | 年齢 `ELDERLY_AGE` と `ELDERLY_AGE - 1` | マウントする | 年齢が「85歳」の形で出て、`ELDERLY_AGE` の方だけ「高齢者」と `is-elderly` が付く | 実装済 |
| CIB-04 | 年齢が空（法人） | マウントする | 年齢が「—」で、「高齢者」は出ない | 実装済 |
| CIB-05 | 全取引停止 / 停止なし | マウントする | 取引規制が「全取引停止」（`is-caution`）/「制限なし」（色なし）になる | 実装済 |
| CIB-06 | コンプラランク A・B・Y・Z と C、空 | マウントする | A・B・Y・Z だけ「要注意」と `is-caution` が付く。C は付かず、空は「—」 | 実装済 |
| CIB-07 | 円貨・外貨・成長投資枠に値 / null / 0 | マウントする | `3,500,000 円` / `50,000.00 ドル` の形で出て、null は「—」、0 は「0 円」 | 実装済 |
| CIB-08 | `valuation` が null（既定） | マウントする | 米国株評価額と評価損益が「—」で、評価損益に色クラスが付かない | 実装済 |
| CIB-09 | `valuation` の評価損益が正 / 負 / 0 | マウントする | 正は「+407,400 円」で `is-profit`、負は「−151,500 円」（U+2212）で `is-loss`、0 は「0 円」で色クラスなし。米国株評価額は単位付きで出る | 実装済 |
