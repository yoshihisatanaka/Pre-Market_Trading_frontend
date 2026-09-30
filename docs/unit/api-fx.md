# api/fx（為替の直近レート API 層）

- 略号: `OFX`
- 対象: `src/api/fx.js`
- テスト: `src/api/fx.spec.js`

新規注文の概算金額に使う `GET /masters/fx/latest`。日本語キー・YYYYMMDD の integer の基準日を
アプリ内モデルに直す変換と、レートが読めないときに概算を「—」へ倒すための `null` を守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OFX-01 | 既定モック | `fetchLatestFxRate()` | `GET /masters/fx/latest` に `currency_code=USD` が載る | 実装済 |
| OFX-02 | 既定モック | `fetchLatestFxRate()` | `{ rate, baseDate, currencyCode }` がフィクスチャの 為替レート・基準日（`'YYYY-MM-DD'`）・通貨コード になる | 実装済 |
| OFX-03 | 為替レートが `null` / 数値にならない文字列 / `0` | `fetchLatestFxRate()` | `rate` が `null`（概算を出さない） | 実装済 |
| OFX-04 | 基準日が 8 桁でない | `fetchLatestFxRate()` | `baseDate` が `''` | 実装済 |
| OFX-05 | 有効なレートの無い通貨（404） | `fetchLatestFxRate({ currencyCode: 'EUR' })` | `ApiError`（status 404）で reject される | 実装済 |
