# utils/customerCautions（顧客の注意表示の判定）

- 略号: `CCA`
- 対象: `src/utils/customerCautions.js`
- テスト: `src/utils/customerCautions.spec.js`

新規注文の顧客バーと顧客詳細の顧客カードが共通で使う「要注意」（コンプラランク）と「高齢者」（年齢）の判定。
年齢は実 API でも文字列で、法人は空。境界値は公開定数（`ELDERLY_AGE` / `CAUTION_RANKS`）から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CCA-01 | — | 公開定数を読む | `CAUTION_RANKS` が `['A', 'B', 'Y', 'Z']`、`ELDERLY_AGE` が 85（画面モックの規則）。`CAUTION_RANKS` は書き換えられない | 実装済 |
| CCA-02 | — | `parseAge()` に `'75'` / `' 85 '` / 数値 `85` を渡す | `75` / `85` / `85`（前後の空白を許す） | 実装済 |
| CCA-03 | — | `parseAge()` に `''` / `null` / `undefined` / `'85歳'` / `'8.5'` / `'-1'` / `'abc'` を渡す | すべて `null`（数字だけのときにだけ数値にする） | 実装済 |
| CCA-04 | — | `isElderly()` に `ELDERLY_AGE` / `ELDERLY_AGE - 1` / `ELDERLY_AGE + 1` の文字列を渡す | `true` / `false` / `true`（`ELDERLY_AGE` 以上が高齢者） | 実装済 |
| CCA-05 | — | `isElderly()` に `''`（法人）/ `null` / `'abc'` を渡す | すべて `false` | 実装済 |
| CCA-06 | — | `isCautionRank()` に `CAUTION_RANKS` の各値を渡す | すべて `true` | 実装済 |
| CCA-07 | — | `isCautionRank()` に `'C'` / 小文字 `'a'` / `''` / `null` / `undefined` を渡す | すべて `false` | 実装済 |
