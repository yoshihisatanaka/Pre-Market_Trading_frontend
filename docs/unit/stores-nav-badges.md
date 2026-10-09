# stores/navBadges（サイドメニューの件数のストア）

- 略号: `NBS`
- 対象: `src/stores/navBadges.js`
- テスト: `src/stores/navBadges.spec.js`
- 表示側: [components-layout-app-sidebar.md](components-layout-app-sidebar.md)
- 件数の取得: [api-order-inquiry.md](api-order-inquiry.md)（`fetchOrderErrorCount`）/ [api-dream-status.md](api-dream-status.md)（`fetchDreamErrorCount`）

サイドメニューの項目に添える件数（画面モックの赤い件数表示）を持つ。キーは `navigation.js` の `badge.key` と同じ。

- `orderErrors` … 注文照会の出来状況が「注文エラー」（処理状況 101 / 103）の注文
- `dreamErrors` … Dream登録状況が「エラー」（登録失敗 9 / 取消失敗 C9）の注文

`load()` は 2 本を独立に取る。片方が失敗してももう片方は入り、失敗した件数は前の値のまま残る（未取得なら null のまま）。

MSW の既定ハンドラ（`src/mocks/handlers/orders.js` / `src/mocks/handlers/dreamStatus.js`）に当てる。
期待値はフィクスチャ（`src/mocks/fixtures/orderInquiry.js` の `orderInquiryRows`、`src/mocks/fixtures/dreamStatus.js` の `dreamOrders`）から導く。
`beforeEach(() => setActivePinia(createPinia()))`。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| NBS-01 | 既定モック | ストアを作るだけ（`load()` を呼ばない） | `counts` が `{ orderErrors: null, dreamErrors: null }`（未取得） | 実装済 |
| NBS-02 | 既定モック | `load()` | `orderErrors` がフィクスチャの処理状況 101 / 103 の行数、`dreamErrors` がフィクスチャの Dream状況 9 / C9 の行数になる | 実装済 |
| NBS-03 | 注文の件数（`GET /orders`）だけが 500 | `load()` | 例外にならず、`dreamErrors` は入り、`orderErrors` は null のまま | 実装済 |
| NBS-04 | Dream の件数（`GET /orders/dream-status`）だけが 500 | `load()` | 例外にならず、`orderErrors` は入り、`dreamErrors` は null のまま | 実装済 |
| NBS-05 | 既定モックで `load()` 済み。その後 2 本とも 500 | もう一度 `load()` | どちらの件数も前の値のまま（失敗で消さない） | 実装済 |
