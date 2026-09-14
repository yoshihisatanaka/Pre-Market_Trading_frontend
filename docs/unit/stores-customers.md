# stores/customers（顧客マスタのストア）

- 略号: `CUS`
- 対象: `src/stores/customers.js`
- テスト: `src/stores/customers.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/index.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。

この一覧は**読むだけ**で、登録・更新・削除を持たない。`useCrudList` はそれらの関数を
渡さない限り更新系の名前を公開しないので、「公開していないこと」自体も守る（CUS-11）。
登録系まで持つストアの例は [stores-blackout-dates.md](stores-blackout-dates.md)。

期待値はフィクスチャ（`src/mocks/fixtures/customers.js`）と `CUSTOMERS_PAGE_SIZE` から導き、
56 / 50 のような数値を直接書かない（フィクスチャが伸びてもテストが壊れないようにする）。
検索条件に使う値もフィクスチャの先頭行から取る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CUS-01 | 既定モック | `load()` を引数なしで呼ぶ | `items` が 1 ページ分（`CUSTOMERS_PAGE_SIZE` 件）で口座番号の昇順、`total` がフィクスチャの全件数、`offset` が 0 になる | 実装済 |
| CUS-02 | 既定モック | `load({ offset: CUSTOMERS_PAGE_SIZE })` を呼ぶ | 2 ページ目の残り件数が返り、`offset` が渡した値になる | 実装済 |
| CUS-03 | 既定モック | `load({ branchCode: <フィクスチャの部店コード> })` を呼ぶ | その部店の行だけが返り、`branchCode` に条件が残る | 実装済 |
| CUS-04 | 既定モック | `load({ customerName: <顧客名の一部> })` / カナの一部を渡す | 顧客名・顧客名カナのどちらに当たっても絞り込まれる（部分一致） | 実装済 |
| CUS-05 | 既定モック | `load({ accountNumber: <フィクスチャの口座番号> })` を呼ぶ | その 1 件だけが返る（完全一致） | 実装済 |
| CUS-06 | 既定モック | `load({ restriction: '1' })` / `load({ accountType: '1' })` / `load({ corporateType: '1' })` を呼ぶ | 区分が一致する行だけが返り、それぞれの条件がストアに残る | 実装済 |
| CUS-07 | 既定モック | `load({ customerName: '該当なし' })` を呼ぶ | `items` が空、`total` が 0、`isEmpty` が `true` になる | 実装済 |
| CUS-08 | API が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`items` が空のまま。`isEmpty` は `false`（空とエラーを別の状態として出し分けるため） | 実装済 |
| CUS-09 | API の応答が遅い | `load()` を await せずに `loading` を読む | 取得中は `true`、完了後に `false` になる | 実装済 |
| CUS-10 | 既定モック。絞り込んだ状態を読み込み済み | `reload()` を呼ぶ | 同じ条件・同じ `offset` のまま読み直す（条件が落ちない） | 実装済 |
| CUS-11 | 既定モック | ストアの公開名を読む | `create` / `update` / `remove` とその状態（`creating` / `deleting` など）を持たない（読むだけの一覧に更新系を見せない） | 実装済 |
| CUS-12 | API の応答が遅い | 2 ページ目 → 1 ページ目の順に `load()` を続けて呼び、先に投げたほうを遅く返す | 最後に投げた `load()` の結果が残る（古い応答が新しい結果を上書きしない） | 実装済 |
| CUS-13 | 既定モック（削除済みの行がモックに存在する） | `load()` を呼ぶ | 削除済みの口座番号が `items` にも `total` にも含まれない | 実装済 |
