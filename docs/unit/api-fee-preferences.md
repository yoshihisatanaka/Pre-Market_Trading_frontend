# api/feePreferences（手数料優遇マスタ API 層）

- 略号: `FPA`
- 対象: `src/api/feePreferences.js`
- テスト: `src/api/feePreferences.spec.js`

ここだけが**バックエンドの形**（パス・英語のクエリ名・日本語のレスポンスキー・integer の口座番号）を
知ってよい層なので、この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。
パス・クエリ名が仕様に在るかは [api-contract.md](api-contract.md)（`CON`）が全 api をまとめて見る。

取り違えやすい点を 4 つ固定する。

- **手数料パターンの空文字は「デフォルトパターン」という値。** 検索では空文字が「条件なし」と区別できないので、
  画面は `DEFAULT_FEE_PATTERN_FILTER`（`'default'`）で持ち、この層が `fee_pattern=`（空文字）に直して送る（FPA-04）。
  入力の本文では空文字のまま送る（FPA-07）
- **数値 7 項目の「未設定」は null で、0 とは別の意味。** 為替スプレッドの 0 は免除、null は仮計算マスタの値。
  受信では null のまま通し（FPA-06）、送信では空欄を null で明示する（部分更新で「未設定に戻す」を伝えるため。FPA-07）
- **事前検証の `warnings` を返す**（CA・銘柄と違う。FPA-10）。登録・変更の応答の `warnings` も 1 件と一緒に返す（FPA-12）
- **パスキーは ID**（`{fee_preference_id}`）。変更検証の対象もクエリの `fee_preference_id` で指す（FPA-08 / FPA-11）

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FPA-01 | 既定モック | `fetchFeePreferences()` | `{ items, total }` を返し、`total` がフィクスチャの有効行の件数、`items[0]` のキーがすべて camelCase（`口座番号` → `accountNumber`（文字列）、`手数料パターン` → `feePattern`、`掛目` → `feeMultiplier`、`スプレッド` → `fxSpread`、`適用方式` → `applyMethod` など）になる | 実装済 |
| FPA-02 | 既定モック | `fetchFeePreferences({ branchCode: '', accountNumber: '', feePattern: '' })` | 空文字の条件はクエリに載せない（MSW が受けた URL に `branch_code` / `account_no` / `fee_pattern` が無い） | 実装済 |
| FPA-03 | 既定モック | `fetchFeePreferences({ branchCode: '123', accountNumber: '1230001', feePattern: 'A' })` | `branch_code=123` / `account_no=1230001` / `fee_pattern=A` で送られる | 実装済 |
| FPA-04 | 既定モック | `fetchFeePreferences({ feePattern: DEFAULT_FEE_PATTERN_FILTER })` | `fee_pattern` が**空文字の値として**送られる（URL に `fee_pattern=` がある）。返る行の `feePattern` はすべて `''` | 実装済 |
| FPA-05 | 既定モック | `fetchFeePreferences({ accountNumber: '12a' })` | 数字以外を含む口座番号は `account_no` に載せない（422 で検索できなくなるのを避ける） | 実装済 |
| FPA-06 | 応答の数値項目と `部店コード` / `顧客名` / `適用方式` が `null` | `fetchFeePreferences()` | 数値 7 項目は `null` のまま（0 にしない）、文字列 3 項目は `''` になる。`スプレッド: 0` は `fxSpread: 0` のまま | 実装済 |
| FPA-07 | 入力（数値は文字列、空欄あり、`feePattern: ''`、`acknowledgedWarnings: true`） | `createFeePreference(入力)` | 本文が `FeePreferenceRequest` の形: `口座番号` は integer、`手数料パターン` は `''` のまま、数値の文字列は数値、空欄は `null`。`ID` / `acknowledgedWarnings` / `更新日時` は本文に載らない | 実装済 |
| FPA-08 | 入力 + `id: '3'` + `updatedAt` | `updateFeePreference({ id, ... })` | `PUT /masters/fee-preferences/3` に送られ、本文に `更新日時` が取得時の値のまま載る。`updatedAt` が空なら `更新日時` のキーごと載らない | 実装済 |
| FPA-09 | 既定モック | `deleteFeePreference('3')` | `DELETE /masters/fee-preferences/3` に本文なしで送られ、戻り値は `'3'` | 実装済 |
| FPA-10 | `validate` の応答が `valid: false`（errors 付き）/ `valid: true`（warnings 付き） | `validateFeePreference(入力)` | 例外にせず、前者は `{ valid: false, errors }`、後者は `{ valid: true, errors: [], warnings }` を返す | 実装済 |
| FPA-11 | 入力 + `id: '3'` + `updatedAt` / `id` なし | `validateFeePreference(...)` | `id` があればクエリに `fee_preference_id=3` と `is_update=true` が付き、無ければクエリを付けない。どちらも本文に `更新日時` は載らない | 実装済 |
| FPA-12 | 登録・変更の応答が `warnings` を持つ / 持たない | `createFeePreference` / `updateFeePreference` | 戻り値は 1 件のアプリ内モデルに `warnings`（文字列の配列）を足したもの。応答に無ければ `[]` | 実装済 |
