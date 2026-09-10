# stores/marketHolidays（海外休場日マスタ ストア）

- 略号: `MHS`
- 対象: `src/stores/marketHolidays.js`
- テスト: `src/stores/marketHolidays.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MHS-01 | 既定モック（56 件） | `load()` を引数なしで呼ぶ | `items` が 1 ページ分（50 件）、`total` が 56、`offset` は 0。`loading` は false、`error` は null | 実装済 |
| MHS-02 | API が 500（`detail` 付き）を返す | `load()` を呼ぶ | `error` に status 500 と message を持つエラーが入り、`items` は空のまま。`loading` は false | 実装済 |
| MHS-03 | API が `holidays: []` を返す | `load()` を呼ぶ | `isEmpty` が true | 実装済 |
| MHS-04 | 既定モック（56 件） | `load({ offset: 50 })` を呼ぶ | `offset` が 50 のまま保たれ、`items` が 51 件目以降になる。`total` は 56 のまま | 実装済 |
| MHS-05 | 既定モック（56 件） | `load({ dateFrom, dateTo })` で 1 年分に絞る | `items` がその期間の日付だけになり、`total` が絞り込み後の件数になる。`dateFrom` / `dateTo` が保たれる | 実装済 |
| MHS-06 | `load({ offset: 50, dateFrom, dateTo })` 済み | `reload()` を呼ぶ | 同じページ位置・同じ絞り込みの結果が返る（1 ページ目に戻らない） | 実装済 |
| MHS-07 | 1 ページ目の応答だけが遅れて返る | 1 ページ目 → 2 ページ目の順に `load()` を呼び、両方の完了を待つ | 後から届いた古い応答で `items` が 1 ページ目に巻き戻らない | 実装済 |
| MHS-08 | 既定モック（56 件）、`load()` 済み | 一覧に無い日付で `create({ date, reason, holidayType })` を呼ぶ | 登録した 1 件が返り、渡した休場区分がそのまま入る。`createError` は null。一覧が読み直されて `total` が 1 増え、その日付が `items` に入る | 実装済 |
| MHS-09 | 既定モック、`load()` 済み | 既にある日付で `create()` を呼ぶ | 事前検証が不合格になり戻り値は null。`validationErrors` に理由が入り、`createError` は null のまま。`items` / `total` は変わらない | 実装済 |
| MHS-10 | `load({ offset: 50, dateFrom, dateTo })` 済み | `create()` が成功する | 同じページ位置・同じ絞り込みのまま読み直される（1 ページ目に戻らない） | 実装済 |
| MHS-11 | POST が 500 を返して `createError` が入っている | `clearCreateError()` を呼ぶ | `createError` が null になり、`validationErrors` / `validationWarnings` も空になる | 実装済 |
| MHS-12 | POST の応答が返る前 | `create()` を await せずに状態を見る | `creating` が true で、一覧側の `loading` は false のまま | 実装済 |
| MHS-13 | 既定モック（56 件）、`load()` 済み | 一覧の先頭の id で `remove(id)` を呼ぶ | 戻り値が true、`deleteError` は null。一覧が読み直されて `total` が 1 減り、その id が `items` から消える | 実装済 |
| MHS-14 | 存在しない休場日を指定し DELETE が 404（`detail` 付き）を返す | `remove(id)` を呼ぶ | 戻り値が false、`deleteError` に status 404 と message が入る。`items` / `total` は変わらない | 実装済 |
| MHS-15 | `load({ offset: 50, dateFrom, dateTo })` 済み | `remove()` が成功する | 同じページ位置・同じ絞り込みのまま読み直される（1 ページ目に戻らない） | 実装済 |
| MHS-16 | `remove()` が失敗して `deleteError` が入っている | `clearDeleteError()` を呼ぶ | `deleteError` が null になる | 実装済 |
| MHS-17 | DELETE の応答が返る前 | `remove()` を await せずに状態を見る | `deleting` が true で、一覧側の `loading` は false のまま | 実装済 |
| MHS-18 | 既定モック（56 件。うち短縮取引が 7 件） | `load({ holidayType: '1' })` を呼ぶ | `items` が短縮取引の行だけになり、`total` がその件数になる。`holidayType` が保たれる | 実装済 |
| MHS-19 | `load({ dateFrom, dateTo, holidayType })` 済み | `reload()` を呼ぶ | 休場区分の絞り込みも保たれたまま取り直される（条件が消えて全件に戻らない） | 実装済 |
| MHS-20 | 既定モック、`load()` 済み | 一覧に無い日付で `create({ date, reason, holidayType: '1' })` を呼ぶ | 戻り値の `holidayType` が `'1'` で、読み直した一覧に現れたその日付の行も `'1'` になる | 実装済 |
| MHS-21 | 既定モック（取消済みの日付を 1 件持つ）、`load()` 済み | その取消済みの日付で `create()` を呼ぶ | 戻り値が null。`validationWarnings` に再有効化の警告が入り、`validationErrors` / `createError` は空のまま。まだ登録しないので `total` は変わらない | 実装済 |
| MHS-22 | MHS-21 の直後（警告が出ている） | 同じ内容に `acknowledgedWarnings: true` を足して `create()` を呼ぶ | 登録された 1 件が返り、`validationWarnings` が空になる。取消済みの行が有効に戻るので `total` が 1 増え、その日付が `items` に入る | 実装済 |
