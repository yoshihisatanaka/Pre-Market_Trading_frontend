# components/ui/BaseCheckbox（単独チェックボックス）

- 略号: `BCK`
- 対象: `src/components/ui/BaseCheckbox.vue`
- テスト: `src/components/ui/BaseCheckbox.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BCK-01 | `label` を渡し `v-model` は `false` | マウントする | ラベル文字が表示され、チェックは外れている | 実装済 |
| BCK-02 | `v-model` は `false` | チェックを付ける | `update:modelValue` が `true` で発火する | 実装済 |
| BCK-03 | `v-model` は `true` | マウントする | チェックが付いている | 実装済 |
| BCK-04 | `disabled` を渡す | マウントする | ルートの `label` ではなく `input` 側が `disabled` になる | 実装済 |
