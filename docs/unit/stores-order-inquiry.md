# stores/orderInquiry（注文照会のストア）

- 略号: `OIS`
- 対象: `src/stores/orderInquiry.js`
- テスト: `src/stores/orderInquiry.spec.js`（未実装）

`useCrudList` に任せている振る舞い（古い応答の破棄）は `composables-use-crud-list.md` が守るので、
ここでは**このストア固有の入出力**だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/orders.js`）に当てて、取得・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。`beforeEach(() => setActivePinia(createPinia()))`。
いまは読むだけなので、登録・更新・削除の名前は公開しない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OIS-01 | 既定モック | `load()` を呼ぶ | `items` が元注文ごとの 8 件、`total` が注文の行数 14 になる | 未着手 |
| OIS-02 | 既定モック | `load({ branchCode: '123' })` | `items` が 2 件（#38 / #41）、`total` が 3 になり、`branchCode` に `'123'` が残る | 未着手 |
| OIS-03 | `GET /orders` が 500 | `load()` | `error.message` に理由が入り、`items` は空、`loading` は false に戻る | 未着手 |
| OIS-04 | 0 件の応答 | `load()` | `isEmpty` が true | 未着手 |
| OIS-05 | 既定モック | `load({ executionStatus: '注文中' })` | `executionStatus` に `'注文中'` が残るが、結果は絞り込まれない（8 件のまま） | 未着手 |
| OIS-06 | 既定モック | ストアを作る | `create` / `update` / `remove` を公開しない | 未着手 |
