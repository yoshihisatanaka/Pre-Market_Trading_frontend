# utils/orderTypes（注文の区分のコードと名前）

- 略号: `ORT`
- 対象: `src/utils/orderTypes.js`
- テスト: `src/utils/orderTypes.spec.js`

発注範囲（画面の「市場区分」）・指成区分・処理状況のコードと名前の対応。名前は OpenAPI に無く、
バックエンドのコードマスタから写している。発注範囲のコードの集合が `src/utils/apiEnums.js` の
`EXECUTION_SCOPE_VALUES` と食い違わないことをここで固定する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ORT-01 | — | `MARKET_SCOPE_OPTIONS` の値を並べる | `EXECUTION_SCOPE_VALUES` と同じコードが同じ順に並ぶ | 実装済 |
| ORT-02 | — | 各選択肢のコードで `marketScopeLabel(code)` | その選択肢の名前になる（`'04'` は「プレ＋レギュラー＋アフター」） | 実装済 |
| ORT-03 | — | `marketScopeLabel('99')` / `''` / `null` / `undefined` | 知らないコードはそのまま `'99'`、空値は「—」 | 実装済 |
| ORT-04 | — | `orderStatusLabel('003')` / `'141'` / `'101'` / `'040'` | 「注文中」/「訂正中断」/「Dream発注失敗」/「訂正待ち」 | 実装済 |
| ORT-05 | — | `orderStatusLabel('999')` / `''` / `null` | 知らないコードはそのまま `'999'`、空値は「—」 | 実装済 |
| ORT-06 | — | `orderPriceLabel('MO', 410)` / `('LO', 410)` / `('', 410)` | 「成行」/ `指値 ` + `formatUsdUnit(410)`（「指値 410.00 ドル」）/「—」 | 実装済 |
| ORT-07 | — | `ORDER_TYPE_OPTIONS` を読む | 成行（`MO`）→ 指値（`LO`）の順に 2 つ | 実装済 |
