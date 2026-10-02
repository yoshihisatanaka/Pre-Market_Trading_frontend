# stores/holdingSearch（預り検索のストア）

- 略号: `HSS`
- 対象: `src/stores/holdingSearch.js`
- テスト: `src/stores/holdingSearch.spec.js`

`useCrudList` に任せている振る舞い（古い応答の破棄）は `composables-use-crud-list.md` が守り、
`fetchHoldings` の送出名と変換は `api-holdings.md`（`HLA`）が守るので、ここでは**このストア固有の入出力**だけを書く。
固有なのは一覧の件数・絞り込みの写しと、顧客名から顧客詳細へ移るための「顧客マスタの行 ID を引く」（`openCustomer`）。

MSW の既定ハンドラ（`src/mocks/handlers/holdings.js` / `customers.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty`、顧客を引く `customerLookupPending` / `customerLookupError` を守る。
`beforeEach(() => setActivePinia(createPinia()))`。期待値はフィクスチャ（`src/mocks/fixtures/holdings.js` / `customers.js`）から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| HSS-01 | 既定モック | `load()` を呼ぶ | `items` がフィクスチャの先頭 `HOLDING_SEARCH_PAGE_SIZE` 件ぶん、`total` がフィクスチャの全件になる | 実装済 |
| HSS-02 | 既定モック | `load({ offset: HOLDING_SEARCH_PAGE_SIZE })` | 2 ページ目の行（フィクスチャの 51 件目以降）が入り、`offset` が写される | 実装済 |
| HSS-03 | 既定モック | `load({ branchCode, specificDeposit })` | その条件に合う行だけになる（件数はフィクスチャから導く）。`branchCode` / `specificDeposit` の ref に条件が写される | 実装済 |
| HSS-04 | 既定モック | `load({ offset: 0, unknownKey: 'x', branchCode })` のように filterKeys に無いキーを混ぜる | 落ちずに `branchCode` だけで絞り込まれ、`GET /holdings` に filterKeys に無いキーは送られない | 実装済 |
| HSS-05 | `GET /holdings` が 500 | `load()` | `error.message` に理由が入り、`items` は空、`loading` は false に戻る | 実装済 |
| HSS-06 | 0 件の応答 | `load()` | `isEmpty` が true | 実装済 |
| HSS-07 | 既定モック | 先頭の明細で `openCustomer(holding)` を呼ぶ | 顧客マスタでその部店・口座番号の顧客の ID（文字列）が返る。`GET /masters/customers` に `branch_code` と `account_no` が送られる。`customerLookupError` は null のまま | 実装済 |
| HSS-08 | 既定モック | 部店コードが空の明細で `openCustomer({ branchCode: '', accountNumber })` | 口座番号だけで引いて、その口座番号の顧客の ID が返る（`branch_code` は送られない） | 実装済 |
| HSS-09 | `GET /masters/customers` が別の口座番号の行だけを返す | `openCustomer(holding)` | null が返り、`customerLookupError.message` が「口座番号 <口座番号> の顧客が顧客マスタに見つかりません。」になる | 実装済 |
| HSS-10 | `GET /masters/customers` が 500 | `openCustomer(holding)` | null が返り、`customerLookupError.message` にサーバの理由が入る。`clearCustomerLookupError()` を呼ぶと null に戻る | 実装済 |
| HSS-11 | `GET /masters/customers` の応答を握ったまま | `openCustomer(holding)` を呼ぶ | 応答が返るまで `customerLookupPending` が true、返ったら false | 実装済 |
