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
| BDS-11 | 既定モック、`load()` 済み | 一覧に無い日付で `create({ date, reason })` を呼ぶ | 事前検証を通って登録され、登録した 1 件が返る。日付・理由は渡した値。対象市場はサーバが決めた値が入り、読み直した一覧の同じ日付の行と一致する。`createError` は null、`validationErrors` は空。`total` が 1 増え、その日付が `items` に入る | 実装済 |
| BDS-12 | 既定モック、`load()` 済み | すでに登録済みの日付で `create()` を呼ぶ | 戻り値が null。`validationErrors` にサーバが返した理由（重複を知らせる文言）が入り、`createError` は null のまま。`items` / `total` は変わらない | 実装済 |
| BDS-13 | 事前検証が不合格になる入力 | `create()` を呼ぶ | 登録の API（`POST /blocked-dates`）は 1 度も呼ばれない | 実装済 |
| BDS-14 | 事前検証が理由を 2 件返す | `create()` を呼ぶ | `validationErrors` にその 2 件が、サーバが返した順のまま入る | 実装済 |
| BDS-15 | 事前検証の API が 500（`message` 付き）を返す | `create()` を呼ぶ | 戻り値が null、`createError` に status 500 とその message が入る。`validationErrors` は空のまま。`items` / `total` は変わらない | 実装済 |
| BDS-16 | 登録の API が 409（`message` 付き）を返す（事前検証は通る） | `create()` を呼ぶ | 戻り値が null、`createError` に status 409 とその message が入る（サーバ側の防御に到達した場合も理由が失われない） | 実装済 |
| BDS-17 | `load({ offset: 表示件数, dateFrom, dateTo })` 済み | `create()` が成功する | 同じページ位置・同じ絞り込みのまま読み直される（1 ページ目・全件に戻らない） | 実装済 |
| BDS-18 | 直前の `create()` が通信エラーで失敗した状態 / 事前検証で弾かれた状態 | それぞれで `clearCreateError()` を呼ぶ | `createError` が null になり、`validationErrors` も空になる（どちらの失敗も残らない） | 実装済 |
| BDS-19 | 事前検証で弾かれて `validationErrors` が入っている | 続けて成功する入力で `create()` を呼ぶ | `validationErrors` が空に戻り、登録した 1 件が返る（前回の理由が残らない） | 実装済 |
| BDS-20 | 事前検証の応答が返る前 | `create()` を await せずに状態を見る | `creating` が true で、一覧側の `loading` は false のまま。検証と登録の 2 往復が終わるまで true が続き、完了後に false に戻る | 実装済 |
| BDS-21 | 既定モック、`load()` 済み | 一覧の先頭の id で `remove(id)` を呼ぶ | 戻り値が true、`deleteError` は null。一覧が読み直されて `total` が 1 減り、その id が `items` から消える | 実装済 |
| BDS-22 | DELETE が 404（`message` 付き）を返す（存在しない id） | `remove(id)` を呼ぶ | 戻り値が false、`deleteError` に status 404 と message が入る。`items` / `total` は変わらない | 実装済 |
| BDS-23 | `load({ offset: 表示件数, dateFrom, dateTo })` 済み | `remove()` が成功する | 同じページ位置・同じ絞り込みのまま読み直される（1 ページ目・全件に戻らない） | 実装済 |
| BDS-24 | `remove()` が失敗して `deleteError` が入っている | `clearDeleteError()` を呼ぶ | `deleteError` が null になる | 実装済 |
| BDS-25 | DELETE の応答が返る前 | `remove()` を await せずに状態を見る | `deleting` が true で、一覧側の `loading` は false のまま。完了後に false に戻る | 実装済 |
| BDS-26 | 既定モック、`load()` 済み | 先頭の行の `id` / `updatedAt` で理由だけを変えて `update({ id, date, reason, updatedAt })` を呼ぶ | 更新後の 1 件が返る（日付は元のまま、理由は渡した値）。`updateError` は null、`updateValidationErrors` は空。一覧が読み直されて `total` は変わらず、その日付の行の理由が新しい値になる | 未着手 |
| BDS-27 | 既定モック、`load()` 済み | 先頭の行の日付を一覧に無い日付へ変えて `update()` を呼ぶ | 戻り値の日付が新しい日付になる。`total` は変わらず、`items` から元の日付が消えて新しい日付が日付昇順の位置に入る | 未着手 |
| BDS-28 | 既定モック、`load()` 済み | 日付を変えずに（自分自身の日付のまま）`update()` を呼ぶ | 自分自身は重複と見なされず成功する。事前検証のリクエストに更新であること（`is_update`）と対象の id が載る | 未着手 |
| BDS-29 | 既定モック、`load()` 済み | 先頭の行の日付を**別の行の日付**へ変えて `update()` を呼ぶ | 戻り値が null。`updateValidationErrors` に重複を知らせる文言が入り、`updateError` は null のまま。`items` / `total` は変わらない | 未着手 |
| BDS-30 | 事前検証が不合格になる入力 | `update()` を呼ぶ | 更新の API（`PUT /blocked-dates/:id`）は 1 度も呼ばれない | 未着手 |
| BDS-31 | 更新の API が 500（`message` 付き）を返す（事前検証は通る） | `update()` を呼ぶ | 戻り値が null、`updateError` に status 500 とその message が入る。`updateValidationErrors` は空のまま。`items` / `total` は変わらない | 未着手 |
| BDS-32 | 既定モック、`load()` 済み | 行の現在値と違う（古い）`updatedAt` を渡して `update()` を呼ぶ | 戻り値が null、`updateError` に status 409 と競合を知らせる message が入る。`items` は変わらない（他の利用者の変更を上書きしない） | 未着手 |
| BDS-33 | 既定モック | 存在しない id で `update()` を呼ぶ | 戻り値が null、`updateError` に status 404 と message が入る | 未着手 |
| BDS-34 | `load({ offset: 表示件数, dateFrom, dateTo })` 済み | `update()` が成功する | 同じページ位置・同じ絞り込みのまま読み直される（1 ページ目・全件に戻らない） | 未着手 |
| BDS-35 | 直前の `update()` が通信エラーで失敗した状態 / 事前検証で弾かれた状態 | それぞれで `clearUpdateError()` を呼ぶ | `updateError` が null になり、`updateValidationErrors` も空になる（どちらの失敗も残らない） | 未着手 |
| BDS-36 | 事前検証の応答が返る前 | `update()` を await せずに状態を見る | `updating` が true で、一覧側の `loading` は false のまま。検証と更新の 2 往復が終わるまで true が続き、完了後に false に戻る | 未着手 |
| BDS-37 | 既定モック、`update()` が 1 回成功した直後 | 読み直した一覧から取った `updatedAt` で同じ行をもう一度 `update()` する | 2 回目も成功する（更新のたびにサーバが新しい更新日時を返し、一覧経由で合札が入れ替わる） | 未着手 |
| BDS-38 | 既定モック、`load()` 済み | 編集で事前検証に弾かれたあと、登録側の `validationErrors` を見る | 編集の理由は `updateValidationErrors` にだけ入り、`validationErrors` は空のまま。逆に登録で弾かれても `updateValidationErrors` は空のまま | 未着手 |
