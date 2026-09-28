# utils/csv（CSV の組み立て）

- 略号: `CSU`
- 対象: `src/utils/csv.js`
- テスト: `src/utils/csv.spec.js`

`buildCsv(header, rows)` は画面ごとの列や値の変換を持たず、RFC 4180 の書式だけを受け持つ。
書式は別システム（TWS）に投入する CSV の実物に合わせてある。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CSU-01 | 1 行の入力 | `buildCsv` を呼ぶ | 先頭に BOM（U+FEFF）が 1 つだけ付く | 実装済 |
| CSU-02 | 2 行の入力 | `buildCsv` を呼ぶ | 各行の末尾（最終行も）に CRLF が付く | 実装済 |
| CSU-03 | `,` を含む値 | `buildCsv` を呼ぶ | 値が `"` で囲まれる | 実装済 |
| CSU-04 | `"` を含む値 | `buildCsv` を呼ぶ | 値が `"` で囲まれ、中の `"` は `""` になる | 実装済 |
| CSU-05 | LF / CR を含む値 | `buildCsv` を呼ぶ | どちらも値が `"` で囲まれる | 実装済 |
| CSU-06 | null / undefined の値 | `buildCsv` を呼ぶ | 空欄になる | 実装済 |
| CSU-07 | 0 と false の値 | `buildCsv` を呼ぶ | `0` / `false` と文字で出る（空欄にしない） | 実装済 |
| CSU-08 | 行が 0 件 | `buildCsv` を呼ぶ | BOM + ヘッダ 1 行 + CRLF だけになる | 実装済 |
