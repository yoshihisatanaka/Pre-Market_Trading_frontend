# stores/customerOrders（顧客詳細の注文照会タブのストア）

- 略号: `COR`
- 対象: `src/stores/customerOrders.js`
- テスト: `src/stores/customerOrders.spec.js`

顧客詳細の注文照会タブ（`/customers/:customerId/orders`）の一覧。読む API は注文照会と同じ
`fetchOrderInquiry`（`GET /orders`）で、部店コードと口座番号をその顧客に固定して読む（画面が渡す）。
足回りは `useCrudList`。**注文照会のストア（[stores-order-inquiry.md](stores-order-inquiry.md)）とは別インスタンス**で、
**読むだけ**。

MSW の既定ハンドラに当て、期待値はフィクスチャ（`src/mocks/fixtures/orderInquiry.js`）から導く。
使う顧客はフィクスチャで注文の最も多い口座を件数から選ぶ（口座番号を直接書かない）。
行は元注文ごとにまとめられるので、期待する行の並びは注文照会の OIS と同じく「ID の降順で最初に現れた元注文」。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| COR-01 | 既定モック | `load({ branchCode, accountNumber })` をその顧客の値で呼ぶ | その口座の注文だけが元注文ごとの行で入り、`total` がその口座の注文の行数。部店・口座番号の条件がストアに残る | 実装済 |
| COR-02 | 既定モック | COR-01 の条件に銘柄（`symbol`）・出来状況（`executionStatus`）を足して呼ぶ | 4 条件がすべて効き、その口座のその銘柄・その処理状況の注文だけになる | 実装済 |
| COR-03 | 既定モック | 注文照会のストアを全件で読み、続けてこのストアを顧客の条件で読む | 互いの条件と `items` が混ざらない（別インスタンス） | 実装済 |
| COR-04 | 既定モック | ストアの公開名を読む | `create` / `update` / `remove` を持たない（訂正・取消は別画面） | 実装済 |
| COR-05 | API が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`items` は空、`isEmpty` は `false` | 実装済 |
| COR-06 | 既定モック | 注文の無い口座番号で `load()` を呼ぶ | `items` が空、`total` が 0、`isEmpty` が `true` | 実装済 |
| COR-07 | 既定モック | `limit` を読む | `CUSTOMER_ORDERS_PAGE_SIZE` | 実装済 |
