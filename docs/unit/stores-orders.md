# stores/orders（注文一覧ストア）

- 略号: `OST`
- 対象: `src/stores/orders.js`
- テスト: `src/stores/orders.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OST-01 | 既定モック（注文 3 件、`ordered_at` は snake_case） | `load()` を呼ぶ | `items` が 3 件になり、`ordered_at` が `orderedAt` に変換されている。`loading` は false、`error` は null | 実装済 |
| OST-02 | API が 500（`message` 付き）を返す | `load()` を呼ぶ | `error` に status 500 と message を持つエラーが入り、`items` は空のまま。`loading` は false | 実装済 |
| OST-03 | API が `items: []` を返す | `load()` を呼ぶ | `isEmpty` が true | 実装済 |
