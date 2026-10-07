# utils/feePreferenceOptions（手数料優遇マスタの選択肢と表示名）

- 略号: `FPO`
- 対象: `src/utils/feePreferenceOptions.js`
- テスト: `src/utils/feePreferenceOptions.spec.js`

手数料パターンは空文字が「デフォルトパターン」という値なので、検索欄（未選択 = 条件なし）では目印
`DEFAULT_FEE_PATTERN_FILTER` で持ち、入力フォームでは空文字のまま持つ。2 つの選択肢の違いと、
URL クエリの検査・表示名の規則を守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FPO-01 | — | `FEE_PATTERN_FILTER_OPTIONS` を読む | 27 件で、先頭が `{ value: DEFAULT_FEE_PATTERN_FILTER, label: 'デフォルト' }`、続いて `A`〜`Z` | 実装済 |
| FPO-02 | — | `FEE_PATTERN_FORM_OPTIONS` を読む | 27 件で、先頭が `{ value: '', label: 'デフォルト' }`、続いて `A`〜`Z` | 実装済 |
| FPO-03 | — | `isFeePatternFilter` に `'default'` / `'A'` / `'Z'` と `''` / `'a'` / `'ZZ'` を渡す | 前の 3 つは true、後の 3 つは false | 実装済 |
| FPO-04 | — | `formatFeePattern('')` / `formatFeePattern('B')` | `'デフォルト'` / `'B'` | 実装済 |
| FPO-05 | — | `formatApplyMethod` に `'BASIS'` / `'PATTERN'` / `''` / `'OTHER'` を渡す | `'ベイシス方式'` / `'パターン方式'` / `'—'` / `'OTHER'` | 実装済 |
