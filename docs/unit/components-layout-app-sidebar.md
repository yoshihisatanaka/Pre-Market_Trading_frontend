# components/layout/AppSidebar（共通サイドメニュー）

- 略号: `ASB`
- 対象: `src/components/layout/AppSidebar.vue`
- テスト: `src/components/layout/AppSidebar.spec.js`
- 項目定義: `src/components/layout/navigation.js`
- E2E 側のシナリオ: [docs/e2e/layout.md](../e2e/layout.md)

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ASB-01 | ルートが `/` | マウントする | 「米株発注システム」、見出し 顧客 / 注文 / マスタメンテ の順、リンク 14 件が `navigation.js` の順序・ラベル・リンク先で並ぶ | 実装済 |
| ASB-02 | ルートが `/` | マウントする | どのリンクも現在ページ（`aria-current="page"`）にならない | 実装済 |
| ASB-03 | ルートが `/customers/search` | マウントする | 「顧客検索」だけが現在ページになり、他の 13 件はならない | 実装済 |
| ASB-04 | ルートが `/` | 「顧客検索」を click | ルートが `/customers/search` に変わる | 実装済 |
