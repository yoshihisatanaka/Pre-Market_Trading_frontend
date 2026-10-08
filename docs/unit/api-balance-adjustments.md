# api/balanceAdjustments（残高マスタ API）

- 略号: `BLA`
- 対象: `src/api/balanceAdjustments.js`
- テスト: `src/api/balanceAdjustments.spec.js`

バックエンドの形（日本語キー・snake_case のクエリ・integer の口座番号）を camelCase の
アプリ内モデルに変換する層。**ここが吸収している差だけ**を見る（画面の挙動は `BLV` 側）。

とくに落としたくないのは 3 点。
`残高` が加算値ではなく**補正後の絶対値**であること、銘柄名を
**`symbol_name_ja` にだけ送る**こと（`symbol_name_en` と両方送ると AND になる。#13）、
新規登録では**ティッカーを `銘柄コード` として送り、銘柄名は送らない**こと。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BLA-01 | 既定モック | `fetchBalanceAdjustments()` を呼ぶ | `{ items, total }` が返り、items の各件が camelCase のアプリ内モデルになっている | 実装済 |
| BLA-02 | 応答の配列名が `balances` | `fetchBalanceAdjustments()` を呼ぶ | `items` に読み替えられている | 実装済 |
| BLA-03 | 応答に `balances` が無い | `fetchBalanceAdjustments()` を呼ぶ | `items` が空配列、`total` が 0 になる（例外にしない） | 実装済 |
| BLA-04 | 検索条件をすべて渡す | `fetchBalanceAdjustments({ branchCode, accountNumber, customerName, ticker, symbolName })` | クエリが `branch_code` / `account_no` / `customer_name` / `symbol` / `symbol_name_ja` で送られる（`symbol_name_en` と旧名 `symbol_name` は送らない） | 実装済 |
| BLA-05 | 検索条件が空文字 | `fetchBalanceAdjustments({ branchCode: '', ticker: '' })` | 空の条件はクエリに載らない（`limit` / `offset` だけが載る） | 実装済 |
| BLA-06 | 口座番号に数字以外が混ざる | `fetchBalanceAdjustments({ accountNumber: '12a' })` | `account_no` を送らない（422 で弾かれて理由が画面に出ないのを避ける） | 実装済 |
| BLA-07 | 応答の `ID` が integer | `fetchBalanceAdjustments()` を呼ぶ | `id` が文字列になっている（行キーと URL で使うため） | 実装済 |
| BLA-08 | 応答の `口座番号` が integer | `fetchBalanceAdjustments()` を呼ぶ | `accountNumber` が文字列になっている | 実装済 |
| BLA-09 | 応答の nullable な項目が null | `fetchBalanceAdjustments()` を呼ぶ | `customerName` / `ticker` / `updatedBy` などが空文字に寄る | 実装済 |
| BLA-10 | 応答の `初期残高` が null / 0 | `fetchBalanceAdjustments()` を呼ぶ | `initialBalance` が null / 0 のまま（0 を null に潰さない） | 実装済 |
| BLA-11 | 応答が `特定預り区分名` を持たず `預り区分名` だけ持つ | `fetchBalanceAdjustments()` を呼ぶ | `specificDepositName` にその値が入る（別名も見る） | 実装済 |
| BLA-12 | 応答の `ユーザー操作フラグ` が 1 / 0 | `fetchBalanceAdjustments()` を呼ぶ | `userModified` が true / false になる | 実装済 |
| BLA-13 | — | `createBalanceAdjustment({ branchCode, accountNumber, symbolCode, specificDeposit, balance })` | 本文が `{ 部店コード, 口座番号, 銘柄コード, 特定預り区分, 残高 }` になり、口座番号は integer | 実装済 |
| BLA-14 | 部店コードが空文字 | `createBalanceAdjustment({ branchCode: '', … })` | 本文に `部店コード` の項目ごと載らない（サーバが口座情報から補完する） | 実装済 |
| BLA-15 | 登録が成功する | `createBalanceAdjustment(...)` | 応答の `balance` を変換した 1 件が返る | 実装済 |
| BLA-16 | — | `updateBalanceAdjustment({ id, balance, updatedAt })` | `PUT /masters/balance-adjustments/{id}` に `{ 残高, 更新日時 }` **だけ**が送られる（部分更新） | 実装済 |
| BLA-17 | `updatedAt` が空文字 | `updateBalanceAdjustment({ id, balance })` | 本文に `更新日時` が載らない | 実装済 |
| BLA-18 | 更新が 409 を返す | `updateBalanceAdjustment(...)` | 例外になり、`message` にサーバの理由が入る（呼び出し側の updateError に入る） | 実装済 |
| BLA-19 | 応答の `売却不可区分` が 1 / 0 / 未定義 | `fetchBalanceAdjustments()` を呼ぶ | `sellProhibited` が true / false / false になる（仕様の既定は 0 なので欠けていれば売却可） | 実装済 |
| BLA-20 | — | `updateBalanceSellProhibited({ id, sellProhibited: true })` | 専用の口 `PUT /masters/balance-adjustments/{id}/sell-prohibited` に `{ 売却不可区分: 1 }` だけが送られ（`残高` を送らない）、応答の 1 件が `sellProhibited: true` で返る | 実装済 |
| BLA-21 | — | `updateBalanceAdjustment({ id, balance })` | 本文に `売却不可区分` が載らない | 実装済 |
| BLA-22 | — | `updateBalanceSellProhibited({ id, sellProhibited: false, updatedAt })` | 本文が `{ 売却不可区分: 0, 更新日時 }` になり、応答の 1 件が `sellProhibited: false` で返る | 実装済 |
