# api/orders（注文一覧 API 層）

- 略号: `ORA`
- 対象: `src/api/orders.js`
- テスト: `src/api/orders.spec.js`

バックエンドの形（`items` 配列・`ordered_at` の snake_case）を知ってよいのはこの層だけ。
この文書が守るのは **送り出すリクエストの形** と **生データ 1 件をアプリ内モデルへ変換する規則** の 2 つ。

ストア（[stores-orders.md](stores-orders.md)）と画面（[views-order-list-view.md](views-order-list-view.md)）は
MSW のモックが返した結果を見ているので、モックと実装が同じ誤解をしていても気づけない。
そこでここでは応答ではなく**リクエストそのもの**と、**モックのフィクスチャを起点にした変換結果**を突き合わせる。

取り違えやすい点を 2 つ固定する。

- **戻り値は配列そのもの。** `fetchCorporateActions()` のような `{ items, total }` ではなく、
  変換済みの注文の配列だけを返す（応答の `total` は外へ出さない）
- **`null` を空文字へ寄せない。** [api-ca.md](api-ca.md) の `ca.js` は `null` を空文字に畳むが、
  この層は素通しする。整形は表示側の責務という前提をここで明示しておく

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ORA-01 | 既定モック | `fetchOrders()` を呼ぶ | `GET /api/orders`（baseURL が付く）へ 1 回送られ、クエリは 1 つも載らない（絞り込み・ページングを持たない API） | 実装済 |
| ORA-02 | API が注文 1 件（8 項目すべて）を返す | `fetchOrders()` を呼ぶ | `ordered_at` が `orderedAt` になり、`id` / `symbol` / `name` / `side` / `quantity` / `price` / `status` は同名で値がそのまま入る | 実装済 |
| ORA-03 | API が `ordered_at` 以外に `settled_at` などアプリが使わないキーを含めて返す | `fetchOrders()` を呼ぶ | 返る要素のキーは上記 8 つだけ（未知のキーを画面へ素通ししない） | 実装済 |
| ORA-04 | API が注文 3 件を返す | `fetchOrders()` を呼ぶ | 応答の並び順のまま 3 要素の配列が返る（`total` などのメタは返さず配列そのもの） | 実装済 |
| ORA-05 | API が `items` を持たない応答 / `items: null` の応答を返す | `fetchOrders()` を呼ぶ | どちらも空配列が返る（落ちない） | 実装済 |
| ORA-06 | API が `items: []` を返す | `fetchOrders()` を呼ぶ | 空配列が返る | 実装済 |
| ORA-07 | API が `quantity` / `price` を数値、`side` / `status` を文字列で返す | `fetchOrders()` を呼ぶ | 数値は数値のまま（文字列化も丸めもしない）、`side` / `status` は原文字列のまま（表示用の言い換えをこの層でしない） | 実装済 |
| ORA-08 | API が `ordered_at` を `null` で返す / `ordered_at` キー自体が無い | `fetchOrders()` を呼ぶ | `orderedAt` はそれぞれ `null` / `undefined` になる（`ca.js` と違い空文字へは寄せない＝整形は表示側の責務） | 実装済 |
| ORA-09 | 既定モック（`src/mocks/fixtures/orders.js` の `orderListResponse`） | `fetchOrders()` を呼ぶ | フィクスチャの `items` と同じ件数が返り、先頭要素の `orderedAt` がフィクスチャ先頭の `ordered_at` と一致する（モックと実装の理解が揃っている） | 実装済 |
| ORA-10 | API が 500 を返す | `fetchOrders()` を呼ぶ | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる。文言・`status` の契約は [api-client.md](api-client.md) 側で固定） | 実装済 |
