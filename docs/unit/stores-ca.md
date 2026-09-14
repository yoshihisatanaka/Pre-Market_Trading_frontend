# stores/ca（CAマスタのストア）

- 略号: `CAS`
- 対象: `src/stores/ca.js`
- テスト: `src/stores/ca.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/index.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。

この一覧は**取得と登録**を持ち、更新・削除はまだ持たない。`useCrudList` は渡さなかった操作の
名前を公開しないので、「何を公開し、何を公開していないか」も守る（CAS-09）。
CRUD 一式を持つストアの例は [stores-blackout-dates.md](stores-blackout-dates.md)。

登録は「サーバの事前検証 → 登録」の 2 段。**不合格は例外ではなく `validationErrors`** に入り、
通信・サーバ障害だけが `createError` に入る（CAS-12 / 13）。

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
| CAS-09 | 既定モック | ストアの公開名を読む | `create` / `creating` / `validationErrors` を公開し、`update` / `remove` とその状態（`updating` / `deleting`）は持たない（まだ無い操作を、できるように見せない） | 実装済 |
| CAS-10 | API の応答が遅い | 2 ページ目 → 1 ページ目の順に `load()` を続けて呼び、先に投げたほうを遅く返す | 最後に投げた `load()` の結果が残る（古い応答が新しい結果を上書きしない） | 実装済 |
| CAS-11 | 既定モック | `load()` の後に `create({ stockCode: <フィクスチャの銘柄>, caType: '120' })` を呼ぶ | 登録された 1 件が返り、`total` が 1 増える（成功時は今の条件のまま一覧を読み直す） | 実装済 |
| CAS-12 | 事前検証が不合格を返す（銘柄マスタに無い銘柄コード） | `create()` を呼ぶ | 戻り値が `null`、`validationErrors` に理由が入り、`createError` は `null` のまま。`total` は増えない | 実装済 |
| CAS-13 | `POST /api/ca` が 500 を返す | `create()` を呼ぶ | 戻り値が `null`、`createError` に理由が入り、`validationErrors` は空のまま | 実装済 |
| CAS-14 | 既定モック。前回の `create()` が失敗している | `clearCreateError()` を呼ぶ | `createError` と `validationErrors` が空になる（モーダルを開き直したときに前回の失敗を残さない） | 実装済 |
| CAS-15 | 既定モック。CA種別で絞り込んだ状態 | 絞り込みに合う CA を `create()` する | 読み直しで絞り込み条件が落ちない（`caType` が残り、一覧も条件に合う行だけ） | 実装済 |
| CAS-16 | 事前検証が `warnings` を含む応答を返す | `create()` を呼ぶ | 警告では止まらず登録される（`validationWarnings` は空のまま。CA では警告を扱わない） | 実装済 |
