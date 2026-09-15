# composables/useCrudList（ページャー付き一覧の取得・登録・更新・削除）

- 略号: `UCL`
- 対象: `src/composables/useCrudList.js`
- テスト: `src/composables/useCrudList.spec.js`

マスタ一覧ストアの足回り。ここが守る契約は 4 つ。

- **古い応答で新しい結果を上書きしない。** ページャー連打・ブラウザバック連打で応答が
  追い越しても、最後に開始した取得の結果が残る（`useAsync` は追い越しを防がない →
  [composables-use-async.md](composables-use-async.md) の UAS-17）
- **持っていない操作の名前を公開しない。** `createItem` / `updateItem` / `deleteItem` を
  渡さない一覧には、その系統のキーごと生やさない（読むだけの一覧を書けるように見せない）
- **事前検証の不合格・警告を例外にしない。** 不合格は `validationErrors`、確認待ちの警告は
  `validationWarnings` に入り、戻り値は `null`。通信・サーバ障害（throw）は
  `createError` / `updateError` に入り、扱いが違う
- **登録と更新の検証理由を混ぜない。** 更新は `updateValidationErrors`（登録の
  `validationErrors` とは別 ref）を使い、片方を消しても他方に残る

ページ位置・検索条件は URL クエリが正（[composables-use-list-query.md](composables-use-list-query.md)）で、
ここはその写しを持つだけ。この層は HTTP を知らないので、テストでも MSW を使わず
関数 props（`fetchPage` など）にスタブを渡す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| UCL-01 | `pageSize` と `fetchPage` だけ | 生成する | `items` が空、`total` が 0、`limit` が `pageSize`、`offset` が 0、`loading` が `false`、`error` が `null`、`isEmpty` が `true`。`fetchPage` はまだ呼ばれない | 実装済 |
| UCL-02 | `filterKeys` に 2 件 | 生成する | 同名のキーが空文字の ref として公開される | 実装済 |
| UCL-03 | `filterKeys` を省略 | `load()` | `fetchPage` が `{ limit, offset: 0 }` だけで呼ばれる | 実装済 |
| UCL-04 | `filterKeys` に 2 件 | `load()` を引数なしで | `fetchPage` が `{ limit: pageSize, offset: 0, 各 key: '' }` で呼ばれる | 実装済 |
| UCL-05 | 同上 | `load({ offset: <位置>, <key>: <値> })` | `fetchPage` にその `offset` と条件が渡り、`offset` ref と条件 ref も同じ値になる | 実装済 |
| UCL-06 | 同上 | `load()` に `filterKeys` に無いキーを混ぜる | そのキーは `fetchPage` に渡らない（公開された条件だけが外へ出る） | 実装済 |
| UCL-07 | 条件付きで `load` 済み | 条件を省いて `load({ offset: 0 })` | 条件 ref が空文字に戻り、`fetchPage` にも空文字が渡る（前回の条件が残らない） | 実装済 |
| UCL-08 | `fetchPage` が items と total を返す | `load()` | `items` がその配列（同一参照）、`total` がその値、`isEmpty` が `false` | 実装済 |
| UCL-09 | `fetchPage` が空の items を返す | `load()` | `items` が空で `isEmpty` が `true` | 実装済 |
| UCL-10 | `fetchPage` が解決を保留する | `load()` し解決前を見る | `loading` が `true`、`isEmpty` は `false`（読み込み中に空表示を出さない）。解決後は `loading` が `false` | 実装済 |
| UCL-11 | `fetchPage` が例外を投げる | `load()` | 例外は外へ出ず、`error` に投げた値（同一参照）。`items` は空・`total` は 0 のままで `isEmpty` は `false`（エラー時に空表示を出さない） | 実装済 |
| UCL-12 | 失敗した状態 | `reload()` が成功する | `error` が `null` に戻り、`items` が新しい結果になる | 実装済 |
| UCL-13 | `load({ offset: <位置>, <key>: <値> })` 済み | `reload()` | `fetchPage` が直前と同じ `offset` と条件で呼ばれる（URL を変えずに読み直す） | 実装済 |
| UCL-14 | 1 回目の `fetchPage` が遅く、2 回目が先に解決する | `load` を 2 回続けて呼び、2 回目 → 1 回目の順に解決させる | `items` / `total` は 2 回目の結果のまま。後から解決した 1 回目の結果で上書きされない | 実装済 |
| UCL-15 | 2 回の `load` が開始順に解決する | 同上（1 回目 → 2 回目の順に解決） | `items` が 2 回目の結果になる（追い越しが起きなければ最後の結果が残る） | 実装済 |
| UCL-16 | `useCrudList` を 2 つ生成する | 片方で `load` を 2 回、もう片方で 1 回呼ぶ | もう片方の結果は破棄されない（追い越し判定は生成ごとに独立し、ストアをまたいで干渉しない） | 実装済 |
| UCL-17 | `createItem` を渡さない | 生成する | `create` / `creating` / `createError` / `validationErrors` / `validationWarnings` / `clearCreateError` のキーが存在しない | 実装済 |
| UCL-18 | `updateItem` を渡さない | 生成する | `update` / `updating` / `updateError` / `updateValidationErrors` / `clearUpdateError` のキーが存在しない | 実装済 |
| UCL-19 | `deleteItem` を渡さない | 生成する | `remove` / `deleting` / `deleteError` / `clearDeleteError` のキーが存在しない | 実装済 |
| UCL-20 | 3 つとも渡す | 生成する | 各系統のキーが生え、`creating` / `updating` / `deleting` が `false`、各 error が `null`、検証理由の配列が空 | 実装済 |
| UCL-21 | `validateItem` なし、`createItem` が 1 件を返す | `create(payload)` | `createItem` が `payload`（同一参照）で呼ばれ、戻り値がその 1 件（同一参照） | 実装済 |
| UCL-22 | `load({ offset: <位置>, <key>: <値> })` 済み | `create()` が成功する | 登録後に一覧が直前と同じ `offset` と条件で読み直され、`items` が登録後の応答に入れ替わる | 実装済 |
| UCL-23 | `createItem` が解決を保留する | `create()` し解決前後を見る | 解決前は `creating` が `true`、完了後は `false`。`loading`（一覧）は `true` にならない | 実装済 |
| UCL-24 | `validateItem` が `{ valid: true, errors: [] }` を返す | `create(payload)` | `validateItem` が `payload` で呼ばれてから `createItem` が呼ばれ、1 件が返る | 実装済 |
| UCL-25 | `validateItem` が `{ valid: false, errors: [<理由>] }` を返す | `create()` | 戻り値が `null`、`createItem` は呼ばれず、`validationErrors` がその理由の配列。`createError` は `null` のまま、一覧も読み直されない | 実装済 |
| UCL-26 | `validateItem` が警告付きで合格し、`payload` に `acknowledgedWarnings` が無い | `create(payload)` | 登録せず戻り値は `null`。`validationWarnings` がその警告、`validationErrors` は空、`createError` は `null` | 実装済 |
| UCL-27 | 同上の `validateItem`、`payload` に `acknowledgedWarnings: true` | `create(payload)` | `createItem` が呼ばれて 1 件が返り、`validationWarnings` は空のまま | 実装済 |
| UCL-28 | `validateItem` が合格し `warnings` が空配列 | `create()` | 確認を挟まずそのまま登録される | 実装済 |
| UCL-29 | `createItem` が例外を投げる | `create()` | 戻り値が `null`、`createError` に投げた値（同一参照）、`validationErrors` は空、一覧は読み直されない | 実装済 |
| UCL-30 | `validateItem` が例外を投げる | `create()` | 戻り値が `null`、`createError` に投げた値が入り、`validationErrors` / `validationWarnings` は空のまま（事前検証の不合格とは扱いが違う）。`createItem` は呼ばれない | 実装済 |
| UCL-31 | 不合格・警告で `validationErrors` / `validationWarnings` が埋まっている | 次の `create()` が成功する | 両方が空に戻る（前回の理由が残らない） | 実装済 |
| UCL-32 | `createError` と検証理由が残っている | `clearCreateError()` | `createError` が `null`、`validationErrors` と `validationWarnings` が空になる | 実装済 |
| UCL-33 | `validateItem` なし、`updateItem` が更新後の 1 件を返す | `update(payload)` | `updateItem` が `payload` で呼ばれ、更新後の 1 件（同一参照）が返り、一覧が直前の `offset` と条件で読み直される | 実装済 |
| UCL-34 | `updateItem` が解決を保留する | `update()` し解決前後を見る | 解決前は `updating` が `true`、完了後は `false` | 実装済 |
| UCL-35 | `validateItem` が `{ valid: false, errors: [<理由>] }` を返す | `update()` | 戻り値が `null`、`updateItem` は呼ばれず、`updateValidationErrors` にその理由。登録側の `validationErrors` は空のまま（理由を混ぜない） | 実装済 |
| UCL-36 | `validateItem` が警告付きで合格し、`payload` に `acknowledgedWarnings` が無い | `update()` | 確認を挟まず `updateItem` が呼ばれて更新される。`validationWarnings` は空のまま（更新は警告を扱わない） | 実装済 |
| UCL-37 | `updateItem` が例外を投げる | `update()` | 戻り値が `null`、`updateError` に投げた値、`updateValidationErrors` は空、一覧は読み直されない | 実装済 |
| UCL-38 | `updateError` / `updateValidationErrors` と、登録側の `validationErrors` の両方が埋まっている | `clearUpdateError()` | `updateError` が `null`、`updateValidationErrors` が空。登録側の `validationErrors` は残る | 実装済 |
| UCL-39 | `load({ offset: <位置>, <key>: <値> })` 済み、`deleteItem` が id を返す | `remove(<id>)` | `deleteItem` が `<id>` で呼ばれ、戻り値が `true`。一覧が直前の `offset` と条件で読み直される | 実装済 |
| UCL-40 | `deleteItem` が解決を保留する | `remove()` し解決前後を見る | 解決前は `deleting` が `true`、完了後は `false` | 実装済 |
| UCL-41 | `deleteItem` が例外を投げる | `remove()` | 戻り値が `false`、`deleteError` に投げた値、一覧は読み直されない | 実装済 |
| UCL-42 | `deleteItem` が `undefined` を解決する（削除自体は成功している） | `remove()` | 戻り値が `false` になり一覧も読み直されない。`deleteItem` は削除した id など truthy な値を返す約束（`src/api/*.js` はどれも id を返す） | 実装済 |
| UCL-43 | `deleteError` が残っている | `clearDeleteError()` | `deleteError` が `null` になる | 実装済 |
