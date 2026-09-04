# components/ui/BaseCard（カード）

- 略号: `BCD`
- 対象: `src/components/ui/BaseCard.vue`
- テスト: `src/components/ui/BaseCard.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BCD-01 | `title` を渡す | マウントする | ヘッダ行にタイトルが表示され、slot の内容が本文に出る | 実装済 |
| BCD-02 | `title` も `header-actions` も渡さない | マウントする | ヘッダ行が描画されない | 実装済 |
| BCD-03 | `header-actions` スロットだけ渡す | マウントする | ヘッダ行が描画され、その内容が出る | 実装済 |
| BCD-04 | `flush` を付ける | マウントする | 本文に `is-flush` が付く | 実装済 |
