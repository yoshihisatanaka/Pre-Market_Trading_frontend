# views/ForbiddenView（権限なしの画面）

- 略号: `FBV`
- 対象: `src/views/ForbiddenView.vue`
- テスト: `src/views/ForbiddenView.spec.js`
- E2E 側のシナリオ: [docs/e2e/access-control.md](../e2e/access-control.md)

permissionGuard が回してくる行き先。一覧を持たない固定の画面なので 4 状態は無く、
`/auth/me` が読めなかった（権限なしに倒した）ときだけ文言を出し分ける。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FBV-01 | `useCurrentOperatorStore` の `error` が無い | マウントする | `forbidden-message` に「この画面を開く権限がありません。」が出て、`/` へのリンク「注文一覧へ戻る」がある。`forbidden-check-failed` は出ない | 実装済 |
| FBV-02 | `/auth/me` が 500 で `ensureLoaded()` を終えている | マウントする | `forbidden-check-failed` に「権限を確認できませんでした（<理由>）。時間をおいて開き直してください。」が出て、`forbidden-message` は出ない | 実装済 |
