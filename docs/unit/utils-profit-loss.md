# utils/profitLoss（評価損益の表示）

- 略号: `PFL`
- 対象: `src/utils/profitLoss.js`
- テスト: `src/utils/profitLoss.spec.js`

顧客詳細の預り一覧と顧客カードが使う、符号付きの金額・率と色分けの向き。
金額は `utils/format.js` の「数字 + 半角スペース + 単位」に揃え、先頭に符号を付ける。
**負号は U+2212（`−`）**で、ハイフン（`-`）ではない。0 は符号なし、値なしは `'—'`。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| PFL-01 | — | `formatSignedJpyUnit()` に `407400` / `-151500` / `0` を渡す | `'+407,400 円'` / `'−151,500 円'` / `'0 円'` | 実装済 |
| PFL-02 | — | `formatSignedJpyUnit(-1)` / `formatSignedPercent(-1)` の先頭の文字を見る | どちらも U+2212（`'−'`）で、ハイフン `'-'` を含まない | 実装済 |
| PFL-03 | — | `formatSignedJpyUnit()` / `formatSignedPercent()` に `null` / `undefined` / `NaN` / `Infinity` / 文字列 `'100'` を渡す | すべて `'—'` | 実装済 |
| PFL-04 | — | `formatSignedPercent()` に `13.58` / `-4.59` / `0` / `5` / `1234.5` を渡す | `'+13.58%'` / `'−4.59%'` / `'0.00%'` / `'+5.00%'` / `'+1,234.50%'`（小数第 2 位まで固定） | 実装済 |
| PFL-05 | — | `profitLossTone()` に `1` / `-1` / `0` / `null` / `NaN` を渡す | `'profit'` / `'loss'` / `''` / `''` / `''`（0 と値なしは色を付けない） | 実装済 |
