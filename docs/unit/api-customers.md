# api/customers（顧客マスタ API 層）

- 略号: `CUA`
- 対象: `src/api/customers.js`
- テスト: `src/api/customers.spec.js`

ここだけが**バックエンドの形**（パス・クエリ名・日本語キー・0/1 のフラグ）を知ってよい層なので、
この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。
同種の文書は [api-ca.md](api-ca.md) / [api-blackout-dates.md](api-blackout-dates.md)。

ストア（[stores-customers.md](stores-customers.md)）と画面
（[views-customer-list-view.md](views-customer-list-view.md)）のテストは MSW のモックが返す結果を
見ている。モックはこちらの実装と同じ理解で書かれているので、**モックとサーバの理解がずれていても
気づけない**。そこでこの文書では、モックの応答ではなく**送信されたリクエストそのもの**を見る。

2026-09-15 の OpenAPI 取り込みで、このマスタ一覧は `/customers` から**新設の
`/masters/customers`** へ移った。あわせてクエリ名が日本語から英語になり、`limit` が使えるようになった。

取り違えやすい点を 5 つ固定する。

- **クエリ名は英語の snake_case**（`branch_code` / `account_no` / `customer_name`）。
  取り込み前は日本語だった
- **`limit` を送る**（1〜200・既定 50）。受注不可日の `/masters/blackout-dates` は今も `limit` を持たない
- **`account_no` は integer。** 数字だけの入力のときにだけ送る（文字列を送ると 422 で弾かれる）
- **`handler_code`（扱者コード）はサーバに無い。** `/masters/customers` のクエリに移されなかった
  （旧 `/customers` には今もある）。`restriction` / `account_type` / `corporate_type` と同じく
  送りはするがモックだけが解釈し、実 API では絞り込まれない
- **フラグの型がキーごとに違う。** `取引停止区分_全取引` / `ユーザー操作フラグ` は integer の 0/1、
  `事故処理口座区分` は**文字列の '0'/'1'**（`AccidentAccountTypeEnum`）。どちらも boolean に直して外へ出す

金額 3 種（`円貨預り金` / `外貨預り金` / `NISA買付可能額_当年`）は数値のまま運ぶ。
**0 と「値が無い」は意味が違う**ので、0 を null に潰さない（CUA-11）。

2026-09-28 に事前検証・登録・更新（`validateCustomer` / `createCustomer` / `updateCustomer`）が入った。
**削除は実装しない。** 送る項目は `src/api/customers.js` の `CUSTOMER_FIELDS` が正で、取り違えやすい点は次の 3 つ。

- **空欄の送りかたが登録と更新で違う。** 登録・事前検証はキーごと送らず、更新は `null` で「クリア」を明示する
- **更新は `口座番号` を送らない**（`CustomerUpdateRequest` に無い）。パスキーは行 ID（`/masters/customers/{account_id}`）
- **事前検証の編集モードはクエリで切り替える**（`account_id` と `is_update=true`）。本文には `口座番号` が要る

テストは**アプリ内のキー ↔ 実 API のキーの対応をテスト側に書き写して固定する**（実装の `CUSTOMER_FIELDS` を
読まない。読むと実装の取り違えをそのまま期待値にしてしまう）。入力はフィクスチャの先頭行（生の形）を
その対応表でフォームの値（すべて文字列）に開いたもので、期待する本文も同じ行から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CUA-01 | 既定モック | `fetchCustomers()` を引数なしで呼ぶ | `GET /api/masters/customers` に `limit=50` と `offset=0` だけが載る。絞り込みも `include_deleted` も送らない | 実装済 |
| CUA-02 | 既定モック | `fetchCustomers({ branchCode, handlerCode, customerName })` を呼ぶ | クエリ名が `branch_code` / `customer_name` になり、値がそのまま載る。`handler_code` も同じ形で載る（サーバは受け取らないが、依頼したい綴りで送る） | 実装済 |
| CUA-03 | 既定モック | 全条件を空文字にして呼ぶ | 空文字の条件はクエリに載らない（「条件なし」を空文字として送らない） | 実装済 |
| CUA-04 | 既定モック | `fetchCustomers({ accountNumber: '1230001' })` を呼ぶ | `account_no=1230001` が載る（数字だけの入力は integer として送る） | 実装済 |
| CUA-05 | 既定モック | 数字以外を含む口座番号（`'123-0001'` / `'abc'` / `' '`）で呼ぶ | `account_no` を送らない（422 で弾かれて理由が画面に出ない事態を避ける） | 実装済 |
| CUA-06 | 既定モック | `fetchCustomers({ limit: 20, offset: 50 })` を呼ぶ | `limit=20` と `offset=50` がそのまま載る | 実装済 |
| CUA-07 | 既定モック | `fetchCustomers({ restriction, accountType, corporateType })` を呼ぶ | クエリ名が `restriction` / `account_type` / `corporate_type` になる（openapi に無くモックだけが解釈する条件） | 実装済 |
| CUA-08 | API が `CustomerItem` を 1 件返す | `fetchCustomers()` を呼ぶ | 主キーの `id`（実 API の `ID` を文字列にしたもの）に加え、口座番号・部店・扱者・顧客名・カナ・年齢・各区分名がアプリ内モデルの名前に変換される。`accountNumber` は integer ではなく文字列 | 実装済 |
| CUA-09 | API が `取引停止区分_全取引` / `ユーザー操作フラグ` を 1 / 0 で返す | `fetchCustomers()` を呼ぶ | `tradingSuspended` / `userModified` が `true` / `false` の boolean になる | 実装済 |
| CUA-10 | API が `事故処理口座区分` を `'1'` / `'0'` / integer の `1` で返す | `fetchCustomers()` を呼ぶ | 文字列 `'1'` のときだけ `accidentAccount` が `true`（integer の 1 では立たない。キーごとに型が違うことを固定する） | 実装済 |
| CUA-11 | API が金額を `3500000` / `0` / `null` で返す | `fetchCustomers()` を呼ぶ | `cashJpy` / `cashUsd` / `growthQuota` が数値のまま（整形しない）。`0` は `0` のままで、`null` だけが `null`（0 を「値が無い」に潰さない） | 実装済 |
| CUA-12 | API が文字列項目を `null` で返す | `fetchCustomers()` を呼ぶ | 部店名・扱者名・カナ・年齢・各区分名が空文字になる（`null` を画面へ流さない） | 実装済 |
| CUA-13 | API が `customers` を持たない応答を返す | `fetchCustomers()` を呼ぶ | `items` が空配列、`total` が 0 になる（キーが欠けても落ちない） | 実装済 |
| CUA-14 | API が 500 を返す | `fetchCustomers()` を呼ぶ | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
| CUA-15 | API が `ID` を持たない `CustomerItem` を返す | `fetchCustomers()` を呼ぶ | `id` が空文字のままになる（口座番号へフォールバックしない）。`accountNumber` は従来どおり出る | 実装済 |
| CUA-16 | 事前検証が合格を返す。フォームの値（数値も文字列で持つ） | `validateCustomer(入力)` を id なしで呼ぶ | `POST /api/masters/customers/validate` にクエリなしで送られる。本文のキーは日本語で、`口座番号` / `総預り資産` / `取引停止区分_*` は integer、`外貨預り金` は小数を許す数値、区分・書類受入・`法人区分` などは文字列のまま。文字列の前後の空白は落とす | 実装済 |
| CUA-17 | 事前検証・登録が成功を返す。任意項目（`生年月日` / `投資方針` / 預り金 / NISA 買付可能額など）が空欄 | `validateCustomer()` / `createCustomer()` を呼ぶ | 空欄の項目は**キーごと送らない**（`null` も `''` も載せない。数値項目に `''` を送ると 422 になり、省けばサーバの既定が入る） | 実装済 |
| CUA-18 | 事前検証が合格を返す | `validateCustomer({ id, updatedAt, ...入力 })` を呼ぶ | クエリが `account_id=<id の数値>` と `is_update=true` になる。本文に `口座番号` は載り、`更新日時` は載らない（事前検証は楽観的ロックを照合しない） | 実装済 |
| CUA-19 | 事前検証が `{ valid: false, errors: [...], warnings: [...] }` / `errors` と `warnings` を欠いた `{ valid: true }` を返す | `validateCustomer()` を呼ぶ | 前者はそのまま `{ valid, errors, warnings }` で返る（不合格を例外にしない）。後者は `errors` / `warnings` が空配列になる | 実装済 |
| CUA-20 | 登録 API が 201 で `account`（サーバ採番の `ID` 付き）を返す | `createCustomer(入力)` を呼ぶ | `POST /api/masters/customers` に CUA-16 と同じ形の本文が送られ、201 の `account` がアプリ内モデルに変換されて返る（`id` はサーバの採番、`accountNumber` は文字列） | 実装済 |
| CUA-21 | 更新 API が更新後の `account` を返す。任意項目の一部が空欄 | `updateCustomer({ id, ...入力 })` を呼ぶ | `PUT /api/masters/customers/<id>` に送られる。本文に `口座番号` が**無い**（業務キーは変更不可）。空欄の項目はキーを残して `null` を送る（部分更新なので省くと「変えない」になる）。更新後の `account` が変換されて返る | 実装済 |
| CUA-22 | 更新 API が成功を返す | `updateCustomer()` を `updatedAt` あり / 空文字で呼ぶ | ありなら本文の `更新日時` にその値がそのまま載る。空文字なら `更新日時` のキーごと送らない | 実装済 |
| CUA-23 | 更新 API が 409（`{ detail }`）を返す | `updateCustomer()` を呼ぶ | 例外が投げられ、`message` に detail が入る（呼び出し側の `useAsync` が `updateError` に入れる） | 実装済 |
| CUA-24 | 整数の項目に `'1.5'` / `'abc'`、小数を許す項目に `'abc'` | `createCustomer()` / `updateCustomer()` を呼ぶ | 数値にならない入力は空欄と同じに扱う（登録ではキーを送らず、更新では `null`）。サーバに 422 で弾かせない | 実装済 |
| CUA-25 | API が `CustomerItem` を 1 件返す（`更新日時` あり / `null`、編集用の項目が欠けた行） | `fetchCustomers()` を呼ぶ | 編集フォームの初期値になる項目（`vwapDocument` / `specificAccountType` / `suspendEquityTrade` / `totalAssets` / `growthQuotaNext` / `birthDate` など）も返る。文字列は欠けたら `''`、数値は欠けたら `null`。`updatedAt` は `更新日時` の文字列で、`null` なら `''` | 実装済 |
| CUA-26 | API が `{ account: CustomerItem }` を返す | `fetchCustomer(<行 ID>)` を呼ぶ | `GET /api/masters/customers/<行 ID>` に送られ（クエリなし）、`account` が一覧と同じアプリ内モデルに変換されて返る（`id` は行 ID の文字列、`accountNumber` は文字列） | 実装済 |
| CUA-27 | API が 404（`{ detail }`）を返す | `fetchCustomer()` を呼ぶ | `status` が 404 の `ApiError` が投げられ、`message` に detail が入る（呼び出し側が「見つからない」を通信障害と分けて出せる） | 実装済 |

## 主キーは `id`（口座番号ではない）

DB 全テーブルの主キーを `id` に統一する方針に合わせて、アプリ内モデルの主キーを
実 API の integer な `ID` にしてある。**口座番号は主キーではなく、行を人が識別する一意な業務コード**。
一覧の行キーも `id` になった（`CustomerListView` の `row-key` は `DataTable` の既定に任せる）。

`ID` とパス `/masters/customers/{account_id}` は 2026-09-18 の取り込みで仕様に入った
（フィクスチャの注記）。`ID` が欠けると `id` は空文字になり、行キーの重複に加えて
**更新のパス（`PUT /masters/customers/{id}`）と編集の事前検証（`account_id`）が壊れる**。

`CUA-15` はその穴を見張るためのシナリオ。**値で取り繕わない**
（銘柄マスタの [api-symbols.md](api-symbols.md) の `STA-24` と同じ扱い）。
