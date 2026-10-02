# views/CustomerSearchView（顧客検索画面）

- 略号: `CSW`
- 対象: `src/views/CustomerSearchView.vue`
- テスト: `src/views/CustomerSearchView.spec.js`

実際の Pinia ストア + vue-router（`createMemoryHistory`）+ MSW(node) を通して、
**4 状態の出し分け**と「検索条件は URL クエリが正」の単方向フローを守る。読むだけの一覧で、
新規追加・編集・削除は無い。読む API は顧客マスタと同じ `GET /masters/customers`。

この画面に固有の、取り違えやすい点を固定する。

- **開いた時点で条件なしの一覧が出る**（画面モックと同じ。CSW-02）
- **URL のクエリ名は画面モックと同じ `branch_code` / `sales_rep_code` / `account_number` / `name`** で、
  API へは `branch_code` / `handler_code` / `account_no` / `customer_name` で送られる（CSW-08 / CSW-09）
- **顧客名は顧客詳細（`/customers/<id>/summary`）へのリンク**（`customer-search-detail-<id>`。CSW-11）
- **米国株評価額 / 評価損益の列は無い**（2026-09-28 決定。CSW-03）

期待値はフィクスチャ（`src/mocks/fixtures/customers.js`）と `CUSTOMER_SEARCH_PAGE_SIZE`、
`src/utils/customerCautions.js` の `CAUTION_RANKS` から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CSW-01 | 既定モック | マウント直後（応答前）を見る | 回転マークが出て、表も空状態もエラーも出ない。件数も出ない | 実装済 |
| CSW-02 | 既定モック | クエリなしでマウントして応答を待つ | 件数がフィクスチャの全件数で、表の行が `CUSTOMER_SEARCH_PAGE_SIZE` 件（口座番号の昇順の先頭ページ） | 実装済 |
| CSW-03 | 既定モック | 列見出しを読む | `部店` / `扱者` / `口座番号` / `顧客名` / `年齢` / `コンプラランク` / `投資方針` / `預り金（円貨）` / `預り金（USD）` / `成長投資枠` / `取引規制` の 11 列。`米国株評価額` / `評価損益` を含む見出しは無い | 実装済 |
| CSW-04 | API が 0 件を返す | マウントして応答を待つ | 「該当する顧客が見つかりませんでした」が出て、表は描画されない | 実装済 |
| CSW-05 | API が 500 を返す | マウントして応答を待つ | エラーの理由と「再試行」が出て、表も空状態も出ない | 実装済 |
| CSW-06 | API が 1 回だけ 500、以降は正常 | 「再試行」を click | エラー表示が消え、表が描画される | 実装済 |
| CSW-07 | 0 件 / 500 / 正常 のいずれか | マウントして応答を待つ | 説明文と検索カードはどの状態でも消えない | 実装済 |
| CSW-08 | 既定モック | 部店・扱者・口座番号・顧客名を入れて「検索」を submit | URL に `branch_code` / `sales_rep_code` / `account_number` / `name` が乗り（`offset` なし）、表がその条件で絞り込まれる | 実装済 |
| CSW-09 | `?branch_code=…&sales_rep_code=…&account_number=…&name=…` でマウント | 送られたリクエストのクエリを見る | API へ `branch_code` / `handler_code` / `account_no` / `customer_name` で送られ、URL 上の名前（`sales_rep_code` / `account_number` / `name`）は送られない。入力欄にも同じ値が入る | 実装済 |
| CSW-10 | 絞り込み済み | 「クリア」を click | URL クエリが空になり、全件に戻る | 実装済 |
| CSW-11 | 既定モック | 先頭行の顧客名のリンクを見る | `customer-search-detail-<id>` のリンクが顧客名を出し、`/customers/<id>/summary` を指す | 実装済 |
| CSW-12 | 既定モック（コンプラランク A・B と C・D・X の行がある） | コンプラランクのセルを読む | `CAUTION_RANKS` のランクは `buy` のバッジ、それ以外は `gray` のバッジでランクを出す | 実装済 |
| CSW-13 | 全取引停止の行と通常の行がある | 取引規制のセルを読む | 停止の行だけ「全取引停止」のバッジ（`buy`）、通常の行はバッジなしの「-」 | 実装済 |
| CSW-14 | 個人と法人（年齢が空）の行がある | 年齢のセルを読む | 個人は「75歳」の形、法人は「—」 | 実装済 |
| CSW-15 | 金額に値・null・0 の行がある | 金額 3 列を読む | `3,500,000 円` / `50,000.00 ドル` の形で、null は「—」、0 は「0 円」 | 実装済 |
| CSW-16 | 既定モック | ページ送りの「2」を click | URL に `offset` が乗り、表が 2 ページ目に入れ替わる | 実装済 |
