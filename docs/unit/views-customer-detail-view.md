# views/CustomerDetailView（顧客詳細の枠）

- 略号: `CDV`
- 対象: `src/views/CustomerDetailView.vue`
- テスト: `src/views/CustomerDetailView.spec.js`

実際の Pinia ストア + vue-router（`createMemoryHistory`）+ MSW(node) を通して、顧客の **4 状態の出し分け**
（取得中 / 見つからない / 失敗 / データあり）と、顧客カード・タブ・子ルートの描画を守る。
子ルート（外株預り / 注文照会 / 注文入力 / 仮計算）の中身はそれぞれの文書（`views-customer-summary-view.md` /
`views-customer-orders-view.md` / `views-order-entry-view.md` / `views-customer-calculation-view.md`）が見るので、
ここでは子ルートを目印だけの部品に差し替える。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CDV-01 | `GET /masters/customers/1` の応答を握ったまま | `/customers/1/summary` でマウントする | ローディングが出て、顧客カード・タブ・見つからない・エラーは出ない | 実装済 |
| CDV-02 | 既定モック（ID 9999 は 404） | `/customers/9999/summary` でマウントする | 「見つからない」が出て、顧客検索へ戻るリンクが `/customers/search` を指す。エラーと顧客カードは出ない | 実装済 |
| CDV-03 | `GET /masters/customers/1` が 500 | `/customers/1/summary` でマウントする | エラーの理由と「再試行」が出て、顧客カードと「見つからない」は出ない | 実装済 |
| CDV-04 | CDV-03 の状態 | 応答を既定に戻して「再試行」を押す | エラーが消え、顧客カードが出る | 実装済 |
| CDV-05 | 既定モック | `/customers/1/summary` でマウントする | 顧客カードに顧客 ID 1 の部店・口座番号・顧客名が出て、タブが 外株預り / 注文入力 / 注文照会 / 仮計算 の 4 つ並ぶ | 実装済 |
| CDV-06 | `GET /masters/customers/1` の応答を握ったまま | マウントし、応答を解放する | 解放するまで子ルートは描かれず、解放後に子ルートが描かれる | 実装済 |
| CDV-07 | 既定モック | `/customers/1/summary` でマウントする | 「外株預り」タブが `/customers/1/summary`、「注文照会」タブが `/customers/1/orders`、「仮計算」タブが `/customers/1/calculations`、「注文入力」タブが `/customers/1/order-entry?branch_code=<部店>&account_number=<口座番号>` を指す | 実装済 |
| CDV-08 | 既定モック | `/customers/1/summary`・`/customers/1/orders`・`/customers/1/order-entry`・`/customers/1/calculations` でそれぞれ開く | 開いたタブだけが選択中（is-active）になる。注文入力・仮計算のタブでも顧客カードとタブが残り、子ルートが描かれる | 実装済 |
| CDV-09 | 既定モック（顧客 ID 1 の預り 4 銘柄） | `/customers/1/summary` でマウントする | 顧客カードの米国株評価額・評価損益が預りの評価額_JPY・評価損益の合計になる（期待値はフィクスチャから導く） | 実装済 |
| CDV-10 | CDV-05 の状態 | URL を `/customers/2/summary` に変える | 顧客を読み直し、顧客カードが顧客 ID 2 の顧客名になる | 実装済 |
| CDV-11 | 既定モック | `/customers/1` を開く | `customer-summary`（`/customers/1/summary`）へ回され、外株預りタブが選択中になる | 実装済 |
