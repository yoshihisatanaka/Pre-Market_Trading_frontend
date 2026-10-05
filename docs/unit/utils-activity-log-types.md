# utils/activityLogTypes（操作ログの区分と表示整形）

- 略号: `ALU`
- 対象: `src/utils/activityLogTypes.js`
- テスト: `src/utils/activityLogTypes.spec.js`
- 仕様の出所: `GET /operations/activity-logs` の `operation` / `sort` / `target_types` クエリと
  `ActivityLogItem.操作区分` の説明（enum ではなく string なので `apiEnums.js` ではなくここに置く）

画面モックの「操作区分」（業務操作 / マスタ更新 / 運用管理）は実 API に無く、対象種別から導く**区分（category）**
として持つ。実 API の `操作区分`（CREATE / UPDATE …）はモックの「操作内容」にあたる（operation）。
運用管理に属する対象種別コード（`OPERATION_TARGET_TYPES`）は実 API の `/operations/activity-logs/targets` の値。

期待する表示名は `ACTIVITY_OPERATION_OPTIONS` / `ACTIVITY_CATEGORY_OPTIONS` から導き、テストに文字列を直接書かない。
空値の表現は他の列とそろえて `—`（em dash）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALU-01 | 選択肢に定義された全操作区分（実 API の 9 種） | `operationLabel(value)` | 選択肢の表示名が返る。選択肢は CREATE / UPDATE / DELETE / BATCH / SUSPEND / RESUME / SHOW / HIDE / VWAP_BULK の順 | 実装済 |
| ALU-02 | 選択肢に無い値（`'PURGE'`） | 同上 | 値がそのまま返る（区分が増えても行が読める） | 実装済 |
| ALU-03 | `'CREATE'` / `'UPDATE'` / `'DELETE'` | `operationBadgeVariant(value)` | それぞれ `success` / `info` / `warning` | 実装済 |
| ALU-04 | `'BATCH'` / 運用系（SUSPEND / RESUME / SHOW / HIDE / VWAP_BULK）/ 未知の値 / 空文字 | 同上 | いずれも `gray` | 実装済 |
| ALU-06 | `''` / `'asc'` / `'desc'` / `'ASC'` / `undefined` | `isActivitySort(value)` | `''` と `'asc'` だけ true（既定の新しい順は空文字で表す） | 実装済 |
| ALU-07 | ISO8601 の日時（`YYYY-MM-DDTHH:MM:SS`） | `formatActivityAt(value)` | `YYYY/MM/DD HH:MM:SS`（年から秒まで・ゼロ埋め） | 実装済 |
| ALU-08 | 空文字 / `null` / `undefined` / 日時として読めない文字列 | 同上 | いずれも `—` | 実装済 |
| ALU-09 | `null` / `undefined` / 空文字 | `formatActivityValue(value)` | いずれも `—` | 実装済 |
| ALU-10 | object / 配列 | 同上 | JSON 文字列になる | 実装済 |
| ALU-11 | 文字列 / 数値（`0` を含む）/ 真偽値（`false` を含む） | 同上 | `String()` した値になる（`0` と `false` を `—` にしない） | 実装済 |
| ALU-12 | `OPERATION_TARGET_TYPES` の各コード / マスタのコード / 未知のコード / 空文字 | `categoryOf(code)` | 運用管理の 2 種は `operation`、それ以外（未知も）は `master` | 実装済 |
| ALU-13 | `'master'` / `'operation'` / 未知の区分 | `categoryLabel(value)` と `categoryBadgeVariant(value)` | 表示名は選択肢どおり（未知はそのまま）。色は マスタ更新 `success` / 運用管理 `gray` / 未知 `info` | 実装済 |
| ALU-14 | 選択肢の値 / `'business'` / `''` / `'MASTER'` / `undefined` | `isActivityCategory(value)` | 選択肢の 2 値だけ true（業務操作は実 API に無いので通さない） | 実装済 |
| ALU-15 | 区分と対象機能の組と、対象種別の一覧 | `targetTypesFor({ category, targetType, targets })` | 対象機能があればそれだけ。運用管理は固定の 2 種（一覧が無くても可）。マスタ更新は一覧のうち運用管理でないもの全部で、一覧が無ければ空。どちらも無ければ空 | 実装済 |
