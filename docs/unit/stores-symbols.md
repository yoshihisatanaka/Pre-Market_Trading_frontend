# stores/symbols（銘柄マスタのストア）

- 略号: `STS`
- 対象: `src/stores/symbols.js`
- テスト: `src/stores/symbols.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/index.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。

この一覧は**新規追加まで**を持つ。`useCrudList` は渡した関数のぶんだけ名前を公開するので、
登録系（`create` / `creating` / `createError` / `validationErrors` / `clearCreateError`）が
公開され、**更新・削除の名前はまだ公開されない**ことを守る（STS-10）。
CRUD 一式まで持つストアの例は [stores-ca.md](stores-ca.md)。

登録は「サーバの事前検証 → 登録」の 2 段で、**不合格（`validationErrors`）と
通信・サーバ障害（`createError`）は別の入れ物に入る**。片方に混ざると画面がエラーを
出す場所を間違えるので、STS-13 / 14 でその分離を守る。
事前検証が返す `warnings` は銘柄マスタでは使わない（api 層が捨てる）ので、
警告付きの応答でも登録は止まらない（STS-17）。

表示件数（`SYMBOLS_PAGE_SIZE`）は api 層が `limit` として送る値（[api-symbols.md](api-symbols.md)）。
モックも受け取った `limit` でページを切るので、ここを変えれば返る件数も変わる。

期待値はフィクスチャ（`src/mocks/fixtures/symbols.js`）と `SYMBOLS_PAGE_SIZE` から導き、
56 / 50 / `'AAPL'` のような値を直接書かない（フィクスチャが伸びてもテストが壊れないようにする）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| STS-01 | 既定モック | `load()` を引数なしで呼ぶ | `items` が 1 ページ分（`SYMBOLS_PAGE_SIZE` 件）銘柄コードの昇順で入り、`total` がフィクスチャの全件数、`offset` が 0 になる | 実装済 |
| STS-02 | 既定モック | `load({ offset: SYMBOLS_PAGE_SIZE })` を呼ぶ | 2 ページ目の残り件数が返り、`offset` が渡した値になる | 実装済 |
| STS-03 | 既定モック | `load({ symbolCode: <フィクスチャの Ticker> })` を呼ぶ | その銘柄の行だけが返り、`symbolCode` に条件が残る。銘柄コードと Ticker のどちらに当たってもよい（部分一致） | 実装済 |
| STS-04 | 既定モック | `load({ regulation: <取引不可のコード> })` を呼ぶ | 規制情報が一致する行だけが返り、`regulation` に条件が残る | 実装済 |
| STS-05 | 既定モック | `load({ orderRoute, vwapTarget })` を同時に渡して呼ぶ | 2 条件の AND で絞られ、どちらの条件も残る | 実装済 |
| STS-06 | 既定モック | `load({ symbolCode: 'ZZZZ' })` を呼ぶ（該当なし） | `items` が空、`total` が 0、`isEmpty` が `true` になる | 実装済 |
| STS-07 | API が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`items` が空のまま。`isEmpty` は `false`（空とエラーを別の状態として出し分けるため） | 実装済 |
| STS-08 | API の応答が遅い | `load()` を await せずに `loading` を読む | 取得中は `true`、完了後に `false` になる | 実装済 |
| STS-09 | 既定モック。絞り込んだ 2 ページ目を読み込み済み | `reload()` を呼ぶ | 同じ条件・同じ `offset` のまま読み直す（条件が落ちない） | 実装済 |
| STS-10 | 既定モック | ストアの公開名を読む | `create` とその状態（`creating` / `createError` / `validationErrors` / `clearCreateError`）を公開する。`update` / `remove` とその状態（`updating` / `deleting` など）は持たない（まだ配線していない操作を見せない） | 実装済 |
| STS-11 | API の応答が遅い | 2 ページ目 → 1 ページ目の順に `load()` を続けて呼び、先に投げたほうを遅く返す | 最後に投げた `load()` の結果が残る（古い応答が新しい結果を上書きしない） | 実装済 |
| STS-12 | 既定モック | `load()` の後に一覧に無い銘柄コードで `create()` を呼ぶ | 登録された 1 件が返り、`total` が 1 増える（成功時は今の条件のまま一覧を読み直す） | 実装済 |
| STS-13 | 事前検証が不合格を返す（既にある銘柄コード） | `create()` を呼ぶ | 戻り値が `null`、`validationErrors` に理由が入り、`createError` は `null` のまま。`total` は増えない | 実装済 |
| STS-14 | `POST /api/masters/symbols` が 500 を返す | `create()` を呼ぶ | 戻り値が `null`、`createError` に理由が入り、`validationErrors` は空のまま | 実装済 |
| STS-15 | 既定モック。前回の `create()` が失敗している | `clearCreateError()` を呼ぶ | `createError` と `validationErrors` が空になる（モーダルを開き直したときに前回の失敗を残さない） | 実装済 |
| STS-16 | 既定モック。取引可否で絞り込んだ状態 | 絞り込みに合う銘柄を `create()` する | 読み直しで絞り込み条件が落ちない（`regulation` が残り、一覧も条件に合う行だけ） | 実装済 |
| STS-17 | 事前検証が `warnings` を含む応答を返す | `create()` を呼ぶ | 警告では止まらず登録される（`validationWarnings` は空のまま。銘柄マスタでは警告を扱わない） | 実装済 |
