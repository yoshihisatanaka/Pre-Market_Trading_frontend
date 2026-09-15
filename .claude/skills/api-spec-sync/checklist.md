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

## 2026-09-15 時点の実測（`a21018a` の取り込み）

79 パス / 102 オペレーション / 129 スキーマ（前回 66 / 88 / 124）。

| # | 項目 | 実測 |
|---|---|---|
| 1 | `response_model` 未宣言 | **改善したが残る。** 主要マスタには `CustomerItem` / `SymbolItem` / `OrderItemResponse` などの型が付いた。中身が未定義のまま残るのは `GET /orders/{order_id}`（`order` / `executions` / `events`）・`/customers`（注文画面用のほう）・`/branches` / `/handlers`（`MasterListResponse.items`）・`/codes`・`/mizuho/*` 4 本・`PUT /orders/{order_id}/dream-correct`・`/batch/*` 10 本。`additionalProperties: true` の Grep は 48 件当たるが、うち相当数は履歴の `変更前データ` / `差分` など**本来自由形式**のものなので、件数だけで判断しない |
| 2 | `enum` | **21 種**（0 件 → 21 種。`474ac83` の取り込みで入った）。値の写しは [src/utils/apiEnums.js](../../../src/utils/apiEnums.js) にあり、`apiEnums.spec.js` が `openapi.json` と突き合わせるので**次の取り込みで増減するとテストが落ちる** |
| 3 | エラー応答の形 | 変わらず。400/401/404/409/500 は `ErrorResponse`（`{detail: string}`）、422 は `HTTPValidationError`（`{detail: ValidationError[]}`）。`client.js` の `normalizeError` は両方を読めるようにしてある |
| 4 | 4XX / 5XX | **大幅に改善。** 102 オペレーション中 68 が 422 以外の 4XX/5XX を宣言、30 は 422 のみ、4 はエラー宣言なし。現れるコードは 200 / 201 / 400 / 401 / 404 / 409 / 422 / 500。`PUT /masters/hard-limits` の楽観ロック 409 も**宣言済みになった**（前回は description にだけ書かれていた） |
| 5 | 日時・金額・株数の型 | `format:` は 36 箇所。日時は `string(date-time)` と素の `string` の anyOf が多く、**日付は integer の YYYYMMDD**（`受注不可日` / `休場日` / `基準日` など）。金額は `number`、株数は `integer` |
| 6 | ページング形式 | おおむね `total` / `limit` / `offset` でそろっているが、**`/masters/blackout-dates` と `/customers` は `limit` を持たない**（`offset` のみ）。一覧の配列キーはリソース名と一致しないものがある（`/masters/symbols` → `stocks`、`/masters/fx` → `exchange_rates`、`/masters/ca` → `ca_list`） |
| 7 | パスのプレフィックス | 原本に `/api` は無く proxy の `rewrite` で整合。ただし**マスタ系 36 パスが `/masters/` 配下へ移動**し、`/masters/symbols` と `/customers` は**クエリ名が日本語から英語の snake_case に変わった**。フロント側の追随は `refactor/masters-api-paths` で実施（銘柄マスタは別途） |
