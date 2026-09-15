# utils/marketHolidayTypes（海外休場区分の表示名と判定）

- 略号: `MHT`
- 対象: `src/utils/marketHolidayTypes.js`
- テスト: `src/utils/marketHolidayTypes.spec.js`
- 仕様の出所: `m_海外休場日.休場区分`（varchar(2) の `'0'` / `'1'`、DEFAULT `'0'`）

コードは `docs/api/openapi.json` の `HolidayTypeEnum` にあり、その写しである
`src/utils/apiEnums.js` の `HOLIDAY_TYPE` から取る。**表示名は spec に無い**ので、
コードと表示名の対応はフロント側の `MARKET_HOLIDAY_TYPE_OPTIONS` が持つ。
期待する表示名はこの選択肢から導き、テストに文字列を直接書かない
（選択肢が増えたときにテストが嘘にならないようにする）。
未知の値・空値は他の列の空値表現とそろえて `—`（em dash）にする。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MHT-01 | 休場区分コード `'0'` | `formatMarketHolidayType(value)` | 選択肢に定義された `'0'` の表示名（終日休場）が返る | 実装済 |
| MHT-02 | 休場区分コード `'1'` | 同上 | 選択肢に定義された `'1'` の表示名（短縮取引）が返る | 実装済 |
| MHT-03 | 選択肢に無いコード `'9'` | 同上 | `—` が返る | 実装済 |
| MHT-04 | 空文字 / `undefined` / `null` / 数値 `0` | 同上 | いずれも `—` が返る | 実装済 |
| MHT-05 | 選択肢に定義された全コード | `isMarketHolidayType(value)` | すべて true になる | 実装済 |
| MHT-06 | `'9'` / `''` / `undefined` / 数値 `0` | 同上 | すべて false になる | 実装済 |
| MHT-07 | 既定値の定数 | `MARKET_HOLIDAY_TYPE_DEFAULT` を見る | 選択肢の先頭のコード（`'0'`）と一致し、`isMarketHolidayType` を通る | 実装済 |
| MHT-08 | — | 選択肢のコードを `HOLIDAY_TYPE`（`HolidayTypeEnum` の写し）と比べる | 過不足なく一致する。表示名だけがフロント側の持ちもの | 実装済 |
