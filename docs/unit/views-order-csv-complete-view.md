# views/OrderCsvCompleteView（CSV一括注文 受付完了画面）

- 略号: `OCC`
- 対象: `src/views/OrderCsvCompleteView.vue`
- テスト: `src/views/OrderCsvCompleteView.spec.js`

実際の Pinia ストア + vue-router（`createMemoryHistory`）+ MSW(node) を通して、一括受付の結果（ストアの `completion`）の
表示と、取込み・Dream登録状況への導線を守る。
画面は `<Teleport>` を使っていないが、他画面と揃えて `global: { stubs: { teleport: true } }` を付ける。

この画面は読み込みを持たない（受付はプレビューで済んでいる）。4 状態のうち、ローディングとエラーはプレビュー画面が受け持ち、
ここで出すのは空（結果が無い）とデータありの 2 つ。

前提はストアの事前検証 → 一括受付を通して作る（テンプレート本文の CSV を Node の File で `validateFile` し、`submitOrders`）。
期待値は `src/mocks/fixtures/orderCsv.js`（`orderCsvSampleOrders` / `BULK_ORDER_FIRST_ID`）から導く。

受付時の警告（`completion.warnings`。2026-10-13 に一括受付の応答へ `warnings` が増えた）は OCC-09〜11。
強制で受け付ける前提は MSW の仮規則（買い・数量 >= `ORDER_CSV_CASH_SHORT_QUANTITY` で買付余力不足）に当てた CSV で作り、
ストアの `setForced` で強制を指定してから `submitOrders` する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OCC-01 | `completion` が無い | マウントする | 空状態（`order-csv-complete-empty`）だけが出て、表は出ない | 実装済 |
| OCC-02 | `completion` が無い | 空状態の「CSV取込みへ」を押す | `order-csv-upload` へ移る | 実装済 |
| OCC-03 | テンプレートの全行を受け付けた | マウントする | 受付件数と Dream登録待ちの件数が `totalOrders`。完了の文言が出て、表の行数は受け付けた件数 | 実装済 |
| OCC-04 | テンプレートの全行を受け付けた | マウントする | 注文ID は `#` の後に採番（`BULK_ORDER_FIRST_ID` からの連番）が続く | 実装済 |
| OCC-05 | 採番が行数より少ない応答で受け付けた | マウントする | 採番が返らなかった行は注文ID が「—」になる | 実装済 |
| OCC-06 | テンプレートの全行を受け付けた | マウントする | どの行も受付状況が「Dream登録待ち」、登録予定が「次回定点RPA登録」 | 実装済 |
| OCC-07 | テンプレートの全行を受け付けた | 「続けてCSV取込み」を押す | ストアの `completion` が null になり、`order-csv-upload` へ移る | 実装済 |
| OCC-08 | テンプレートの全行を受け付けた | 「Dream登録状況へ」を押す | `dream-status-list` へ移る | 実装済 |
| OCC-09 | 既定モック・正常の行と買付余力不足の行の CSV を検証し、買付余力不足の行を強制にして受け付けた | マウントする | 警告の帯（`order-csv-complete-warnings`）が出て、`order-csv-complete-warning` が 1 件。文言は「N行目：」（N は強制した行の CSV 行番号）に `orderCsvCashShortForcedWarning(数量)` が続く | 実装済 |
| OCC-10 | テンプレートの全行を受け付けた・一括受付の `warnings` が行番号の無い文言 1 件 | マウントする | `order-csv-complete-warning` がその文言だけで、「行目：」が付かない | 実装済 |
| OCC-11 | テンプレートの全行を受け付けた（`warnings` が空） | マウントする | 警告の帯（`order-csv-complete-warnings`）は出ない | 実装済 |
