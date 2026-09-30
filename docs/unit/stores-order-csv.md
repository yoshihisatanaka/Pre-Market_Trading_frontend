# stores/orderCsv（CSV一括注文のストア）

- 略号: `OCS`
- 対象: `src/stores/orderCsv.js`
- テスト: `src/stores/orderCsv.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/orderCsv.js`）に当てて、CSV の列の仕様の取得と、
取込み画面の「CSVフォーマット」表の 4 状態のもとになる `columnsLoading` / `columnsError` / `isColumnsEmpty` を守る。
`beforeEach(() => setActivePinia(createPinia()))`。

あわせて、テンプレートDL（`downloadTemplate`）・事前検証（`validateFile` → `validation`）・
一括受付（`submitOrders` → `completion`）と、画面を開き直したときにエラーや結果を消す `clear*` を守る
（OCS-07〜21）。`validation` / `completion` はプレビュー・受付完了の画面へ持ち越す結果。
事前検証は multipart なので、テストの間だけ Node の FormData と File に差し替える（`src/api/orderCsv.spec.js` と同じ）。
`作成者` の期待値は `/auth/me` の既定モック（`supervisorOperator.操作者コード`）から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OCS-01 | 読み込み前 | ストアを作る | `columns` が空配列、`columnsLoading` が false、`columnsError` が null | 実装済 |
| OCS-02 | 既定モック | `loadColumns()` を呼ぶ | `columns` がフィクスチャの全列（先頭は index 最小の列名）、`columnsLoading` が false、`columnsError` が null、`isColumnsEmpty` が false | 実装済 |
| OCS-03 | 応答を握ったまま | `loadColumns()` を呼ぶ | `columnsLoading` が true、`isColumnsEmpty` は false（読み込み中に空を出さない） | 実装済 |
| OCS-04 | API が 500（`detail` 付き） | `loadColumns()` を呼ぶ | `columnsError.message` に detail が入り、`columns` は空、`columnsLoading` は false、`isColumnsEmpty` は false | 実装済 |
| OCS-05 | 0 列の応答 | `loadColumns()` を呼ぶ | `isColumnsEmpty` が true | 実装済 |
| OCS-06 | OCS-04 の状態 | 応答を既定に戻して `loadColumns()` を呼ぶ | `columnsError` が null に戻り、`columns` がフィクスチャの全列になる | 実装済 |
| OCS-07 | 作った直後 | ストアを作る | `validation` / `completion` が null、`canSubmit` / `validating` / `submitting` / `templateLoading` が false | 実装済 |
| OCS-08 | 既定モック | `downloadTemplate()` を呼ぶ | `{ blob, filename }` が返り（filename は `ORDER_CSV_TEMPLATE_FILENAME`）、`templateError` は null | 実装済 |
| OCS-09 | テンプレートが 500 | `downloadTemplate()` を呼ぶ | null が返り、`templateError` に理由が入る | 実装済 |
| OCS-10 | 既定モック | テンプレート本文の CSV で `validateFile()` を呼ぶ | `validation` の件数がフィクスチャどおりで、`canSubmit` が true | 実装済 |
| OCS-11 | NG 行を含む事前検証の応答 | `validateFile()` のあと `submitOrders()` を呼ぶ | `canSubmit` が false。`submitOrders()` は false を返し、一括受付のリクエストは届かない | 実装済 |
| OCS-12 | 事前検証の応答を握ったまま | `validateFile()` を呼ぶ | `validating` が true | 実装済 |
| OCS-13 | 前回の検証結果がある | ヘッダーが足りない CSV で `validateFile()` を呼ぶ | `validation` が null（前回の結果を残さない）、`validationError.message` が handler の detail | 実装済 |
| OCS-14 | 一括受付の失敗で `submitError` がある | `validateFile()` を呼ぶ | `submitError` が null に戻る | 実装済 |
| OCS-15 | 全行 OK の検証結果がある | `submitOrders()` を呼ぶ | true が返り、`completion` が `{ totalOrders, message, rows }` になる。`rows[i].orderId` は応答の採番を並び順で当てたもの。`validation` は null になり、`作成者` は `supervisorOperator.操作者コード` で届く | 実装済 |
| OCS-16 | 全行 OK の検証結果がある・一括受付が 500 | `submitOrders()` を呼ぶ | false が返り、`submitError` に理由が入る。`validation` は残り、`completion` は null のまま | 実装済 |
| OCS-17 | 全行 OK の検証結果がある・受付の応答を握ったまま | `submitOrders()` を 2 回呼ぶ | 握っている間は `submitting` が true、`canSubmit` が false。2 回目は false が返り、受付は 1 回しか届かない | 実装済 |
| OCS-18 | `validation` が null | `submitOrders()` を呼ぶ | false が返り、何も送らない | 実装済 |
| OCS-19 | `templateError` と `validationError` がある | `clearUploadErrors()` を呼ぶ | どちらも null になる | 実装済 |
| OCS-20 | `submitError` がある | `clearSubmitError()` を呼ぶ | `submitError` が null になる | 実装済 |
| OCS-21 | `completion` がある | `clearCompletion()` を呼ぶ | `completion` が null になる | 実装済 |
