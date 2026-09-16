# components/layout/AppHeader（共通ヘッダ）

- 略号: `AHD`
- 対象: `src/components/layout/AppHeader.vue`
- テスト: `src/components/layout/AppHeader.spec.js`
- 開閉状態の所有者: [components-layout-app-layout.md](components-layout-app-layout.md)
- E2E 側のシナリオ: [docs/e2e/layout.md](../e2e/layout.md)

画面タイトルは view ではなくヘッダが `router` の `meta.title` から描画する。
市場ステータスは `utils/marketStatus`（[docs/unit/utils-market-status.md](utils-market-status.md)）の判定を 1 分ごとに反映する。

左端のメニューボタンはサイドメニューの開閉操作。**ヘッダは開閉状態を持たず**、`sidebarOpen` prop を
表示に映して `toggle-sidebar` を通知するだけ。押し出し式で畳むとサイドメニューは画面外に出るため、
ボタンは常に見えているヘッダ側に置く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| AHD-01 | ルートの `meta.title` が「注文一覧」 | マウントする | 見出しに「注文一覧」が出る | 実装済 |
| AHD-02 | 「注文一覧」のルートでマウント済 | `meta.title` が「ページが見つかりません」のルートへ遷移 | 見出しが「ページが見つかりません」に変わる | 実装済 |
| AHD-03 | システム時刻が `2026-03-02T14:30:00Z`（NY 09:30） | マウントする | 市場ステータスに「● Regular」が出る | 実装済 |
| AHD-04 | システム時刻が `2026-03-02T20:59:00Z`（NY 15:59）でマウント済 | 60 秒経過する | 市場ステータスが「● After-Hours」に更新される | 実装済 |
| AHD-05 | 任意 | マウントする | 画面固有ボタンの差し込み先が空の状態で描画される | 実装済 |
| AHD-06 | マウント済 | アンマウントする | 定期更新のタイマーが残らない | 実装済 |
| AHD-07 | `sidebarOpen` が true | マウントする | メニューボタンが展開中（`aria-expanded="true"`）で、サイドメニューと関連付いている（`aria-controls="app-sidebar"`） | 実装済 |
| AHD-08 | `sidebarOpen` が false | マウントする | メニューボタンが折りたたみ中（`aria-expanded="false"`）になる | 実装済 |
| AHD-09 | 任意 | メニューボタンを click | `toggle-sidebar` が 1 回通知される（自分では開閉状態を変えない） | 実装済 |
