# stores/customerSearch（顧客検索のストア）

- 略号: `CSS`
- 対象: `src/stores/customerSearch.js`
- テスト: `src/stores/customerSearch.spec.js`

顧客検索（`/customers/search`）の一覧。読む API は顧客マスタと同じ `fetchCustomers`
（`GET /masters/customers`）で、足回りは `useCrudList`（[composables-use-crud-list.md](composables-use-crud-list.md)）。
**一覧は読むだけ**で、**顧客マスタのストア（[stores-customers.md](stores-customers.md)）とは別インスタンス**。
同じストアを使うと、こちらの検索が顧客マスタ画面の検索条件とページ位置を踏み潰す。

MSW の既定ハンドラに当て、期待値はフィクスチャ（`src/mocks/fixtures/customers.js`）と
`CUSTOMER_SEARCH_PAGE_SIZE` から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CSS-01 | 既定モック | `load()` を引数なしで呼ぶ | `items` が 1 ページ分（`CUSTOMER_SEARCH_PAGE_SIZE` 件）で口座番号の昇順、`total` がフィクスチャの件数、`limit` が `CUSTOMER_SEARCH_PAGE_SIZE` | 実装済 |
| CSS-02 | 既定モック | `load({ branchCode, handlerCode, accountNumber, customerName })` を先頭行の値で呼ぶ | 4 つの条件がすべて効いてその顧客だけが返り、条件がストアに残る | 実装済 |
| CSS-03 | 既定モック。条件付きで読み込み済み | 条件を渡さずに `load()` を呼ぶ | 前の条件は残らず（すべて `''`）、全件の 1 ページ目に戻る | 実装済 |
| CSS-04 | 既定モック | `load({ customerName: '該当なし' })` を呼ぶ | `items` が空、`total` が 0、`isEmpty` が `true` | 実装済 |
| CSS-05 | API が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`items` は空、`isEmpty` は `false` | 実装済 |
| CSS-06 | 既定モック | ストアの公開名を読む | `create` / `update` / `remove` とその状態を持たない（読むだけの一覧） | 実装済 |
| CSS-07 | 既定モック | 顧客マスタのストアを部店で絞って読み、続けて顧客検索のストアを 2 ページ目で読む | 互いの条件・ページ位置・`items` が混ざらない（別インスタンス） | 実装済 |
