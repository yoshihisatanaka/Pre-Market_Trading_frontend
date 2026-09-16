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

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALY-01 | 保存値なし / 幅 1280 | マウントする | サイドメニューが開いた状態で描画され、slot の中身が表示される | 実装済 |
| ALY-02 | 保存値なし / 幅 900 | マウントする | サイドメニューが閉じた状態で描画される | 実装済 |
| ALY-03 | 幅 1280 でマウント済 | メニューボタンを click | サイドメニューが閉じた状態に変わる | 実装済 |
| ALY-04 | 幅 1280・閉じる操作の後 | 破棄してもう一度マウントする | 閉じた状態のまま描画される | 実装済 |
