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
| EXA-09 | 既定モック | 各条件に値を入れて `exportExecutionsCsv()`（`side: 'buy'`） | `GET /executions/export-csv` に一覧と同じクエリ名 `branch_code` / `symbol` / `side=3` / `status` / `start_date` / `end_date` / `route` でその値が送られ、`limit` / `offset` は載らない | 実装済 |
| EXA-10 | 既定モック | 全条件を空文字・`side: 'x'` にして `exportExecutionsCsv()` | 空文字の条件と知らない `side` はクエリに載らず、`limit` / `offset` も載らない（クエリが空） | 実装済 |
| EXA-11 | 既定モック | `exportExecutionsCsv()` | `blob` が（文字列ではなく）Blob で、本文は見出し 1 行 + フィクスチャの全件（ページで切られない） | 実装済 |
| EXA-12 | 応答の Content-Disposition が `filename*=UTF-8''<パーセントエンコード>` と `filename="…"` の両方を持つ | `exportExecutionsCsv()` | `filename` が `filename*` をデコードした名前になる（`filename=` より優先） | 実装済 |
| EXA-13 | 応答の Content-Disposition が `attachment; filename="…"`（引用符つき・空白を含む） | `exportExecutionsCsv()` | `filename` が引用符の中身そのものになる | 実装済 |
| EXA-14 | 応答の Content-Disposition が `attachment; filename=…`（引用符なし） | `exportExecutionsCsv()` | `filename` がその値になる | 実装済 |
| EXA-15 | 応答に Content-Disposition が無い | `exportExecutionsCsv()` | `filename` が `EXECUTIONS_CSV_FILENAME` になる | 実装済 |
| EXA-16 | `filename*` のパーセントエンコードが壊れていて、`filename="…"` も持つ | `exportExecutionsCsv()` | 例外にならず、`filename` が `filename="…"` の値になる | 実装済 |
| EXA-17 | 既定モック（本文の先頭に UTF-8 BOM を付けて返す） | `exportExecutionsCsv()` | `blob` の先頭 3 バイトが BOM（`EF BB BF`）のまま | 保留 |

> EXA-17 を保留にした理由: MSW(node) の XHR インターセプタ越しに受けると、既定ハンドラ
> （`src/mocks/handlers/executions.js`）が付けた BOM が Blob の先頭に無い（先頭が `約` の `E7 B4 84`）。
> api 層は `response.data` をそのまま返しているので、落ちているのはテスト環境の変換（インターセプタが
> 本文を文字列にデコードしてから Blob にし直している疑い）と見ているが、切り分けは済んでいない。
> 実ブラウザ（Service Worker の MSW / 実 API）で BOM が残るかは E2E か手動で確かめる。
