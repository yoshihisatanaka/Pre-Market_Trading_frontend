# components/layout/AppSidebar（共通サイドメニュー）

- 略号: `ASB`
- 対象: `src/components/layout/AppSidebar.vue`
- テスト: `src/components/layout/AppSidebar.spec.js`
- 項目定義: `src/components/layout/navigation.js`
- 開閉状態の所有者: [components-layout-app-layout.md](components-layout-app-layout.md)
- E2E 側のシナリオ: [docs/e2e/layout.md](../e2e/layout.md)

開閉は押し出し式（閉じると画面外へ出て本文が全幅になる）で、状態は `AppLayout` が持ち
`open` prop で降りてくる。既定は `true`（展開）なので、props を渡さないマウントは従来どおり展開状態。
畳んだときは中のリンクを操作対象から外す（`inert`）。

権限の要る区分（`navigation.js` の `requiredPermission`。いまは「運用管理」の `operation`）は
`useCurrentOperatorStore()`（`GET /auth/me`）の結果で出し分け、読み終える前と読めなかったときは出さない。
そのためテストは Pinia を用意し、ASB-01〜06 は既定モック（全権限ありの supervisorOperator）で
`ensureLoaded()` を済ませてからマウントする。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ASB-01 | ルートが `/` | マウントする | 「米株発注システム」、見出し 顧客 / 注文 / マスタメンテ / 運用管理 の順、リンク 20 件が `navigation.js` の順序・ラベル・リンク先で並ぶ | 実装済 |
| ASB-02 | ルートが `/` | マウントする | どのリンクも現在ページ（`aria-current="page"`）にならない | 実装済 |
| ASB-03 | ルートが `/customers/search` | マウントする | 「顧客検索」だけが現在ページになり、他の 19 件はならない | 実装済 |
| ASB-04 | ルートが `/` | 「顧客検索」を click | ルートが `/customers/search` に変わる | 実装済 |
| ASB-05 | `open` を省略 | マウントする | 展開状態で描画され、リンクが操作対象のまま（`inert` が付かない） | 実装済 |
| ASB-06 | `open` が false | マウントする | 折りたたみ状態で描画され、中のリンクが操作対象から外れる | 実装済 |
| ASB-07 | `/auth/me` が運用管理権限の無い利用者（`noOperationOperator`）を返し、読み終えている | マウントする | 見出し「運用管理」とその 4 リンクが出ず、顧客 / 注文 / マスタメンテ の 3 区分 16 リンクが定義順に出る | 実装済 |
| ASB-08 | `/auth/me` の応答がまだ返っていない | マウントする | 見出し「運用管理」が出ず、リンクは 16 件 | 実装済 |
| ASB-09 | `/auth/me` が 500 を返し、読み終えている | マウントする | 見出し「運用管理」が出ず、リンクは 16 件 | 実装済 |
