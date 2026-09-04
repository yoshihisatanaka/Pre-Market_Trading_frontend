# components/ui/BaseButton（汎用ボタン）

- 略号: `BBT`
- 対象: `src/components/ui/BaseButton.vue`
- テスト: `src/components/ui/BaseButton.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BBT-01 | 既定のまま | マウントする | `type="button"`、`base-button--primary` と `base-button--md` が付き、slot の内容が出る | 実装済 |
| BBT-02 | `variant="success"`、`size="sm"` | マウントする | `base-button--success` と `base-button--sm` が付く | 実装済 |
| BBT-03 | `block` を付ける | マウントする | `is-block` が付く | 実装済 |
| BBT-04 | `disabled` を付ける | マウントする | `disabled` 属性が付く | 実装済 |
| BBT-05 | `@click` を渡す | ボタンを押す | 渡したハンドラが呼ばれる | 実装済 |
| BBT-06 | `type="submit"` | マウントする | `type` が `submit` になる | 実装済 |
