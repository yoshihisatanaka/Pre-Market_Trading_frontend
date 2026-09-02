# components/ui/BaseSelect（選択入力）

- 略号: `BSL`
- 対象: `frontend/src/components/ui/BaseSelect.vue`
- テスト: `frontend/src/components/ui/BaseSelect.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BSL-01 | `options` を 3 件渡す | マウントする | 選択肢が 3 つ、渡した順にラベル付きで並ぶ | 実装済 |
| BSL-02 | `placeholder` を渡す | マウントする | 先頭に空値の選択肢が増え、そのラベルが placeholder の文言になる | 実装済 |
| BSL-03 | `placeholder` を渡さない | マウントする | 空値の選択肢は増えない | 実装済 |
| BSL-04 | `options` を渡す | 2 番目を選ぶ | `update:modelValue` がその value で発火する | 実装済 |
| BSL-05 | `invalid` を付ける | マウントする | `aria-invalid="true"` と `is-invalid` クラスが付く | 実装済 |
| BSL-06 | `variant="underline"` | マウントする | `data-variant` が `underline` になる | 実装済 |
