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
境界での切り替えは [composables-use-market-status.md](composables-use-market-status.md) が持つ
（通信は起動時の 1 回だけで、以後はセッションの境界に達したら通信せずに切り替える）。

市場ステータスはモック 08986d1 に合わせたバッジ 1 個（丸印・ラベル・JST 側・ET 側）で、
配色は外側の `data-status` ごとに変わる。基準日・3 セッション・短縮取引の理由は `title` にだけ出す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| AHD-01 | ルートの `meta.title` が「注文一覧」 | マウントする | 見出しに「注文一覧」が出る | 実装済 |
| AHD-02 | 「注文一覧」のルートでマウント済 | `meta.title` が「ページが見つかりません」のルートへ遷移 | 見出しが「ページが見つかりません」に変わる | 実装済 |
| AHD-03 | ストアに通常営業日の応答が入り、現在時刻がレギュラーの窓の中 | マウントする | バッジの `data-status` が `regular`、ラベルが「Regular」、JST 側が「日本時間 23:30–翌06:00（冬時間）」、ET 側が「ET 09:30–16:00」 | 実装済 |
| AHD-04 | AHD-03 の状態 | レギュラーの終了時刻まで時間を進める | 通信せずに（`load` は呼ばれない）「After-Hours」と「日本時間 翌06:00–翌10:00（冬時間）」「ET 16:00–20:00」に切り替わる | 実装済 |
| AHD-05 | 任意 | マウントする | 画面固有ボタンの差し込み先が空の状態で描画される | 実装済 |
| AHD-06 | マウント済 | アンマウントする | 境界のタイマーが残らない | 実装済 |
| AHD-07 | `sidebarOpen` が true | マウントする | メニューボタンが展開中（`aria-expanded="true"`）で、サイドメニューと関連付いている（`aria-controls="app-sidebar"`） | 実装済 |
| AHD-08 | `sidebarOpen` が false | マウントする | メニューボタンが折りたたみ中（`aria-expanded="false"`）になる | 実装済 |
| AHD-09 | 任意 | メニューボタンを click | `toggle-sidebar` が 1 回通知される（自分では開閉状態を変えない） | 実装済 |
| AHD-10 | ストアに休場（理由あり）の応答が入っている | マウントする | `data-status` が `holiday`、ラベルが「Closed」、JST 側が「休場（感謝祭）」、ET 側が「ET Market Holiday」 | 実装済 |
| AHD-11 | ストアが未取得（起動直後） | マウントする | ラベルが「—」、`data-status` が `unknown`。JST 側・ET 側は描画されない（推定を出さない） | 実装済 |
| AHD-12 | ストアが取得に失敗している（`status` は null） | マウントする | 「—」と、JST 側に「市場状況を取得できません」が出る。ヘッダの見出しとメニューボタンは通常どおり使える | 実装済 |
| AHD-13 | AHD-03 の状態 | バッジの `title` を見る | 基準日とサマータイムの別、3 セッションの日本語名・JST・ET が新しい表記（`23:30–翌06:00`）で並ぶ | 実装済 |
| AHD-14 | 短縮取引日の応答が入っている | マウントする | `title` に「短縮取引: 感謝祭翌日」が入り、バッジの中には出ない（モックに目印が無い）。通常営業日の `title` には入らない | 実装済 |
