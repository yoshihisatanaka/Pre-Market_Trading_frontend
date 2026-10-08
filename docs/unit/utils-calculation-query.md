# utils/calculationQuery（仮計算へ引き継ぐ URL クエリ）

- 略号: `CQY`
- 対象: `src/utils/calculationQuery.js`
- テスト: `src/utils/calculationQuery.spec.js`

外株預り・預り検索の行の「仮計算」が `/customers/:customerId/calculations` へ渡すクエリの組み立てと読み取り。
クエリ名（`symbol` / `side` / `specific_deposit`）は URL 上の契約で、`side` は売買区分のコードではなく `'buy'` / `'sell'`。
顧客はパスで指すのでクエリに載せない。

取り違えやすい点:

- **預り区分は特定預り区分のまま渡す。** 新規注文の引き継ぎ（`utils/orderEntryQuery.js` の `deposit`）と違い、
  預り売買区分へ読み替えない（`CalculationRequest.特定預り区分` が預りの明細と同じ向きのため）。名前も `specific_deposit` で分ける
- **仮計算で選べる預り区分は 特定（1）/ 一般（0）/ 成長投資枠（6）だけ。** NISA（旧）・継続管理勘定は載せない
- **成長投資枠も落とさない**（新規注文の「買い」と違い、行の「仮計算」は売りの概算なので）
- **読めない値（手で書き換えた URL）は `''` に落とす**

コードの値は公開定数（`SPECIFIC_DEPOSIT` / `SIDE`）から取る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CQY-01 | — | `buildCalculationQuery()` に全項目（売買は `SIDE.BUY`）を渡す / `SIDE.SELL` で渡す | `{ symbol, side: 'buy', specific_deposit }`。売りは `side: 'sell'` | 実装済 |
| CQY-02 | — | `buildCalculationQuery()` を引数なし / 空文字だけ / 未知の売買区分 / NISA（旧）の預り区分で呼ぶ | 空の値・読めない値はキーごと載らない（引数なし・空文字だけなら `{}`） | 実装済 |
| CQY-03 | 特定 / 成長投資枠 / 非特定の明細 | `holdingCalculationQuery(明細)` | 明細のティッカー、`side: 'sell'`、明細の特定預り区分がそのまま載る（成長投資枠も落とさない） | 実装済 |
| CQY-04 | ティッカーの無い明細・NISA（旧）の明細 | `holdingCalculationQuery(明細)` | ティッカーが無ければ銘柄コードを `symbol` に載せる。NISA（旧）は `specific_deposit` を載せない | 実装済 |
| CQY-05 | — | `parseCalculationQuery()` に正しいクエリ（前後の空白・小文字の銘柄を含む）を渡す | 値が前後の空白を落として入り、銘柄は大文字、`side` は売買区分のコード、`specificDeposit` はそのまま | 実装済 |
| CQY-06 | — | `parseCalculationQuery()` に `side: 'hold'`・`specific_deposit` に NISA の `'4'`・配列の値（`?symbol=a&symbol=b`）を渡す / 引数なしで呼ぶ | 読めない値はすべて `''`（全項目が `''` のオブジェクト） | 実装済 |
| CQY-07 | — | `buildCalculationQuery()` の結果を `parseCalculationQuery()` で読む | 渡した値がそのまま戻る（往復で崩れない） | 実装済 |
