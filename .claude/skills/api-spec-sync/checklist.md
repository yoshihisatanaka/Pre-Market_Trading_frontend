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

## 2026-09-16 時点の実測

93 パス / 122 オペレーション / 161 スキーマ（前回 79 / 102 / 129）。
増分は **操作ログ横断照会（`ActivityLogs` 2 本）** と
**手数料パターン / 手数料優遇のマスタ（`MasterFeePatterns` / `MasterFeePreferences` 各 9 本）**。

| # | 点検項目 | 判定 | 実測 |
|---|---|---|---|
| 1 | `response_model` 未宣言 | 要確認（横ばい） | 応答の直下が自由形式なのは **11 本**（`/batch/*` 10 本・`GET /codes`）。加えて**型は付いていても中身が自由形式**なのが `/branches` / `/handlers`（`MasterListResponse.items`）・`GET /orders/{order_id}`（`order` / `executions` / `events`）・`GET /customers`（注文画面用の `customers`）・`/mizuho/*`。`additionalProperties: true` の Grep は 59 件当たるが、履歴の `変更前データ` / `差分` など**本来自由形式**のものを含むので件数だけで判断しない |
| 2 | `enum` | OK | **21 種で増減なし**（`apiEnums.spec.js` が突き合わせており、増減すれば落ちる） |
| 3 | エラー応答の形 | OK | 変わらず。400/401/404/409/500 は `ErrorResponse`（`{detail: string}`）、422 は `HTTPValidationError`。`client.js` の `normalizeError` は両方を読める |
| 4 | 4XX / 5XX | 改善 | 122 オペレーション中 **88 が 422 以外の 4XX/5XX を宣言**（前回 68）、30 は 422 のみ、4 は宣言なし。現れるコードは 200 / 201 / 400 / 401 / 404 / 409 / 422 / 500 |
| 5 | 日時・金額・株数の型 | OK | `format:` は 45 箇所（`date-time` 44 / `binary` 1）。**日付は依然 integer の YYYYMMDD**（`権利付最終日` / `基準日` など）。金額は `number`、株数は `integer` |
| 6 | ページング形式 | 改善 | 一覧 12 本すべて `total` / `limit` / `offset` を持つ。**`/masters/blackout-dates` に `limit` が付いた**（前回は `offset` のみ）。履歴系（`*HistoryResponse` 9 本）と `OrderListResponse`・`/customers`（注文画面用）は `total` のみ。配列キーがリソース名と一致しないものは従来どおり（`/masters/symbols` → `stocks`、`/masters/fx` → `exchange_rates`、`/masters/ca` → `ca_list`） |
| 7 | パスのプレフィックス | OK | 原本に `/api` は無く proxy の `rewrite` で整合。先頭は `/orders` `/customers` `/balances` `/closing` `/masters` `/operations` `/holdings` `/mizuho` `/batch` `/branches` `/handlers` `/codes` `/` |

### この取り込みで増えた追随ポイント

- **クエリ名の改名**（lint も型も検知しない）。`stock_code` → `symbol`（`/masters/ca` ほか）、
  `name_ja` / `name_en` → `symbol_name_ja` / `symbol_name_en`。**旧名は FastAPI に無視されるだけで
  エラーにならない**ため、絞り込みが黙って効かなくなる。追随は `fix: CAマスタの銘柄絞り込みを symbol
  クエリに合わせる` で実施済み
- **更新系が部分更新（`*UpdateRequest`）に変わった。** 本文に含めた項目だけ更新、明示的な `null` だけがクリア。
  いまの `src/api/` は全項目を明示して送るので挙動は不変
- **認証は宣言だけで未接続。** `securitySchemes` に `sessionCookie` / `csrfToken` があるが
  グローバルな `security` が無く、lint も「never used」と警告する（下記）。
  更新系 42 本が `session` を cookie パラメータとして宣言しているが、
  Cookie はブラウザが自動で送る（dev は Vite proxy 経由で same-origin）ので**フロント側の対応は不要**。
  `X-User-Code` は更新系 51 本すべてに付いており、`src/api/client.js` の interceptor が全 API 共通で付与済み
- `base_date` は `/masters/fx`（為替マスタ）と `/batch/*` にしか出ない。**どちらも未実装画面**なので追随不要

### lint（`redocly lint openapi.json`）

**error 1 / warning 9。直していない**（`openapi.json` はバックエンドの生成物で、直しても次の取得で消える）。

- error 1: `Servers must be present.`（`servers` が無い。フロントは Vite proxy 経由なので実害なし）
- warning 7: `Operation must have at least one 4XX response.`
  （`/orders/csv-spec` `/orders/csv-template` `/masters/hard-limits` GET・
  `/operations/activity-logs/targets` `/branches` `/codes` `/` の 7 本）
- warning 2: `Security scheme "sessionCookie" / "csrfToken" is never used.`
