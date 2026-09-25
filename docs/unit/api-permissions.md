# api/permissions（権限マスタ API 層）

- 略号: `PMA`
- 対象: `src/api/permissions.js`
- テスト: `src/api/permissions.spec.js`

ここだけが**バックエンドの形**（`/masters/permissions` というパス・日本語キー・権限の 0/1）を
知ってよい層なので、この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。
突き合わせる相手は `docs/api/openapi.json` の `RolePermissionItem` / `RolePermissionUpdateRequest`。

ストア（[stores-permissions.md](stores-permissions.md)）と画面
（[views-permission-list-view.md](views-permission-list-view.md)）のテストは MSW のモックが返す結果を見ているので、
モックとサーバの理解がずれていても気づけない。本文のキーと値の型はこの層で固定する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| PMA-01 | 既定モック | `fetchPermissions()` を呼ぶ | `GET /api/masters/permissions` を呼ぶ。クエリは付けない（ロールは 4 つ固定で絞り込みもページングも無い） | 実装済 |
| PMA-02 | API が既定フィクスチャの `roles` を返す | `fetchPermissions()` を呼ぶ | 件数と並びがフィクスチャどおりで、日本語キーが camelCase に、権限の `1` / `0` が `true` / `false` に変換される | 実装済 |
| PMA-03 | API が `説明: null` / `更新日時: null` の行を返す | `fetchPermissions()` を呼ぶ | `description` と `updatedAt` が空文字になる | 実装済 |
| PMA-04 | API が権限の項目を欠いた行を返す | `fetchPermissions()` を呼ぶ | 欠けた権限は `false`（持っていない）と読まれる | 実装済 |
| PMA-05 | API が `roles` の無い本文を返す | `fetchPermissions()` を呼ぶ | 空配列が返る。例外にはしない | 実装済 |
| PMA-06 | 既定モック | `updateRolePermission(role, 値)` を呼ぶ（`updatedAt` あり） | `PUT /api/masters/permissions/{ロールコード}` の本文が `発注権限` / `マスタ更新権限` / `運用管理権限` / `全店参照権限` / `更新日時` の 5 項目になり、権限は boolean ではなく integer の `0` / `1` で載る。`説明` は送らない | 実装済 |
| PMA-07 | 既定モック | `updatedAt` を空文字で `updateRolePermission()` を呼ぶ | 本文に `更新日時` のキーが無い（照合する合札が無い） | 実装済 |
| PMA-08 | ロールコードに `/` を含む | `updateRolePermission()` を呼ぶ | パスのロールコードが URL エンコードされる（パスの区切りとして解釈されない） | 実装済 |
| PMA-09 | API が `{ role, message }` を返す | `updateRolePermission()` を呼ぶ | 戻り値の `role` が更新後の行のアプリ内モデルに、`message` がサーバの文言になる | 実装済 |
| PMA-10 | 既定モック（存在しないロール） | `updateRolePermission('unknown', 値)` を呼ぶ | `status` 404 の `ApiError` になり、`message` にサーバの `detail` が入る | 実装済 |
| PMA-11 | `VITE_USER_CODE` が設定されている | `updateRolePermission()` を呼ぶ | リクエストに `X-User-Code` ヘッダが載る | 実装済 |
