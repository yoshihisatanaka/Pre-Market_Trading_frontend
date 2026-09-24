# components/ui/BaseTextarea（複数行入力）

- 略号: `BTX`
- 対象: `src/components/ui/BaseTextarea.vue`
- テスト: `src/components/ui/BaseTextarea.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BTX-01 | `v-model` に値を渡す | マウントする | `textarea` の値が渡した値になる | 実装済 |
| BTX-02 | 既定のまま | 入力欄に文字を入れる | `update:modelValue` が入力した文字で発火する | 実装済 |
| BTX-03 | 既定のまま | マウントする | `rows` が `4` | 実装済 |
| BTX-04 | `rows` を指定する | マウントする | `rows` 属性が指定した値になる | 実装済 |
| BTX-05 | `invalid` を付ける | マウントする | `aria-invalid="true"` と `is-invalid` クラスが付く | 実装済 |
| BTX-06 | `invalid` を付けない | マウントする | `aria-invalid` 属性が出ない | 実装済 |
| BTX-07 | `maxlength` / `placeholder` / `disabled` / `id` / `aria-describedby` など宣言していない属性を渡す | マウントする | それらが `textarea` 要素にそのまま付く | 実装済 |
