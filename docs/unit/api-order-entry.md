# api/orderEntry（新規注文の事前検証と登録 API 層）

- 略号: `NOA`
- 対象: `src/api/orderEntry.js`
- テスト: `src/api/orderEntry.spec.js`

パスとクエリ名が仕様に在るかは `api-contract.md`（`CON`）が見るので、ここでは
**送る本文の形**（日本語キー・integer・`'YYYYMMDD'`・null）と**応答の変換**だけを守る。
業務上の不合格（200 の `valid:false` / `success:false`）は例外にせず、4xx / 5xx だけが `ApiError` になる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| NOA-01 | 既定モック | `validateOrder(注文)` | 本文が OrderRequest の日本語キーで送られ、口座番号は integer、有効期限・受注日は `'YYYYMMDD'`、受注時刻は `'HH:MM'` のまま、区分値はコードのまま | 実装済 |
| NOA-02 | 成行・受注者が空・強制区分なし・VWAP なし | `validateOrder(注文)` | 本文の指値単価 `null`、受注者 `null`（空文字にしない）、強制区分 `0`、VWAP区分 `0`。受注者は必須なのでサーバ（既定モック）の 422 が `ApiError` で返る | 実装済 |
| NOA-03 | 指値 200.5・強制区分あり・VWAP あり | `createOrder(注文)` | 指値単価 `200.5`、強制区分 `1`、VWAP区分 `1` | 実装済 |
| NOA-04 | 既定モック・警告の出ない顧客と銘柄 | `validateOrder(注文)` | `{ valid: true, errors: [], warnings: [] }` | 実装済 |
| NOA-05 | 取引不可の銘柄（BRK.B） | `validateOrder(注文)` | 例外にならず `valid: false` で、`errors` に「売り、買いともに禁止銘柄です。」 | 実装済 |
| NOA-06 | 応答に `errors` / `warnings` が無い | `validateOrder` / `createOrder` | どちらも `[]` になる。`createOrder` の `message` が無ければ `''` | 実装済 |
| NOA-07 | `POST /orders/validate` が 500 | `validateOrder(注文)` | `ApiError`（status 500）で reject される | 実装済 |
| NOA-08 | 既定モック | `createOrder(注文)` | `success: true`、`orderId` が採番された integer の文字列（`FIRST_ORDER_ID`）、`message` がサーバの文言 | 実装済 |
| NOA-09 | 取引不可の銘柄 | `createOrder(注文)` | 例外にならず `success: false`、`orderId: ''`、`errors` に理由 | 実装済 |
| NOA-10 | `POST /orders` が 500 | `createOrder(注文)` | `ApiError`（status 500）で reject される | 実装済 |
| NOA-11 | 受注者が `ORDER_PERSON_MAX_LENGTH` + 1 文字・既定モック | `createOrder(注文)` | サーバの 422（4 文字超）が `ApiError`（status 422）で reject される | 実装済 |
