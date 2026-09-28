# components/operations/StalledOrderTable（滞留注文の表）

- 略号: `SOT`
- 対象: `src/components/operations/StalledOrderTable.vue`
- テスト: `src/components/operations/StalledOrderTable.spec.js`

「注文エラー」と「注文中」の 2 本は 1 列だけが違う同じ表なので、列定義とセルの整形を
この部品にまとめてある。`variant` がその 1 列と出来状況の色を決める。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOT-01 | `variant` が `'errors'` | マウントする | 列見出しが 注文ID / 部店 / 口座番号 / 顧客名 / 銘柄 / 売買 / 数量 / 価格 / 市場区分 / 受注日時 / エラー理由 / 出来状況 の 12 列になる | 実装済 |
| SOT-02 | `variant` が `'working'` | マウントする | 11 列目の見出しが「確認状況」になり、そのセルに `confirmationNote` が出る | 実装済 |
| SOT-03 | 1 件の行を渡す | マウントする | 注文 ID が `#27` のように `#` を前置して出る | 実装済 |
| SOT-04 | `side` が `'buy'` / `'sell'` の行 | マウントする | 売買が「買」/「売」と出る | 実装済 |
| SOT-05 | `side` が空の行 | マウントする | 売買が「—」になる | 実装済 |
| SOT-06 | 成行（`orderType` が `'MO'`）の行 | マウントする | 価格が「成行」と出る | 実装済 |
| SOT-07 | 指値（`orderType` が `'LO'`・`limitPrice` が 228.5）の行 | マウントする | 価格が「指値 $228.50」と出る | 実装済 |
| SOT-08 | `orderedAt` が空の行 | マウントする | 受注日時が「—」になる | 実装済 |
| SOT-09 | 顧客名や市場区分が空の行 | マウントする | そのセルが「—」になる | 実装済 |
