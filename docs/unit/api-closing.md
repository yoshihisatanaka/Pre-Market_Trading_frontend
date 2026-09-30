# api/closing（締め管理 API 層）

- 略号: `CLS`
- 対象: `src/api/closing.js`
- テスト: `src/api/closing.spec.js`

`GET /closing/status` の照会と、締め実行 `POST /closing/mizuho`・締め解除 `POST /closing/mizuho/reset` を持つ。
パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が見るので、ここでは**この層の変換**だけを守る。

締め実行・締め解除の `実行者` はサーバが `X-User-Code` から解決しない（省くと `'SYSTEM'` で記録される）ので、
本文に載せる。値は `vitest.config.js` の `VITE_USER_CODE`（`test-user`）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CLS-01 | 既定モック | `fetchMizuhoClosingStatus()` | `closing_type=MIZUHO` を付けて問い合わせ、`{ closed: false, updatedAt: null, operator: '' }` を返す | 実装済 |
| CLS-02 | 応答が締め済（`closedMizuhoClosingStatus`） | `fetchMizuhoClosingStatus()` | `closed` が true、`updatedAt` が 更新日時 のまま、`operator` が 実行者 になる | 実装済 |
| CLS-03 | 応答の本文が空 | `fetchMizuhoClosingStatus()` | `null` を返す（画面はこれを「空」として出す） | 実装済 |
| CLS-04 | `GET /closing/status` が 500 | `fetchMizuhoClosingStatus()` | `ApiError` で reject する | 実装済 |
| CLS-05 | 既定モック | `closeMizuhoOrders()` | `POST /closing/mizuho` に本文 `{ 実行者: 'test-user' }` を送り、応答を `{ closed: true, updatedAt: 応答の 更新日時, operator: 'test-user' }` にして返す | 実装済 |
| CLS-06 | 既定モック | `reopenMizuhoOrders()` | `POST /closing/mizuho/reset` に本文 `{ 実行者: 'test-user' }` を送り、`closed` が false の状態を返す | 実装済 |
| CLS-07 | `POST /closing/mizuho` が 403（`{ detail: '操作権限がありません。' }`） | `closeMizuhoOrders()` | `ApiError` で reject し、`message` がその `detail`、`status` が 403 | 実装済 |
