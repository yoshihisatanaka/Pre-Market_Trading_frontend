# api/stalledOrders（滞留注文抽出 API）

- 略号: `SOA`
- 対象: `src/api/stalledOrders.js`
- テスト: `src/api/stalledOrders.spec.js`（未実装）
- E2E 側のシナリオ: [docs/e2e/stalled-orders.md](../e2e/stalled-orders.md)

この API はバックエンド未実装で、形は実 API の `OrderItemResponse` に寄せた仮置き。
守りたいのは**変換がこの層に閉じていること**で、日本語キー → camelCase、
売買区分のコード → `'buy'` / `'sell'`、別項目の受注日・受注時刻 → 1 本の日時、の 3 つ。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOA-01 | 既定モック | `fetchStalledOrders()` を呼ぶ | `orderErrors` が 3 件、`workingOrders` が 2 件で返る | 未着手 |
| SOA-02 | 既定モック | `fetchStalledOrders()` を呼ぶ | 日本語キーが camelCase になる（`部店` → `branchCode`、`銘柄コード` → `symbol`、`エラー内容` → `errorReason`） | 未着手 |
| SOA-03 | 口座番号が integer の行 | `fetchStalledOrders()` を呼ぶ | `accountNumber` が文字列で返る | 未着手 |
| SOA-04 | 売買区分が `'1'` / `'3'` の行 | `fetchStalledOrders()` を呼ぶ | `side` が `'buy'` / `'sell'` になる | 未着手 |
| SOA-05 | 売買区分が未知のコードの行 | `fetchStalledOrders()` を呼ぶ | `side` が空文字になる（買いに丸めない） | 未着手 |
| SOA-06 | 成行（指成区分 `'MO'`・指値単価が null）の行 | `fetchStalledOrders()` を呼ぶ | `limitPrice` が null のまま返る（0 に寄せない） | 未着手 |
| SOA-07 | 受注日と受注時刻を持つ行 | `fetchStalledOrders()` を呼ぶ | `orderedAt` が `'2026-09-16T10:22:00'` になる | 未着手 |
| SOA-08 | 受注日か受注時刻が欠けた行 | `fetchStalledOrders()` を呼ぶ | `orderedAt` が空文字になる | 未着手 |
| SOA-09 | 応答に `注文エラー` / `注文中` が無い | `fetchStalledOrders()` を呼ぶ | どちらも空配列で返り、例外にならない | 未着手 |
| SOA-10 | 既定モック | `fetchStalledOrders({ branchCode: '123' })` を呼ぶ | クエリに `branch_code=123` だけが載り、空の条件は送られない | 未着手 |
| SOA-11 | API が 500 を返す | `fetchStalledOrders()` を呼ぶ | `ApiError` が投げられる | 未着手 |
