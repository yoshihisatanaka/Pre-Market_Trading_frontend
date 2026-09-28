# router/index（ルート定義と権限のガード）

- 略号: `RTR`
- 対象: `src/router/index.js`
- テスト: `src/router/index.spec.js`
- 権限の出どころ: [stores-current-operator.md](stores-current-operator.md)
- メニュー側の出し分け: [components-layout-app-sidebar.md](components-layout-app-sidebar.md)

`meta.permission` を持つ画面は、その権限を持つ操作者にだけ開かせる。判定は `beforeEach` に登録した
`requirePermission(to)`（export 済み）が行う。メニューを隠すだけでは URL の直打ちで開けてしまうので、
ガードはこちらが持つ。

守るのは 3 つ。

- **マスタメンテ（`/masters/*`）は全画面 `permission: 'master'`**（2026-09-28 決定）。
  付け忘れは `routes` を走査して検出する（RTR-06）
- **操作者の読み込みの完了を待ってから判定する。** 途中で判定すると、権限があるのに一瞬 forbidden へ回される
- **権限なしは `{ name: 'forbidden', replace: true }`**（戻るボタンで権限の無い画面へ戻り、また弾かれるのを避ける）

`requirePermission` は `to.meta` だけを見るので、ルートオブジェクトを模した `{ meta }` を渡して直接呼ぶ。
実 router は `createWebHistory` 固定で差し替えられないため、遷移を通しで見る行（RTR-08）は
export された `routes` と `requirePermission` でテスト用ルータ（`createMemoryHistory`）を組む。
`/auth/me` の既定モックは管理責任者（master あり）で、権限の無い操作者は `salesOperator` を返させる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| RTR-01 | `meta.permission` を持たないルート | `requirePermission` を呼ぶ | `true`（通す）。操作者の読み込みを待たず、`/auth/me` も叩かない | 実装済 |
| RTR-02 | `permission: 'master'`。既定モック（master あり） | `requirePermission` を呼ぶ | `true`（通す） | 実装済 |
| RTR-03 | `permission: 'master'`。`/auth/me` が `salesOperator`（master なし） | `requirePermission` を呼ぶ | `{ name: 'forbidden', replace: true }` が返る | 実装済 |
| RTR-04 | `permission: 'master'`。`/auth/me` が 500 | `requirePermission` を呼ぶ | `{ name: 'forbidden', replace: true }` が返る（取得失敗は権限なし） | 実装済 |
| RTR-05 | `permission: 'master'`。起動時の `load()` が応答待ち（master あり） | `requirePermission` を呼ぶ | 読み込みの完了を待ってから `true` を返す。`/auth/me` は 1 回だけ叩かれる | 実装済 |
| RTR-06 | — | `routes` のうち path が `/masters/` で始まるルートを走査する | 1 件以上あり、すべてが `meta.permission === 'master'` を持つ | 実装済 |
| RTR-07 | — | `routes` から `forbidden` を引く | path `/forbidden` のルートがあり、`meta.permission` を持たない（回し先が自分自身を弾いて無限に回らない） | 実装済 |
| RTR-08 | `routes` + `requirePermission` のテスト用ルータ。`/auth/me` が `salesOperator` | `/masters/customers` へ push する | 行き着いたルートが `forbidden`（`/forbidden`）になる | 実装済 |
