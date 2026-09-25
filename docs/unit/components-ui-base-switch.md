# components/ui/BaseSwitch（スライド式トグル）

- 略号: `BSW`
- 対象: `src/components/ui/BaseSwitch.vue`
- テスト: `src/components/ui/BaseSwitch.spec.js`

`role="switch"` の `<button>`。**押しても値を変えず、`toggle` を emit するだけ**
（ON / OFF は呼び出し側が `modelValue` で決める。確認ダイアログで確定したときだけ切り替える用途のため）。
`update:modelValue` を emit しないことも固定する（v-model で結ぶと黙って切り替わらなくなる）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BSW-01 | `modelValue=false` / `label='IBの発注停止'` | マウントする | `<button type="button" role="switch">` で、`aria-checked="false"`・`aria-label="IBの発注停止"`。ON の見た目（`is-on`）は付かない | 実装済 |
| BSW-02 | `modelValue=true` | マウントする | `aria-checked="true"` で、`is-on` が付く | 実装済 |
| BSW-03 | `modelValue=false` | click | `toggle` が 1 回 emit され、`update:modelValue` は emit されない。`aria-checked` は `false` のまま | 実装済 |
| BSW-04 | `disabled` を付ける | マウントして click | `disabled` 属性が付き、`toggle` は emit されない | 実装済 |
| BSW-05 | `data-testid` を渡す | マウントする | ルートの `<button>` に付く | 実装済 |
