# api/holdings（預り残高の検索 API 層）

- 略号: `HLA`
- 対象: `src/api/holdings.js`
- テスト: `src/api/holdings.spec.js`

`GET /holdings`（`HoldingItem`。m_残高情報 に口座・銘柄・為替・CA を結合した明細）を読む層。
ここだけが**バックエンドの形**（クエリ名・日本語キー・0/1 のフラグ・% 表記の文字列）を知ってよいので、
[api-customers.md](api-customers.md) と同じく「**実際に送り出すリクエストの形**」と「受け取った生データの変換」を守る。

取り違えやすい点は次のとおり。

- **クエリ名は英語の snake_case**（`branch_code` / `account_no` / `customer_name` / `symbol` / `symbol_name` / `specific_deposit`）
- **`account_no` は integer。** 数字だけの入力のときにだけ送る（文字列を送ると 422）
- **行に ID が無い。** `口座番号:銘柄コード:預り売買区分` を行キー `id` にする
- **参考単価・参考為替は項目として返らない。** `評価額_USD ÷ 数量` / `評価額_JPY ÷ 評価額_USD` で戻す
  （推定。docs/api/requests.md #33）。割れないときは `null`
- **評価損益率は「% 表記」の文字列。** 数値に直し、読めない値は `null`

入力と期待値はフィクスチャ（`src/mocks/fixtures/holdings.js`）の先頭行から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| HLA-01 | 既定モック | `fetchHoldings()` を引数なしで呼ぶ | `GET /api/holdings` に `limit=50` と `offset=0` だけが載る | 実装済 |
| HLA-02 | 既定モック | 部店・顧客名・銘柄・銘柄名・特定預り区分をすべて埋めて呼ぶ | クエリ名が `branch_code` / `customer_name` / `symbol` / `symbol_name` / `specific_deposit` になり、値がそのまま載る | 実装済 |
| HLA-03 | 既定モック | 全条件を空文字にして呼ぶ | 空文字の条件はクエリに載らない | 実装済 |
| HLA-04 | 既定モック | 口座番号を数字だけ / `'123-0001'` / `'abc'` / `' '` で呼ぶ | 数字だけのときだけ `account_no` が載る（integer として送る）。それ以外は送らない | 実装済 |
| HLA-05 | 既定モック | `fetchHoldings({ limit: 200, offset: 50 })` を呼ぶ | `limit=200` と `offset=50` がそのまま載る | 実装済 |
| HLA-06 | API が `HoldingItem` を 1 件返す | `fetchHoldings()` を呼ぶ | 部店・口座番号・顧客名・カナ・銘柄コード・ティッカー・銘柄名・数量・特定預り区分（コードと名前）・評価額（USD / JPY）・平均取得単価・取得金額・評価損益がアプリ内モデルの名前になる。`accountNumber` は文字列、`id` は `口座番号:銘柄コード:預り売買区分`、`total` は応答の値 | 実装済 |
| HLA-07 | 同上 | `fetchHoldings()` を呼ぶ | `referencePrice` が `評価額_USD ÷ 数量`、`referenceFxRate` が `評価額_JPY ÷ 評価額_USD` になる | 実装済 |
| HLA-08 | API が数量 0 / 評価額_USD `null` / 評価額_USD 0 の行を返す | `fetchHoldings()` を呼ぶ | 割れない値は `null`（数量 0 なら参考単価、評価額_USD が無いか 0 なら参考為替）。`Infinity` や `NaN` を出さない | 実装済 |
| HLA-09 | API が評価損益率を `'12.34%'` / `'-5%'` / `'+3.2%'` / `' 1,234.5 % '` / 数値 `7.5` / `'abc'` / `''` / `null` で返す | `fetchHoldings()` を呼ぶ | `12.34` / `-5` / `3.2` / `1234.5` / `7.5` / `null` / `null` / `null` | 実装済 |
| HLA-10 | API が売却不可区分を `1` / `0` / `null` で返す | `fetchHoldings()` を呼ぶ | `sellProhibited` が `true` / `false` / `false`（1 だけが売却不可） | 実装済 |
| HLA-11 | API が `CA` を `null` / 文字列で、文字列項目（顧客名カナ・ティッカー・預り売買区分名）を `null` で返す | `fetchHoldings()` を呼ぶ | `corporateAction` は `null` なら `''`、文字列ならそのまま。ほかの文字列項目も `''` になる | 実装済 |
| HLA-12 | API が `holdings` を持たない応答を返す | `fetchHoldings()` を呼ぶ | `items` が空配列、`total` が 0 | 実装済 |
| HLA-13 | API が 500 を返す | `fetchHoldings()` を呼ぶ | 例外が投げられる | 実装済 |
