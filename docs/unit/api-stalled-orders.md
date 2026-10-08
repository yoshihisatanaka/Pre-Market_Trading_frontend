# api/stalledOrders（滞留注文抽出 API）

- 略号: `SOA`
- 対象: `src/api/stalledOrders.js`
- テスト: `src/api/stalledOrders.spec.js`
- E2E 側のシナリオ: [docs/e2e/stalled-orders.md](../e2e/stalled-orders.md)

一覧に専用の API は無く、注文照会と同じ `GET /orders` を処理状況で絞って 2 本並行で呼ぶ
（`docs/api/requests.md` #1 ① の決着。注文エラー = `status=101,103`、注文中 = `status=003`）。
各本は `limit=200` で `offset` を送りながらページを送り、集めた件数が `total` に届くか空のページが返ったら止める。
守りたいのは**変換がこの層に閉じていること**で、`OrderItemResponse` の日本語キー → camelCase、
売買区分のコード → `'buy'` / `'sell'`、別項目の受注日・受注時刻 → 1 本の日時、Ticker 優先の銘柄、
処理状況による発注失敗理由の読み分け、など。

既定モックは注文照会と共用の `src/mocks/handlers/orders.js` が `src/mocks/fixtures/orderInquiry.js` の
`orderInquiryRows` で応答する。期待値はそこから処理状況で絞って導く。ページ送り・特殊な行（Ticker が無い・
decimal の文字列・区切りの無い受注日時 など）は `server.use()` で `*/api/orders` を差し替えて作る。

コンファメーション CSV の取込（`importConfirmationCsv(file)`）は契約提案のまま 2026-10-07 の取り込みで仕様に入った
（`POST /operations/stalled-orders/confirmation-import`。応答は既存の `CsvImportResponse`）。SOA-12 以降がこちら。
MSW のハンドラは消して実 API へ素通しにしたので、**取込のテストは毎回 `server.use()` で応答を差し込む**
（`vitest.setup.js` は `onUnhandledRequest: 'error'`）。

**jsdom の FormData は MSW(node) を通らない。** jsdom の FormData を載せた POST は、MSW の XHR
インターセプタが Fetch の `Request` に変換できず、本文を読まないハンドラでも応答しないまま止まる
（2026-09-28 に確認）。そこでテストの間だけグローバルの `FormData` を Node（undici）の実装に
差し替え（`vi.stubGlobal`）、送る File も Node の実装（`node:buffer` の `File`）で作る。
jsdom の File を Node の FormData に積むとファイルではなく文字列として届くため。
これで `apiClient.post` を spy せずに、MSW のハンドラが `request.formData()` から `file` を読めるところまで確かめられる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOA-01 | 既定モック | `fetchStalledOrders()` を呼ぶ | `orderErrors` が処理状況 101 / 103 の行（#40・#29）、`workingOrders` が処理状況 003 の行（#42・#34）で、どちらも注文 ID の降順で返る | 実装済 |
| SOA-02 | 既定モック | `fetchStalledOrders()` を呼ぶ | 日本語キーが camelCase になる（`部店` → `branchCode`、`顧客名` → `customerName`、`数量` → `quantity`、`発注範囲名` → `marketCategoryName`、`表示状況名` → `statusName` など） | 実装済 |
| SOA-03 | 口座番号が integer の行 | `fetchStalledOrders()` を呼ぶ | `accountNumber` が文字列で返る | 実装済 |
| SOA-04 | 売買区分が `'3'` / `'1'` の行 | `fetchStalledOrders()` を呼ぶ | `side` が `'buy'` / `'sell'` になる（コードマスタの 3 買 / 1 売） | 実装済 |
| SOA-05 | 売買区分が未知のコードの行 | `fetchStalledOrders()` を呼ぶ | `side` が空文字になる（買いに丸めない） | 実装済 |
| SOA-06 | 成行（指成区分 `'MO'`・指値単価が null）の行 | `fetchStalledOrders()` を呼ぶ | `limitPrice` が null のまま返る（0 に寄せない） | 実装済 |
| SOA-07 | 受注日 `'2026-09-25'`・受注時刻 `'10:22:00'` の行（既定モックの #29） | `fetchStalledOrders()` を呼ぶ | `orderedAt` が `'2026-09-25T10:22:00'` になる | 実装済 |
| SOA-08 | 受注日か受注時刻が欠けた行 | `fetchStalledOrders()` を呼ぶ | `orderedAt` が空文字になる | 実装済 |
| SOA-09 | 応答に `orders` が無い | `fetchStalledOrders()` を呼ぶ | どちらも空配列で返り、例外にならない | 実装済 |
| SOA-10 | 既定モック | `fetchStalledOrders({ branchCode: '123' })` を呼ぶ | 2 本とも `GET /orders` に `branch_code=123` と `status` / `limit=200` / `offset=0` だけが載り、空の条件（`account_no` / `symbol`）は送られない | 実装済 |
| SOA-11 | API が 500 を返す | `fetchStalledOrders()` を呼ぶ | `ApiError` が投げられる | 実装済 |
| SOA-12 | 本文を記録するハンドラ | `importConfirmationCsv(file)` を呼ぶ | `multipart/form-data` で `/operations/stalled-orders/confirmation-import` に届き、ハンドラが `request.formData()` の `file` から送ったファイル名と中身を読める | 実装済 |
| SOA-13 | 200（`success: true`）を返す | `importConfirmationCsv(file)` を呼ぶ | `success` / `total_count` / `success_count` / `error_count` / `message` が `success` / `totalCount` / `successCount` / `errorCount` / `message` になる | 実装済 |
| SOA-14 | 200 で `errors[]` に行エラーがある（`row_data.order_id` が数値の 999） | `importConfirmationCsv(file)` を呼ぶ | 1 件が `{ lineNumber: 2, orderId: '999', messages: [理由…] }` になる（`line_number` → `lineNumber`、`errors` → `messages`、注文 ID は文字列） | 実装済 |
| SOA-15 | 行エラーの `row_data` が null | `importConfirmationCsv(file)` を呼ぶ | `orderId` が空文字になる | 実装済 |
| SOA-16 | 400（`detail` にヘッダ違いの理由） | `importConfirmationCsv(file)` を呼ぶ | その `detail` を message に持つ `ApiError`（status 400）が投げられる | 実装済 |
| SOA-17 | 422（file 欠落の HTTPValidationError） | `importConfirmationCsv(file)` を呼ぶ | status 422 の `ApiError` が投げられる | 実装済 |
| SOA-18 | 500 | `importConfirmationCsv(file)` を呼ぶ | status 500 の `ApiError` が投げられる | 実装済 |
| SOA-19 | 既定モック | `fetchStalledOrders()` を呼ぶ | `GET /orders` が `status=101,103`（注文エラー）と `status=003`（注文中）の 2 本で呼ばれる | 実装済 |
| SOA-20 | 既定モック | `fetchStalledOrders({ accountNumber: ' 300003 ', symbol: 'amzn' })` を呼ぶ | 口座番号は前後の空白を除いた integer の `account_no=300003`、銘柄は `symbol=amzn` で 2 本とも送られ、注文エラーに #40 だけが返る | 実装済 |
| SOA-21 | 既定モック | `fetchStalledOrders({ accountNumber: '300-003' })` を呼ぶ | 数字以外を含む口座番号は `account_no` に載らない（422 にしない） | 実装済 |
| SOA-22 | 1 ページに 1 行ずつ返し `total` が行数のハンドラ | `fetchStalledOrders()` を呼ぶ | `offset` を 0, 1, 2 … と送りながら `total` に届くまでページを送り、全行が返った順に集まる。`limit` は毎回 200 | 実装済 |
| SOA-23 | `total` が実際の行数より大きく、行が尽きると空のページを返すハンドラ | `fetchStalledOrders()` を呼ぶ | 空のページを受けたところで止まり（回り続けない）、それまでの行が返る | 実装済 |
| SOA-24 | `Ticker` と `銘柄コード` が違う行 / `Ticker` が null の行 | `fetchStalledOrders()` を呼ぶ | `symbol` は `Ticker` が優先で、無ければ `銘柄コード` になる | 実装済 |
| SOA-25 | 指値単価が数値の文字列（`'228.5000'`）の行 | `fetchStalledOrders()` を呼ぶ | `limitPrice` が数値の 228.5 になる | 実装済 |
| SOA-26 | 受注日 `'20260916'`・受注時刻 `'1022'`（区切りなし）の行 | `fetchStalledOrders()` を呼ぶ | `orderedAt` が `'2026-09-16T10:22:00'` になる | 実装済 |
| SOA-27 | `表示状況名` が null の行 | `fetchStalledOrders()` を呼ぶ | `statusName` が `処理状況名` になる | 実装済 |
| SOA-28 | 処理状況 101（Dream 発注失敗）で `Dreamエラー内容` と `エラー内容` の両方を持つ行 / `Dreamエラー内容` が空の行 | `fetchStalledOrders()` を呼ぶ | `errorReason` は `Dreamエラー内容` が優先で、空なら `エラー内容` になる | 実装済 |
| SOA-29 | 処理状況 103（IB 発注失敗）で両方を持つ行 / `エラー内容` が空の行 | `fetchStalledOrders()` を呼ぶ | `errorReason` は `エラー内容` が優先で、空なら `Dreamエラー内容` になる | 実装済 |
| SOA-30 | 既定モック | `fetchStalledOrders()` を呼ぶ | `confirmationNote` は 2 本のどの行も空文字（サーバに項目が無い。#1② 待ち） | 実装済 |
