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
- **事前検証の `is_update` は「編集からの呼び出しか（= id を持つか）」だけで決まる。**
  対象は本文の受注不可日ではなく**クエリの `blackout_date_id`** で指すので、日付を変える編集でも
  対象を見失わず、自分自身が重複として弾かれることもない（CA の `ca_id` と同じ形）。
  主キーが受注不可日だった頃は「日付を変えたかどうか」で新規検証と変更検証を使い分けていた

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BDA-01 | 既定モック | `fetchBlackoutDates()` を引数なしで呼ぶ | `GET /api/masters/blackout-dates` に `offset=0` だけが載る。`start_date` / `end_date` / `include_deleted` は送らない | 実装済 |
| BDA-02 | 既定モック | `fetchBlackoutDates({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })` を呼ぶ | クエリ名が `start_date` / `end_date` で、値が integer の `20260101` / `20261231` になる（`date_from` や `'2026-01-01'` では送らない） | 実装済 |
| BDA-03 | 既定モック | `fetchBlackoutDates({ limit: 50, offset: 50 })` を呼ぶ | `limit` はクエリに載らない（実 API が受け付けない）。`offset` は渡した値で載る | 実装済 |
| BDA-04 | API が `BlackoutDateItem` を 1 件返す | `fetchBlackoutDates()` を呼ぶ | `{ id, date: '2026-12-25', reason, updatedAt }` に変換される。`id` は実 API の `ID`（integer）を文字列にしたもので、受注不可日ではない。`date` は `'YYYY-MM-DD'`。対象市場に相当する項目は持たない | 実装済 |
| BDA-05 | API が `備考: null` / `更新日時: null` の行を返す | `fetchBlackoutDates()` を呼ぶ | `reason` と `updatedAt` が空文字になる（`null` を画面へ流さない） | 実装済 |
| BDA-06 | API が `blackout_dates` を持たない応答を返す | `fetchBlackoutDates()` を呼ぶ | `items` が空配列、`total` が 0 になる（`blackout_dates` は required ではない） | 実装済 |
| BDA-07 | 既定モック | `validateBlackoutDate({ date, reason })` を id なしで呼ぶ | `POST /api/masters/blackout-dates/validate` の本文が日本語キー `{ 受注不可日, 備考 }` で受注不可日は integer。`is_update` は付かない | 実装済 |
| BDA-08 | 既定モック | `validateBlackoutDate({ id, date, reason })` を **日付を変えず**に呼ぶ | `is_update=true` と `blackout_date_id=<id>` が付く（自分自身を重複としないため） | 実装済 |
| BDA-09 | 既定モック | `validateBlackoutDate({ id, date, reason })` を **日付を変えて**呼ぶ | 日付を変えても `is_update=true` と `blackout_date_id=<id>` が付く（対象は日付と切り離して id で指す）。本文の受注不可日は新しい日付になる | 実装済 |
| BDA-10 | 事前検証が `{ valid: false, errors }` を返す | `validateBlackoutDate()` を呼ぶ | `valid` / `errors` がそのまま返る。例外にはしない | 実装済 |
| BDA-11 | 事前検証が `errors` を持たない応答を返す | `validateBlackoutDate()` を呼ぶ | `errors` が空配列になる | 実装済 |
| BDA-12 | 既定モック | `createBlackoutDate({ date, reason })` を呼ぶ | `POST /api/masters/blackout-dates` の本文が日本語キーで、応答の `blackout_date` を変換した 1 件が返る | 実装済 |
| BDA-13 | 既定モック | `updateBlackoutDate({ id: '12', date: '2030-01-01', reason, updatedAt })` を呼ぶ | パスが `/api/masters/blackout-dates/12`（対象の id）、本文が `{ 受注不可日: 20300101, 備考, 更新日時 }`。**日付を変えても同じ行なので id は変わらず**、date だけ新しくなる | 実装済 |
| BDA-14 | 合札（`updatedAt`）が空 | `updateBlackoutDate()` を呼ぶ | 本文に `更新日時` のキーが入らない（登録直後の行は実 API 側の更新日時が未設定で、照合する相手が無い） | 実装済 |
| BDA-15 | 既定モック | `deleteBlackoutDate('12')` を呼ぶ | `DELETE /api/masters/blackout-dates/12` を呼び、戻り値が渡した id になる。パスに載るのは id で、受注不可日ではない | 実装済 |
| BDA-16 | `VITE_USER_CODE` が設定されている | 更新系（`createBlackoutDate`）を呼ぶ | リクエストに `X-User-Code` ヘッダが載る（実 API が必須にしているため） | 実装済 |
| BDA-17 | API が `ID` を持たない `BlackoutDateItem` を返す | `fetchBlackoutDates()` を呼ぶ | `id` が空文字のままになる（受注不可日へフォールバックしない）。`date` は従来どおり出る | 実装済 |

## 主キーは `id`（受注不可日ではない）

DB 全テーブルの主キーを `id` に統一する方針に合わせて、アプリ内モデルの主キーを
実 API の integer な `ID` にしてある。**受注不可日は主キーではなく、一意制約を持つ業務上の日付**。

これにより次の 2 つが変わった。

- **日付を変える編集でもパスが変わらない**（`BDA-13`）。主キーが日付だった頃は
  「変更前の日付をパスに、変更後の日付を本文に」という非対称を抱えていた
- **事前検証が対象を id で指せる**（`BDA-08` / `BDA-09`）。日付を変えたかどうかで
  新規検証と変更検証を使い分ける回避策が要らなくなった

**この層はフロントが先行している。** 取り込み時点の `docs/api/openapi.json` の `BlackoutDateItem` に
`ID` は無く、パスも `/masters/blackout-dates/{blackout_date}` のまま。対象 id を渡すクエリ
`blackout_date_id` も仕様に無く、CA の `ca_id` に倣った決め打ち（→ バックエンドへの確認事項）。

`BDA-17` はその穴を見張るためのシナリオ。**値で取り繕わない**
（銘柄マスタの [api-symbols.md](api-symbols.md) の `STA-24` と同じ扱い）。
