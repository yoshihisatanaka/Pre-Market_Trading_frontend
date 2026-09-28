# router/permissionGuard（権限の要るルートのガード）

- 略号: `PMG`
- 対象: `src/router/permissionGuard.js`
- テスト: `src/router/permissionGuard.spec.js`
- E2E 側のシナリオ: [docs/e2e/access-control.md](../e2e/access-control.md)

`meta.requiredPermission` を持つルートを、その権限の無い利用者に開かせない。
テストはメモリ履歴のテスト用ルータ（`/` / `meta.requiredPermission: 'operation'` の `/ops` /
`name: 'forbidden'` の `/forbidden`）に `beforeEach(permissionGuard)` を差して遷移先を見る。
実ルータ（`router/index.js`）は import して `getRoutes()` の meta だけを確かめる（遷移は E2E の AC が見る）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| PMG-01 | 既定モック | `meta.requiredPermission` の無いルートへ push | そのルートに着き、`/auth/me` へのリクエストは出ない | 実装済 |
| PMG-02 | 既定モック（運用管理権限あり） | `requiredPermission: 'operation'` のルートへ push | そのルートに着く | 実装済 |
| PMG-03 | `/auth/me` が `noOperationOperator` を返す | 同上 | `forbidden` に回る | 実装済 |
| PMG-04 | `/auth/me` が 500 | 同上 | `forbidden` に回る | 実装済 |
| PMG-05 | 実ルータ（`router/index.js`） | `getRoutes()` の meta を見る | `requiredPermission: 'operation'` が付いたルートは 4 つで、パスが `navigation.js` の運用管理区分の 4 項目と一致する | 実装済 |
