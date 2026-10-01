# stores/orderInquiry（注文照会のストア）

- 略号: `OIS`
- 対象: `src/stores/orderInquiry.js`
- テスト: `src/stores/orderInquiry.spec.js`

`useCrudList` に任せている振る舞い（古い応答の破棄）は `composables-use-crud-list.md` が守るので、
ここでは**このストア固有の入出力**だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/orders.js`）に当てて、取得・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。`beforeEach(() => setActivePinia(createPinia()))`。
一覧は読むだけなので、登録・更新・削除の名前は公開しない（訂正・取消は `stores-order-action.md` の `OAS`）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OIS-01 | 既定モック | `load()` を呼ぶ | `items` が元注文ごとのまとまりの数、`total` が注文の行数（フィクスチャの件数）になる | 実装済 |
| OIS-02 | 既定モック | `load({ branchCode: '123' })` | `items` が 2 件（#38 / #41）、`total` が部店 123 の行数になり、`branchCode` に `'123'` が残る | 実装済 |
| OIS-03 | `GET /orders` が 500 | `load()` | `error.message` に理由が入り、`items` は空、`loading` は false に戻る | 実装済 |
| OIS-04 | 0 件の応答 | `load()` | `isEmpty` が true | 実装済 |
| OIS-05 | 既定モック | `load({ executionStatus: '003' })`（注文中） | `executionStatus` に `'003'` が残り、処理状況 003 の行だけに絞り込まれる（MSW が `status=003` を解釈する。#38 のまとまりの最新版 #42 と #34） | 実装済 |
| OIS-06 | 既定モック | ストアを作る | `create` / `update` / `remove` を公開しない | 実装済 |
