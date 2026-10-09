# stores/dreamStatus（Dream登録状況のストア）

- 略号: `DSS`
- 対象: `src/stores/dreamStatus.js`
- テスト: `src/stores/dreamStatus.spec.js`

> `useCrudList` に任せている振る舞い（古い応答の破棄）は `composables-use-crud-list.md` が守るので、
> ここでは**このストア固有の入出力**（絞り込み条件の受け渡し・状況コードの選択肢・STS変更）だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/dreamStatus.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty`、検索プルダウンの `statusOptions` を守る。
`beforeEach(() => setActivePinia(createPinia()))`。

書き込みは STS変更（`changeStatus`）だけで、`create` / `update` / `remove` は持たない。
`changeStatus` は行の `updatedAt` を合札として送り、成功したら `onSuccess` を呼んでから
**いまの条件とページ位置のまま**一覧を読み直す（変更後の行が検索条件から外れうるため、行の差し替えはしない）。
失敗（400 / 409 など）は `changeError` に入れて null を返し、読み直さない。
成功したときはサイドメニューの件数（`useNavBadgesStore().load()`。[stores-nav-badges.md](stores-nav-badges.md)）も取り直す（DSS-25 / 26）。
STS変更のハンドラは行を書き換えるが、`resetMockState()`（`vitest.setup.js` の afterEach）でフィクスチャに戻る。

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
| DSS-17 | 既定モック | ストアの公開 API を見る | STS変更の `changeStatus` / `clearChangeError` / `changing` / `changeError` は公開し、`create` / `update` / `remove` は公開しない | 実装済 |
| DSS-18 | 既定モック。読み込み済みの登録失敗の行 | その行で `changeStatus({ order, status: '0', receiptNumber, reason })` | サーバに行の `updatedAt` が更新日時として届き、`{ order, message }`（変更後の行とサーバの処理結果）を返す | 実装済 |
| DSS-19 | 既定モック。`load({ offset: PAGE_SIZE })` 済みで、2 ページ目に登録失敗の行がある | その行を `'0'` へ `changeStatus()` | `offset` が `PAGE_SIZE` のまま読み直され、同じページのその行の状況が `'0'` になる | 実装済 |
| DSS-20 | 既定モック。`load({ status: 'ERROR' })` 済み | 登録失敗の行を `'0'` へ `changeStatus()` | `status` が `'ERROR'` のまま読み直され、その行が一覧から消えて `total` が 1 減る | 実装済 |
| DSS-21 | 既定モック | `onSuccess` 付きで `changeStatus()` | `onSuccess` が結果を受け取って呼ばれ、その時点ではまだ一覧は読み直されていない（行は変更前の状況のまま） | 実装済 |
| DSS-22 | 既定モック。取得時と違う `updatedAt` の行（409） | `onSuccess` 付きで `changeStatus()` | null を返し、`changeError` に status 409 のエラー（サーバの理由）が入る。`onSuccess` は呼ばれず、一覧は読み直さない | 実装済 |
| DSS-23 | PUT の応答を遅らせる | `changeStatus()` | 送信中は `changing` が true で一覧の `loading` は立たない。終わると `changing` は false | 実装済 |
| DSS-24 | DSS-22 の状態（`changeError` あり） | `clearChangeError()` | `changeError` が null に戻る | 実装済 |
| DSS-25 | 既定モック。読み込み済みの登録失敗の行 | その行を `'0'` へ `changeStatus()` | サイドメニューの件数を取り直す（`dream_status=ERROR`・`limit=1` の GET が出る）。`useNavBadgesStore().counts.dreamErrors` がフィクスチャのエラー行（登録失敗・取消失敗）の件数より 1 少なくなる | 実装済 |
| DSS-26 | 既定モック。取得時と違う `updatedAt` の行（409） | `changeStatus()` | 件数は取り直さない（`dream_status=ERROR`・`limit=1` の GET が出ない） | 実装済 |
