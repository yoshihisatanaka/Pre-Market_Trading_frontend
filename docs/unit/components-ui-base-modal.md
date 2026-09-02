# components/ui/BaseModal（ダイアログ）

- 略号: `BMD`
- 対象: `frontend/src/components/ui/BaseModal.vue`
- テスト: `frontend/src/components/ui/BaseModal.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BMD-01 | `open` が `false` | マウントする | ダイアログが描画されない | 実装済 |
| BMD-02 | `open` が `true` で `title` を渡す | マウントする | タイトルと slot の内容が `role="dialog"` の中に出る | 実装済 |
| BMD-03 | `open` が `true` | 背後の幕をクリックする | `close` が発火する | 実装済 |
| BMD-04 | `open` が `true` | ダイアログ本体をクリックする | `close` は発火しない | 実装済 |
| BMD-05 | `open` が `true` | Esc キーを押す | `close` が発火する | 実装済 |
| BMD-06 | `open` が `false` | Esc キーを押す | `close` は発火しない | 実装済 |
| BMD-07 | `open` が `true` で `footer` スロットを渡す | マウントする | フッタ行にその内容が出る | 実装済 |
| BMD-08 | `size="sm"` で `open` が `true` | マウントする | ダイアログ本体に `modal__box--sm` が付く | 実装済 |
