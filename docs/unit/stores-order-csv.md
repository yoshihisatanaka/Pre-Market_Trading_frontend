# stores/orderCsv（CSV一括注文のストア）

- 略号: `OCS`
- 対象: `src/stores/orderCsv.js`
- テスト: `src/stores/orderCsv.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/orderCsv.js`）に当てて、CSV の列の仕様の取得と、
取込み画面の「CSVフォーマット」表の 4 状態のもとになる `columnsLoading` / `columnsError` / `isColumnsEmpty` を守る。
`beforeEach(() => setActivePinia(createPinia()))`。

事前検証・一括受付（プレビュー・受付完了の画面へ持ち越す結果）は処理が未実装なので、足すときに行を足す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OCS-01 | 読み込み前 | ストアを作る | `columns` が空配列、`columnsLoading` が false、`columnsError` が null | 実装済 |
| OCS-02 | 既定モック | `loadColumns()` を呼ぶ | `columns` がフィクスチャの全列（先頭は index 最小の列名）、`columnsLoading` が false、`columnsError` が null、`isColumnsEmpty` が false | 実装済 |
| OCS-03 | 応答を握ったまま | `loadColumns()` を呼ぶ | `columnsLoading` が true、`isColumnsEmpty` は false（読み込み中に空を出さない） | 実装済 |
| OCS-04 | API が 500（`detail` 付き） | `loadColumns()` を呼ぶ | `columnsError.message` に detail が入り、`columns` は空、`columnsLoading` は false、`isColumnsEmpty` は false | 実装済 |
| OCS-05 | 0 列の応答 | `loadColumns()` を呼ぶ | `isColumnsEmpty` が true | 実装済 |
| OCS-06 | OCS-04 の状態 | 応答を既定に戻して `loadColumns()` を呼ぶ | `columnsError` が null に戻り、`columns` がフィクスチャの全列になる | 実装済 |
