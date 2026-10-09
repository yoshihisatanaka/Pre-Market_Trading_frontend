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

区分は見出しのボタンでアコーディオン開閉する（2026-10-02）。初期値は `navigation.js` の `defaultOpen`
（顧客 / 注文・照会 は開、マスタメンテ / 運用管理 は閉）で、**現在のページを含む区分は既定に関わらず開く**。
畳んだ区分のリンクは `v-show` で隠すだけで DOM には残るので、ASB-01〜11 のリンク件数・順序の検証はそのまま成り立つ。
開閉は見出しボタンの `aria-expanded` と、それが `aria-controls` で指す入れ物の `display`（`v-show`）で見る
（jsdom 上の `isVisible()` は閉じ直した後の `display: none` を拾わなかった）。

遷移の確定待ちの行き先は `pendingPath` prop で降りてくる（所有者は `AppLayout`。出どころは
[composables-use-route-loading.md](composables-use-route-loading.md)）。一致する項目を読み込み中の見た目にし、
回転マークは読み上げ対象から外す（読み上げは `AppLayout` のバーに任せ、リンク名をラベルだけに保つ）。
項目にマウスが乗った / フォーカスした時点で行き先のチャンクを先読みする。遷移はしない（ASB-17〜20）。
先読みの検証は、ルートの `component` を呼ばれたことが判るローダにして行う。

項目の件数（`navigation.js` の `badge`。注文照会 = 注文エラー、Dream登録状況 = Dream登録エラー）は
`useNavBadgesStore()`（[stores-nav-badges.md](stores-nav-badges.md)）から読み、1 件以上の項目にだけ数字を出す（ASB-21〜25）。
数字は `aria-hidden` で、リンク名（ラベル）に混ぜない。読み上げは `hidden` の「〈badge.label〉 N 件」を `aria-describedby` で指す。
件数は**ルートの path が変わるたびに**取り直し、クエリだけの変化では取り直さない。
件数が載るとリンクの `text()` が揺れるので、テストは `beforeEach` で 2 本の件数 API（`GET /orders` / `GET /orders/dream-status`）を
`total: 0` で返し、ASB-01〜20 は件数なしで検証する。件数を出す行は、その中で応答を上書きする。
リンク名は「`aria-hidden` と `hidden` の子を除いた文字列」で見る（jsdom は accessible name を計算しないため）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ASB-01 | ルートが `/` | マウントする | 「米株発注システム」、見出し 顧客 / 注文・照会 / マスタメンテ / 運用管理 の順、リンク 20 件が `navigation.js` の順序・ラベル・リンク先で並ぶ | 実装済 |
| ASB-02 | ルートが `/` | マウントする | どのリンクも現在ページ（`aria-current="page"`）にならない | 実装済 |
| ASB-03 | ルートが `/customers/search` | マウントする | 「顧客検索」だけが現在ページになり、他の 19 件はならない | 実装済 |
| ASB-04 | ルートが `/` | 「顧客検索」を click | ルートが `/customers/search` に変わる | 実装済 |
| ASB-05 | `open` を省略 | マウントする | 展開状態で描画され、リンクが操作対象のまま（`inert` が付かない） | 実装済 |
| ASB-06 | `open` が false | マウントする | 折りたたみ状態で描画され、中のリンクが操作対象から外れる | 実装済 |
| ASB-07 | `/auth/me` が operation だけ無い利用者を返し、読み終えている | マウントする | 見出し「運用管理」とその配下のリンクが出ず、顧客 / 注文・照会 / マスタメンテ の 3 区分が定義順に出る | 実装済 |
| ASB-08 | `/auth/me` の応答がまだ返っていない | マウントする | 権限の要る区分（マスタメンテ・運用管理）が見出しごと出ず、顧客 / 注文・照会 の区分だけが出る（未取得は権限なし） | 実装済 |
| ASB-09 | `/auth/me` が 500 を返し、読み終えている | マウントする | 権限の要る区分（マスタメンテ・運用管理）が見出しごと出ず、顧客 / 注文・照会 の区分だけが出る（取得失敗は権限なし） | 実装済 |
| ASB-10 | `/auth/me` が master だけ無い利用者を返し、読み終えている | マウントする | 見出し「マスタメンテ」とその配下のリンクが出ず、顧客 / 注文・照会 / 運用管理 の 3 区分が定義順に出る | 実装済 |
| ASB-11 | 操作者を読み込む前にマウント済み（権限の要る区分が出ていない） | 読み込み（全権限あり）が終わるのを待つ | マスタメンテと運用管理の見出しと配下のリンクが現れ、全区分が定義順に並ぶ（読み込みの完了に追従する） | 実装済 |
| ASB-12 | ルートが `/`（どの区分にも属さない） | マウントする | 顧客 / 注文・照会 の見出しボタンが `aria-expanded="true"` で配下のリンクが見え、マスタメンテ / 運用管理 は `aria-expanded="false"` で配下のリンクが見えない | 実装済 |
| ASB-13 | ASB-12 の状態 | 「マスタメンテ」の見出しボタンを click し、もう一度 click | 1 回目で `aria-expanded="true"` になり配下のリンクが見える。2 回目で閉じて見えなくなる。他の区分の開閉は変わらない | 実装済 |
| ASB-14 | ASB-12 の状態 | 「顧客」の見出しボタンを click | 「顧客」が `aria-expanded="false"` になり、顧客検索 / 預り検索 が見えなくなる | 実装済 |
| ASB-15 | ルートが `/masters/symbols` | マウントする | 既定で閉じる「マスタメンテ」が開いて「銘柄マスタ」が見え、「運用管理」は閉じたまま | 実装済 |
| ASB-16 | ルートが `/` でマウント済み | `/operations/incidents/1` へ遷移する | 「運用管理」が開く（配下のページへの遷移にも追従する）。「マスタメンテ」は閉じたまま | 実装済 |
| ASB-17 | ルートが `/` / `pendingPath` が `/customers/search` | マウントする | 「顧客検索」だけが読み込み中の見た目（`is-pending`）になり、読み上げ対象外の回転マークが付く。他のリンクにはどちらも付かない。「顧客検索」のリンク名はラベルのまま | 実装済 |
| ASB-18 | ルートが `/` / `pendingPath` を省略 | マウントする | どのリンクも読み込み中の見た目にならず、回転マークも付かない | 実装済 |
| ASB-19 | ルートが `/` / `/customers/search` と `/orders/inquiry` が遅延ルート | 「顧客検索」にマウスを載せ、「注文照会」にフォーカスする | それぞれの画面の読み込みが始まる。ルートは `/` のまま（遷移しない） | 実装済 |
| ASB-20 | ASB-19 の後、読み込みが終わっている | 「顧客検索」にもう一度マウスを載せる | 読み込みは始まらない（取得済みのものを取り直さない） | 実装済 |
| ASB-21 | ルートが `/` / 注文エラーと Dream登録エラーの件数 API がそれぞれ 1 以上の `total` を返す | マウントする | 「注文照会」と「Dream登録状況」のリンクの中にだけそれぞれの件数の数字が出る。ほかのリンクには出ない | 実装済 |
| ASB-22 | ASB-21 と同じ | マウントする | 数字は `aria-hidden="true"`。リンク名（`aria-hidden` / `hidden` を除いた文字列）はラベルのままで、リンクの `aria-label` もラベル（隠れた要素も数える名前の計算でもラベルのままにする）。リンクの `aria-describedby` が `hidden` の要素を指し、その文が「注文エラー N 件」/「Dream登録エラー N 件」 | 実装済 |
| ASB-23 | ルートが `/` / 2 本の件数 API が `total: 0` | マウントする | どのリンクにも数字が出ず、`aria-describedby` も `aria-label` も付かない | 実装済 |
| ASB-24 | ルートが `/` / 2 本の件数 API が 500 | マウントする | どのリンクにも数字が出ず、`aria-describedby` も付かない（取得失敗は未取得と同じ扱い） | 実装済 |
| ASB-25 | ルートが `/` でマウント済み（件数を取得済み） | 別の path へ遷移し、続けて同じ path のままクエリだけを変える | path の遷移で 2 本の件数 API がもう一度呼ばれる。クエリだけの変化では呼ばれない | 実装済 |
