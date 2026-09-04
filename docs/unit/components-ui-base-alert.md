# components/ui/BaseAlert（帯状の通知）

- 略号: `BAL`
- 対象: `src/components/ui/BaseAlert.vue`
- テスト: `src/components/ui/BaseAlert.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BAL-01 | 既定のまま | マウントする | `data-variant` が `info`、`role` が `status`、slot の内容が出る | 実装済 |
| BAL-02 | `variant="error"` | マウントする | `data-variant` が `error`、`role` が `alert` になる | 実装済 |
| BAL-03 | `variant="warning"` | マウントする | `data-variant` が `warning`、`role` は `status` のまま | 実装済 |
