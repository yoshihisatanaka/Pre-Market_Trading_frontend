# api/incidents（障害管理 API）

- 略号: `INA`
- 対象: `src/api/incidents.js`
- テスト: `src/api/incidents.spec.js`（未作成）
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

**このファイルが扱う API の形はすべて仮置き。** `docs/api/openapi.json` に障害管理のエンドポイントは
1 本も無い。形は `/operations/activity-logs` の作法（エンベロープは英語 snake_case・明細の項目キーは
日本語・区分は「コード + 〜名」の対）を借りた暫定で、確定したらこのファイルと `src/mocks/` だけを直す。

バックエンドの生の形を知ってよいのはこの層だけ。外へは camelCase のアプリ内モデルで返す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| INA-01 | 既定モック | `fetchIncidentStatus()` を呼ぶ | `運用状態` → `operationState`、`運用状態名` → `operationStateName`、`IB送信制御` → `ibSendControl`、`注文入力制御` → `orderEntryControl` に変換される | 未着手 |
| INA-02 | 既定モック | `fetchIncidentStatus()` を呼ぶ | `更新日時` → `updatedAt`、`更新者` → `updatedBy` に変換される | 未着手 |
| INA-03 | 本文が空で返る | `fetchIncidentStatus()` を呼ぶ | `null` が返る（画面が「空」として出せる） | 未着手 |
| INA-04 | 既定モック | `fetchIncidentHistories()` を呼ぶ | 履歴の配列が返り、各要素が `id` / `changedAt` / `stateBeforeName` / `stateAfterName` / `description` / `updatedBy` を持つ | 未着手 |
| INA-05 | `histories` が無い本文で返る | `fetchIncidentHistories()` を呼ぶ | 空配列が返る（`undefined` にしない） | 未着手 |
| INA-06 | API が 500 を返す | `fetchIncidentStatus()` を呼ぶ | `ApiError` が投げられ、`message` が「サーバーでエラーが発生しました。」になる | 未着手 |
| INA-07 | 既定モック | `fetchIncidentStatus()` を呼ぶ | `/operations/incidents` に GET が飛ぶ | 未着手 |
| INA-08 | 既定モック | `fetchIncidentHistories()` を呼ぶ | `/operations/incidents/histories` に GET が飛ぶ | 未着手 |
