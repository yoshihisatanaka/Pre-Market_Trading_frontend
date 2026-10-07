# api/mizuhoExecutions（みずほ注文締の約定一覧 API 層）

- 略号: `MZE`
- 対象: `src/api/mizuhoExecutions.js`
- テスト: `src/api/mizuhoExecutions.spec.js`

`GET /executions` を注文ルート `0`（みずほ）に固定して読む。パス・クエリ名が仕様に在るかは
`api-contract.md`（`CON`）が見るので、ここでは**この層の変換**（生の形 ↔ アプリ内モデル）と**送るクエリの値**だけを守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MZE-01 | 既定モック | `fetchMizuhoExecutions()` | `{ items, total, summary }` を返し、`items[0]` のキーがすべて camelCase（`ID` → `id` の文字列、`注文数量` → `quantity`、`約定単価` → `executedPrice`） | 実装済 |
| MZE-02 | 既定モック | `fetchMizuhoExecutions()` | 条件を渡さなくても `route=0` が必ず送られ、空文字の条件（`branch_code` など）はクエリに載らない | 実装済 |
| MZE-03 | 既定モック | `fetchMizuhoExecutions({ dateFrom: '2026-09-01', dateTo: '2026-09-30' })` | `start_date` / `end_date` にその値がそのまま送られる | 実装済 |
| MZE-04 | 既定モック | `fetchMizuhoExecutions({ side: '9' })` | 知らない売買区分は `side` を送らない（`'1'` / `'3'` だけ送る） | 実装済 |
| MZE-05 | 既定モック | `fetchMizuhoExecutions({ fillStatus })` をコードマスタ `約定出来状況` のコード（`010` / `011` / `034`）で呼ぶ | `status` に `010` / `011` はそのまま、取消済の `034` は `032,034`（取消済の 2 コード）が載る | 実装済 |
| MZE-06 | 応答の 売買区分 が `'3'` / `'1'` / 未知 | `fetchMizuhoExecutions()` | `side` が `'buy'` / `'sell'` / `''` になる | 実装済 |
| MZE-07 | 応答の 処理状況 が `011` / `010` / `032` / `034` / 未知 | `fetchMizuhoExecutions()` | `fillStatus` が `filled` / `partial` / `canceled_filled` / `canceled_filled` / `''` になり、`statusName` はサーバの名称のまま | 実装済 |
| MZE-08 | 応答の `Ticker` が null | `fetchMizuhoExecutions()` | `symbol` が 銘柄コード になる | 実装済 |
| MZE-09 | 応答の 約定単価 が null | `fetchMizuhoExecutions()` | `executedPrice` が `null` のまま（0 に潰さない） | 実装済 |
| MZE-10 | 応答の `summary` が欠けている | `fetchMizuhoExecutions()` | `summary` が 件数 0（`executionCount` / `buyCount` / `sellCount` / `partialCount` がすべて 0）になり、落ちない | 実装済 |
| MZE-11 | 既定モック | `exportMizuhoExecutionsCsv({ branchCode, symbol, side: '1', fillStatus: '011', dateFrom, dateTo })` | `GET /executions/export-csv` に `route=0`・`branch_code`・`symbol`・`side=1`・`status=011`・`start_date`・`end_date` が載り、`limit` / `offset` は載らない | 実装済 |
| MZE-12 | 既定モック | `exportMizuhoExecutionsCsv()`（条件なし） | クエリは `route=0` だけになる | 実装済 |
| MZE-13 | 既定モック | `exportMizuhoExecutionsCsv()` | `blob` が Blob で、見出し 1 行 + みずほの約定の全件が入る。`filename` は応答の Content-Disposition の名前になる | 実装済 |
| MZE-14 | `export-csv` の応答に Content-Disposition が無い | `exportMizuhoExecutionsCsv()` | `filename` が `EXECUTIONS_CSV_FILENAME` になる | 実装済 |
| MZE-15 | `export-csv` が 500 | `exportMizuhoExecutionsCsv()` | 応答の `detail` を `message` に持つ `ApiError` で reject される | 実装済 |
| MZE-16 | 既定モック（処理状況 032 と 034 の行を含む） | `fetchMizuhoExecutions({ fillStatus: '034' })` | フィクスチャの 032 と 034 の行がどちらも返り、`total` がその件数になる | 実装済 |
| MZE-17 | 応答の 約定代金_JPY が数値 / null | `fetchMizuhoExecutions()` | `executedAmountJpy` がその数値 / `null` のまま（0 に潰さない） | 実装済 |
