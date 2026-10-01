# api/stalledOrders（滞留注文抽出 API）

- 略号: `SOA`
- 対象: `src/api/stalledOrders.js`
- テスト: `src/api/stalledOrders.spec.js`
- E2E 側のシナリオ: [docs/e2e/stalled-orders.md](../e2e/stalled-orders.md)

この API はバックエンド未実装で、形は実 API の `OrderItemResponse` に寄せた仮置き。
守りたいのは**変換がこの層に閉じていること**で、日本語キー → camelCase、
売買区分のコード → `'buy'` / `'sell'`、別項目の受注日・受注時刻 → 1 本の日時、の 3 つ。

コンファメーション CSV の取込（`importConfirmationCsv(file)`）も未実装で、パス・項目名・応答は
`docs/api/requests.md` の契約提案（応答は既存の `CsvImportResponse`）。SOA-12 以降がこちら。

**jsdom の FormData は MSW(node) を通らない。** jsdom の FormData を載せた POST は、MSW の XHR
インターセプタが Fetch の `Request` に変換できず、本文を読まないハンドラでも応答しないまま止まる
（2026-09-28 に確認）。そこでテストの間だけグローバルの `FormData` を Node（undici）の実装に
差し替え（`vi.stubGlobal`）、送る File も Node の実装（`node:buffer` の `File`）で作る。
jsdom の File を Node の FormData に積むとファイルではなく文字列として届くため。
これで `apiClient.post` を spy せずに、MSW のハンドラが `request.formData()` から `file` を読めるところまで確かめられる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOA-01 | 既定モック | `fetchStalledOrders()` を呼ぶ | `orderErrors` が 3 件、`workingOrders` が 2 件で返る | 実装済 |
| SOA-02 | 既定モック | `fetchStalledOrders()` を呼ぶ | 日本語キーが camelCase になる（`部店` → `branchCode`、`銘柄コード` → `symbol`、`エラー内容` → `errorReason`） | 実装済 |
| SOA-03 | 口座番号が integer の行 | `fetchStalledOrders()` を呼ぶ | `accountNumber` が文字列で返る | 実装済 |
| SOA-04 | 売買区分が `'3'` / `'1'` の行 | `fetchStalledOrders()` を呼ぶ | `side` が `'buy'` / `'sell'` になる（コードマスタの 3 買 / 1 売） | 実装済 |
| SOA-05 | 売買区分が未知のコードの行 | `fetchStalledOrders()` を呼ぶ | `side` が空文字になる（買いに丸めない） | 実装済 |
| SOA-06 | 成行（指成区分 `'MO'`・指値単価が null）の行 | `fetchStalledOrders()` を呼ぶ | `limitPrice` が null のまま返る（0 に寄せない） | 実装済 |
| SOA-07 | 受注日と受注時刻を持つ行 | `fetchStalledOrders()` を呼ぶ | `orderedAt` が `'2026-09-16T10:22:00'` になる | 実装済 |
| SOA-08 | 受注日か受注時刻が欠けた行 | `fetchStalledOrders()` を呼ぶ | `orderedAt` が空文字になる | 実装済 |
| SOA-09 | 応答に `注文エラー` / `注文中` が無い | `fetchStalledOrders()` を呼ぶ | どちらも空配列で返り、例外にならない | 実装済 |
| SOA-10 | 既定モック | `fetchStalledOrders({ branchCode: '123' })` を呼ぶ | クエリに `branch_code=123` だけが載り、空の条件は送られない | 実装済 |
| SOA-11 | API が 500 を返す | `fetchStalledOrders()` を呼ぶ | `ApiError` が投げられる | 実装済 |
| SOA-12 | 本文を記録するハンドラ | `importConfirmationCsv(file)` を呼ぶ | `multipart/form-data` で `/operations/stalled-orders/confirmation-import` に届き、ハンドラが `request.formData()` の `file` から送ったファイル名と中身を読める | 実装済 |
| SOA-13 | 200（`success: true`）を返す | `importConfirmationCsv(file)` を呼ぶ | `success` / `total_count` / `success_count` / `error_count` / `message` が `success` / `totalCount` / `successCount` / `errorCount` / `message` になる | 実装済 |
| SOA-14 | 200 で `errors[]` に行エラーがある（`row_data.order_id` が数値の 999） | `importConfirmationCsv(file)` を呼ぶ | 1 件が `{ lineNumber: 2, orderId: '999', messages: [理由…] }` になる（`line_number` → `lineNumber`、`errors` → `messages`、注文 ID は文字列） | 実装済 |
| SOA-15 | 行エラーの `row_data` が null | `importConfirmationCsv(file)` を呼ぶ | `orderId` が空文字になる | 実装済 |
| SOA-16 | 400（`detail` にヘッダ違いの理由） | `importConfirmationCsv(file)` を呼ぶ | その `detail` を message に持つ `ApiError`（status 400）が投げられる | 実装済 |
| SOA-17 | 422（file 欠落の HTTPValidationError） | `importConfirmationCsv(file)` を呼ぶ | status 422 の `ApiError` が投げられる | 実装済 |
| SOA-18 | 500 | `importConfirmationCsv(file)` を呼ぶ | status 500 の `ApiError` が投げられる | 実装済 |
