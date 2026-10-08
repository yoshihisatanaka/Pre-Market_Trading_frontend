# utils/orderEntryOptions（新規注文の選択肢）

- 略号: `NOP`
- 対象: `src/utils/orderEntryOptions.js`
- テスト: `src/utils/orderEntryOptions.spec.js`

新規注文（外株注文入力）の区分値のコードと表示名の対応表。`openapi.json` の enum は値だけを持つので、
**コードと表示名の対応はこのファイルだけが持つ。** 守るのは次の 2 つ。

- 画面が送るコードが `src/utils/apiEnums.js` の `*_VALUES`（`openapi.json` の enum の写し）に含まれること。
  enum から値が消えたり綴りが変わったりしたら、ここで落ちる
- 向きを取り違えやすい値（売買区分の 1 / 3、指成区分の MO / LO）と、コード順と違う並び（市場区分）

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| NOP-01 | — | 各 `*_OPTIONS`（売買・指成・市場区分・決済通貨・預り売買・勧誘・受注方法・資金性格・注文チャネル・金銭受渡）の value を `apiEnums.js` の対応する `*_VALUES` と突き合わせる | すべての value が enum に含まれる | 実装済 |
| NOP-02 | — | 画面に欄の無い固定値（取引 = 委託・証券受渡方法 = 当社保管）を enum と `openapi.json` の OrderRequest と突き合わせる | `TRANSACTION_TYPE_VALUES` / `SECURITIES_DELIVERY_VALUES` に含まれ、証券受渡方法は OrderRequest の既定値（`'100'`）と一致する | 実装済 |
| NOP-03 | — | `ORDER_FORM_DEFAULTS` の各既定値を対応する選択肢と突き合わせる（市場区分は入力欄の `ORDER_ENTRY_EXECUTION_SCOPE_OPTIONS`） | どの既定値も選択肢の value のどれかに一致する（画面の初期表示で未選択の欄が出ない） | 実装済 |
| NOP-04 | — | 売買区分の選択肢を読む | 買い = `'3'`（tone `buy`）・売り = `'1'`（tone `sell`）で、先頭が買い | 実装済 |
| NOP-05 | — | 指成区分の選択肢を読む | 成行 = `'MO'`・指値 = `'LO'` | 実装済 |
| NOP-06 | — | 市場区分の選択肢を読む | value の並びが `02, 04, 03, 06`（コード順ではなく時間帯の順）で、enum の 4 値を過不足なく含む（`01` / `05` は 2026-10-02 の取り込みで外れた） | 実装済 |
| NOP-07 | — | `optionLabel()` を既知の値・未知の値・空文字・`undefined` で呼ぶ | 既知は表示名、それ以外は `'—'` | 実装済 |
| NOP-08 | — | `ORDER_PERSON_MAX_LENGTH` を `openapi.json` の OrderRequest.受注者 と突き合わせる | `maxLength`（4）と一致する | 実装済 |
| NOP-09 | — | 入力欄の市場区分 `ORDER_ENTRY_EXECUTION_SCOPE_OPTIONS` を読む | フェーズ 1 で受け付ける `02`（プレ＋レギュラー）/ `03`（レギュラー）の 2 つだけ。アフターを含む `04` / `06` は出さない（docs/api/requests.md #50 ②） | 実装済 |
