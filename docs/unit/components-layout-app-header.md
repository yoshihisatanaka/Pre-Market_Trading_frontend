# components/layout/AppHeader（共通ヘッダ）

- 略号: `AHD`
- 対象: `src/components/layout/AppHeader.vue`
- テスト: `src/components/layout/AppHeader.spec.js`
- 開閉状態の所有者: [components-layout-app-layout.md](components-layout-app-layout.md)
- E2E 側のシナリオ: [docs/e2e/layout.md](../e2e/layout.md)

画面タイトルは view ではなくヘッダが `router` の `meta.title` から描画する。

市場ステータスと取引時間帯は **`GET /market-status` の応答**が出どころ
（[stores-market-status.md](stores-market-status.md) → [utils-market-status.md](utils-market-status.md)）。
ヘッダ自身は通信しない。**ローカルの時刻からセッションを推定しない**ので、取れていなければ
「—」を出す（祝日を知らない推定を、実データと区別できない見た目で出さない）。
時計と再取得は [composables-use-market-status.md](composables-use-market-status.md) が持つ。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| AHD-01 | ルートの `meta.title` が「注文一覧」 | マウントする | 見出しに「注文一覧」が出る | 実装済 |
| AHD-02 | 「注文一覧」のルートでマウント済 | `meta.title` が「ページが見つかりません」のルートへ遷移 | 見出しが「ページが見つかりません」に変わる | 実装済 |
| AHD-03 | ストアに通常営業日の応答が入り、現在時刻がレギュラーの窓の中 | マウントする | 市場ステータスに「● Regular」が出て、時間帯グリッドのレギュラーの列が現在の列になる | 実装済 |
| AHD-04 | AHD-03 の状態。以後の再取得では休場が返る | 5 分経過する | 取り直した内容が表示に反映され、「○ Closed」と休場理由に変わる | 実装済 |
| AHD-05 | 任意 | マウントする | 画面固有ボタンの差し込み先が空の状態で描画される | 実装済 |
| AHD-06 | マウント済 | アンマウントする | 定期更新のタイマーが残らない | 実装済 |
| AHD-07 | `sidebarOpen` が true | マウントする | メニューボタンが展開中（`aria-expanded="true"`）で、サイドメニューと関連付いている（`aria-controls="app-sidebar"`） | 実装済 |
| AHD-08 | `sidebarOpen` が false | マウントする | メニューボタンが折りたたみ中（`aria-expanded="false"`）になる | 実装済 |
| AHD-09 | 任意 | メニューボタンを click | `toggle-sidebar` が 1 回通知される（自分では開閉状態を変えない） | 実装済 |
| AHD-10 | ストアに休場（理由あり）の応答が入っている | マウントする | 「○ Closed」と休場理由が出て、時間帯グリッドは描画されない | 実装済 |
| AHD-11 | ストアが未取得（起動直後） | マウントする | 市場ステータスが「—」で、時間帯グリッドは描画されない（推定を出さない） | 実装済 |
| AHD-12 | ストアが取得に失敗している（`status` は null） | マウントする | 「—」と「市場状況を取得できません」が出る。ヘッダの見出しとメニューボタンは通常どおり使える | 実装済 |
| AHD-13 | AHD-03 の状態 | 市場ステータスの `title` を見る | 基準日とサマータイムの別、3 セッションの日本語名・JST・ET が並ぶ | 実装済 |
| AHD-14 | 短縮取引日の応答が入っている | マウントする | 「短縮取引」の目印が出る（通常営業日では出ない） | 実装済 |
