# components/layout/AppLayout（アプリ全体の骨格）

- 略号: `ALY`
- 対象: `src/components/layout/AppLayout.vue`
- テスト: `src/components/layout/AppLayout.spec.js`
- 開閉状態: [composables-use-sidebar-toggle.md](composables-use-sidebar-toggle.md)
- 部品: [components-layout-app-sidebar.md](components-layout-app-sidebar.md) / [components-layout-app-header.md](components-layout-app-header.md)
- E2E 側のシナリオ: [docs/e2e/layout.md](../e2e/layout.md)

サイドメニューの開閉状態を**唯一所有する**のがここ。`AppSidebar` / `AppHeader` は
props を受け取って描画するだけの部品で、自分では状態を持たない（`BaseModal` と同じ方針）。
ここが検証するのは「状態を作って配り、ヘッダからの通知で反転させ、保存が次回に効く」までの結線。

見た目（画面外へスライドして本文が全幅になること）は jsdom では確かめられないので、
判定は**メニューボタンの `aria-expanded`** で行う。実際の見え方は E2E（LAY-05〜09）で見る。

画面遷移の確定待ち（[composables-use-route-loading.md](composables-use-route-loading.md)）はここが読んで、
ヘッダ上端のバー（読み上げ「画面を読み込んでいます」）と本文の `aria-busy`、押した項目の読み込み中表示
（`AppSidebar` に配る `pending-path`）に変える。テスト用ルータに `trackRouteLoading` を差し、
`/customers/search` を解決を手で止められる遅延ルートにして確定待ちを作る（ALY-05〜07）。
解除条件そのものは composable 側で見るので、ここでは「出る / 消える / 配る」の結線だけを見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALY-01 | 保存値なし / 幅 1280 | マウントする | サイドメニューが開いた状態で描画され、slot の中身が表示される | 実装済 |
| ALY-02 | 保存値なし / 幅 900 | マウントする | サイドメニューが閉じた状態で描画される | 実装済 |
| ALY-03 | 幅 1280 でマウント済 | メニューボタンを click | サイドメニューが閉じた状態に変わる | 実装済 |
| ALY-04 | 幅 1280・閉じる操作の後 | 破棄してもう一度マウントする | 閉じた状態のまま描画される | 実装済 |
| ALY-05 | `/` でマウント済 / `/customers/search` のチャンクが未解決 | `/customers/search` へ遷移する | 読み込み中のバー（`route-loading`）が出て「画面を読み込んでいます」が読め、本文（`main`）が `aria-busy="true"` になる | 実装済 |
| ALY-06 | ALY-05 の状態 | チャンクを解決する | バーが消え、本文の `aria-busy` が外れる | 実装済 |
| ALY-07 | `/` でマウント済 / `/customers/search` のチャンクが未解決 | `/customers/search` へ遷移する | サイドメニューの「顧客検索」が読み込み中の見た目（`is-pending`）になる | 実装済 |
| ALY-08 | バナーストアにお知らせ（`NOTICE`）が入っている | マウントする | 運用バナー（`operation-banner`）がヘッダ（`header`）の後・本文（`main`）の前に描かれ、どちらの中にも入らない | 実装済 |
