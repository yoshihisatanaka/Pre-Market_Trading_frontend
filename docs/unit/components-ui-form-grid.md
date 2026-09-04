# components/ui/FormGrid（フォーム項目の列配置）

- 略号: `FGD`
- 対象: `src/components/ui/FormGrid.vue`
- テスト: `src/components/ui/FormGrid.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FGD-01 | 既定のまま | マウントする | ルートに `form-grid--4` が付く | 実装済 |
| FGD-02 | `columns` に 2 を渡す | マウントする | ルートに `form-grid--2` が付く | 実装済 |
| FGD-03 | slot に要素を 3 つ入れる | マウントする | 3 つがそのまま描画される | 実装済 |
