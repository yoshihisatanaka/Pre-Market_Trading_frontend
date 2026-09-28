# api/orderInquiry（注文照会 API 層）

- 略号: `OIA`
- 対象: `src/api/orderInquiry.js`
- テスト: `src/api/orderInquiry.spec.js`（未実装）

パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が全 api をまとめて見るので、ここでは
**この層の変換**（生の `OrderItemResponse` ↔ アプリ内モデル）と**元注文ごとのまとめ方**を守る。

まとめ方（`元注文ID` と `注文種別` の読み方）は仕様に書かれておらず推定で置いている
（`src/api/orderInquiry.js` 冒頭の「推定で置いているもの」）。バックエンドに確かめて変わったら、
OIA-09〜11 を書き直す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OIA-01 | 既定モック | `fetchOrderInquiry()` | `{ items, total }` を返し、`total` は注文の行数（14）、`items` は元注文ごとの 8 件。`items[0].latest` のキーがすべて camelCase | 未着手 |
| OIA-02 | 既定モック | `fetchOrderInquiry({ branchCode: '', symbol: '' })` | 空文字の条件はクエリに載せない（MSW が受けた URL にそのキーが無い）。`limit` / `offset` は常に載る | 未着手 |
| OIA-03 | 既定モック | `fetchOrderInquiry({ branchCode: '123', accountNumber: '300001', symbol: 'AAPL' })` | `branch_code=123` / `account_no=300001` / `symbol=AAPL` で送られる | 未着手 |
| OIA-04 | 既定モック | `fetchOrderInquiry({ accountNumber: '30-01' })` | 数字だけでない口座番号は `account_no` に載せない（422 を避ける） | 未着手 |
| OIA-05 | 既定モック | `fetchOrderInquiry({ executionStatus: '注文中' })` | `status` クエリを送らない（出来状況と処理状況コードの対応が未確定） | 未着手 |
| OIA-06 | 売買区分が `'1'` / `'3'` / `'9'` の行 | `fetchOrderInquiry()` | `side` がそれぞれ `'sell'` / `'buy'` / `''` になる | 未着手 |
| OIA-07 | 受注日・受注時刻が `'2026-09-28'` + `'09:15:00'` / `'20260928'` + `'0915'` / 片方 `null` の行 | `fetchOrderInquiry()` | `orderedAt` が `'2026-09-28T09:15:00'` / `'2026-09-28T09:15:00'` / `''` になる | 未着手 |
| OIA-08 | 成行（指値単価 `null`）・出来数量 `0`・約定代金 `null` の行 | `fetchOrderInquiry()` | `limitPrice` と `filledAmountUsd` は `null`、`filledQuantity` は `0` のまま（0 と未取得を区別する） | 未着手 |
| OIA-09 | 既定モック | `fetchOrderInquiry()` | `元注文ID` が 30 の行（#33 / #36）は起点 #30 のまとまりに入り、`latest` が #36、`history` が #30 → #33 の古い順になる | 未着手 |
| OIA-10 | 既定モック | `fetchOrderInquiry()` | `注文種別` が `'SLICE_CHILD'` の行（#43〜#45）は #35 の `slices` に ID 順で入り、`history` には入らない | 未着手 |
| OIA-11 | 子注文だけが返り、親の行が無い応答 | `fetchOrderInquiry()` | 子注文が 1 件ずつ独立した行（`history` / `slices` が空）になる | 未着手 |
| OIA-12 | 処理状況が `'000'` / `'003'` / `'010'` / `'101'` / `'011'` / `'034'` の行 | `fetchOrderInquiry()` | `cancelable` は前の 4 つで true・後の 2 つで false、`amendable` は前の 3 つだけ true | 未着手 |
| OIA-13 | 処理状況が `'010'` / `'101'` / `'034'` / `'002'` の行 | `fetchOrderInquiry()` | `statusTone` が `'partial'` / `'error'` / `'canceled'` / `''` になる | 未着手 |
