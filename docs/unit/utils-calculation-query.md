# utils/calculationQuery（仮計算へ引き継ぐ URL クエリ）

- 略号: `CQY`
- 対象: `src/utils/calculationQuery.js`
- テスト: `src/utils/calculationQuery.spec.js`

外株預り・預り検索の行の「仮計算」が `/customers/:customerId/calculations` へ渡すクエリの組み立てと読み取り。
クエリ名（`symbol` / `side` / `specific_deposit` / `quantity` / `unit_price`）は URL 上の契約で、`side` は売買区分のコードではなく `'buy'` / `'sell'`。
顧客はパスで指すのでクエリに載せない。

取り違えやすい点:

- **預り区分は特定預り区分のまま渡す。** 新規注文の引き継ぎ（`utils/orderEntryQuery.js` の `deposit`）と違い、
  預り売買区分へ読み替えない（`CalculationRequest.特定預り区分` が預りの明細と同じ向きのため）。名前も `specific_deposit` で分ける
- **仮計算で選べる預り区分は 特定（1）/ 一般（0）/ 成長投資枠（6）だけ。** NISA（旧）・継続管理勘定は載せない
- **成長投資枠も落とさない**（新規注文の「買い」と違い、行の「仮計算」は売りの概算なので）
- **数量・単価の初期値はモックの `calculations.py`（`_default_input`）と同じ。** 預りから売りで入るときの数量は
  売却可能数量（`sellableQuantity`。保有数量ではない）、単価は預りの現在値（`referencePrice` = 前日終値）。
  値が無い明細（`null`）は載せず、仮計算の画面が銘柄マスタの前日終値で補う（単価）か空のままにする（数量）。
  為替はクエリに載せない（画面が為替マスタの現在レートを引く）
- **数量・単価は入力欄と同じ形だけ受ける**（数量は 1 株以上・9 桁以内の整数、単価は 0 より大きい整数 7 桁・小数 8 桁以内）。
  `'0'` / 小数の数量 / 負の値 / 数字でないものは載せず、読んでも `''`
- **読めない値（手で書き換えた URL）は `''` に落とす**

コードの値は公開定数（`SPECIFIC_DEPOSIT` / `SIDE`）から取る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CQY-01 | — | `buildCalculationQuery()` に銘柄・売買（`SIDE.BUY`）・預り区分を渡す / `SIDE.SELL` で渡す | `{ symbol, side: 'buy', specific_deposit }`。売りは `side: 'sell'`。数量・単価を渡さなければそのキーは無い | 実装済 |
| CQY-02 | — | `buildCalculationQuery()` を引数なし / 空文字だけ / 未知の売買区分 / NISA（旧）の預り区分で呼ぶ | 空の値・読めない値はキーごと載らない（引数なし・空文字だけなら `{}`） | 実装済 |
| CQY-03 | 特定 / 成長投資枠 / 非特定の明細（売却可能株数 80・前日終値 227.16） | `holdingCalculationQuery(明細)` | 明細のティッカー、`side: 'sell'`、明細の特定預り区分がそのまま載り（成長投資枠も落とさない）、`quantity: '80'`・`unit_price: '227.16'` が付く | 実装済 |
| CQY-04 | ティッカーの無い明細・NISA（旧）の明細 | `holdingCalculationQuery(明細)` | ティッカーが無ければ銘柄コードを `symbol` に載せる。NISA（旧）は `specific_deposit` を載せない（数量・単価は載る） | 実装済 |
| CQY-05 | — | `parseCalculationQuery()` に正しいクエリ（前後の空白・小文字の銘柄を含む）を渡す | 値が前後の空白を落として入り、銘柄は大文字、`side` は売買区分のコード、`specificDeposit` はそのまま | 実装済 |
| CQY-06 | — | `parseCalculationQuery()` に `side: 'hold'`・`specific_deposit` に NISA の `'4'`・配列の値（`?symbol=a&symbol=b`）を渡す / 引数なしで呼ぶ | 読めない値はすべて `''`（`symbol` / `side` / `specificDeposit` / `quantity` / `unitPrice` の 5 項目が `''` のオブジェクト） | 実装済 |
| CQY-07 | — | `buildCalculationQuery()` の結果（数量・単価を含む）を `parseCalculationQuery()` で読む | 渡した値がそのまま戻る（往復で崩れない。数量・単価は文字列） | 実装済 |
| CQY-08 | — | `buildCalculationQuery()` に数量・単価を数値（`80` / `227.16`）と文字列（`' 10 '` / `'1.5'`）で渡す / `0`・`-1`・`1.5`（数量）・`'abc'`・`null`・10 桁の数量・整数 8 桁の単価で渡す | 数値も文字列も `quantity` / `unit_price` に文字列で載る（空白は落とす）。形に合わない値はキーごと載らない | 実装済 |
| CQY-09 | 売却可能株数・前日終値が `null` の明細（Phase 66 より前の応答）/ 売却可能株数 0 の明細 | `holdingCalculationQuery(明細)` | `quantity` / `unit_price` を載せない（銘柄・売り・預り区分だけ）。0 株も載せない | 実装済 |
| CQY-10 | — | `parseCalculationQuery()` に `quantity: ' 80 '`・`unit_price: '227.16'` を渡す / `quantity` に `'0'`・`'1.5'`・`'1234567890'`・`'abc'`、`unit_price` に `'0'`・`'-1'`・`'12345678'`・`'1.123456789'`・`['1', '2']` を渡す | 正しい値は空白を落とした文字列で入る（`quantity: '80'`、`unitPrice: '227.16'`）。読めない値は `''`（ほかの項目には影響しない） | 実装済 |
