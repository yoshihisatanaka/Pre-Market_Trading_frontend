# utils/customerFields（顧客マスタのフォーム項目定義）

- 略号: `CFF`
- 対象: `src/utils/customerFields.js`
- テスト: `src/utils/customerFields.spec.js`
- 使う側: [views-customer-list-view.md](views-customer-list-view.md)（`CustomerFormFields` を通して CLV-23 以降が見る）

登録・編集フォームの項目表（`CUSTOMER_FIELD_GROUPS`）と、フォームの値を作る・検査する純関数。
**項目はこれから増える**（2026-09-28 時点で最終形の 3 分の 1 程度）ので、テストは項目数や
ラベルを直接書かず、`CUSTOMER_FIELDS` の宣言（`required` / `initial` / `control` / `min` / `max` / `pattern`）から
期待値を導く。項目が増えても各規則が全項目に効いていることを見張る。

ここでの検査は「明らかな入力漏れ・書式違いで往復しない」ためのもの。実在（部店・扱者）・
重複（口座番号）・項目どうしの整合はサーバの事前検証が見るので、ここでは扱わない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CFF-01 | — | `CUSTOMER_FIELD_GROUPS` と `CUSTOMER_FIELDS` を読む | `CUSTOMER_FIELDS` はグループの項目を並び順どおり畳んだもの。`key` と `testid` はそれぞれ全項目で重複しない。`control` は `text` / `integer` / `decimal` / `select` のいずれか | 実装済 |
| CFF-02 | — | `emptyCustomerForm()` を呼ぶ | 全項目の `key` を持ち、`initial` を宣言した項目はその値、それ以外は `''`。呼ぶたびに別のオブジェクトが返る（前回の入力を持ち越さない） | 実装済 |
| CFF-03 | 数値（`0` を含む）・文字列・`null`・欠けた項目を持つ顧客 | `toCustomerForm(customer)` を呼ぶ | 全項目が文字列になる。数値は `String()` の形（`0` は `'0'`）、`null` と欠けた項目は `''`（`0` と「値が無い」を区別する） | 実装済 |
| CFF-04 | `emptyCustomerForm()` のまま | `validateCustomerForm()` を呼ぶ | 必須で初期値の無い項目だけにエラーが出る。入力欄は「〈label〉を入力してください。」、選択欄は「〈label〉を選択してください。」。任意の項目と初期値のある必須項目は `''` | 実装済 |
| CFF-05 | 必須の入力欄が空白だけ | `validateCustomerForm()` を呼ぶ | 未入力と同じ「〈label〉を入力してください。」になる（前後の空白は値とみなさない） | 実装済 |
| CFF-06 | 整数の項目に `'1.5'` / `'abc'` | `validateCustomerForm()` を呼ぶ | 「〈label〉は整数で入力してください。」 | 実装済 |
| CFF-07 | 小数を許す項目に `'abc'`、別の入力で `'1.25'` | `validateCustomerForm()` を呼ぶ | `'abc'` は「〈label〉は数値で入力してください。」、`'1.25'` は `''` | 実装済 |
| CFF-08 | `min` / `max` を持つ数値項目に、境界ちょうど・下限未満・上限超過の値 | `validateCustomerForm()` を呼ぶ | 境界ちょうどは `''`。下限未満は「〈label〉は 〈min を 3 桁区切り〉 以上で入力してください。」、上限超過は「〈label〉は 〈max を 3 桁区切り〉 以下で入力してください。」 | 実装済 |
| CFF-09 | 生年月日に `'19620708'` / `'0'` / `''` / `'1962-07-08'` / `'1962070'` | `validateCustomerForm()` を呼ぶ | 8 桁の数字・`'0'`（法人）・空欄（任意）は `''`。それ以外は宣言された `patternMessage` | 実装済 |
| CFF-10 | 必須をすべて埋めたフォーム | `validateCustomerForm()` → `hasCustomerFormErrors()` | 全項目が `''` で、`hasCustomerFormErrors()` が false。1 項目でもエラーがあれば true | 実装済 |
