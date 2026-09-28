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

`permission` を持つ区分（いまは「マスタメンテ」= `master`）は、ログイン中の操作者
（`stores/currentOperator`。[stores-current-operator.md](stores-current-operator.md)）がその権限を持つときだけ
**見出しごと**出す。未取得・取得失敗のあいだも出さない（権限の無い人に一瞬見せないため）。
ASB-01〜06 は既定モック（`/auth/me` が管理責任者 = master あり）を読み込んだ状態でマウントする。
期待値は `navigation.js` の `navSections` / `navItems` と `permission` から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ASB-01 | ルートが `/`。操作者（master あり）を読み込み済み | マウントする | 「米株発注システム」、見出し 顧客 / 注文 / マスタメンテ / 運用管理 の順、リンク 20 件が `navigation.js` の順序・ラベル・リンク先で並ぶ | 実装済 |
| ASB-02 | ルートが `/` | マウントする | どのリンクも現在ページ（`aria-current="page"`）にならない | 実装済 |
| ASB-03 | ルートが `/customers/search` | マウントする | 「顧客検索」だけが現在ページになり、他の 19 件はならない | 実装済 |
| ASB-04 | ルートが `/` | 「顧客検索」を click | ルートが `/customers/search` に変わる | 実装済 |
| ASB-05 | `open` を省略 | マウントする | 展開状態で描画され、リンクが操作対象のまま（`inert` が付かない） | 実装済 |
| ASB-06 | `open` が false | マウントする | 折りたたみ状態で描画され、中のリンクが操作対象から外れる | 実装済 |
| ASB-07 | `/auth/me` が営業員（`salesOperator`。master なし）を返し、読み込み済み | マウントする | 「マスタメンテ」の見出しもその配下のリンクも出ない。ほかの区分（顧客 / 注文 / 運用管理）は見出しとリンクがそのまま並ぶ | 実装済 |
| ASB-08 | 操作者をまだ読み込んでいない | マウントする | 「マスタメンテ」の見出しと配下のリンクが出ない（未取得は権限なし） | 実装済 |
| ASB-09 | `/auth/me` が 500 を返し、読み込みが失敗した | マウントする | 「マスタメンテ」の見出しと配下のリンクが出ない（取得失敗は権限なし） | 実装済 |
| ASB-10 | 操作者を読み込む前にマウント済み（マスタメンテが出ていない） | 読み込み（master あり）が終わるのを待つ | 「マスタメンテ」の見出しと配下のリンクが現れる（読み込みの完了に追従する） | 実装済 |
