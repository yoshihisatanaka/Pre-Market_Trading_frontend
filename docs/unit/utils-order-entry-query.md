# utils/orderEntryQuery（新規注文へ引き継ぐ URL クエリ）

- 略号: `OEQ`
- 対象: `src/utils/orderEntryQuery.js`
- テスト: `src/utils/orderEntryQuery.spec.js`

顧客詳細（「注文入力」「新規注文」・預りの「買い」「売り」）と預り検索（「買い」「売り」）が新規注文の画面
（顧客詳細の注文入力タブ `/customers/:customerId/order-entry`。`/orders/new` も同じクエリを読む）へ渡すクエリの組み立てと読み取り。
クエリ名（`branch_code` / `account_number` / `ticker` / `side` / `deposit`）は URL 上の契約で、
`side` は売買区分のコードではなく `'buy'` / `'sell'`。

取り違えやすい点:

- **預りの特定預り区分と注文の預り売買区分は向きが違う。** `SPECIFIC_DEPOSIT.SPECIFIC`（1）→ `DEPOSIT_CATEGORY.SPECIFIC`（0）、
  `NON_SPECIFIC`（0）→ `GENERAL`（1）、`GROWTH_QUOTA`（6）→ `GROWTH`（6）。NISA（旧）・継続管理勘定は対応が無く `''`
- **成長投資枠の明細の「買い」は預り区分を載せない**（買付に成長投資枠は選べない）
- **読めない値（手で書き換えた URL）は `''` に落とす**

コードの値は公開定数（`SPECIFIC_DEPOSIT` / `DEPOSIT_CATEGORY` / `SIDE`）から取る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OEQ-01 | — | `toDepositCategory()` に `SPECIFIC_DEPOSIT` の特定 / 非特定 / 成長投資枠を渡す | `DEPOSIT_CATEGORY` の特定 / 一般 / 成長投資枠 | 実装済 |
| OEQ-02 | — | `toDepositCategory()` に NISA / 継続管理勘定 / `''` / 未知の値 / `undefined` を渡す | すべて `''` | 実装済 |
| OEQ-03 | — | `buildOrderEntryQuery()` に全項目（売買は `SIDE.BUY`）を渡す / `SIDE.SELL` で渡す | `{ branch_code, account_number, ticker, side: 'buy', deposit }`。売りは `side: 'sell'` | 実装済 |
| OEQ-04 | — | `buildOrderEntryQuery()` を引数なし / 空文字だけ / 未知の売買区分で呼ぶ | 空の値はキーごと載らない（引数なし・空文字だけなら `{}`、未知の売買区分は `side` が載らない） | 実装済 |
| OEQ-05 | 特定預りの明細 | `holdingOrderQuery(顧客, 明細, SIDE.SELL)` / `SIDE.BUY` | 顧客の部店・口座番号、明細のティッカー、`side`、読み替えた `deposit`（特定）が載る（買い・売りとも） | 実装済 |
| OEQ-06 | 成長投資枠の明細 | `holdingOrderQuery()` を買い / 売りで呼ぶ | 買いは `deposit` を載せない。売りは `deposit` が成長投資枠 | 実装済 |
| OEQ-07 | ティッカーの無い明細・NISA（旧）の明細 | `holdingOrderQuery()` を売りで呼ぶ | `ticker` と `deposit` が載らない（銘柄欄・預り区分は既定のまま） | 実装済 |
| OEQ-08 | — | `parseOrderEntryQuery()` に正しいクエリ（前後の空白・小文字のティッカーを含む）を渡す | 値が前後の空白を落として入り、ティッカーは大文字、`side` は売買区分のコード（`SIDE.BUY` / `SIDE.SELL`）、`depositCategory` はそのまま | 実装済 |
| OEQ-09 | — | `parseOrderEntryQuery()` に口座番号 `'12a'`・`side: 'hold'`・`deposit` に NISA の `'4'`・配列の値（`?ticker=a&ticker=b`）を渡す / 引数なしで呼ぶ | 読めない値はすべて `''`（全項目が `''` のオブジェクト） | 実装済 |
| OEQ-10 | — | `buildOrderEntryQuery()` の結果を `parseOrderEntryQuery()` で読む | 渡した値がそのまま戻る（往復で崩れない） | 実装済 |
