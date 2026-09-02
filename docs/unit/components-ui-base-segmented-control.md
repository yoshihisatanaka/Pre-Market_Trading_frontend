# components/ui/BaseSegmentedControl（排他選択のボタン列）

- 略号: `BSC`
- 対象: `frontend/src/components/ui/BaseSegmentedControl.vue`
- テスト: `frontend/src/components/ui/BaseSegmentedControl.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BSC-01 | `options` を 3 件渡す | マウントする | ボタンが 3 つ、渡した順にラベル付きで並び、すべて `type="button"` | 実装済 |
| BSC-02 | `v-model` に 2 番目の value を渡す | マウントする | 2 番目だけ `aria-pressed="true"` / `data-selected="true"` になる | 実装済 |
| BSC-03 | 既定のまま | 3 番目のボタンを押す | `update:modelValue` がその value で発火する | 実装済 |
| BSC-04 | `tone` に `buy` / `sell` を持つ options | マウントする | 各ボタンの `data-tone` がその値になる | 実装済 |
| BSC-05 | `disabled` を渡す | マウントする | すべてのボタンが `disabled` になる | 実装済 |
| BSC-06 | `disabled` を渡す | ボタンを押す | `update:modelValue` は発火しない | 実装済 |
