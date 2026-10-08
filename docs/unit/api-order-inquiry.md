# api/orderInquiry（注文照会 API 層）

- 略号: `OIA`
- 対象: `src/api/orderInquiry.js`
- テスト: `src/api/orderInquiry.spec.js`

パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が全 api をまとめて見るので、ここでは
**この層の変換**（生の `OrderItemResponse` ↔ アプリ内モデル）と**元注文ごとのまとめ方**、
注文照会から入る**1 件の詳細・訂正・取消**の送り方と読み方を守る。

まとめ方（`元注文ID` と `注文種別` の読み方）は仕様に書かれておらず推定で置いている
（`src/api/orderInquiry.js` 冒頭の「推定で置いているもの」）。バックエンドに確かめて変わったら、
OIA-09〜11 を書き直す。

詳細の `order`（OrderRecord）は 2026-10-06 の回答で一覧と同じ派生項目（顧客名・処理状況名・出来数量 …）を持つ。
MSW も一覧の行をそのまま（`注文ルートコード` を足して）返す（`src/mocks/handlers/orders.js`）。派生項目の無い応答
（古いサーバ）では従来どおり約定の合計に落ちることも守る。件数・値の期待値は `src/mocks/fixtures/orderInquiry.js` から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OIA-01 | 既定モック | `fetchOrderInquiry()` | `{ items, total }` を返し、`total` は注文の行数（フィクスチャの件数）、`items` は元注文ごとのまとまりの数。`items[0].latest` のキーがすべて camelCase | 実装済 |
| OIA-02 | 既定モック | `fetchOrderInquiry({ branchCode: '', symbol: '' })` | 空文字の条件はクエリに載せない（MSW が受けた URL にそのキーが無い）。`limit` / `offset` は常に載る | 実装済 |
| OIA-03 | 既定モック | `fetchOrderInquiry({ branchCode: '123', accountNumber: '300001', symbol: 'AAPL' })` | `branch_code=123` / `account_no=300001` / `symbol=AAPL` で送られる | 実装済 |
| OIA-04 | 既定モック | `fetchOrderInquiry({ accountNumber: '30-01' })` | 数字だけでない口座番号は `account_no` に載せない（422 を避ける） | 実装済 |
| OIA-05 | 既定モック | `executionStatus` にコードマスタ `注文照会出来状況` のコード（`000` / `003` / `010` / `011` / `034` / `101`）を順に渡す | `status` クエリに載る。取消済の `034` は `032,034`、注文エラーの `101` は `101,103` に広げ、ほかはそのまま | 実装済 |
| OIA-06 | 売買区分が `'1'` / `'3'` / `'9'` の行 | `fetchOrderInquiry()` | `side` がそれぞれ `'sell'` / `'buy'` / `''` になる | 実装済 |
| OIA-07 | 受注日・受注時刻が `'2026-09-28'` + `'09:15:00'` / `'20260928'` + `'0915'` / 片方 `null` の行 | `fetchOrderInquiry()` | `orderedAt` が `'2026-09-28T09:15:00'` / `'2026-09-28T09:15:00'` / `''` になる | 実装済 |
| OIA-08 | 成行（指値単価 `null`）・出来数量 `0`・約定代金 `null` の行 | `fetchOrderInquiry()` | `limitPrice` と `filledAmountUsd` は `null`、`filledQuantity` は `0` のまま（0 と未取得を区別する） | 実装済 |
| OIA-09 | 既定モック | `fetchOrderInquiry()` | `元注文ID` が 30 の行（#33 / #36）は起点 #30 のまとまりに入り、`latest` が #36、`history` が #30 → #33 の古い順になる | 実装済 |
| OIA-10 | 既定モック | `fetchOrderInquiry()` | `注文種別` が `'SLICE_CHILD'` の行（#43〜#45）は #35 の `slices` に ID 順で入り、`history` には入らない | 実装済 |
| OIA-11 | 子注文だけが返り、親の行が無い応答 | `fetchOrderInquiry()` | 子注文が 1 件ずつ独立した行（`history` / `slices` が空）になる | 実装済 |
| OIA-12 | 処理状況が `'000'` / `'003'` / `'010'` / `'131'` / `'133'` / `'101'` / `'103'` / `'141'` / `'011'` / `'034'` / `'040'` の行 | `fetchOrderInquiry()` | `cancelable` は `'141'` までの 8 つで true・後の 3 つで false、`amendable` は `'000'` / `'003'` / `'010'` だけ true | 実装済 |
| OIA-13 | 処理状況が `'010'` / `'101'` / `'034'` / `'002'` の行 | `fetchOrderInquiry()` | `statusTone` が `'partial'` / `'error'` / `'canceled'` / `''` になる | 実装済 |
| OIA-14 | 既定モック | `fetchOrderInquiry({ executionStatus: '' })` / 引数なし | `status` クエリを載せない（選択肢に無い値を落とすのは画面の役目。OIV-11） | 実装済 |
| OIA-15 | 既定モック（#35 は一部出来） | `fetchOrderDetail('35')` | `GET /orders/35` を読み、`id` / 部店 / 口座番号（文字列）/ `customerName`（顧客名）/ 銘柄 / `side` / 数量 / 指成区分 / 指値単価 / 発注範囲 / `vwap` / `status`（処理状況コード）/ `statusName`（処理状況名）/ `orderedAt` がフィクスチャの行から変換され、`filledQuantity` はその行の出来数量、`amendable` / `cancelable` は true になる | 実装済 |
| OIA-16 | `Ticker` が `'BRK.B'`・`銘柄コード` が `'BRKB'` の行 / `Ticker` が空の行 | `fetchOrderDetail(id)` | `symbol` は `Ticker` を優先し、空なら `銘柄コード` になる | 実装済 |
| OIA-17 | `order` に派生項目（出来数量 など）が無い（古いサーバ）。`executions` が 2 件（約定数量 30 と `'20'`）/ 空配列 / 項目なし | `fetchOrderDetail(id)` | `filledQuantity` がそれぞれ 50 / 0 / 0 になる | 実装済 |
| OIA-18 | `指値単価` が `'410.0000'`（数値の文字列）/ `410` / `null` | `fetchOrderDetail(id)` | `limitPrice` がそれぞれ 410 / 410 / `null` になる | 実装済 |
| OIA-19 | 既定モック（無い注文 ID） | `fetchOrderDetail(無い ID)` | `status` が 404、`message` がサーバの detail の ApiError で reject する | 実装済 |
| OIA-20 | 応答を記録する | `amendOrder({ id: '36', quantity: 30, limitPrice: 145 })` | `POST /orders/36/amend` に `{ 数量: 30, 指値単価: 145 }` だけが送られる（渡していない項目のキーは本文に無い） | 実装済 |
| OIA-21 | 応答を記録する | `amendOrder({ id, orderType: 'MO', marketScope: '02', reason: '' })` → `reason: 'お客様申出'` で再度 | 1 回目は `{ 指成区分: 'MO', 発注範囲: '02' }`（空の理由は送らない）、2 回目は `理由: 'お客様申出'` が加わる | 実装済 |
| OIA-22 | 既定モック（#36 は未発注） | `amendOrder({ id: '36', quantity: 30 })` | `{ mode: 'inPlace', originalOrderId: '36', amendmentOrderId: '', message: サーバの文言, warnings: [] }` になる | 実装済 |
| OIA-23 | 既定モック（#34 は注文中） | `amendOrder({ id: '34', quantity: 600 })` | `mode` が `'cancelReplace'`、`originalOrderId` が `'34'`、`amendmentOrderId` がフィクスチャの最大 ID + 1 の文字列になる | 実装済 |
| OIA-24 | 200 で `success: false`（message あり / なし） | `amendOrder(...)` | message があればその文言、無ければ「注文を訂正できませんでした。」の ApiError で reject する | 実装済 |
| OIA-25 | 200 で `mode` が未知・`warnings` に `null` / 空文字 / 文字列が混ざる | `amendOrder(...)` | `mode` は `''`、`warnings` は空でない文字列だけになる | 実装済 |
| OIA-26 | 既定モック（#41 は全部出来 / 無い ID） | `amendOrder({ id: '41', quantity: 1 })` / 無い ID | 400 は `status` 400・サーバの detail の ApiError、無い ID は `status` 404 の ApiError で reject する | 実装済 |
| OIA-27 | 応答を記録する | `cancelOrder({ id: '36' })` | `POST /orders/36/cancel` に空のオブジェクト `{}` が送られる（理由・取消者を載せない） | 実装済 |
| OIA-28 | 既定モック（#36 は未発注） | `cancelOrder({ id: '36' })` | `{ orderId: '36', message: サーバの文言, warnings: [] }` になる | 実装済 |
| OIA-29 | 200 で `success: false`（errors が 2 件 / errors が空で message あり / どちらも無い） | `cancelOrder(...)` | errors を ` / ` で連結した文言 / message / 「注文を取り消せませんでした。」の ApiError で reject する | 実装済 |
| OIA-30 | 既定モック（#41 は全部出来） | `cancelOrder({ id: '41' })` | `status` 400・サーバの detail の ApiError で reject する | 実装済 |
| OIA-31 | `executions` は約定数量 30 と `'20'`（合計 50）。`order` の 出来数量 が `70` / `'70.0000'` / `0` | `fetchOrderDetail(id)` | `filledQuantity` がそれぞれ 70 / 70 / 0（サーバの値を優先し、0 でも約定の合計に落とさない） | 実装済 |
| OIA-32 | `order` に 顧客名・処理状況名 がある / 派生項目の無い `order` | `fetchOrderDetail(id)` | `customerName` / `statusName` がその値 / どちらも `''` | 実装済 |
| OIA-33 | `強制区分` が `1` / `0` / `null` の行 | `fetchOrderInquiry()` | `forced` がそれぞれ true / false / false になる | 実装済 |
| OIA-34 | 既定モック（#35 は契約提案の判定結果 4 項目を持つスライスの親） | `fetchOrderInquiry()` | #35 の `latest.slicePlan` が `{ maxSliceQuantity, reasons, averageVolume, referencePrice }` にフィクスチャの `スライス適用上限数量` / `スライス適用理由` / `スライス平均出来高` / `スライス参照価格` の値で入る。子注文と、ほかのまとまりの `latest` は `slicePlan` が `null` | 実装済 |
| OIA-35 | `スライス適用理由` だけが `['理由A', null, '', '理由B']` の行 / `スライス参照価格` だけが `'337.5000'` の行 / `スライス適用理由` が `[]` だけの行 | `fetchOrderInquiry()` | 1 行目は `reasons` が `['理由A', '理由B']` でほかは `null`、2 行目は `referencePrice` が 337.5・`reasons` が `[]`、3 行目は `slicePlan` が `null`（4 項目のどれも無い行は null） | 実装済 |
