# components/layout/AppSidebar（共通サイドメニュー）

- 略号: `ASB`
- 対象: `src/components/layout/AppSidebar.vue`
- テスト: `src/components/layout/AppSidebar.spec.js`
- 項目定義: `src/components/layout/navigation.js`
- 開閉状態の所有者: [components-layout-app-layout.md](components-layout-app-layout.md)
- 権限の出どころ: [stores-current-operator.md](stores-current-operator.md)
- E2E 側のシナリオ: [docs/e2e/layout.md](../e2e/layout.md)

開閉は押し出し式（閉じると画面外へ出て本文が全幅になる）で、状態は `AppLayout` が持ち
`open` prop で降りてくる。既定は `true`（展開）なので、props を渡さないマウントは従来どおり展開状態。
畳んだときは中のリンクを操作対象から外す（`inert`）。

権限の要る区分（`navigation.js` の `requiredPermission`。「マスタメンテ」= `master`、「運用管理」= `operation`）は
`useCurrentOperatorStore()`（`GET /auth/me`）の結果で**見出しごと**出し分け、読み終える前と読めなかったときは出さない
（権限の無い人に一瞬見せないため）。そのためテストは Pinia を用意し、ASB-01〜06 は既定モック
（全権限ありの `supervisorOperator`）で `ensureLoaded()` を済ませてからマウントする。
1 つの権限だけが無い利用者は、`supervisorOperator` からその権限だけを外した操作者で作る
（フィクスチャの `salesOperator` / `noOperationOperator` は master と operation の両方を持たず、区分ごとの切り分けにならない）。
期待値は `navigation.js` の `navSections` / `navItems` と `requiredPermission` から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ASB-01 | ルートが `/` | マウントする | 「米株発注システム」、見出し 顧客 / 注文 / マスタメンテ / 運用管理 の順、リンク 20 件が `navigation.js` の順序・ラベル・リンク先で並ぶ | 実装済 |
| ASB-02 | ルートが `/` | マウントする | どのリンクも現在ページ（`aria-current="page"`）にならない | 実装済 |
| ASB-03 | ルートが `/customers/search` | マウントする | 「顧客検索」だけが現在ページになり、他の 19 件はならない | 実装済 |
| ASB-04 | ルートが `/` | 「顧客検索」を click | ルートが `/customers/search` に変わる | 実装済 |
| ASB-05 | `open` を省略 | マウントする | 展開状態で描画され、リンクが操作対象のまま（`inert` が付かない） | 実装済 |
| ASB-06 | `open` が false | マウントする | 折りたたみ状態で描画され、中のリンクが操作対象から外れる | 実装済 |
| ASB-07 | `/auth/me` が operation だけ無い利用者を返し、読み終えている | マウントする | 見出し「運用管理」とその配下のリンクが出ず、顧客 / 注文 / マスタメンテ の 3 区分が定義順に出る | 実装済 |
| ASB-08 | `/auth/me` の応答がまだ返っていない | マウントする | 権限の要る区分（マスタメンテ・運用管理）が見出しごと出ず、顧客 / 注文 の区分だけが出る（未取得は権限なし） | 実装済 |
| ASB-09 | `/auth/me` が 500 を返し、読み終えている | マウントする | 権限の要る区分（マスタメンテ・運用管理）が見出しごと出ず、顧客 / 注文 の区分だけが出る（取得失敗は権限なし） | 実装済 |
| ASB-10 | `/auth/me` が master だけ無い利用者を返し、読み終えている | マウントする | 見出し「マスタメンテ」とその配下のリンクが出ず、顧客 / 注文 / 運用管理 の 3 区分が定義順に出る | 実装済 |
| ASB-11 | 操作者を読み込む前にマウント済み（権限の要る区分が出ていない） | 読み込み（全権限あり）が終わるのを待つ | マスタメンテと運用管理の見出しと配下のリンクが現れ、全区分が定義順に並ぶ（読み込みの完了に追従する） | 実装済 |
