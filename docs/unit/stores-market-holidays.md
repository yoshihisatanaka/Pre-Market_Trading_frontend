# stores/marketHolidays（海外休場日マスタ ストア）

- 略号: `MHS`
- 対象: `src/stores/marketHolidays.js`
- テスト: `src/stores/marketHolidays.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MHS-01 | 既定モック（56 件） | `load()` を引数なしで呼ぶ | `items` が 1 ページ分（50 件）、`total` が 56、`offset` は 0。`loading` は false、`error` は null | 実装済 |
| MHS-02 | API が 500（`message` 付き）を返す | `load()` を呼ぶ | `error` に status 500 と message を持つエラーが入り、`items` は空のまま。`loading` は false | 実装済 |
| MHS-03 | API が `items: []` を返す | `load()` を呼ぶ | `isEmpty` が true | 実装済 |
| MHS-04 | 既定モック（56 件） | `load({ offset: 50 })` を呼ぶ | `offset` が 50 のまま保たれ、`items` が 51 件目以降になる。`total` は 56 のまま | 実装済 |
| MHS-05 | 既定モック（56 件） | `load({ dateFrom, dateTo })` で 1 年分に絞る | `items` がその期間の日付だけになり、`total` が絞り込み後の件数になる。`dateFrom` / `dateTo` が保たれる | 実装済 |
| MHS-06 | `load({ offset: 50, dateFrom, dateTo })` 済み | `reload()` を呼ぶ | 同じページ位置・同じ絞り込みの結果が返る（1 ページ目に戻らない） | 実装済 |
| MHS-07 | 1 ページ目の応答だけが遅れて返る | 1 ページ目 → 2 ページ目の順に `load()` を呼び、両方の完了を待つ | 後から届いた古い応答で `items` が 1 ページ目に巻き戻らない | 実装済 |
