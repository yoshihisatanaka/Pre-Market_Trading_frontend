# utils/activityLogTypes（操作ログの区分と表示整形）

- 略号: `ALU`
- 対象: `src/utils/activityLogTypes.js`
- テスト: `src/utils/activityLogTypes.spec.js`
- 仕様の出所: `GET /operations/activity-logs` の `operation` / `sort` / `target_types` クエリと
  `ActivityLogItem.操作区分` の説明（enum ではなく string なので `apiEnums.js` ではなくここに置く）

画面モックの「操作区分」（業務操作 / マスタ更新 / 運用管理）は実 API の `区分`（2026-10-06 の回答 #38）で、
**区分（category）**として持つ。区分は仕様で必須ではないので、応答に無いときだけ対象種別から導く（`resolveCategory`）。
実 API の `操作区分`（CREATE / UPDATE …）はモックの「操作内容」にあたる（operation）。
業務操作 / 運用管理に属する対象種別コード（`BUSINESS_TARGET_TYPES` / `OPERATION_TARGET_TYPES`）は区分が無い応答と、
対象種別の一覧が無いときの代わり。実行者区分（`actor_group`）の選択肢は `ACTIVITY_ACTOR_GROUP_OPTIONS`。

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
| ALU-12 | `BUSINESS_TARGET_TYPES` / `OPERATION_TARGET_TYPES` の各コード / マスタのコード / 未知のコード / 空文字 | `categoryOf(code)` | 業務操作のコードは `business`、運用管理の 2 種は `operation`、それ以外（未知も）は `master` | 実装済 |
| ALU-13 | `'business'` / `'master'` / `'operation'` / 未知の区分 | `categoryLabel(value)` と `categoryBadgeVariant(value)` | 表示名は選択肢どおり（未知はそのまま）。色は 業務操作 `info` / マスタ更新 `success` / 運用管理 `gray` / 未知 `info` | 実装済 |
| ALU-14 | 選択肢の値 / `''` / `'MASTER'` / `'BUSINESS'` / `undefined` | `isActivityCategory(value)` | 選択肢の 3 値（業務操作 / マスタ更新 / 運用管理）だけ true | 実装済 |
| ALU-15 | 区分と対象機能の組と、区分を持たない対象種別の一覧 | `targetTypesFor({ category, targetType, targets })` | 対象機能があればそれだけ。区分だけなら一覧のうち対象種別から導いた区分が一致するもの全部。一覧が無いとき業務操作は `BUSINESS_TARGET_TYPES`、運用管理は `OPERATION_TARGET_TYPES`、マスタ更新は空。どちらも無ければ空 | 実装済 |
| ALU-16 | 応答の区分あり / 空文字（対象種別は業務・運用・マスタ） | `resolveCategory(category, targetType)` | 区分があればそれを返す（対象種別から導く値と違っても応答が正）。空なら対象種別から導いた区分 | 実装済 |
| ALU-17 | 選択肢の値 / `''` / `'sales'` / `'MANAGER'` / `undefined` | `isActivityActorGroup(value)` | 選択肢の 2 値（`sales_ifa` / `manager`）だけ true | 実装済 |
| ALU-18 | 区分を持つ対象種別の一覧（コードからは運用管理と導けない対象種別に `区分: 'operation'`） | `targetTypesFor({ category: 'operation', targets })` | 応答の区分で絞る（コードから導く値ではなく区分を正とする）。一覧にその区分が 1 件も無いときは固定の並びに落とす | 実装済 |
