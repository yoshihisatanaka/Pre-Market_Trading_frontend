# components/ui/BaseBadge（状態チップ）

- 略号: `BBG`
- 対象: `src/components/ui/BaseBadge.vue`
- テスト: `src/components/ui/BaseBadge.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BBG-01 | 既定のまま | マウントする | `data-variant` が `gray`、slot の内容が出る | 実装済 |
| BBG-02 | `variant="buy"` | マウントする | `data-variant` が `buy`、`badge--buy` が付く | 実装済 |
