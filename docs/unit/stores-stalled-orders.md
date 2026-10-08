# stores/stalledOrders（滞留注文抽出ストア）

- 略号: `SOS`
- 対象: `src/stores/stalledOrders.js`
- テスト: `src/stores/stalledOrders.spec.js`
- E2E 側のシナリオ: [docs/e2e/stalled-orders.md](../e2e/stalled-orders.md)

ページャを持たないので `useCrudList` ではなく `useAsync` を直に使う。
1 回の検索で 2 本の一覧が同時に埋まるため、空状態の判定も 2 本ある。
1 件の形は `src/api/stalledOrders.js` の JSDoc を参照。

コンファメーション CSV の取込（SOS-09 以降）は一覧と `loading` / `error` を分けて持つ
（取込に失敗しても一覧の表示を残すため）。取込の POST は jsdom の FormData のままでは
MSW(node) を通らないので、テストの間だけ Node の FormData / File に差し替える
（理由は [api-stalled-orders.md](api-stalled-orders.md) の前書き）。

取込（`POST /operations/stalled-orders/confirmation-import`）は 2026-10-07 に実 API が入り、MSW のハンドラを消した
（`vitest.setup.js` は `onUnhandledRequest: 'error'`）。**取込を呼ぶテストは必ず `server.use()` で応答
（`CsvImportResponse` の生の形や 400 / 500 の `{ detail }`）を差し込む。** 一覧への反映の中身はバックエンドの責務なので、
「取込の後に引き直したこと」は、取込後の一覧の GET を別の応答に差し替えてそれが入ることで確かめる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOS-01 | まだ `load()` を呼んでいない | — | `orderErrors` / `workingOrders` はどちらも空配列 | 実装済 |
| SOS-02 | 既定モック | `load()` を呼んで応答を待つ | `orderErrors` 3 件 / `workingOrders` 2 件になる | 実装済 |
| SOS-03 | 応答がまだ返っていない | `load()` を呼ぶ | `loading` が true になり、空状態のフラグはどちらも false のまま | 実装済 |
| SOS-04 | API が 500 を返す | `load()` を呼んで応答を待つ | `error` にその理由が入り、空状態のフラグは false のまま（エラーと空が二重に出ない） | 実装済 |
| SOS-05 | 両方 0 件を返す | `load()` を呼んで応答を待つ | `isOrderErrorsEmpty` / `isWorkingOrdersEmpty` がどちらも true | 実装済 |
| SOS-06 | 注文エラーだけ 0 件を返す | `load()` を呼んで応答を待つ | `isOrderErrorsEmpty` だけが true になる | 実装済 |
| SOS-07 | `load({ branchCode: '123' })` を呼んだあと | `reload()` を呼ぶ | 直前と同じ条件で引き直される | 実装済 |
| SOS-08 | 一度失敗したあと | `reload()` を呼ぶ | `error` が消えて結果が入れ替わる | 実装済 |
| SOS-09 | `load({ branchCode: '123' })` を呼んだあと。取込は `success: true` の `CsvImportResponse`、次の一覧は部店 123 の注文エラーから 1 件を除いた応答 | `importConfirmation(file)` を呼ぶ | 取込の結果（`success: true` / `successCount`）が返り、一覧が部店 123 の条件のまま引き直されて差し替えた応答の内容になる。`importError` は null | 実装済 |
| SOS-10 | `load()` のあと。取込は `success: false`・行エラー 1 件（`row_data.order_id` あり）の `CsvImportResponse`、次の一覧は 0 件 | `importConfirmation(file)` を呼ぶ | `success: false` の結果（行エラーにその注文 ID）が返り、行エラーでも一覧は引き直される（0 件になる） | 実装済 |
| SOS-11 | `load()` のあと、取込が 500・次の一覧は 0 件を返す | `importConfirmation(file)` を呼ぶ | null が返り、`importError` に理由が入る。一覧は引き直されず 3 件 / 2 件のまま、一覧の `error` は null のまま | 実装済 |
| SOS-12 | 取込の応答がまだ返っていない | `importConfirmation(file)` を呼ぶ | `importing` が true になり、応答のあと false に戻る | 実装済 |
| SOS-13 | 取込が 400 で `importError` が入っている | `clearImportError()` を呼ぶ | `importError` が null になる | 実装済 |
