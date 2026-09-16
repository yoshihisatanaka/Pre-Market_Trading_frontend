# stores/ca（CAマスタのストア）

- 略号: `CAS`
- 対象: `src/stores/ca.js`
- テスト: `src/stores/ca.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/index.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。

この一覧は**取得・登録・更新・削除**の CRUD 一式を持つ。`useCrudList` は渡さなかった操作の
名前を公開しないので、3 系統がそろって配線されていること自体も守る（CAS-09）。
同じ形のストアは [stores-blackout-dates.md](stores-blackout-dates.md)。

削除は実 API 側が論理削除（取消区分=1）。一覧は既定で取消済みを返さないので、読み直すと
消えたように見える。**事前検証は無い**（DELETE は本文を取らない）ので、
拒否の理由はすべて `deleteError` に入る（CAS-23）。

登録も編集も「サーバの事前検証 → 登録 / 更新」の 2 段。**不合格は例外ではなく
`validationErrors` / `updateValidationErrors`** に入り、通信・サーバ障害だけが
`createError` / `updateError` に入る（CAS-12 / 13 / 18 / 19）。

**登録側と更新側の枠は共用しない。** 片方を消し忘れると、もう片方のモーダルに前回の理由が
漏れる（`useCrudList` の JSDoc に理由がある）。CAS-20 がその分離を守る。

**楽観的ロックの競合（409）は `updateError`** に入る。事前検証の不合格ではなく
通信・サーバ障害と同じ枠なので、ストアも画面も 409 を特別扱いしない（CAS-19）。

**`validationWarnings` は公開されるが常に空。** api 層の `validateCorporateAction` が
`warnings` を受け取らないため（理由は [api-ca.md](api-ca.md)。CA は主キーが surrogate な ID で、
登録が必ず新しい行を作るので「取消済みの行を再有効化する」ような確認事項が起きない）。

期待値はフィクスチャ（`src/mocks/fixtures/ca.js`）と `CA_PAGE_SIZE` から導き、
56 / 50 のような数値を直接書かない（フィクスチャが伸びてもテストが壊れないようにする）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CAS-01 | 既定モック | `load()` を引数なしで呼ぶ | `items` が 1 ページ分（`CA_PAGE_SIZE` 件）、`total` がフィクスチャの全件数、`offset` が 0 になる | 実装済 |
| CAS-02 | 既定モック | `load({ offset: CA_PAGE_SIZE })` を呼ぶ | 2 ページ目の残り件数が返り、`offset` が渡した値になる | 実装済 |
| CAS-03 | 既定モック | `load({ stockCode: <フィクスチャの Ticker> })` を呼ぶ | その銘柄の行だけが返り、`stockCode` に条件が残る。銘柄コードと Ticker のどちらに当たってもよい（部分一致） | 実装済 |
| CAS-04 | 既定モック | `load({ caType: '110' })` を呼ぶ | CA種別が一致する行だけが返り、`caType` に条件が残る | 実装済 |
| CAS-05 | 既定モック | `load({ stockCode: 'ZZZZ' })` を呼ぶ（該当なし） | `items` が空、`total` が 0、`isEmpty` が `true` になる | 実装済 |
| CAS-06 | API が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`items` が空のまま。`isEmpty` は `false`（空とエラーを別の状態として出し分けるため） | 実装済 |
| CAS-07 | API の応答が遅い | `load()` を await せずに `loading` を読む | 取得中は `true`、完了後に `false` になる | 実装済 |
| CAS-08 | 既定モック。絞り込んだ 2 ページ目を読み込み済み | `reload()` を呼ぶ | 同じ条件・同じ `offset` のまま読み直す（条件が落ちない） | 実装済 |
| CAS-09 | 既定モック | ストアの公開名を読む | `create` / `update` / `remove` の 3 系統とその状態（`creating` / `updating` / `deleting` / `validationErrors` / `updateValidationErrors` / `deleteError`）をすべて公開する（CRUD 一式がストアに配線されていることを守る） | 実装済 |
| CAS-10 | API の応答が遅い | 2 ページ目 → 1 ページ目の順に `load()` を続けて呼び、先に投げたほうを遅く返す | 最後に投げた `load()` の結果が残る（古い応答が新しい結果を上書きしない） | 実装済 |
| CAS-11 | 既定モック | `load()` の後に `create({ stockCode: <フィクスチャの銘柄>, caType: '120' })` を呼ぶ | 登録された 1 件が返り、`total` が 1 増える（成功時は今の条件のまま一覧を読み直す） | 実装済 |
| CAS-12 | 事前検証が不合格を返す（銘柄マスタに無い銘柄コード） | `create()` を呼ぶ | 戻り値が `null`、`validationErrors` に理由が入り、`createError` は `null` のまま。`total` は増えない | 実装済 |
| CAS-13 | `POST /api/masters/ca` が 500 を返す | `create()` を呼ぶ | 戻り値が `null`、`createError` に理由が入り、`validationErrors` は空のまま | 実装済 |
| CAS-14 | 既定モック。前回の `create()` が失敗している | `clearCreateError()` を呼ぶ | `createError` と `validationErrors` が空になる（モーダルを開き直したときに前回の失敗を残さない） | 実装済 |
| CAS-15 | 既定モック。CA種別で絞り込んだ状態 | 絞り込みに合う CA を `create()` する | 読み直しで絞り込み条件が落ちない（`caType` が残り、一覧も条件に合う行だけ） | 実装済 |
| CAS-16 | 事前検証が `warnings` を含む応答を返す | `create()` を呼ぶ | 警告では止まらず登録される（`validationWarnings` は空のまま。CA では警告を扱わない） | 実装済 |
| CAS-17 | 既定モック | `load()` の後に一覧の 1 件の `id` と `updatedAt` を添えて `update()` を呼ぶ | 更新後の 1 件が返り、一覧の該当行が新しい内容になる。`total` は変わらない | 実装済 |
| CAS-18 | 事前検証が不合格を返す（銘柄マスタに無い銘柄コード） | `update()` を呼ぶ | 戻り値が `null`、`updateValidationErrors` に理由が入り、`updateError` は `null` のまま。一覧は変わらない | 実装済 |
| CAS-19 | `PUT /api/masters/ca/{id}` が 409 を返す（古い `updatedAt` を送る） | `update()` を呼ぶ | 戻り値が `null`、`updateError` に競合の理由が入る。`updateValidationErrors` は空のまま。一覧は自動で読み直されない | 実装済 |
| CAS-20 | 既定モック。登録も更新も失敗させた状態 | `clearUpdateError()` を呼ぶ | 更新側（`updateError` / `updateValidationErrors`）だけが空になり、登録側（`createError` / `validationErrors`）は残る | 実装済 |
| CAS-21 | 既定モック。CA種別で絞り込んだ状態 | 絞り込みの圏外へ CA種別を変えて `update()` する | 読み直しで絞り込み条件が落ちない（`caType` が残る）。`total` が 1 減る | 実装済 |
| CAS-22 | 既定モック | `load()` の後に一覧の 1 件を `remove()` する | `true` が返り、`total` が 1 減ってその行が一覧から消える（実 API は論理削除だが、一覧は取消済みを返さない） | 実装済 |
| CAS-23 | `DELETE /api/masters/ca/{id}` が 500 を返す | `remove()` を呼ぶ | `false` が返り、`deleteError` に理由が入る。`total` は変わらない | 実装済 |
| CAS-24 | 既定モック。前回の `remove()` が失敗している | `clearDeleteError()` を呼ぶ | `deleteError` が空になる（確認モーダルを開き直したときに前回の失敗を残さない） | 実装済 |
