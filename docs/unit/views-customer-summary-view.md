# views/CustomerSummaryView（顧客詳細の外株預りタブ）

- 略号: `CSM`
- 対象: `src/views/CustomerSummaryView.vue`
- テスト: `src/views/CustomerSummaryView.spec.js`

実際の Pinia ストア + vue-router（`createMemoryHistory`）+ MSW(node) を通して、枠
（`CustomerDetailView`）ごと `/customers/:customerId/summary` からマウントする。
預りの **4 状態の出し分け**、CA の警告、行の「買い」「売り」が新規注文へ引き継ぐ URL クエリ、
「仮計算」が仮計算タブへ引き継ぐ URL クエリ、発注権限での出し分けを守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CSM-01 | `GET /holdings` の応答を握ったまま | `/customers/1/summary` でマウントする | 預りのローディングが出て、表・空・エラー・件数は出ない | 実装済 |
| CSM-02 | `GET /holdings` が 500 | `/customers/1/summary` でマウントする | 預りのエラーの理由と「再試行」が出て、表は出ない（顧客カードは出る） | 実装済 |
| CSM-03 | CSM-02 の状態 | 応答を既定に戻して「再試行」を押す | 預りだけを読み直して表が出る。顧客は読み直さない | 実装済 |
| CSM-04 | 既定モック（顧客 ID 3 は保有なし） | `/customers/3/summary` でマウントする | 「保有外株なし」が出て、表と CA の警告は出ない | 実装済 |
| CSM-05 | 既定モック（顧客 ID 1） | `/customers/1/summary` でマウントする | 件数が「<預りの件数> 銘柄」で、行がフィクスチャの順のティッカーで並び、評価の時点（「…時点」）が出る | 実装済 |
| CSM-06 | 既定モック（顧客 ID 1。TSLA が CA 発生中） | `/customers/1/summary` でマウントする | CA の警告が出て、CA の印は CA のある行（TSLA）にだけ付く | 実装済 |
| CSM-07 | 既定モック（顧客 ID 1。AAPL は特定預り） | AAPL の行の「買い」を見る | 注文入力タブ `/customers/1/order-entry?branch_code=<部店>&account_number=<口座番号>&ticker=AAPL&side=buy&deposit=0` を指す | 実装済 |
| CSM-08 | 既定モック（顧客 ID 1。NVDA は成長投資枠） | NVDA の行の「買い」「売り」を見る | 買いは deposit を載せず、売りは `side=sell&deposit=6&quantity=<売却可能株数>` を載せる | 実装済 |
| CSM-15 | 既定モック（顧客 ID 1。AAPL は特定預り区分 1 特定・数量 100・売却可能株数 80） | AAPL の行の「売り」を見る | `side=sell&deposit=0`（預りの特定 1 → 注文の特定 0）と `quantity=80`（保有数量ではなく売却可能株数）を載せる | 実装済 |
| CSM-09 | 既定モック（顧客 ID 1。MSFT は売却不可） | MSFT の行の「売り」を見る | 押せない button で、リンクではない。「買い」はリンクのまま | 実装済 |
| CSM-10 | `GET /auth/me` が発注権限なしの操作者 | `/customers/1/summary` でマウントする | 各行が「閲覧のみ」になり、「買い」「売り」と見出しの「新規注文」は出ない。行と見出しの「仮計算」は出る（発注ではないため） | 実装済 |
| CSM-11 | 既定モック（発注権限あり） | `/customers/1/summary` でマウントする | 見出しの「新規注文」が注文入力タブ `/customers/1/order-entry?branch_code=<部店>&account_number=<口座番号>` を指す | 実装済 |
| CSM-12 | 既定モック（顧客 ID 6。CA の無い 2 銘柄） | `/customers/6/summary` でマウントする | 表は出るが CA の警告も CA の印も出ない | 実装済 |
| CSM-13 | 既定モック（顧客 ID 1。AAPL は特定、NVDA は成長投資枠） | AAPL・NVDA の行の「仮計算」を見る | `/customers/1/calculations?symbol=<ティッカー>&side=sell&specific_deposit=<特定預り区分>` を指す（AAPL は `1`、NVDA は `6`。成長投資枠も落とさない） | 実装済 |
| CSM-14 | 既定モック | 見出しの「仮計算」を見る | クエリなしの `/customers/1/calculations` を指す | 実装済 |
