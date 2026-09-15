# api/customers（顧客マスタ API 層）

- 略号: `CUA`
- 対象: `src/api/customers.js`
- テスト: `src/api/customers.spec.js`

ここだけが**バックエンドの形**（パス・日本語のクエリ名・日本語キー・0/1 のフラグ）を知ってよい層なので、
この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。
同種の文書は [api-ca.md](api-ca.md) / [api-blackout-dates.md](api-blackout-dates.md)。

ストア（[stores-customers.md](stores-customers.md)）と画面
（[views-customer-list-view.md](views-customer-list-view.md)）のテストは MSW のモックが返す結果を
見ている。モックはこちらの実装と同じ理解で書かれているので、**モックとサーバの理解がずれていても
気づけない**。そこでこの文書では、モックの応答ではなく**送信されたリクエストそのもの**を見る。

取り違えやすい点を 4 つ固定する。

- **クエリ名が日本語**（`部店コード` / `扱者コード` / `口座番号` / `顧客名`）。
  英語のクエリ名は `offset` だけ
- **`limit` は送らない。** 実 API の一覧は 1 ページ 50 件で固定されていて `limit` を持たない。
  引数としては受け取るが、リクエストには載せない（`GET /masters/ca` との違い）
- **`口座番号` は integer。** 数字だけの入力のときにだけ送る（文字列を送ると 422 で弾かれる）
- **フラグの型がキーごとに違う。** `取引停止区分_全取引` / `ユーザー操作フラグ` は integer の 0/1、
  `事故処理口座区分` は**文字列の '0'/'1'**。どちらも boolean に直して外へ出す

金額 3 種（`円貨預り金` / `外貨預り金` / `NISA買付可能額_当年`）は数値のまま運ぶ。
**0 と「値が無い」は意味が違う**ので、0 を null に潰さない（CUA-11）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CUA-01 | 既定モック | `fetchCustomers()` を引数なしで呼ぶ | `GET /api/customers` に `offset=0` だけが載る。日本語のクエリも `limit` も `include_deleted` も送らない | 実装済 |
| CUA-02 | 既定モック | `fetchCustomers({ branchCode, handlerCode, customerName })` を呼ぶ | クエリ名が `部店コード` / `扱者コード` / `顧客名` になり、値がそのまま載る | 実装済 |
| CUA-03 | 既定モック | 全条件を空文字にして呼ぶ | 空文字の条件はクエリに載らない（「条件なし」を空文字として送らない） | 実装済 |
| CUA-04 | 既定モック | `fetchCustomers({ accountNumber: '1230001' })` を呼ぶ | `口座番号=1230001` が載る（数字だけの入力は integer として送る） | 実装済 |
| CUA-05 | 既定モック | 数字以外を含む口座番号（`'123-0001'` / `'abc'` / `' '`）で呼ぶ | `口座番号` を送らない（422 で弾かれて理由が画面に出ない事態を避ける） | 実装済 |
| CUA-06 | 既定モック | `fetchCustomers({ limit: 20, offset: 50 })` を呼ぶ | `offset=50` は載るが `limit` は載らない（実 API は 1 ページ 50 件固定） | 実装済 |
| CUA-07 | 既定モック | `fetchCustomers({ restriction, accountType, corporateType })` を呼ぶ | クエリ名が `取引停止区分_全取引` / `口座区分` / `法人区分` になる（openapi に無くモックだけが解釈する条件） | 実装済 |
| CUA-08 | API が `AccountItem` を 1 件返す | `fetchCustomers()` を呼ぶ | 口座番号・部店・扱者・顧客名・カナ・年齢・各区分名がアプリ内モデルの名前に変換される。`accountNumber` は integer ではなく文字列 | 実装済 |
| CUA-09 | API が `取引停止区分_全取引` / `ユーザー操作フラグ` を 1 / 0 で返す | `fetchCustomers()` を呼ぶ | `tradingSuspended` / `userModified` が `true` / `false` の boolean になる | 実装済 |
| CUA-10 | API が `事故処理口座区分` を `'1'` / `'0'` / integer の `1` で返す | `fetchCustomers()` を呼ぶ | 文字列 `'1'` のときだけ `accidentAccount` が `true`（integer の 1 では立たない。キーごとに型が違うことを固定する） | 実装済 |
| CUA-11 | API が金額を `3500000` / `0` / `null` で返す | `fetchCustomers()` を呼ぶ | `cashJpy` / `cashUsd` / `growthQuota` が数値のまま（整形しない）。`0` は `0` のままで、`null` だけが `null`（0 を「値が無い」に潰さない） | 実装済 |
| CUA-12 | API が文字列項目を `null` で返す | `fetchCustomers()` を呼ぶ | 部店名・扱者名・カナ・年齢・各区分名が空文字になる（`null` を画面へ流さない） | 実装済 |
| CUA-13 | API が `customers` を持たない応答を返す | `fetchCustomers()` を呼ぶ | `items` が空配列、`total` が 0 になる（キーが欠けても落ちない） | 実装済 |
| CUA-14 | API が 500 を返す | `fetchCustomers()` を呼ぶ | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
