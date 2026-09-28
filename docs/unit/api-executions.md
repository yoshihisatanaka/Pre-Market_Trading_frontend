# api/executions（約定照会 API 層）

- 略号: `EXA`
- 対象: `src/api/executions.js`
- テスト: `src/api/executions.spec.js`

> パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が全 api をまとめて見るので、ここでは
> **この層の変換**（生の形 ↔ アプリ内モデル）と**送るクエリの形**だけを守る。

ここだけが**バックエンドの形**（パス・クエリ名・日本語のレスポンスキー・売買区分のコード・integer の ID）を
知ってよい層なので、「実際に送り出すリクエストの形」と「受け取った生データの変換」を守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| EXA-01 | 既定モック | `fetchExecutions()` | `{ items, total, summary }` を返し、`items[0]` のキーがすべて camelCase（`約定数量` → `quantity`、`約定代金` → `amountUsd` など） | 実装済 |
| EXA-02 | 既定モック | `fetchExecutions({ branchCode: '', symbol: '', side: '', status: '', dateFrom: '', dateTo: '', route: '' })` | 空文字の条件はクエリに載せない（MSW が受けた URL にそれらのキーが無い） | 実装済 |
| EXA-03 | 既定モック | 各条件に値を入れて `fetchExecutions()` | 仕様のクエリ名 `branch_code` / `symbol` / `status` / `start_date` / `end_date` / `route` でその値が送られる | 実装済 |
| EXA-04 | 既定モック | `side: 'buy'` / `'sell'` / `'x'` で呼ぶ | `side=3` / `side=1` が送られ、知らない値のときは `side` を送らない | 実装済 |
| EXA-05 | 応答の `売買区分` が `'3'` / `'1'` / `'9'` | `fetchExecutions()` | `side` が `'buy'` / `'sell'` / `''` になる | 実装済 |
| EXA-06 | 応答の nullable 項目が `null`（`顧客名` / `Ticker` / `約定単価` / `約定日時`） | `fetchExecutions()` | 文字列項目は `''`、数値項目は `null` のまま（0 と未取得を区別する） | 実装済 |
| EXA-07 | 既定モック | `fetchExecutions()` | `ID` / `注文ID` / `口座番号`（integer）が文字列の `id` / `orderId` / `accountNumber` になる | 実装済 |
| EXA-08 | 既定モック / `summary` が欠けた応答 | `fetchExecutions()` | `summary` が `count` / `orderCount` / `buyCount` / `sellCount` / `totalQuantity` / `totalAmountUsd` / `totalFeeUsd` に変換される。欠けているときは全項目 0 | 実装済 |
