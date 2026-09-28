# stores/dreamStatus（Dream登録状況のストア）

- 略号: `DSS`
- 対象: `src/stores/dreamStatus.js`
- テスト: `src/stores/dreamStatus.spec.js`

> `useCrudList` に任せている振る舞い（古い応答の破棄）は `composables-use-crud-list.md` が守るので、
> ここでは**このストア固有の入出力**（絞り込み条件の受け渡し・状況コードの選択肢）だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/dreamStatus.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty`、検索プルダウンの `statusOptions` を守る。
`beforeEach(() => setActivePinia(createPinia()))`。

期待値はフィクスチャ（`src/mocks/fixtures/dreamStatus.js`）と `DREAM_STATUS_PAGE_SIZE` から導く。
並びは作成日時の新しい順（実 API の既定）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| DSS-01 | 既定モック | `load()` | `total` がフィクスチャの全件数、`items` が作成日時の新しい順の 1 ページぶん、`limit` が `DREAM_STATUS_PAGE_SIZE`、`offset` が 0 | 実装済 |
| DSS-02 | 既定モック | `load({ offset: PAGE_SIZE })` | 2 ページ目の行が入り、`offset` が `PAGE_SIZE` になる | 実装済 |
| DSS-03 | 既定モック | `load({ status: '9' })` | 登録失敗の行だけになり、`status` が `'9'` になる | 実装済 |
| DSS-04 | 既定モック | `load({ status: 'ERROR' })` | 登録失敗と取消失敗の両方の行になる | 実装済 |
| DSS-05 | 既定モック | `load({ branchCode, accountNumber })` | 両方に合う行だけになる | 実装済 |
| DSS-06 | 既定モック | `load({ symbol })` を Ticker と銘柄コードで 1 回ずつ | どちらでも同じ行に絞り込まれる | 実装済 |
| DSS-07 | 既定モック | `load({ dateFrom, dateTo })` に同じ日付 | その日に**作成された**注文だけになる（登録日時列の値ではない） | 実装済 |
| DSS-08 | 既定モック | `load({ receiptNumber })` | その受付番号の 1 件だけになる | 実装済 |
| DSS-09 | 既定モック | 条件を変えて `load()` を続けて呼ぶ | 前の条件は残らない（渡さなかった条件は空に戻る） | 実装済 |
| DSS-10 | 既定モック | 該当の無い条件で `load()` | `items` が空・`total` が 0 で `isEmpty` が true | 実装済 |
| DSS-11 | 一覧 API が 500 | `load()` | `error.message` に detail が入り、`items` は空、`isEmpty` は false | 実装済 |
| DSS-12 | 応答を遅らせる | `load()` | 取得中は `loading` が true、終わると false | 実装済 |
| DSS-13 | 既定モック。条件付きで読み込み済み | `reload()` | 条件とページ位置を保ったまま読み直す | 実装済 |
| DSS-14 | 既定モック | `loadStatusCodes()` | `statusOptions` がコード一覧の並びのまま `{ value: コード, label: 名称 }` になる | 実装済 |
| DSS-15 | コード一覧の応答を遅らせる | `loadStatusCodes()` | 取得中は `statusCodesLoading` が true で、一覧の `loading` は立たない | 実装済 |
| DSS-16 | コード一覧 API が 500 | `loadStatusCodes()` | 例外にならず `statusOptions` は空のまま。一覧の `error` には入らない | 実装済 |
| DSS-17 | 既定モック | ストアの公開 API を見る | 読むだけなので `create` / `update` / `remove` を公開しない | 実装済 |
