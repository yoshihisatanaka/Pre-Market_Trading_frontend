# components/masters/MasterFormDialog（マスタ入力ダイアログ）

- 略号: `MFD`
- 対象: `src/components/masters/MasterFormDialog.vue`
- テスト: `src/components/masters/MasterFormDialog.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MFD-01 | `open: false` | マウントする | ダイアログが描画されない | 実装済 |
| MFD-02 | `open: true` で `title` と既定スロットを渡す | マウントする | タイトルとスロットの内容が `role="dialog"` の中に出る | 実装済 |
| MFD-03 | `testidPrefix="blackout-dates"` で `action` を渡さない | マウントする | `blackout-dates-add-form` / `-add-cancel` / `-add-submit` が出る | 実装済 |
| MFD-04 | `testidPrefix="blackout-dates"` で `action: 'edit'` | マウントする | testid が `blackout-dates-edit-form` / `-edit-cancel` / `-edit-submit` に振り替わる | 実装済 |
| MFD-05 | `validationErrors` に 2 件 | マウントする | `{prefix}-{action}-validation-error` に 2 件が箇条書きで出る | 実装済 |
| MFD-06 | `validationWarnings` に 1 件 | マウントする | `{prefix}-{action}-validation-warning` が警告の見た目（`data-variant="warning"`）で出る | 実装済 |
| MFD-07 | `validationWarnings` に 1 件・`pending: false` | マウントする | 送信ボタンは押せるままになる | 実装済 |
| MFD-08 | `error` あり | マウントする | `{prefix}-{action}-error` に `error.message` が 1 行で出る | 実装済 |
| MFD-09 | `validationErrors` / `validationWarnings` / `error` を同時に渡す | マウントする | 3 つの枠がすべて出る | 実装済 |
| MFD-10 | いずれのエラーも渡さない | マウントする | 3 つの枠はどれも出ない | 実装済 |
| MFD-11 | `submitLabel` を渡さず `pending: false` | マウントする | 送信ボタンの文言が「追加」になる | 実装済 |
| MFD-12 | `submitLabel` を渡さず `pending: true` | マウントする | 送信ボタンの文言が「追加中…」になる | 実装済 |
| MFD-13 | `submitLabel: '更新'` で `pending: true` | マウントする | 送信ボタンの文言が「更新中…」になる | 実装済 |
| MFD-14 | `pending: true` | マウントする | キャンセルボタンも送信ボタンも無効になる | 実装済 |
| MFD-15 | `pending: false` | キャンセルボタンをクリックする | `close` が 1 回発火する | 実装済 |
| MFD-16 | `pending: false` | 送信ボタンをクリックする | `submit` が 1 回発火する | 実装済 |
| MFD-17 | `pending: false` | form を submit する（入力欄での Enter 相当） | `submit` が 1 回発火する | 実装済 |
