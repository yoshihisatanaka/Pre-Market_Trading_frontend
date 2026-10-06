# stores/mizuhoExecutions（みずほ注文締の約定一覧のストア）

- 略号: `MZS`
- 対象: `src/stores/mizuhoExecutions.js`
- テスト: `src/stores/mizuhoExecutions.spec.js`

`useCrudList` に任せている振る舞い（古い応答の破棄・再取得）は `composables-use-crud-list.md` が守るので、
ここでは**このストア固有の入出力**（件数カードの `summary` を含む）だけを書く。
MSW の既定ハンドラ（`src/mocks/handlers/mizuhoExecutions.js`）に当てる。`beforeEach(() => setActivePinia(createPinia()))`。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MZS-01 | 既定モック | `load()` を呼ぶ | `items` が 12 件、`total` が 12、`summary` が 総 12 / 買 7 / 売 5 / 一部出来 2（一部出来の注文の件数）になる | 実装済 |
| MZS-02 | 既定モック | `load({ side: '1' })` | `items` が売の 5 件だけになり、`summary` も 総 5 / 買 0 / 売 5 / 一部出来 1 になる | 実装済 |
| MZS-03 | 既定モック | `load({ fillStatus: '010' })`（一部出来の処理状況コード） | 一部出来の 2 件だけになる（行の `fillStatus` はすべて `partial`） | 実装済 |
| MZS-04 | `GET /executions` が 500 | `load()` | `error.message` に理由が入り、`items` は空、`loading` は false に戻る | 実装済 |
| MZS-05 | 0 件の応答 | `load()` | `isEmpty` が true、`summary` は 0 件 | 実装済 |
| MZS-06 | 1 回目の応答を握ったまま 2 回目の `load()` が先に返る | 1 回目を返す | `summary` は 2 回目（最後に出した要求）の値のまま | 実装済 |
| MZS-07 | 既定モック・`load({ side: '1', symbol, offset })` 済み | `exportCsv()` | `export-csv` に `route=0`・`side=1`・`symbol` が載り、`limit` / `offset` は載らない。`{ blob, filename }` が返る | 実装済 |
| MZS-08 | `load({ side: '1', symbol })` のあと `load({ side: '3' })` | `exportCsv()` | 最後に読んだ条件（`side=3`・`symbol` なし）で要求する | 実装済 |
| MZS-09 | 既定モック・`load()` 済み・`export-csv` が 500 | `exportCsv()` | `null` が返り、`exportError.message` に理由が入る。一覧の `error` は null のまま、`items` は残り、`exporting` は false に戻る | 実装済 |
| MZS-10 | `load()` 済み・`export-csv` の応答を握ったまま | `exportCsv()` を呼び、応答を返す | 待ちの間は `exporting` が true で一覧の `loading` は false。応答後 `exporting` は false | 実装済 |
| MZS-11 | MZS-09 のあと | `clearExportError()` | `exportError` が null になり、一覧の `error` と `items` は変わらない | 実装済 |
