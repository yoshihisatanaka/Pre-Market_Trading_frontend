# api/incidents（障害管理 API）

- 略号: `INA`
- 対象: `src/api/incidents.js`
- テスト: `src/api/incidents.spec.js`
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

エンドポイントは `/operations/order-suspensions` 配下（`docs/api/openapi.json` のタグ `OrderSuspensions`）。
ファイル名が `incidents` なのは画面の呼称に合わせたため。キーは日本語のまま返る。

バックエンドの生の形を知ってよいのはこの層だけ。外へは camelCase のアプリ内モデルで返す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| INA-01 | 既定モック | `fetchSuspensionStatus()` を呼ぶ | `発注停止中` → `suspended`、`全体停止中` → `allSuspended`、`停止中の対象` → `suspendedTargets`、`targets` の各行が `id` / `target` / `targetName` / `suspended` に変換される。`targets` は `ALL` が先頭のまま | 実装済 |
| INA-02 | 既定モック | `fetchSuspensionStatus()` を呼ぶ | 各行の `停止理由` / `停止日時` / `停止者` / `再開日時` / `再開者` / `更新日時` / `更新者` が `reason` / `suspendedAt` / `suspendedBy` / `resumedAt` / `resumedBy` / `updatedAt` / `updatedBy` に変換される。`発注停止フラグ` は運ばない | 実装済 |
| INA-03 | 本文が空で返る | `fetchSuspensionStatus()` を呼ぶ | `null` が返る（画面が「空」として出せる） | 実装済 |
| INA-04 | 既定モック | `fetchSuspensionHistories()` を呼ぶ | `{ items, total }` が返り、`items` の各要素が `id` / `target` / `targetName` / `operation` / `operationName` / `operator` / `operatorName` / `reason` / `operatedAt` を持つ。`reason` は `変更後データ` の `停止理由`、`operatorName` は契約提案の `操作者名`（無ければ空文字） | 実装済 |
| INA-05 | `histories` と `total` が無い本文で返る | `fetchSuspensionHistories()` を呼ぶ | `{ items: [], total: 0 }` が返る（`undefined` にしない） | 実装済 |
| INA-06 | API が 500 を返す | `fetchSuspensionStatus()` を呼ぶ | `ApiError` が投げられ、`message` が「サーバーでエラーが発生しました。」になる | 実装済 |
| INA-07 | 既定モック | `fetchSuspensionStatus()` を呼ぶ | `/operations/order-suspensions` に GET が飛ぶ | 実装済 |
| INA-08 | 既定モック | `fetchSuspensionHistories({ limit, offset })` を呼ぶ | `/operations/order-suspensions/history` に、渡した `limit` と `offset` をクエリに載せて GET が飛ぶ | 実装済 |
| INA-09 | `変更後データ` が null の履歴 | `fetchSuspensionHistories()` を呼ぶ | その要素の `reason` が `null` になる（落ちない） | 実装済 |
| INA-10 | 既定モック | `suspendOrders({ target: '1', reason: 'IB回線障害', updatedAt: '…' })` を呼ぶ | `/operations/order-suspensions/suspend` に POST が飛び、本文が `{ 停止対象, 停止理由, 更新日時 }` になる。`実行者` は送らない | 実装済 |
| INA-11 | 既定モック | `suspendOrders()` を呼ぶ | `success` / `target`（camelCase の停止対象 1 件）/ `message` が返る | 実装済 |
| INA-12 | 停止 API が 409 を返す | `suspendOrders()` を呼ぶ | `ApiError` が投げられ、`status` が 409、`message` がサーバの `detail` になる | 実装済 |
| INA-13 | `updatedAt` を省略 | `suspendOrders()` を呼ぶ | 本文の `更新日時` が null になる | 実装済 |
| INA-14 | IB が停止中 | `resumeOrders({ target: '1', updatedAt: '…' })` を呼ぶ | `/operations/order-suspensions/resume` に POST が飛び、本文が `{ 停止対象, 更新日時 }` になる。`停止理由` と `実行者` は送らない | 実装済 |
| INA-15 | 再開 API が 400 を返す | `resumeOrders()` を呼ぶ | `ApiError` が投げられ、`message` がサーバの `detail` になる | 実装済 |
| INA-16 | 既定モック | `fetchSuspensionHistories()` を引数なしで呼ぶ | クエリは `offset=0` だけで、`limit` は載らない（件数はサーバの既定に任せる） | 実装済 |
| INA-17 | `total` が 1 ページの件数より大きい本文で返る | `fetchSuspensionHistories()` を呼ぶ | 戻り値の `total` がサーバの `total`（全体件数）になる。`items` の件数ではない | 実装済 |
