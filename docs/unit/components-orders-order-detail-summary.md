# components/orders/OrderDetailSummary（対象注文の読み取り専用の表）

- 略号: `ODS`
- 対象: `src/components/orders/OrderDetailSummary.vue`
- テスト: `src/components/orders/OrderDetailSummary.spec.js`

訂正・取消の画面が対象注文を見せる `dl`（左にラベル、右に値）。何をどの順で出すかは呼び出し側が
`items: [{ label, value, testid? }]` で組み立てるので、ここでは props → 描画の入出力だけを守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ODS-01 | `items` が 3 件 | マウントする | `dt` / `dd` が渡した順に 3 組並び、各組がその行の `label` / `value` になる | 実装済 |
| ODS-02 | `testid` を付けた行と付けない行 | マウントする | `testid` を付けた行の `dd` にだけ `data-testid` が付く（付けない行は属性自体が無い） | 実装済 |
| ODS-03 | `items` が空 | マウントする | `dl` だけが描かれ、`dt` / `dd` は無い | 実装済 |
| ODS-04 | 属性 `data-testid="order-amend-summary"` を渡す | マウントする | ルートの `dl` にその `data-testid` が付く（フォールスルー） | 実装済 |
