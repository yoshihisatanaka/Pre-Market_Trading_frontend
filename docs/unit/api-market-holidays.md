# api/marketHolidays（海外休場日マスタ API 層）

- 略号: `MHA`
- 対象: `src/api/marketHolidays.js`
- テスト: `src/api/marketHolidays.spec.js`

ここだけが**バックエンドの形**（パス・クエリ名・日本語キー・integer の休場日）を知ってよい層なので、
この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。

ストア（[stores-market-holidays.md](stores-market-holidays.md)）と画面
（[views-market-holiday-list-view.md](views-market-holiday-list-view.md)）の絞り込みテストは、
MSW のモックが返す結果を見ている。モックはこちらの実装と同じ理解で書かれているので、
**モックとサーバの理解がずれていても気づけない**（実際、休場区分の絞り込みは実 API 側の不具合で
0 件になっていた。2026-09-10 時点）。そこでこの文書では、モックの応答ではなく
**送信されたリクエストそのもの**を `docs/api/openapi.json` の宣言と突き合わせる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MHA-01 | 既定モック | `fetchMarketHolidays()` を引数なしで呼ぶ | `GET /api/masters/market-holidays` に `limit=50` / `offset=0` だけが載る。`start_date` / `end_date` / `holiday_type` は送らない | 実装済 |
| MHA-02 | 既定モック | `fetchMarketHolidays({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })` を呼ぶ | クエリ名が `start_date` / `end_date` で、値が integer の `20260101` / `20261231` になる（`date_from` や `'2026-01-01'` では送らない） | 実装済 |
| MHA-03 | 既定モック | `fetchMarketHolidays({ holidayType: '1' })` を呼ぶ | `holiday_type=1` が載る。空文字を渡した場合はキーごと送らない | 実装済 |
| MHA-04 | API が `HolidayItem` を 1 件返す | `fetchMarketHolidays()` を呼ぶ | `{ id, date: '2026-12-25', reason, holidayType }` に変換される。`id` は実 API の `ID`（integer）を文字列にしたもので、休場日ではない。`date` は `'YYYY-MM-DD'` | 実装済 |
| MHA-05 | API が `休場理由: null` の行を返す | `fetchMarketHolidays()` を呼ぶ | `reason` が空文字になる（`null` を画面へ流さない） | 実装済 |
| MHA-06 | 既定モック | `validateMarketHoliday({ date, reason, holidayType })` を呼ぶ | `POST /api/masters/market-holidays/validate` の本文が日本語キー `{ 休場日, 休場区分, 休場理由 }` で、休場日は integer になる。既定は新規検証なのでクエリは付かない | 実装済 |
| MHA-13 | 既定モック | `validateMarketHoliday({ ..., id: '12' })` を呼ぶ | クエリに `holiday_id=12` / `is_update=true` が載る（対象は本文の休場日ではなく id で指す）。本文の形は新規検証と同じ | 実装済 |
| MHA-07 | 事前検証が `{ valid: false, errors, warnings }` を返す | `validateMarketHoliday()` を呼ぶ | `valid` / `errors` / `warnings` がそのまま返る。例外にはしない | 実装済 |
| MHA-08 | 事前検証が `errors` / `warnings` を持たない応答を返す | `validateMarketHoliday()` を呼ぶ | `errors` / `warnings` が空配列になる（どちらも required ではないため） | 実装済 |
| MHA-09 | 既定モック | `createMarketHoliday({ date, reason, holidayType })` を呼ぶ | `POST /api/masters/market-holidays` の本文が日本語キーで、応答の `holiday` を変換した 1 件が返る | 実装済 |
| MHA-10 | 既定モック | `deleteMarketHoliday('12')` を呼ぶ | `DELETE /api/masters/market-holidays/12` を呼び、戻り値が渡した id になる。パスに載るのは id で、休場日ではない | 実装済 |
| MHA-11 | `VITE_USER_CODE` が設定されている | 更新系（`createMarketHoliday`）を呼ぶ | リクエストに `X-User-Code` ヘッダが載る（実 API が必須にしているため） | 実装済 |
| MHA-12 | API が `ID` を持たない `MarketHolidayItem` を返す | `fetchMarketHolidays()` を呼ぶ | `id` が空文字のままになる（休場日へフォールバックしない）。`date` は従来どおり出る | 実装済 |

## 主キーは `id`（休場日ではない）

DB 全テーブルの主キーが `id`（integer のサロゲートキー）に統一され、アプリ内モデルの主キーも
実 API の `ID` にしてある。**休場日は主キーではなく、一意制約を持つ業務上の日付**。

この層は一時期フロントが先行していたが、**2026-09-18 の取り込みで仕様が追いついた**。

```text
/masters/market-holidays/{holiday_id}   holiday_id: integer（行ID）  GET / PUT / DELETE
MarketHolidayItem.ID: integer           required・「サロゲートキー・主キー」
/masters/market-holidays/validate       クエリ holiday_id: integer | null, is_update: boolean
```

`MHA-12` は**仕様が追いついた後も見張りとして残す**。`ID` は required なので通常は必ず届くが、
落ちたときに休場日へフォールバックすると「動いているように見える」まま行のキーだけが
静かに壊れ、気づけなくなる。同じ扱いを銘柄マスタがしている
（[api-symbols.md](api-symbols.md) の `STA-24`）。

`MHA-13` の変更検証（`holiday_id` / `is_update`）を**呼ぶ画面はまだ無い**。海外休場日には
行ごとの編集が無く、仕様に入った `PUT /masters/market-holidays/{holiday_id}` を使っていないため。
クエリ名を契約テスト（`CON-05`）の監視下に置き、編集を足すときの入口をそろえる目的で先に置いている。
