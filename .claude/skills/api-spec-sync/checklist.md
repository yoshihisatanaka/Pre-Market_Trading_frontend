# 仕様ギャップ点検リスト

構文・`$ref` の解決・OpenAPI としての妥当性は `redocly lint` が機械的に検証する。
このリストは **lint では拾えない「原本そのものの穴」** に集中する。
`docs/api/openapi.json` を取得したら、以下を毎回点検して件数と該当箇所を報告する。

**穴が埋まっていない項目は、フロントエンドの実装を進める前にバックエンド担当へ送る。**
ここで挙がった箇所を推測で埋めると、実装後に食い違いが発覚する。

| # | 点検項目 | 調べ方 | 埋まっていないと起きること |
|---|---|---|---|
| 1 | 一覧・詳細・履歴レスポンスの要素が素の object になっていないか（FastAPI 側で `response_model` 未宣言） | `additionalProperties: true` を Grep | フィクスチャも `src/api/` の変換関数も書けない。画面が作れない |
| 2 | `enum` が宣言されているか（注文状態・売買区分・注文種別など） | `"enum"` を Grep | 想定外の値で表示が `undefined` になる |
| 3 | エラー応答の形が [client.js](../../../src/api/client.js) の `normalizeError`（`message` / `code`）と一致するか | `422` の `$ref` 先スキーマを読む | エラーメッセージが画面に出ない |
| 4 | 4XX / 5XX が宣言されているか | 各操作の `responses` のキーを数える | 異常系の実装が推測になる |
| 5 | 日時・金額・株数の型（`format: date-time` / `number` / `integer`） | `format:` を Grep し、件数が操作数に見合うか見る | 日付が 1 日ずれる。端数表示が崩れる |
| 6 | 一覧系のページング形式が統一されているか（`total` / `limit` / `offset`） | 一覧レスポンスのプロパティを見比べる | 画面ごとに違う処理を書く羽目になる |
| 7 | パスのプレフィックスが [vite.config.js](../../../vite.config.js) の proxy 設定と噛み合っているか | `paths` の先頭と `server.proxy` の `rewrite` を見比べる | 実 API に繋いだ瞬間 404 |

## 報告フォーマット

| # | 項目 | 判定 | 根拠 |
|---|---|---|---|
| 1 | `response_model` 未宣言 | OK / 要確認 | `additionalProperties: true` が N 箇所（該当スキーマ名） |
| … | | | |

## 2026-09-07 時点の実測（初回取り込み）

次に取り込んだとき、ここから改善しているかを見る目安。

| # | 項目 | 実測 |
|---|---|---|
| 1 | `response_model` 未宣言 | **29 箇所**（Orders / Stocks / ExchangeRates / BlackoutDates / CA / Holidays / BalanceAdjustments / Customers の一覧・詳細・履歴） |
| 2 | `enum` | **0 件** |
| 3 | エラー応答の形 | 422 は FastAPI の `{detail: [...]}`。`normalizeError` が期待する `{message, code}` と**不一致** |
| 4 | 4XX / 5XX | 200 / 201 / 422 のみ。400 / 401 / 403 / 404 / 500 は**未定義** |
| 5 | 日時・金額・株数の型 | 判定不能（型が見えるのはページング系のみ。実体は項目 1 の内側） |
| 6 | ページング形式 | OK（一覧 6 本すべて `total` / `limit` / `offset`） |
| 7 | パスのプレフィックス | 原本に `/api` は無い。proxy 側の `rewrite` で剥がして整合済み |
