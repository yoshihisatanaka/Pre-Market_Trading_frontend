# views/OrderCsvUploadView（CSV一括注文 取込み画面）

- 略号: `OCU`
- 対象: `src/views/OrderCsvUploadView.vue`
- テスト: `src/views/OrderCsvUploadView.spec.js`

実際の Pinia ストア + vue-router（`createMemoryHistory`）+ MSW(node) を通して、
「CSVフォーマット」表（`GET /orders/csv-spec`）の **4 状態の出し分け**と、取込み口の活性を守る。
画面は `<Teleport>` を使っていないが、他画面と揃えて `global: { stubs: { teleport: true } }` を付ける。

あわせて、テンプレートDL（`GET /orders/csv-template` → `downloadBlob`）と、
「内容を確認する」（`POST /orders/validate-csv` → プレビューへ遷移、またはこの画面にエラー）を守る（OCU-13〜20）。
`@/utils/download` は `vi.mock` して「何を渡したか」を見る（jsdom は `URL.createObjectURL` を持たない）。
事前検証は multipart なので、テストの間だけ Node の FormData に差し替え、ドロップするファイルも Node の File にする
（`src/api/orderCsv.spec.js` と同じ）。ルータには preview を足す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OCU-01 | 応答を握ったまま | マウントする | CSVフォーマットにローディングが表示され、表・空表示・エラーは出ない | 実装済 |
| OCU-02 | `GET /orders/csv-spec` が 500（`detail` 付き） | マウントする | その detail と「再試行」が表示され、表・凡例は出ない | 実装済 |
| OCU-03 | OCU-02 の状態 | 応答を既定に戻して「再試行」を押す | エラーが消え、表がフィクスチャの全列ぶんの行で出る | 実装済 |
| OCU-04 | 0 列の応答 | マウントする | 「CSVフォーマットの定義がありません」が表示され、表・凡例は出ない | 実装済 |
| OCU-05 | 既定モック | マウントする | 凡例と表が出て、行数がフィクスチャの列数、各行の列名が index の昇順でフィクスチャの列名と一致する | 実装済 |
| OCU-06 | 既定モック | マウントする | 必須の列だけ列名が赤字（`order-csv-upload__required`）になり、任意の列（指値単価）は赤字にならない | 実装済 |
| OCU-07 | 既定モック | マウントする | 必須欄は必須の列で `●` と読み上げ用の「必須」、任意の列で `—` と「任意」になる | 実装済 |
| OCU-08 | 既定モック | マウントする | condition のある列（指値単価）だけ、説明の下にその条件の文言が添えられる | 実装済 |
| OCU-09 | 既定モック | マウントする | 例の欄に例が文字列で出る（integer の口座番号も元の数字のまま） | 実装済 |
| OCU-10 | ファイル未選択 | マウントする | 「内容を確認する」が押せない | 実装済 |
| OCU-11 | ファイル未選択 | 取込み口に CSV をドロップする | 取込み口にファイル名が出て、「内容を確認する」が押せるようになる | 実装済 |
| OCU-12 | 既定モック | マウントする | 「テンプレートDL」ボタンが出て押せる（取得中でない） | 実装済 |
| OCU-13 | 既定モック | 「テンプレートDL」を押す | `downloadBlob` に `ORDER_CSV_TEMPLATE_FILENAME` とテンプレート本文の Blob が渡る | 実装済 |
| OCU-14 | テンプレートの応答を握ったまま | 「テンプレートDL」を押す | 取得中は「テンプレートDL」が押せない | 実装済 |
| OCU-15 | テンプレートが 500 | 「テンプレートDL」を押す | `order-csv-template-error` が出て、`downloadBlob` は呼ばれない | 実装済 |
| OCU-16 | 既定モック | テンプレート本文の CSV をドロップして「内容を確認する」を押す | `order-csv-preview` へ移り、ストアに検証結果（フィクスチャの件数）が入る | 実装済 |
| OCU-17 | NG 行を含む CSV | ドロップして「内容を確認する」を押す | プレビューへ移る（行の NG は検証の失敗ではない） | 実装済 |
| OCU-18 | ヘッダーが足りない CSV | ドロップして「内容を確認する」を押す | 取込み画面に留まり、`order-csv-validate-error` に handler の detail が出る | 実装済 |
| OCU-19 | 事前検証の応答を握ったまま | ドロップして「内容を確認する」を押す | 応答を待つ間は「内容を確認する」が押せない | 実装済 |
| OCU-20 | ストアに前回のテンプレートと検証のエラーが残っている | マウントする | `order-csv-template-error` と `order-csv-validate-error` のどちらも出ない | 実装済 |
