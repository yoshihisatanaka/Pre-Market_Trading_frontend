# api/ca（CAマスタ API 層）

- 略号: `CAA`
- 対象: `src/api/ca.js`
- テスト: `src/api/ca.spec.js`

ここだけが**バックエンドの形**（パス・クエリ名・日本語キー・integer の日付）を知ってよい層なので、
この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。

ストア（[stores-ca.md](stores-ca.md)）と画面
（[views-corporate-action-list-view.md](views-corporate-action-list-view.md)）のテストは
MSW のモックが返す結果を見ている。モックはこちらの実装と同じ理解で書かれているので、
**モックとサーバの理解がずれていても気づけない**。そこでこの文書では、モックの応答ではなく
**送信されたリクエストそのもの**を `docs/api/openapi.json` の宣言と突き合わせる。
受注不可日の同種の文書は [api-blackout-dates.md](api-blackout-dates.md)。

取り違えやすい点を 2 つ固定する。

- **`limit` を送る。** 受注不可日の `/blackout-dates` と違い、`GET /ca` は `limit`（既定 50・最大 200）を
  クエリで受け付ける。表示件数を変えたらそのまま送る
- **一覧の配列名は `ca_list`。** `blackout_dates` / `holidays` と同じ位置にあるが名前が違う

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CAA-01 | 既定モック | `fetchCorporateActions()` を引数なしで呼ぶ | `GET /api/ca` に `limit=50` と `offset=0` だけが載る。`stock_code` / `ca_type` / `include_deleted` は送らない | 実装済 |
| CAA-02 | 既定モック | `fetchCorporateActions({ stockCode: 'AAPL', caType: '110' })` を呼ぶ | クエリ名が `stock_code` / `ca_type` になり、値がそのまま載る | 実装済 |
| CAA-03 | 既定モック | `fetchCorporateActions({ stockCode: '', caType: '' })` を呼ぶ | 空文字の条件はクエリに載らない（「条件なし」を空文字として送らない） | 実装済 |
| CAA-04 | 既定モック | `fetchCorporateActions({ limit: 20, offset: 40 })` を呼ぶ | `limit` / `offset` が渡した値で載る | 実装済 |
| CAA-05 | API が `CAItem` を 1 件返す | `fetchCorporateActions()` を呼ぶ | `{ id: '1', stockCode, ticker, caType, caTypeName, exRightsDate, effectiveDate, paymentDate, ratio, note, userModified }` に変換される。`id` は文字列、日付 3 種は `'YYYY-MM-DD'` | 実装済 |
| CAA-06 | API が `Ticker` / `CA種別名` / `比率` / `備考` を `null` で返す | `fetchCorporateActions()` を呼ぶ | 該当項目が空文字になる（`null` を画面へ流さない） | 実装済 |
| CAA-07 | API が日付 3 種を `null` で返す | `fetchCorporateActions()` を呼ぶ | 日付が空文字になる（`Date` に通さないので時差でずれない） | 実装済 |
| CAA-08 | API が `ユーザー操作フラグ` を 1 / 0 で返す | `fetchCorporateActions()` を呼ぶ | `userModified` が `true` / `false` の boolean になる（0/1 の integer を外へ出さない） | 実装済 |
| CAA-09 | API が `ca_list` を持たない応答を返す | `fetchCorporateActions()` を呼ぶ | `items` が空配列、`total` が 0 になる（`ca_list` が欠けても落ちない） | 実装済 |
| CAA-10 | API が 500 を返す | `fetchCorporateActions()` を呼ぶ | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
