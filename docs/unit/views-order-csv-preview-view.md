# views/OrderCsvPreviewView（CSV一括注文 プレビュー画面）

- 略号: `OCP`
- 対象: `src/views/OrderCsvPreviewView.vue`
- テスト: `src/views/OrderCsvPreviewView.spec.js`

実際の Pinia ストア + vue-router（`createMemoryHistory`）+ MSW(node) を通して、事前検証の結果（ストアの `validation`）の
出し分けと、一括受付（`POST /orders/bulk-create`）への導線を守る。
画面は `<Teleport>` を使っていないが、他画面と揃えて `global: { stubs: { teleport: true } }` を付ける。

この画面は読み込みを持たない。4 状態は次のように読み替える。

- ローディング … 取込み画面の「内容を確認する」が受け持つ（この画面の対象外）。受付中のボタンの非活性だけを見る（OCP-12）
- エラー … 一括受付の失敗（OCP-11）。事前検証の失敗は取込み画面に留まる（`views-order-csv-upload-view.md`）
- 空 … 結果が無い（OCP-01・02）/ CSV にデータ行が無い（OCP-04）
- データあり … 件数・表・受付ボタン（OCP-03・05〜10）

前提の作り方: テストで同じ Pinia を先に作り、`server.use` で事前検証の応答を決めてから
`store.validateFile(Node の File)` を呼び、そのあとマウントする（multipart のため FormData は Node の実装に差し替える）。
期待値は `src/mocks/fixtures/orderCsv.js` と `src/utils/orderCodeLabels.js` / `src/utils/format.js` から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OCP-01 | 検証結果が無い | マウントする | 空状態（`order-csv-preview-empty`）だけが出て、表・件数・受付ボタンは出ない | 実装済 |
| OCP-02 | 検証結果が無い | 空状態の「CSV取込みへ」を押す | `order-csv-upload` へ移る | 実装済 |
| OCP-03 | 全行 OK の検証結果 | マウントする | 3 枠の件数（取込み・正常・エラー）がフィクスチャの件数どおりで、エラー枠は `is-ok`。エラーの帯（`order-csv-preview-has-error`）は出ない | 実装済 |
| OCP-04 | データ行が 0 件の検証結果 | マウントする | 表の代わりに `order-csv-preview-no-rows` が出る。受付ボタンは「受付できる注文がありません」で押せない | 実装済 |
| OCP-05 | NG を含む検証結果 | マウントする | エラーの帯が出て、エラー枠は `is-ng`。NG の行だけに `is-invalid` が付く | 実装済 |
| OCP-06 | NG と警告を含む検証結果 | マウントする | エラーと警告は別の testid（`order-csv-preview-error` / `order-csv-preview-warning`）・別のクラス（`is-error` / `is-warning`）で出る。行ごとの件数と文言はフィクスチャどおり | 実装済 |
| OCP-07 | 全行 OK の検証結果 | マウントする | 行のセルに、口座「部店-口座番号」・売買の名前・価格ラベル・市場区分の名前・期間指定の MM/DD が出る | 実装済 |
| OCP-08 | 全行 OK の検証結果 | マウントする | 受付ボタンの文言が「N件を受付する」（N は取込み件数）で押せる | 実装済 |
| OCP-09 | NG を含む検証結果 | マウントする | 受付ボタンが「エラーを修正してください」になり、押せない | 実装済 |
| OCP-10 | 全行 OK の検証結果 | 受付ボタンを押す | `order-csv-complete` へ移り、ストアに `completion` が入る | 実装済 |
| OCP-11 | 全行 OK の検証結果・一括受付が 500 | 受付ボタンを押す | プレビューに留まり、`order-csv-preview-submit-error` に理由が出る。ボタンは押せる状態に戻る | 実装済 |
| OCP-12 | 全行 OK の検証結果・受付の応答を握ったまま | 受付ボタンを押す | 応答を待つ間は受付ボタンが押せない | 実装済 |
| OCP-13 | ストアに前回の `submitError` が残っている | マウントする | `order-csv-preview-submit-error` は出ない | 実装済 |
| OCP-14 | 全行 OK の検証結果 | 「← 再取込み」と「← CSVを再取込みする」をそれぞれ押す | どちらでも `order-csv-upload` へ移る | 実装済 |
