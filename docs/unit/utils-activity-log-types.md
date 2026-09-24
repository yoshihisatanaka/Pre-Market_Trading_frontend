# utils/activityLogTypes（操作ログの区分と表示整形）

- 略号: `ALU`
- 対象: `src/utils/activityLogTypes.js`
- テスト: `src/utils/activityLogTypes.spec.js`
- 仕様の出所: `GET /operations/activity-logs` の `operation` / `sort` クエリと `ActivityLogItem.操作区分` の説明
  （enum ではなく string なので `apiEnums.js` ではなくここに置く）

期待する表示名は `ACTIVITY_OPERATION_OPTIONS` から導き、テストに文字列を直接書かない。
空値の表現は他の列とそろえて `—`（em dash）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALU-01 | 選択肢に定義された全操作区分 | `operationLabel(value)` | 選択肢の表示名が返る | 実装済 |
| ALU-02 | 選択肢に無い値（`'PURGE'`） | 同上 | 値がそのまま返る（区分が増えても行が読める） | 実装済 |
| ALU-03 | `'CREATE'` / `'UPDATE'` / `'DELETE'` | `operationBadgeVariant(value)` | それぞれ `success` / `info` / `warning` | 実装済 |
| ALU-04 | `'BATCH'` / 未知の値 / 空文字 | 同上 | いずれも `gray` | 実装済 |
| ALU-05 | 選択肢の全値 / 小文字・空文字・`undefined`・未知の値 | `isActivityOperation(value)` | 選択肢の値だけ true、それ以外は false | 実装済 |
| ALU-06 | `''` / `'asc'` / `'desc'` / `'ASC'` / `undefined` | `isActivitySort(value)` | `''` と `'asc'` だけ true（既定の新しい順は空文字で表す） | 実装済 |
| ALU-07 | ISO8601 の日時（`YYYY-MM-DDTHH:MM:SS`） | `formatActivityAt(value)` | `YYYY/MM/DD HH:MM:SS`（年から秒まで・ゼロ埋め） | 実装済 |
| ALU-08 | 空文字 / `null` / `undefined` / 日時として読めない文字列 | 同上 | いずれも `—` | 実装済 |
| ALU-09 | `null` / `undefined` / 空文字 | `formatActivityValue(value)` | いずれも `—` | 実装済 |
| ALU-10 | object / 配列 | 同上 | JSON 文字列になる | 実装済 |
| ALU-11 | 文字列 / 数値（`0` を含む）/ 真偽値（`false` を含む） | 同上 | `String()` した値になる（`0` と `false` を `—` にしない） | 実装済 |
