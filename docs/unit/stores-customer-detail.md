# stores/customerDetail（顧客詳細のストア）

- 略号: `CDE`
- 対象: `src/stores/customerDetail.js`
- テスト: `src/stores/customerDetail.spec.js`

顧客詳細（`/customers/:customerId/summary`・`/orders`）の顧客カードと外株預り。
`load(id)` は 2 段で、顧客（`GET /masters/customers/{account_id}`）を読み、その部店コードと口座番号で
預り（`GET /holdings`、`limit` は `CUSTOMER_HOLDINGS_LIMIT`）を読む。

守るのは次の 4 つ。

- **別の顧客を開いたら前の顧客の値を即座に捨てる。** 同じ顧客の読み直しは値を残したまま読む
- **応答の追い越し。** 最後に出した `load` の結果だけを採り、古い `load` の結果・失敗で上書きしない
- **預りが失敗しても顧客カードは残る。** 404 は `customerNotFound` で通信障害と分ける
- **`valuation`（評価額・評価損益の合計）は出せるときだけ数値。** 読み込み中・失敗・上限を超えて読み切れて
  いない（`total` > 件数）ときは `null`。0 件なら 0。`null` の金額は合計に入れない

MSW の既定ハンドラ（`src/mocks/handlers/customers.js` / `holdings.js`）に当て、期待値はフィクスチャ
（`src/mocks/fixtures/customers.js` / `holdings.js`）から導く。使う顧客は 3 種で、いずれもフィクスチャから引く:
CA 発生中の明細を持つ顧客 / 預りはあるが CA の無い顧客 / 預りの無い顧客。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CDE-01 | 既定モック | CA のある顧客の行 ID で `load()` を呼ぶ | `customer` がその顧客（`id` / `accountNumber`）、`holdings` がフィクスチャのその口座の明細（行キーの順）、`holdingsTotal` が件数。`holdingsPending` / `holdingsEmpty` は `false` | 実装済 |
| CDE-02 | 既定モック | `load()` を呼ぶ | 預りの検索は顧客の `branch_code` と `account_no`、`limit=CUSTOMER_HOLDINGS_LIMIT` で送られる | 実装済 |
| CDE-03 | 顧客の取得が 404 | `load()` を呼ぶ | `customerNotFound` が `true`、`customer` は `null`。預りは読みに行かない | 実装済 |
| CDE-04 | 顧客の取得が 500 | `load()` を呼ぶ | `customerError` に理由が入り、`customerNotFound` は `false`（見つからないと通信障害を分ける） | 実装済 |
| CDE-05 | 預りの取得が 500 | `load()` を呼ぶ | `customer` は残り、`holdingsError` に理由が入る。`holdingsPending` / `holdingsEmpty` は `false`、`valuation` は `null` | 実装済 |
| CDE-06 | CDE-05 の状態から預りが直った | `reloadHoldings()` を呼ぶ | 同じ顧客の預りが入り、`holdingsError` が消える | 実装済 |
| CDE-07 | 何も読んでいない | `reloadHoldings()` を呼ぶ | `null` が返り、預りは読みに行かない | 実装済 |
| CDE-08 | 顧客 A を読み込み済み | 顧客 B の `load()` を呼んだ直後（応答前）に値を読む | `customer` が `null`、`holdings` が空、`valuation` が `null`（A のカードを B の画面に出さない） | 実装済 |
| CDE-09 | 顧客 A を読み込み済み | 同じ A の `load()` を呼んだ直後（応答前）に値を読み、完了を待つ | 応答前も `customer` と `holdings` は A のまま。完了後も A | 実装済 |
| CDE-10 | 顧客の応答が遅い（A を遅く、B を速く返す） | A → B の順に `load()` を続けて呼ぶ | `customer` と `holdings` は B（古い A の結果で上書きしない） | 実装済 |
| CDE-11 | A の顧客取得が遅れて 500、B は成功 | A → B の順に `load()` を続けて呼ぶ | `customer` は B で、`customerError` は `null`（古い失敗で上書きしない） | 実装済 |
| CDE-12 | 預りの応答が遅い | `load()` の前・顧客を読み終えた瞬間・預りの読み込み中・完了後に `holdingsPending` を読む | 前・読み終えた瞬間（預りを読み始める前）・読み込み中は `true`、完了後は `false` | 実装済 |
| CDE-13 | 既定モック | 預りの無い顧客で `load()` を呼ぶ | `holdingsEmpty` が `true`、`valuation` が `{ valueJpy: 0, profitLossJpy: 0 }`、`hasCorporateAction` が `false` | 実装済 |
| CDE-14 | 既定モック | CA のある顧客 / CA の無い顧客で `load()` を呼ぶ | `hasCorporateAction` が `true` / `false` | 実装済 |
| CDE-15 | 既定モック | CA のある顧客で `load()` を呼ぶ | `valuation` がその口座の明細の `評価額_JPY` と `評価損益` の合計 | 実装済 |
| CDE-16 | 預りの応答の `total` が返った件数より多い | `load()` を呼ぶ | `valuation` が `null`（一部だけの合計を出さない） | 実装済 |
| CDE-17 | 預りの 1 件の `評価額_JPY` / `評価損益` が `null` | `load()` を呼ぶ | `null` の金額を飛ばした合計になる | 実装済 |
| CDE-18 | 預りの応答が遅い | 読み込み中に `valuation` を読む | `null` | 実装済 |
