# utils/marketHolidayTypes（海外休場区分の既定値と短縮取引日の表示）

- 略号: `MHT`
- 対象: `src/utils/marketHolidayTypes.js`
- テスト: `src/utils/marketHolidayTypes.spec.js`
- 仕様の出所: `m_海外休場日.休場区分`（varchar(2) の `'0'` / `'1'`、DEFAULT `'0'`）

コードは `docs/api/openapi.json` の `HolidayTypeEnum` にあり、その写しである
`src/utils/apiEnums.js` の `HOLIDAY_TYPE` から取る。区分の表示名と検索セレクトの選択肢は
コードマスタ `海外休場区分`（`GET /codes`。`stores/codes.js`）から引くので、このファイルは持たない
（2026-10-14 に `MARKET_HOLIDAY_TYPE_OPTIONS` / `formatMarketHolidayType` / `isMarketHolidayType` を外した。
旧 MHT-01〜06 / 08 はその検証で、名称の有無は `utils-api-enums.md` の AEN-06 に移した）。
ここに残るのは既定値と、画面モックの「短縮取引日」列の判定・表示だけ。
未知の値・空値は他の列の空値表現とそろえて `—`（em dash）にする。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MHT-07 | 既定値の定数 | `MARKET_HOLIDAY_TYPE_DEFAULT` を見る | 終日休場のコード（`HOLIDAY_TYPE.ALL_DAY` = `'0'`）と一致する | 実装済 |
| MHT-09 | `'1'` / `'0'` / `'9'` / 空値 / 数値 | `isShortTradingDay(value)` | `'1'` だけ true。それ以外（終日休場・未知・空値・数値の 1）は false | 実装済 |
| MHT-10 | `'1'` / `'0'` / `'9'` / 空値 / 数値 | `formatMarketHolidayEarlyClose(value)` | `'1'` は `MARKET_HOLIDAY_EARLY_CLOSE_LABEL`（13:00 ET 終了）、それ以外は `—` | 実装済 |
