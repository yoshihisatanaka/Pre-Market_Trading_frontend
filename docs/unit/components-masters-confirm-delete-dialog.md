# components/masters/ConfirmDeleteDialog（削除確認ダイアログ）

- 略号: `CDD`
- 対象: `src/components/masters/ConfirmDeleteDialog.vue`
- テスト: `src/components/masters/ConfirmDeleteDialog.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CDD-01 | `open: false` | マウントする | ダイアログが描画されない | 実装済 |
| CDD-02 | `open: true` | マウントする | タイトル「削除確認」が `role="dialog"` の中に出る | 実装済 |
| CDD-03 | `label: '2026-01-01'` | マウントする | 本文に「2026-01-01 を削除しますか？」が出る | 実装済 |
| CDD-04 | `open: true` | マウントする | 「この操作は元に戻せません。」の注意書きが出る | 実装済 |
| CDD-05 | `testidPrefix="market-holidays"` | マウントする | `market-holidays-delete-cancel` と `market-holidays-delete-submit` が出る | 実装済 |
| CDD-06 | `error` あり | マウントする | `{prefix}-delete-error` に `error.message` が出る | 実装済 |
| CDD-07 | `error` を渡さない | マウントする | `{prefix}-delete-error` は出ない | 実装済 |
| CDD-08 | `pending: false` | マウントする | 送信ボタンの文言が「削除する」で、両ボタンが押せる | 実装済 |
| CDD-09 | `pending: true` | マウントする | 送信ボタンの文言が「削除中…」になる | 実装済 |
| CDD-10 | `pending: true` | マウントする | キャンセルボタンも削除ボタンも無効になる | 実装済 |
| CDD-11 | `pending: false` | 「削除する」をクリックする | `confirm` が 1 回発火する | 実装済 |
| CDD-12 | `pending: false` | 「キャンセル」をクリックする | `close` が 1 回発火する | 実装済 |
| CDD-13 | `open: true` | マウントする | 削除ボタンが危険色（`base-button--danger`）で出る | 実装済 |
