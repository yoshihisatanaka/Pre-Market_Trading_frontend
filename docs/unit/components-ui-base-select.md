# components/ui/BaseSelect（選択入力）

- 略号: `BSL`
- 対象: `src/components/ui/BaseSelect.vue`
- テスト: `src/components/ui/BaseSelect.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BSL-01 | `options` を 3 件渡す | マウントする | 選択肢が 3 つ、渡した順にラベル付きで並ぶ | 実装済 |
| BSL-02 | `placeholder` を渡す | マウントする | 先頭に空値の選択肢が増え、そのラベルが placeholder の文言になる | 実装済 |
| BSL-03 | `placeholder` を渡さない | マウントする | 空値の選択肢は増えない | 実装済 |
| BSL-04 | `options` を渡す | 2 番目を選ぶ | `update:modelValue` がその value で発火する | 実装済 |
| BSL-05 | `invalid` を付ける | マウントする | `aria-invalid="true"` と `is-invalid` クラスが付く | 実装済 |
| BSL-06 | `variant="underline"` | マウントする | `data-variant` が `underline` になる | 実装済 |
| BSL-07 | `group` を付けた選択肢（A 群 2 件・B 群 2 件）と付けない選択肢 1 件を混ぜて渡す | マウントする | `<optgroup>` が 2 つでき、見出しが group の文言、中に渡した順の選択肢が入る。group の無い選択肢は `<optgroup>` の外に出る | 実装済 |
| BSL-08 | `disabled: true` の選択肢を 1 件含める | マウントする | その選択肢だけに `disabled` が付き、ほかには付かない | 実装済 |
