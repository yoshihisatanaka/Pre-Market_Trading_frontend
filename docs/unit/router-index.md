# router/index（ルート定義）

- 略号: `RTR`
- 対象: `src/router/index.js`
- テスト: `src/router/index.spec.js`
- ガードの挙動: [router-permission-guard.md](router-permission-guard.md)（`permissionGuard`）
- メニュー側の出し分け: [components-layout-app-sidebar.md](components-layout-app-sidebar.md)

export された `routes`（ルート定義の配列）の `meta.requiredPermission` の付け方を検査する。
**権限の有無で forbidden へ回すかどうか（ガードの挙動）は PMG が見るので、ここでは重複させない。**
運用管理の 4 ルートが `'operation'` を持ち、パスが `navigation.js` の運用管理区分と一致することも
PMG-05 が見ている。

守るのは次の 2 つ。

- **マスタメンテ（`/masters/*`）は全画面 `requiredPermission: 'master'`**（2026-09-28 決定）。
  新しいマスタ画面を足したときの付け忘れを検出する
- **メニューの区分とルートの meta がそろっている。** メニューを隠すだけでは URL の直打ちで開けてしまい、
  ルートだけに付けるとメニューから辿れない制限になる（どちらか片方の付け忘れを検出する）

`navigation.js` の項目のうちルートの無いもの（未実装の画面）は NotFound に落ちるだけなので、
区分との一致の検査からは外す（2026-10-02 に預り検索 `/customers/holdings` が入り、いまは該当なし）。

顧客検索（`/customers/search`）と、そこから入る顧客詳細（`/customers/:customerId(\d+)`。子に `summary` /
`orders`、空パスは `summary` へ redirect）は 2026-10-01 に、預り検索（`/customers/holdings`）は 2026-10-02 に入った。
いずれも権限を要求しない（RTR-04 / RTR-06）。
顧客詳細はメニューに載らないので RTR-04 の走査には入らず、RTR-06 で別に見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| RTR-01 | — | `routes` のうち path が `/masters/` で始まるルートを走査する | 1 件以上あり、すべてが `meta.requiredPermission === 'master'` を持つ | 実装済 |
| RTR-02 | — | `routes` のうち `requiredPermission: 'master'` のルートを走査する | すべて path が `/masters/` で始まる（マスタ以外の画面にマスタ権限を付けない） | 実装済 |
| RTR-03 | — | `navigation.js` の `requiredPermission` を持つ各区分（マスタメンテ・運用管理）について、項目のリンク先のルートを引く | ルートのある項目はすべて区分と同じ `requiredPermission` を持つ。逆にその権限を要求するルートの集合は、区分に載ったルートの集合と一致する | 実装済 |
| RTR-04 | — | `requiredPermission` を持たない区分（顧客・注文）の項目のリンク先のルートを引く | ルートのある項目（みずほ注文締など）は `requiredPermission` を持たない | 実装済 |
| RTR-05 | — | `routes` から `forbidden` と NotFound（`/:pathMatch(.*)*`）を引く | どちらも存在し、`requiredPermission` を持たない（回し先が自分を弾いて回り続けない） | 実装済 |
| RTR-06 | — | `routes` から顧客詳細（`/customers/:customerId(\d+)`）を引き、子ルートと空パスの redirect を見る | 親と子（`summary` / `orders` / `order-entry`）のどれも `requiredPermission` を持たない。空パスの子は同じ `customerId` のまま `customer-summary` へ回す | 実装済 |
| RTR-07 | — | `routes` から `/orders/new` を引き、`beforeEnter` にクエリなし・部店だけ・部店と口座番号を渡す | 口座番号（`account_number`）が無ければ `customer-search` へ回し、あれば `true`（通す）を返す（モックの「顧客の指定が無ければ顧客検索へ」と同じ） | 実装済 |
