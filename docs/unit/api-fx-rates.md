# api/fxRates（為替マスタ API 層）

- 略号: `FXA`
- 対象: `src/api/fxRates.js`
- テスト: `src/api/fxRates.spec.js`

ここだけが**バックエンドの形**（`/masters/fx` 配下のパス・日本語キー・integer の YYYYMMDD の基準日・
integer の `ID`）を知ってよい層なので、「**実際に送り出す HTTP リクエストの形**」と
「受け取った生データの変換」を守る。パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が見る。

ストア（[stores-fx-rates.md](stores-fx-rates.md)）と画面
（[views-fx-rate-master-view.md](views-fx-rate-master-view.md)）のテストは MSW の既定ハンドラの結果を見ているので、
ここでは `server.use()` でリクエストを記録し、`docs/api/openapi.json` の `FxRequest` / `LatestFxResponse` /
`FxItem` と突き合わせる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FXA-01 | 応答を記録するハンドラ | `fetchLatestFxRate({ currencyCode: 'USD', targetDate: 'YYYY-MM-DD' })` | `GET /api/masters/fx/latest` のクエリが `currency_code=USD` と `target_date=YYYYMMDD`（ハイフン無しの数字）になる | 実装済 |
| FXA-02 | `LatestFxResponse` を返す | `fetchLatestFxRate()` | `{ id, baseDate, currencyCode, rate, withholdingRate }` に変換される。`id` は文字列、`baseDate` は 'YYYY-MM-DD'、`源泉レート` は `withholdingRate` になる | 実装済 |
| FXA-03 | latest が 404 | `fetchLatestFxRate()` | 例外にせず `null` を返す（未登録は正常な結果） | 実装済 |
| FXA-04 | latest が 500 | `fetchLatestFxRate()` | `ApiError`（`status` 500、`message` は detail）で reject する | 実装済 |
| FXA-05 | `targetDate: ''` | `fetchLatestFxRate()` | `target_date` をクエリに載せない | 実装済 |
| FXA-06 | 詳細が `{ exchange_rate: FxItem }` を返す | `fetchFxRate(id)` | `GET /api/masters/fx/{id}` を呼び、包みを外した 1 件の日本語キーがすべて camelCase になる（`源泉レート` → `withholdingRate`、`更新日時` → `updatedAt`、`更新者` → `updatedBy`、`作成日時` → `createdAt`） | 実装済 |
| FXA-07 | `id` を渡さない | `validateFxRate({ baseDate, currencyCode, rate, withholdingRate })` | `POST /api/masters/fx/validate` の本文が `{ 基準日: YYYYMMDD の integer, 通貨コード, 為替レート, 源泉レート }` で、クエリは付かない | 実装済 |
| FXA-08 | `id` を渡す | `validateFxRate({ ..., id })` | クエリに `fx_id=<id>` と `is_update=true` が載る | 実装済 |
| FXA-09 | validate が `valid: false`（errors 1 件・warnings 無し） | `validateFxRate()` | 例外にせず `{ valid: false, errors: [理由], warnings: [] }` を返す | 実装済 |
| FXA-10 | 登録が `{ success, exchange_rate }` を返す | `createFxRate({ baseDate, currencyCode, rate, withholdingRate })` | `POST /api/masters/fx` の本文が `FxRequest` の 4 項目（`源泉レート` を含む）だけ（ID・更新日時を載せない）で、戻り値は包みを外した camelCase の 1 件 | 実装済 |
| FXA-11 | `updatedAt` を渡す | `updateFxRate({ id, baseDate, currencyCode, rate, withholdingRate, updatedAt })` | `PUT /api/masters/fx/{id}` の本文が `FxRequest` の 4 項目（`源泉レート` を含む）＋`更新日時`（渡した値のまま） | 実装済 |
| FXA-12 | `updatedAt: ''` | `updateFxRate()` | 本文に `更新日時` のキーが無い | 実装済 |
| FXA-13 | 変更が 409 | `updateFxRate()` | `ApiError`（`status` 409、`message` は detail）で reject する | 実装済 |
| FXA-14 | latest の `源泉レート` が null | `fetchLatestFxRate()` | `withholdingRate` が null のまま返る（0 や undefined にしない） | 実装済 |
| FXA-15 | 詳細の `源泉レート` が null | `fetchFxRate(id)` | `withholdingRate` が null のまま返る | 実装済 |
| FXA-16 | `withholdingRate` を渡さない | `createFxRate({ baseDate, currencyCode, rate })` | 本文に `源泉レート: null` のキーが載る（省略しない） | 実装済 |
| FXA-17 | `withholdingRate` を渡さない | `updateFxRate({ id, baseDate, currencyCode, rate, updatedAt })` | 本文に `源泉レート: null` のキーが載る（省略しない） | 実装済 |
