# views/CustomerOrdersView（顧客詳細の注文照会タブ）

- 略号: `COV`
- 対象: `src/views/CustomerOrdersView.vue`
- テスト: `src/views/CustomerOrdersView.spec.js`

実際の Pinia ストア + vue-router（`createMemoryHistory`）+ MSW(node) を通して、枠
（`CustomerDetailView`）ごと `/customers/:customerId/orders` からマウントする。
`global: { stubs: { teleport: true } }` を付ける（ヘッダの「新規注文」を wrapper 内に描かせる）。

一覧の **4 状態の出し分け**と、この画面に固有の 2 点を守る。

- `GET /orders` には顧客の部店・口座番号が**必ず**載り、URL クエリには載らない（URL に載るのは `symbol` / `status`）
- 0 件の文言が絞り込みの有無で変わる

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| COV-01 | `GET /orders` の応答を握ったまま | `/customers/1/orders` でマウントする | 一覧のローディングが出て、表・空・エラー・件数は出ない | 実装済 |
| COV-02 | `GET /orders` が 500 | `/customers/1/orders` でマウントする | エラーの理由と「再試行」が出て、表は出ない | 実装済 |
| COV-03 | COV-02 の状態 | 応答を既定に戻して「再試行」を押す | 一覧が出る | 実装済 |
| COV-04 | `GET /orders` が 0 件 | 絞り込みなしでマウントする | 「この顧客の注文はありません」が出て、表は出ない | 実装済 |
| COV-05 | 既定モック | `?symbol=<どの注文にも無い銘柄>` でマウントする | 「条件に一致する注文が見つかりませんでした」が出る | 実装済 |
| COV-06 | 既定モック（口座 1230001 の注文 3 行） | `/customers/1/orders` でマウントする | `GET /orders` に `branch_code=<部店>`・`account_no=<口座番号>` が載り、元注文ごとのまとまり（期待値はフィクスチャから導く）が並ぶ | 実装済 |
| COV-07 | 既定モック | `/customers/1/orders` でマウントする | 表の見出しに部店・口座番号・顧客名の列が無い | 実装済 |
| COV-08 | 既定モック | 銘柄コードを入れて「検索」 | URL クエリは `symbol` だけになり（部店・口座番号は載らない）、`GET /orders` には `symbol` と顧客の部店・口座番号が載る | 実装済 |
| COV-09 | 既定モック | `?status=003` でマウントする | 出来状況が「注文中」に復元され、`GET /orders` に `status=003` と顧客の部店・口座番号が載る | 実装済 |
| COV-10 | 既定モック | `?status=不明な値` でマウントする | 出来状況は空で、`GET /orders` に `status` が載らない | 実装済 |
| COV-11 | 既定モック（発注権限あり） | ヘッダの「新規注文」を押す | `/orders/new?branch_code=<部店>&account_number=<口座番号>` へ移る | 実装済 |
| COV-12 | `GET /auth/me` が発注権限なしの操作者 | `/customers/1/orders` でマウントする | ヘッダの「新規注文」と訂正・取消が出ず、各行が「閲覧のみ」になる | 実装済 |
| COV-13 | 既定モック（#38 は #42 に訂正済み） | #38 のまとまりの「訂正」を押す | `order-amend` へ最新の版（#42）の注文 ID で移る | 実装済 |
| COV-14 | 既定モック | #38 のまとまりの「取消」を押す | `order-cancel` へ最新の版（#42）の注文 ID で移る | 実装済 |
