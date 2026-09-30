# stores/orderAction（注文 1 件への操作のストア）

- 略号: `OAS`
- 対象: `src/stores/orderAction.js`
- テスト: `src/stores/orderAction.spec.js`

訂正画面（`OrderAmendView`）と取消画面（`OrderCancelView`）が共用する。持つのは 3 系統
（対象注文 `order` / 訂正 `amendResult` / 取消 `cancelResult`）で、それぞれの `loading` / `error` を別に持つ。
1 件の形・送り方は `api-order-inquiry.md`（`OIA`）が守るので、ここでは**このストア固有の状態遷移**だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/orders.js`）に当てる。`beforeEach(() => setActivePinia(createPinia()))`。
注文 ID と状況はフィクスチャ（`src/mocks/fixtures/orderInquiry.js`）から引く
（#36 未発注 / #34 注文中 / #35 一部出来 / #41 全部出来）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OAS-01 | 既定モック | `load('35')` | `orderId` が `'35'`、`order` が #35 の詳細（`filledQuantity` はフィクスチャの出来数量）になり、`loading` は false・`error` は null | 実装済 |
| OAS-02 | 詳細の応答を握ったまま | `load('35')` | 応答までは `loading` が true・`order` が null | 実装済 |
| OAS-03 | 既定モック（無い注文 ID） | `load(無い ID)` | `error.status` が 404、`order` は null | 実装済 |
| OAS-04 | `GET /orders/:orderId` が 500 | `load('35')` → 応答を既定に戻して `reload()` | 1 回目は `error.message` に理由が入る。`reload()` で同じ注文を読み直し、`order` が入って `error` は null に戻る | 実装済 |
| OAS-05 | #36 を読んで訂正が成功している | `load('34')` | 応答を待つあいだ `order` と `amendResult` / `amendError` / `cancelResult` / `cancelError` がすべて null になり、応答後は #34 になる | 実装済 |
| OAS-06 | #35 の応答だけを遅らせる | `load('35')` の直後に `load('36')` → #35 を解放する | 古い #35 の応答で上書きされず、`order` は #36 のまま | 実装済 |
| OAS-07 | #36 を読んである | `amend({ quantity: 30 })` | いまの注文（#36）に対して送られ、`amendResult` が `mode: 'inPlace'`・`originalOrderId: '36'` になる。`amending` は false に戻る | 実装済 |
| OAS-08 | #36 を読んである・訂正の応答を握ったまま | `amend({ quantity: 30 })` | 応答までは `amending` が true で、`order` は残る | 実装済 |
| OAS-09 | #41（全部出来）を読んである | `amend({ quantity: 1 })` | `amendError.message` にサーバの理由が入り、`amendResult` は null、`order` は残る | 実装済 |
| OAS-10 | #36 を読んである | `cancel()` | いまの注文（#36）に対して送られ、`cancelResult` が `orderId: '36'` とサーバの文言になる。`canceling` は false に戻る | 実装済 |
| OAS-11 | #41（全部出来）を読んである | `cancel()` | `cancelError.message` にサーバの理由が入り、`cancelResult` は null、`order` は残る | 実装済 |
| OAS-12 | #35 の応答を遅らせて 500 にする | `load('35')` の直後に `load('36')` → #35 を解放する | 古い #35 の失敗で `error` が立たず、`order` は #36・`error` は null のまま | 保留 |

OAS-12 は保留。古い応答を捨てるのは成功時の `order` だけで、古い応答の**失敗**は `useAsync` がそのまま
`error` に入れる（`src/stores/orderAction.js` の `fetchLatest`）。現状では #36 を表示できているのに
画面がエラー表示に切り替わる。直すかどうかを決めてからテストを書く。
