# api/permissions（権限マスタ API 層）

- 略号: `PMA`
- 対象: `src/api/permissions.js`
- テスト: `src/api/permissions.spec.js`

ここだけが**バックエンドの形**（`/masters/permissions` というパス・日本語キー・権限の 0/1）を
知ってよい層なので、この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。
突き合わせる相手は `docs/api/openapi.json` の `RolePermissionItem` / `RolePermissionUpdateRequest`。

画面は画面モック（2026-10-12）の 8 権限を出す。うち 参照 / 発注（強制） / CSV一括発注 / ユーザ管理 は
仕様に保存先が無い**契約提案**（キーは `参照権限` / `強制発注権限` / `CSV一括発注権限` / `ユーザ管理権限`。
[requests.md](../api/requests.md) #75 / #76 / #81）で、実 API が返さない間は `null`（未対応）と読み、更新でも送らない。
操作ログ閲覧は保存せず、マスタ更新か運用管理から導く。`全店参照権限` は画面に出さないので読まず、送らない。

ストア（[stores-permissions.md](stores-permissions.md)）と画面
（[views-permission-list-view.md](views-permission-list-view.md)）のテストは MSW のモックが返す結果を見ているので、
モックとサーバの理解がずれていても気づけない。本文のキーと値の型はこの層で固定する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| PMA-01 | 既定モック | `fetchPermissions()` を呼ぶ | `GET /api/masters/permissions` を呼ぶ。クエリは付けない（ロールは 4 つ固定で絞り込みもページングも無い） | 実装済 |
| PMA-02 | API が既定フィクスチャの `roles` を返す | `fetchPermissions()` を呼ぶ | 件数と並びがフィクスチャどおりで、日本語キーが camelCase に、権限の `1` / `0` が `true` / `false` に変換される。契約提案の 4 権限も読まれ、操作ログ閲覧はマスタ更新か運用管理から導かれる | 実装済 |
| PMA-03 | API が `説明: null` / `更新日時: null` の行を返す | `fetchPermissions()` を呼ぶ | `description` と `updatedAt` が空文字になる | 実装済 |
| PMA-04 | API が仕様の 3 権限（発注 / マスタ更新 / 運用管理）を欠いた行を返す | `fetchPermissions()` を呼ぶ | 欠けた権限は `false`（持っていない）と読まれる | 実装済 |
| PMA-05 | API が `roles` の無い本文を返す | `fetchPermissions()` を呼ぶ | 空配列が返る。例外にはしない | 実装済 |
| PMA-06 | 既定モック | `updateRolePermission(role, 値)` を呼ぶ（`updatedAt` あり、契約提案の 4 権限も真偽値） | `PUT /api/masters/permissions/{ロールコード}` の本文が `発注権限` / `マスタ更新権限` / `運用管理権限` / `参照権限` / `強制発注権限` / `CSV一括発注権限` / `ユーザ管理権限` / `更新日時` の 8 項目になり、権限は boolean ではなく integer の `0` / `1` で載る。`説明` と `全店参照権限` は送らない | 実装済 |
| PMA-07 | 既定モック | `updatedAt` を空文字で `updateRolePermission()` を呼ぶ | 本文に `更新日時` のキーが無い（照合する合札が無い） | 実装済 |
| PMA-08 | ロールコードに `/` を含む | `updateRolePermission()` を呼ぶ | パスのロールコードが URL エンコードされる（パスの区切りとして解釈されない） | 実装済 |
| PMA-09 | API が `{ role, message }` を返す | `updateRolePermission()` を呼ぶ | 戻り値の `role` が更新後の行のアプリ内モデルに、`message` がサーバの文言になる | 実装済 |
| PMA-10 | 既定モック（存在しないロール） | `updateRolePermission('unknown', 値)` を呼ぶ | `status` 404 の `ApiError` になり、`message` にサーバの `detail` が入る | 実装済 |
| PMA-11 | `VITE_USER_CODE` が設定されている | `updateRolePermission()` を呼ぶ | リクエストに `X-User-Code` ヘッダが載る | 実装済 |
| PMA-12 | API が契約提案の 4 権限を返さない行と、`null` で返す行 | `fetchPermissions()` を呼ぶ | どちらの行も `canReference` / `canForceOrder` / `canCsvOrder` / `canUserManagement` が `null`（未対応）になる。`false` にはしない | 実装済 |
| PMA-13 | マスタ更新 / 運用管理が (0,0) (1,0) (0,1) (1,1) の 4 行 | `fetchPermissions()` を呼ぶ | `canActivityLogView` が `false` / `true` / `true` / `true` になる | 実装済 |
| PMA-14 | 既定モック | 契約提案の 4 権限を `null`、導出値の `canActivityLogView` を `true` にして `updateRolePermission()` を呼ぶ | 本文は `発注権限` / `マスタ更新権限` / `運用管理権限` / `更新日時` の 4 項目だけになる（未対応の項目と導出値を送らない） | 実装済 |
