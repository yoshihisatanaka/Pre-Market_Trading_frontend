# components/ui/FormField（フォーム1項目の器）

- 略号: `FLD`
- 対象: `src/components/ui/FormField.vue`
- テスト: `src/components/ui/FormField.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FLD-01 | `label` を渡す | マウントする | ラベル文字が表示され、`for` が slot に渡した `id` と一致する | 実装済 |
| FLD-02 | `required` を付ける | マウントする | 必須マーク `*` と、読み上げ用の「（必須）」が出て、slot に渡る `required` が `true` になる | 実装済 |
| FLD-03 | `error` に文言を渡す | マウントする | その文言が `role="alert"` で表示され、slot に渡る `invalid` が `true` になる | 実装済 |
| FLD-04 | `hint` と `error` の両方を渡す | マウントする | slot に渡る `aria-describedby` にヒントとエラーの両 id が空白区切りで並ぶ | 実装済 |
| FLD-05 | `hint` も `error` も渡さない | マウントする | slot に渡る `aria-describedby` は `undefined` | 実装済 |
| FLD-06 | `layout="inline"` を渡す | マウントする | 必須マークが `●` になり、ルートに `form-field--inline` が付く | 実装済 |
| FLD-07 | 同じ画面に 2 つ並べる | マウントする | 2 つの `id` が互いに異なる | 実装済 |
