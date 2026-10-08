# utils/stalledOrderCsv（滞留注文抽出の CSV 3 種）

- 略号: `SOU`
- 対象: `src/utils/stalledOrderCsv.js`
- テスト: `src/utils/stalledOrderCsv.spec.js`
- 画面側: [views-stalled-order-list-view.md](views-stalled-order-list-view.md)

別システム発注 CSV・そのサンプル・コンファメーション CSV のサンプルを、サーバを通さずに組み立てる。
列・値・ファイル名は公開モックの実物（2026-09-28 採取）。入力は `StalledOrder[]`
（形は `src/api/stalledOrders.js` の JSDoc）で、テストでは注文照会と共用のフィクスチャ
（`src/mocks/fixtures/orderInquiry.js` の `orderInquiryRows`）のうち、注文エラーに出る #29・#40 の値から組み立てる。
BOM・CRLF・クォートは [utils-csv.md](utils-csv.md) の責務なので、ここでは行の中身だけを見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOU-01 | 注文 1 件 | `buildTwsOrderCsv` を呼ぶ | 1 行目が `order_id,account_number,symbol,action,quantity,order_type,limit_price,time_in_force,market_category` | 実装済 |
| SOU-02 | fixture の #29（成行・買） | `buildTwsOrderCsv` を呼ぶ | データ行が `29,200001,MSFT,BUY,35,MKT,,DAY,レギュラー`（成行は limit_price が空欄） | 実装済 |
| SOU-03 | fixture の #40（指値 214.25・売） | `buildTwsOrderCsv` を呼ぶ | データ行が `40,300003,AMZN,SELL,40,LMT,214.25,DAY,プレ＋レギュラー`（指値は桁を整えない） | 実装済 |
| SOU-04 | `side` が未知（空） | `buildTwsOrderCsv` を呼ぶ | action が空欄になる（推測で埋めない） | 実装済 |
| SOU-05 | `orderType` が未知 | `buildTwsOrderCsv` を呼ぶ | order_type が空欄になる（推測で埋めない） | 実装済 |
| SOU-06 | 0 件 | `buildTwsOrderCsv` を呼ぶ | ヘッダの 1 行だけになる | 実装済 |
| SOU-07 | 注文 2 件（#26, #27 の順） | `buildTwsOrderCsv` を呼ぶ | データ行が渡した順に並ぶ | 実装済 |
| SOU-08 | — | `buildTwsOrderSampleCsv` を呼ぶ | 発注 CSV のヘッダと `6,300003,AMZN,BUY,40,LMT,214.2500,DAY,プレ＋レギュラー` の 1 行 | 実装済 |
| SOU-09 | — | `buildConfirmationSampleCsv` を呼ぶ | ヘッダ `order_id,confirmation_ref,confirmation_status,filled_quantity,average_price,confirmed_at,message` と `6,TWS-20260904-0006,CANCELLED,0,0,2026-09-04 10:15:00,TWSで取消確認` の 1 行 | 実装済 |
| SOU-10 | — | ファイル名の定数を読む | `tws_stalled_orders.csv` / `tws_upload_sample.csv` / `tws_confirmation_sample.csv` | 実装済 |
