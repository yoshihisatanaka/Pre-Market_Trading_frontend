# 滞留注文抽出（実 API 接続）

- 略号: `SOR`
- 画面: `src/views/StalledOrderListView.vue`（`/operations/stalled-orders`）
- テスト: `e2e/stalled-orders.real-api.spec.js`

[stalled-orders.md](stalled-orders.md)（`SO`）と対象画面は同じだが、**当てる先が違う**。
`SO` は MSW のモックに当てて画面の細かい挙動を固定する。こちらは**実 API（`GET /orders` /
`POST /operations/stalled-orders/confirmation-import`）に当てて、フロントとバックエンドの噛み合わせだけ**を見る。

## なぜ分けるか

`SO` はフィクスチャの中身（注文エラー 2 件・注文中 2 件・`#40` が先頭・部店 `234` で片方だけ空になる）を期待値にしている。
実 API に当てるとデータが違うので全滅し、取込のシナリオ（`SO-20`〜`24`）は応答を `mockApi()`（`window.__mswOverrides`）で
差し込んでいるので、MSW を切ると効かない。一覧の 500・ローディング・0 件の再現も `SO` の担当で、ここでは求めない。
そこで**データの中身に依存しない不変条件**だけを書く。件数は画面と、**画面自身が受け取った `GET /orders` の応答**から読む。

この画面の噛み合わせで壊れやすいのは次の 3 つ。

- **一覧の 2 回呼び。** 専用の API は無く、`GET /orders` を `status=101,103`（注文エラー）と `status=003`（注文中）で
  2 回引く（`src/api/stalledOrders.js`）。`status` のカンマ区切りが効かないと、片方が 0 件か全件に化ける
- **全件取得。** 画面はページャを持たず、`limit` の上限（200）ずつ送って全件を集める。件数表示はサーバの `total` と一致するはず
- **取込の multipart と応答の変換。** 項目名は `file`。応答は既存の `CsvImportResponse` で、
  行エラーの `line_number` と `row_data.order_id` を表の「行」「注文ID」に出す

## 実行方法

既定では**動かない**（`E2E_REAL_API` が無ければ丸ごとスキップ）。実 API に当てるときだけ、前提をそろえて実行する。

1. `.env` の `VITE_ENABLE_MSW` を `false` にして `docker compose up -d --force-recreate frontend`
2. バックエンドを起動しておく（`(cd ../Pre-Market_Trading && docker compose up -d api)`）
3. `.env` の `VITE_USER_CODE` が設定されていること（無いと `X-User-Code` が飛ばず、取込が弾かれうる）

```powershell
docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test stalled-orders.real-api
```

MSW が有効なままだと実 API を見ていないので、各シナリオの冒頭で検出して失敗させる。
2 行は独立していて、`--grep` で 1 本だけ抜き出してよい。

## 実データを書き換える（書き換えない設計）

`SOR-02` は実 API の取込を叩くが、**実 DB の注文・約定を書き換えない**ように組んである。

- CSV は 1 行だけで、注文 ID は**存在しない値**（`999999999`。`d_注文` の連番が届かない値で、int4 の上限未満）。
  取込の前に `GET /orders/999999999` が成功しない（＝その注文が無い）ことを確かめ、あれば止める
- 取込は「1 行でもエラーがあれば全行ロールバック」（`openapi.json` の取込 API の説明）。唯一の行がエラーなので何も反映されない
- 万一その ID が実在しても約定を足さない値にしてある（`confirmation_status` は `WORKING`、`filled_quantity` は `0`。
  `filled_quantity` は累計で、`d_約定` の累計との差分だけを足す仕様）

1 回の実行につき DB に残るもの: **注文・約定は何も残らない想定**。ただし取込結果を `d_注文イベント`（`CONFIRMATION_IMPORT`）に
記録する仕様なので、イベントの記録がロールバックの外で行われるなら、失敗した取込のイベントが 1 件残りうる（検証モードで確かめる）。

## 応答コード（SOR-02）

仕様（`openapi.json`）では、知らない注文 ID は **200 の `CsvImportResponse`（`success: false` と行エラー）** で返り、
400 は「空ファイル・ヘッダ不一致・データ行なし」だけ、404 は定義されていない。`SOR-02` は **200 だけを通す**。

4xx を通さないのは、それ自体が噛み合わせの不具合の信号だから。400 ならフロントの CSV の形（ヘッダ）がサーバと合っていない、
422 なら multipart の項目名か `X-User-Code` が合っていない、404 なら仕様に無い応答。
実装が知らない注文を 404 などで拒否していたら、この行は落ちて `保留` になり、`docs/api/requests.md` に載せる。
`success: true`（存在しない注文が取り込まれた）も失敗にする。文言はサーバが決めるので固定しない。

## シナリオ

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOR-01 | MSW off・api 起動 | `/operations/stalled-orders` を開く | 実 API へ `GET /orders` が `status=101,103` と `status=003` の 2 回飛び、どちらも 2xx で配列 `orders` を返す。2 つのカード（注文エラー / 注文中）それぞれで、件数表示が応答の `total` と一致し、エラーは出ない。件数が 1 以上なら表が出て行数が件数と一致し、0 なら空の文言が出る | 未着手 |
| SOR-02 | SOR-01 と同じ。注文 ID `999999999` の注文が無い（`GET /orders/999999999` が成功しない） | 注文 ID `999999999`・`WORKING`・約定数量 0 の 1 行だけのコンファメーション CSV を選んで「取込して注文照会へ反映」 | 実 API へ multipart で `POST /operations/stalled-orders/confirmation-import` が送られ、200 で `success: false`・`success_count: 0` が返る（4xx / 5xx は噛み合わせの不具合として失敗）。成功の通知は出ず、選んだファイル名は表示されたまま。行エラーの表の 1 行目が行 `2` / 注文ID `999999999`（`row_data` が無ければ「—」）と理由（文言は固定しない）。2 つの一覧の件数は取込の前と同じ | 未着手 |
