# api/closing（締め管理 API 層）

- 略号: `CLS`
- 対象: `src/api/closing.js`
- テスト: `src/api/closing.spec.js`

`GET /closing/status` の照会と、締め実行 `POST /closing/mizuho`・締め解除 `POST /closing/mizuho/reset` を持つ。
パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が見るので、ここでは**この層の変換**だけを守る。

締め実行・締め解除の本文は空（`{}`）で送る。`実行者` はサーバが認証情報（セッション → `X-User-Code`）から解決する
（2026-10-06 回答。docs/api/requests.md #29）。MSW も `X-User-Code` を記録するので、期待する実行者は
`vitest.config.js` の `VITE_USER_CODE`（`test-user`）。照会は状態変更履歴 `history[]`（新しい順）を
`history_limit=CLOSING_HISTORY_LIMIT` 件まで返し、操作区分 `CLOSE` / `RESET` を `close` / `reopen` に読み替える。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CLS-01 | 既定モック | `fetchMizuhoClosingStatus()` | `closing_type=MIZUHO` と `history_limit=CLOSING_HISTORY_LIMIT` を付けて問い合わせ、`{ closed: false, updatedAt: null, operator: '', history: [] }` を返す | 実装済 |
| CLS-02 | 応答が締め済（`closedMizuhoClosingStatus`。history 3 件） | `fetchMizuhoClosingStatus()` | `closed` が true、`updatedAt` が 更新日時 のまま、`operator` が 実行者 になり、`history` は応答の並び（新しい順）のまま `{ id: ID の文字列, action: CLOSE→'close' / RESET→'reopen', operator: 実行者, operatedAt: 操作日時 }` になる | 実装済 |
| CLS-03 | 応答の本文が空 | `fetchMizuhoClosingStatus()` | `null` を返す（画面はこれを「空」として出す） | 実装済 |
| CLS-04 | `GET /closing/status` が 500 | `fetchMizuhoClosingStatus()` | `ApiError` で reject する | 実装済 |
| CLS-05 | 既定モック | `closeMizuhoOrders()` | `POST /closing/mizuho` に空の本文 `{}` を送り、応答を `{ closed: true, updatedAt: 応答の 更新日時, operator: 'test-user' }` にして返す。`history` の先頭が `{ action: 'close', operator: 'test-user', operatedAt: updatedAt }` | 実装済 |
| CLS-06 | 既定モック | `reopenMizuhoOrders()` | `POST /closing/mizuho/reset` に空の本文 `{}` を送り、`closed` が false・`operator` が `'test-user'` の状態を返す。`history` の先頭が `reopen` | 実装済 |
| CLS-07 | `POST /closing/mizuho` が 403（`{ detail: '操作権限がありません。' }`） | `closeMizuhoOrders()` | `ApiError` で reject し、`message` がその `detail`、`status` が 403 | 実装済 |
| CLS-08 | 応答に `history` が無い（古いサーバ）。締め済で 更新日時あり / 受付中で 更新日時あり / 受付中で 更新日時なし | `fetchMizuhoClosingStatus()` | 更新日時があれば最後の 1 回から 1 件（`id: ''`、締め済なら `close`・受付中なら `reopen`、実行者・更新日時を写す）、無ければ `[]` | 実装済 |
| CLS-09 | `history` に `{ ID: null, 操作区分: 'UNKNOWN', 実行者: null }`（操作日時なし） | `fetchMizuhoClosingStatus()` | その 1 件が `{ id: '', action: '', operator: '', operatedAt: null }` になる（壊れない） | 実装済 |
