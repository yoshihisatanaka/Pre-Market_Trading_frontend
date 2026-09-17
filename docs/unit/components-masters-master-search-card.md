# components/masters/MasterSearchCard（マスタ検索カード）

- 略号: `MSC`
- 対象: `src/components/masters/MasterSearchCard.vue`
- テスト: `src/components/masters/MasterSearchCard.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MSC-01 | `testidPrefix="market-holidays"` | マウントする | `market-holidays-search`（form）・`market-holidays-search-submit`・`market-holidays-search-clear` が出る | 実装済 |
| MSC-02 | 既定スロットに入力欄を差す | マウントする | スロットの内容が `.form-grid` の中に描画される | 実装済 |
| MSC-03 | `columns` を渡さない | マウントする | 入力欄の器が 4 列（`form-grid--4`）になる | 実装済 |
| MSC-04 | `columns: 2` | マウントする | 入力欄の器が 2 列（`form-grid--2`）になる | 実装済 |
| MSC-05 | 既定 | form を submit する | `submit` が 1 回発火する | 実装済 |
| MSC-06 | 既定 | 「クリア」ボタンをクリックする | `clear` が 1 回発火する | 実装済 |
| MSC-07 | 既定（`disabled` も `optionsLoading` も false） | マウントする | 検索・クリアの両ボタンが押せる | 実装済 |
| MSC-08 | `disabled: true` | マウントする | 検索・クリアの両ボタンが無効になる | 実装済 |
| MSC-09 | `disabled: true` | マウントする | 入力欄を包む `fieldset` は無効にならない（条件は入力できる） | 実装済 |
| MSC-10 | `optionsLoading: true` | マウントする | 入力欄を包む `fieldset` が無効になる | 実装済 |
| MSC-11 | `optionsLoading: true` | マウントする | 検索・クリアの両ボタンが無効になる | 実装済 |
| MSC-12 | `optionsLoading: true` | マウントする | `{prefix}-options-loading` の回転マークが出る | 実装済 |
| MSC-13 | `optionsLoading` を渡さない | マウントする | `{prefix}-options-loading` は出ない | 実装済 |
