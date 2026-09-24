# api/incidents（障害管理 API）

- 略号: `INA`
- 対象: `src/api/incidents.js`
- テスト: `src/api/incidents.spec.js`（未作成）
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

エンドポイントは `/operations/order-suspensions` 配下（`docs/api/openapi.json` のタグ `OrderSuspensions`）。
ファイル名が `incidents` なのは画面の呼称に合わせたため。キーは日本語のまま返る。

バックエンドの生の形を知ってよいのはこの層だけ。外へは camelCase のアプリ内モデルで返す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| INA-01 | 既定モック | `fetchSuspensionStatus()` を呼ぶ | `発注停止中` → `suspended`、`全体停止中` → `allSuspended`、`停止中の対象` → `suspendedTargets`、`targets` の各行が `id` / `target` / `targetName` / `suspended` に変換される。`targets` は `ALL` が先頭のまま | 未着手 |
| INA-02 | 既定モック | `fetchSuspensionStatus()` を呼ぶ | 各行の `停止理由` / `停止日時` / `停止者` / `再開日時` / `再開者` / `更新日時` / `更新者` が `reason` / `suspendedAt` / `suspendedBy` / `resumedAt` / `resumedBy` / `updatedAt` / `updatedBy` に変換される。`発注停止フラグ` は運ばない | 未着手 |
| INA-03 | 本文が空で返る | `fetchSuspensionStatus()` を呼ぶ | `null` が返る（画面が「空」として出せる） | 未着手 |
| INA-04 | 既定モック | `fetchSuspensionHistories()` を呼ぶ | 履歴の配列が返り、各要素が `id` / `target` / `targetName` / `operation` / `operationName` / `operator` / `reason` / `operatedAt` を持つ。`reason` は `変更後データ` の `停止理由` | 未着手 |
| INA-05 | `histories` が無い本文で返る | `fetchSuspensionHistories()` を呼ぶ | 空配列が返る（`undefined` にしない） | 未着手 |
| INA-06 | API が 500 を返す | `fetchSuspensionStatus()` を呼ぶ | `ApiError` が投げられ、`message` が「サーバーでエラーが発生しました。」になる | 未着手 |
| INA-07 | 既定モック | `fetchSuspensionStatus()` を呼ぶ | `/operations/order-suspensions` に GET が飛ぶ | 未着手 |
| INA-08 | 既定モック | `fetchSuspensionHistories()` を呼ぶ | `/operations/order-suspensions/history` に `limit=50` 付きで GET が飛ぶ | 未着手 |
| INA-09 | `変更後データ` が null の履歴 | `fetchSuspensionHistories()` を呼ぶ | その要素の `reason` が `null` になる（落ちない） | 未着手 |
