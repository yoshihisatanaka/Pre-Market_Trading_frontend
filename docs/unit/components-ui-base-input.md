# components/ui/BaseInput（1行入力）

- 略号: `BIN`
- 対象: `frontend/src/components/ui/BaseInput.vue`
- テスト: `frontend/src/components/ui/BaseInput.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BIN-01 | `v-model` に値を渡す | マウントする | `input` の値が渡した値になる | 実装済 |
| BIN-02 | 既定のまま | 入力欄に文字を入れる | `update:modelValue` が入力した文字で発火する | 実装済 |
| BIN-03 | 既定のまま | マウントする | `type` は `text`、`data-variant` は `boxed` | 実装済 |
| BIN-04 | `variant="underline"`、`type="number"` | マウントする | `data-variant` が `underline`、`type` が `number` になる | 実装済 |
| BIN-05 | `invalid` を付ける | マウントする | `aria-invalid="true"` と `is-invalid` クラスが付く | 実装済 |
| BIN-06 | `invalid` を付けない | マウントする | `aria-invalid` 属性が出ない | 実装済 |
| BIN-07 | `step` / `maxlength` / `disabled` など宣言していない属性を渡す | マウントする | それらが `input` 要素にそのまま付く | 実装済 |
