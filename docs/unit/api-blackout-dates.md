# api/blackoutDates（受注不可日マスタ API 層）

- 略号: `BDA`
- 対象: `src/api/blackoutDates.js`
- テスト: `src/api/blackoutDates.spec.js`

ここだけが**バックエンドの形**（パス・クエリ名・日本語キー・integer の受注不可日）を知ってよい層なので、
この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。

ストア（[stores-blackout-dates.md](stores-blackout-dates.md)）と画面
（[views-blackout-date-list-view.md](views-blackout-date-list-view.md)）のテストは、
MSW のモックが返す結果を見ている。モックはこちらの実装と同じ理解で書かれているので、
**モックとサーバの理解がずれていても気づけない**。そこでこの文書では、モックの応答ではなく
**送信されたリクエストそのもの**を `docs/api/openapi.json` の宣言と突き合わせる。
海外休場日の同種の文書は [api-market-holidays.md](api-market-holidays.md)。

特に取り違えやすい 2 点をここで固定する。

- **`limit` を送らない。** 実 API の一覧は 1 ページ 50 件で固定されていて `limit` というクエリを持たない
  （海外休場日の `/masters/market-holidays` は持つ）。ストアは表示件数を `limit` として渡してくるので、落とすのは api 層の役目
- **事前検証の `is_update` は「日付を変えたか」で決まる。** 実 API の変更検証は
  「本文の受注不可日が実在し取消済みでないこと」を見るので、新しい日付に使うと「存在しません」で弾かれる。
  日付を変えないときだけ変更検証にし、変えるときは新規検証（その日付が空いているか）を使う

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BDA-01 | 既定モック | `fetchBlackoutDates()` を引数なしで呼ぶ | `GET /api/masters/blackout-dates` に `offset=0` だけが載る。`start_date` / `end_date` / `include_deleted` は送らない | 実装済 |
| BDA-02 | 既定モック | `fetchBlackoutDates({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })` を呼ぶ | クエリ名が `start_date` / `end_date` で、値が integer の `20260101` / `20261231` になる（`date_from` や `'2026-01-01'` では送らない） | 実装済 |
| BDA-03 | 既定モック | `fetchBlackoutDates({ limit: 50, offset: 50 })` を呼ぶ | `limit` はクエリに載らない（実 API が受け付けない）。`offset` は渡した値で載る | 実装済 |
| BDA-04 | API が `BlackoutDateItem` を 1 件返す | `fetchBlackoutDates()` を呼ぶ | `{ id: '20261225', date: '2026-12-25', reason, updatedAt }` に変換される。`id` は受注不可日の文字列、`date` は `'YYYY-MM-DD'`。対象市場に相当する項目は持たない | 実装済 |
| BDA-05 | API が `備考: null` / `更新日時: null` の行を返す | `fetchBlackoutDates()` を呼ぶ | `reason` と `updatedAt` が空文字になる（`null` を画面へ流さない） | 実装済 |
| BDA-06 | API が `blackout_dates` を持たない応答を返す | `fetchBlackoutDates()` を呼ぶ | `items` が空配列、`total` が 0 になる（`blackout_dates` は required ではない） | 実装済 |
| BDA-07 | 既定モック | `validateBlackoutDate({ date, reason })` を id なしで呼ぶ | `POST /api/masters/blackout-dates/validate` の本文が日本語キー `{ 受注不可日, 備考 }` で受注不可日は integer。`is_update` は付かない | 実装済 |
| BDA-08 | 既定モック | `validateBlackoutDate({ id, date, reason })` を **id と同じ日付**で呼ぶ | `is_update=true` が付く（自分自身を重複としないため）。対象を渡す `id` クエリは送らない（実 API に無い） | 実装済 |
| BDA-09 | 既定モック | `validateBlackoutDate({ id, date, reason })` を **id と違う日付**で呼ぶ | `is_update` は付かない（新規検証としてその日付が空いているかを見る）。本文の受注不可日は新しい日付になる | 実装済 |
| BDA-10 | 事前検証が `{ valid: false, errors }` を返す | `validateBlackoutDate()` を呼ぶ | `valid` / `errors` がそのまま返る。例外にはしない | 実装済 |
| BDA-11 | 事前検証が `errors` を持たない応答を返す | `validateBlackoutDate()` を呼ぶ | `errors` が空配列になる | 実装済 |
| BDA-12 | 既定モック | `createBlackoutDate({ date, reason })` を呼ぶ | `POST /api/masters/blackout-dates` の本文が日本語キーで、応答の `blackout_date` を変換した 1 件が返る | 実装済 |
| BDA-13 | 既定モック | `updateBlackoutDate({ id: '20261225', date: '2030-01-01', reason, updatedAt })` を呼ぶ | パスが `/api/masters/blackout-dates/20261225`（**変更前**の日付）、本文が `{ 受注不可日: 20300101, 備考, 更新日時 }`。戻り値の id / date が新しい日付になる | 実装済 |
| BDA-14 | 合札（`updatedAt`）が空 | `updateBlackoutDate()` を呼ぶ | 本文に `更新日時` のキーが入らない（登録直後の行は実 API 側の更新日時が未設定で、照合する相手が無い） | 実装済 |
| BDA-15 | 既定モック | `deleteBlackoutDate('20261225')` を呼ぶ | `DELETE /api/masters/blackout-dates/20261225` を呼び、戻り値が渡した id になる | 実装済 |
| BDA-16 | `VITE_USER_CODE` が設定されている | 更新系（`createBlackoutDate`）を呼ぶ | リクエストに `X-User-Code` ヘッダが載る（実 API が必須にしているため） | 実装済 |
