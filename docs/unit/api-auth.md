# api/auth（ログイン中の操作者 API 層）

- 略号: `AUA`
- 対象: `src/api/auth.js`
- テスト: `src/api/auth.spec.js`

`GET /auth/me`（`docs/api/openapi.json` の `CurrentOperatorResponse`）の日本語キーと、英語キーの真偽値
（`PermissionFlags`）をアプリ内モデル `CurrentOperator` に畳む層。画面の出し分け（権限マスタの編集可否など）は
この戻り値のロールと権限で決まるので、**欠けた値は「持っていない」側に倒れる**ことを守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| AUA-01 | 既定モック | `fetchCurrentOperator()` を呼ぶ | `GET /api/auth/me` を呼ぶ。クエリは付けない | 実装済 |
| AUA-02 | API が管理責任者（`supervisorOperator`）を返す | `fetchCurrentOperator()` を呼ぶ | 日本語キーが camelCase に、`権限.branch_all` が `permissions.branchAll`、`権限.depositary` が `permissions.depositary` に変換される。`部店コード: null` は空文字になる | 実装済 |
| AUA-03 | API が管理者（`viewerOperator`）を返す | `fetchCurrentOperator()` を呼ぶ | `roleCode` がそのロールコードに、`branchCode` が部店コードになる | 実装済 |
| AUA-04 | API が `権限` の無い本文を返す | `fetchCurrentOperator()` を呼ぶ | 5 つの権限（`order` / `master` / `operation` / `branchAll` / `depositary`）がすべて `false` になる（誤って操作を出さない側に倒す） | 実装済 |
| AUA-05 | API が未登録の操作者（`ロールコード` / `氏名` が null、`登録済: false`）を返す | `fetchCurrentOperator()` を呼ぶ | `roleCode` と `name` が空文字、`registered` が `false` になる | 実装済 |
| AUA-06 | API が 500（`detail` 付き）を返す | `fetchCurrentOperator()` を呼ぶ | `status` 500 の `ApiError` になり、`message` にサーバの `detail` が入る | 実装済 |
| AUA-07 | API が管理責任者（`depositary: true`）/ 営業員（`depositary: false`）/ `権限` に `depositary` キーの無い本文を返す | `fetchCurrentOperator()` を呼ぶ | `permissions.depositary` が `true` / `false` / `false`（欠けたら持っていない側に倒す） | 実装済 |
| AUA-08 | API が営業員（`受注者コード` あり）/ 管理責任者（`受注者コード: null`）/ `受注者コード` の無い本文を返す | `fetchCurrentOperator()` を呼ぶ | `orderTakerCode` がその受注者コード / 空文字 / 空文字（新規注文の受注者の初期値。docs/api/requests.md #51） | 実装済 |
