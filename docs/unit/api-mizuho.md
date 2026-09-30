# api/mizuho（みずほ連携 API 層）

- 略号: `MZO`
- 対象: `src/api/mizuho.js`
- テスト: `src/api/mizuho.spec.js`

オーダーシート（注文ファイル）の作成 `GET /mizuho/export-orders` を持つ。応答は xlsx のバイト列で、
件数はヘッダ（`X-Exported-Count` / `X-Newly-Exported-Count` / `X-Skipped-Unregistered`）で返る。
openapi.json には応答のスキーマも 400 も宣言が無いので、形はバックエンドの実装（`app/api/mizuho_api.py`）に合わせる。
MSW の既定ハンドラ（`src/mocks/handlers/mizuho.js`）は締め済でないと 400 を返すので、
成功を見るシナリオは先に `closeMizuhoOrders()` で締めておく。
パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MZO-01 | 締め済 | `exportMizuhoOrderSheet({ side: 'buy' })` | クエリ `side=buy` で問い合わせ、`filename` が `オーダーシート_20260928_BUY_US.xlsx`、`blob` の type が xlsx | 実装済 |
| MZO-02 | 締め済（既定のフィクスチャ: 売り 登録済 2・未登録 1） | `exportMizuhoOrderSheet({ side: 'sell' })` | `exportedCount` が 2、`newlyExportedCount` が 2、`skippedCount` が 1（ヘッダの文字列を数値にする） | 実装済 |
| MZO-03 | 件数ヘッダも `Content-Disposition` も無い応答 | `exportMizuhoOrderSheet({ side: 'sell' })` | 件数は 3 つとも `null`、`filename` は既定名 `オーダーシート_SELL_US.xlsx` | 実装済 |
| MZO-04 | 受付中（既定モック） | `exportMizuhoOrderSheet({ side: 'buy' })` | `ApiError` で reject し、`message` が `注文ファイルは、みずほ注文締め後に作成してください。`、`status` が 400 | 実装済 |
