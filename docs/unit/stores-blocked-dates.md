# stores/blockedDates（受注不可日マスタ ストア）

- 略号: `BDS`
- 対象: `src/stores/blockedDates.js`
- テスト: `src/stores/blockedDates.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BDS-01 | 既定モック（フィクスチャ全件） | `load()` を引数なしで呼ぶ | `items` が 1 ページ分、`total` がフィクスチャの全件数、`offset` は 0。`loading` は false、`error` は null | 実装済 |
| BDS-02 | API が 500（`message` 付き）を返す | `load()` を呼ぶ | `error` に status 500 と message を持つエラーが入り、`items` は空のまま。`loading` は false | 実装済 |
| BDS-03 | 既定モック | `load({ offset: 表示件数 })` を呼ぶ | `offset` がその値のまま保たれ、`items` が 2 ページ目になる。`total` は全件数のまま | 実装済 |
| BDS-04 | 既定モック | `load({ dateFrom, dateTo })` で 1 年分に絞る | `items` がその期間の日付だけになり、`total` が絞り込み後の件数になる。`dateFrom` / `dateTo` が保たれる | 実装済 |
| BDS-05 | 応答が遅れて返る | `load()` を await せずに状態を見て、その後完了を待つ | 取得中は `loading` が true で、完了後に false に戻る | 実装済 |
| BDS-06 | API が `items: []` を返す / 500 を返す | それぞれ `load()` を呼ぶ | 0 件かつ非ローディング・非エラーのときだけ `isEmpty` が true。エラーのときは false | 実装済 |
| BDS-07 | 初回の `load()` が 500 で失敗している | 2 回目の `load()` が成功する | `error` が null に戻り、`items` に結果が入る | 実装済 |
| BDS-08 | `load({ offset: 表示件数, dateFrom, dateTo })` 済み | `reload()` を呼ぶ | 同じページ位置・同じ絞り込みの結果が返る（1 ページ目・全件に戻らない） | 実装済 |
| BDS-09 | 1 ページ目の応答だけが遅れて返る | 1 ページ目 → 2 ページ目の順に `load()` を呼び、両方の完了を待つ | 後から届いた古い応答で `items` が 1 ページ目に巻き戻らない | 実装済 |
| BDS-10 | 既定モック | `load()` を呼ぶ | `limit` が表示件数の定数と一致し、リクエストの `limit` にも同じ値が載る | 実装済 |
