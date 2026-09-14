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

取り違えやすい点を 6 つ固定する。

- **`limit` を送る。** 受注不可日の `/blackout-dates` と違い、`GET /ca` は `limit`（既定 50・最大 200）を
  クエリで受け付ける。表示件数を変えたらそのまま送る
- **一覧の配列名は `ca_list`、1 件の応答のキーは `ca`。** `blackout_dates` / `holidays` と
  同じ位置にあるが名前が違う
- **`is_update` は「編集からの呼び出しか」だけで決まる。** 実 API は検証対象の CA を本文ではなく
  クエリの `ca_id` で受けるので、受注不可日のような「日付を変えたか」の判定が要らない（CAA-13 / 14）
- **未設定は `null` で明示する。** 日付 3 種・分母・分子・備考は、クエリパラメータのように
  キーごと省くのではなく `null` を送る。`CARequest` はレコード全体を差し替える形なので、
  キーを落とすと「変えない」と「空にする」が区別できない（CAA-12）
- **`warnings` は受け取らない。** 応答は持つが、CA では常に空とみなす（CAA-16）
- **楽観的ロックの合札は整形せず素通しする。** `CAItem.更新日時` は ISO の date-time で返り、
  `CARequest.更新日時` の説明は `'YYYY-MM-DD HH:MM:SS'` と書かれているが、
  **受注不可日（`BlackoutDateItem` / `BlackoutDateRequest`）もまったく同じ非対称**で、
  そちらは ISO を素通しして実 API の編集が通っている（`docs/e2e/blackout-dates-real-api.md` の BDR-06）。
  合札は照合用の不透明なトークンなので、秒未満の桁を落とす整形はかえって不一致を作る（CAA-20 / 21）

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CAA-01 | 既定モック | `fetchCorporateActions()` を引数なしで呼ぶ | `GET /api/ca` に `limit=50` と `offset=0` だけが載る。`stock_code` / `ca_type` / `include_deleted` は送らない | 実装済 |
| CAA-02 | 既定モック | `fetchCorporateActions({ stockCode: 'AAPL', caType: '110' })` を呼ぶ | クエリ名が `stock_code` / `ca_type` になり、値がそのまま載る | 実装済 |
| CAA-03 | 既定モック | `fetchCorporateActions({ stockCode: '', caType: '' })` を呼ぶ | 空文字の条件はクエリに載らない（「条件なし」を空文字として送らない） | 実装済 |
| CAA-04 | 既定モック | `fetchCorporateActions({ limit: 20, offset: 40 })` を呼ぶ | `limit` / `offset` が渡した値で載る | 実装済 |
| CAA-05 | API が `CAItem` を 1 件返す | `fetchCorporateActions()` を呼ぶ | `{ id: '1', stockCode, ticker, caType, caTypeName, exRightsDate, effectiveDate, paymentDate, denominator, numerator, ratio, note, userModified, updatedAt }` に変換される。`id` は文字列、日付 3 種は `'YYYY-MM-DD'` | 実装済 |
| CAA-06 | API が `Ticker` / `CA種別名` / `比率` / `備考` を `null` で返す | `fetchCorporateActions()` を呼ぶ | 該当項目が空文字になる（`null` を画面へ流さない） | 実装済 |
| CAA-07 | API が日付 3 種を `null` で返す | `fetchCorporateActions()` を呼ぶ | 日付が空文字になる（`Date` に通さないので時差でずれない） | 実装済 |
| CAA-08 | API が `ユーザー操作フラグ` を 1 / 0 で返す | `fetchCorporateActions()` を呼ぶ | `userModified` が `true` / `false` の boolean になる（0/1 の integer を外へ出さない） | 実装済 |
| CAA-09 | API が `ca_list` を持たない応答を返す | `fetchCorporateActions()` を呼ぶ | `items` が空配列、`total` が 0 になる（`ca_list` が欠けても落ちない） | 実装済 |
| CAA-10 | API が 500 を返す | `fetchCorporateActions()` を呼ぶ | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
| CAA-11 | 既定モック | `createCorporateAction({ stockCode: 'A0001', caType: '120', exRightsDate: '2026-04-28', effectiveDate: '2026-04-30', paymentDate: '', denominator: 1, numerator: 2, note: 'メモ' })` を呼ぶ | `POST /api/ca` の本文が日本語キーになり、日付が integer の `YYYYMMDD`（`20260428`）で載る。応答の `ca` がアプリ内モデルに変換されて返る | 実装済 |
| CAA-12 | 既定モック | `createCorporateAction()` に日付 3 種・分母・分子・備考を空文字 / 未指定で渡す | 本文に該当キーが `null` で載る（キーごと省かない） | 実装済 |
| CAA-13 | 既定モック | `validateCorporateAction({ stockCode: 'A0001', caType: '120' })` を `id` なしで呼ぶ | `POST /api/ca/validate` にクエリが付かない（新規検証が既定）。本文は `CARequest` の形 | 実装済 |
| CAA-14 | 既定モック | `validateCorporateAction({ id: '7', … })` を呼ぶ | クエリに `ca_id=7` と `is_update=true` が載る。`ca_id` は integer として送る | 実装済 |
| CAA-15 | 事前検証が `{ valid: false, errors: ['…'] }` を返す | `validateCorporateAction()` を呼ぶ | 例外にならず `{ valid: false, errors }` が返る（不合格は通信エラーと区別する） | 実装済 |
| CAA-16 | 事前検証が `warnings` を含む応答を返す | `validateCorporateAction()` を呼ぶ | 戻り値は `{ valid, errors }` だけで `warnings` を含まない（CA では警告を扱わない） | 実装済 |
| CAA-17 | 既定モック | `createCorporateAction({ denominator: '1', numerator: '2.5' })` のように分母・分子を文字列で渡す | 本文では number になる（画面の `type="number"` が持つ文字列をこの層で数値に直す） | 実装済 |
| CAA-18 | `POST /api/ca` が 400 を返す | `createCorporateAction()` を呼ぶ | 例外が投げられ、`message` にサーバの `detail` が入る | 実装済 |
| CAA-19 | 既定モック | `updateCorporateAction({ id: '7', stockCode, caType, … })` を呼ぶ | `PUT /api/ca/7` を叩き、本文が `CARequest` の形（日本語キー・日付は integer）になる。応答の `ca` がアプリ内モデルに変換されて返る | 実装済 |
| CAA-20 | 既定モック | `updateCorporateAction({ updatedAt: '2026-08-20T09:30:00', … })` を呼ぶ | 本文の `更新日時` が **`'2026-08-20T09:30:00'` のまま**載る（半角空白へ整形しない） | 実装済 |
| CAA-21 | 既定モック | `updateCorporateAction({ updatedAt: '', … })` を呼ぶ | 本文に `更新日時` のキーが載らない（未指定を「照合しない」と解釈させる。登録直後の行は更新日時が無い） | 実装済 |
| CAA-22 | 既定モック | 編集の payload（`id` と `updatedAt` を含む）をそのまま `validateCorporateAction()` に渡す | 事前検証の本文に `更新日時` が載らない（事前検証は楽観的ロックの照合をしない） | 実装済 |
| CAA-23 | `PUT /api/ca/{id}` が 409 を返す | `updateCorporateAction()` を呼ぶ | 例外が投げられ、`status` が 409、`message` にサーバの `detail` が入る | 実装済 |
