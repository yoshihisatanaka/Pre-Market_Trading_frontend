# 新規注文（実 API 接続）

- 略号: `NR`
- 画面: `src/views/OrderEntryView.vue`
- テスト: `e2e/order-entry.real-api.spec.js`（未実装）

[order-entry.md](order-entry.md)（`NO`）と対象画面は同じだが、**当てる先が違う**。
`NO` は MSW のモックに当てて画面の挙動を細かく固定する。こちらは**実 API
（`/masters/symbols`・`/masters/customers`・`/orders/validate` ほか）に当てて、フロントとバックエンドの
噛み合わせだけ**を見る。期待値はデータの中身に依存させず、照会に使う口座番号・ティッカーは
実行時に API から 1 件読んで決める。

いまはリリースまでの合格線どおり**スモーク 2 本**（照会 1 本・送信 1 本）だけを置く。
**送信のスモークは事前検証（`POST /orders/validate`）までで止め、注文は確定しない。**
確定（`POST /orders`）は `d_注文` に行が残り、IB 発注・Dream 連携のバッチの対象になるため、
消す手段がそろってから（10/15 以降のステージング期間）に足す。

## 実行方法

既定では**動かない**（`E2E_REAL_API` が無ければ丸ごとスキップ）。実 API に当てるときだけ、
前提をそろえて本体セッションで実行する。

1. `.env` の `VITE_ENABLE_MSW` を `false` にして `docker compose up -d --force-recreate frontend`
2. バックエンドを起動しておく（`(cd ../Pre-Market_Trading && docker compose up -d api)`）

```powershell
docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test order-entry.real-api
```

MSW が有効なままだと実 API を見ていないので、各シナリオの冒頭で検出して失敗させる。

## 未確定の仕様（docs/api/requests.md #24）

事前検証の業務エラーを 200 の `valid:false` で返すか 4xx で返すかが未確定。`NR-02` は
**どちらで返っても**「確認画面へ進む」か「理由の帯が出る」かのどちらかになることだけを見て、
帯の種類（入力エラー / 通信エラー）までは固定しない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| NR-01 | 実 API に接続。`GET /api/masters/customers` と `GET /api/masters/symbols` の先頭から、有効な口座（部店・口座番号）と取引可の銘柄（Ticker）を 1 件ずつ読んでおく | 新規注文を開き、その部店・口座番号・Ticker を入力する | 「データあり」状態（入力フォーム）になり、ローディング・エラー・空の表示は残らない。口座番号の横に API の `顧客名`、ティッカーの横に API の `銘柄名_英字`（無ければ `銘柄名`）が出る。期間指定の先頭が「当日中（M/D）」 | 未着手 |
| NR-02 | NR-01 と同じ口座・銘柄。発注停止中ではない | 買い・成行・数量 1 を入れて「送信」（フロコン警告が出たら強制区分を付けて送り直す） | `POST /api/orders/validate` が 1 回以上送られ、本文の `銘柄コード` が NR-01 で読んだ銘柄の `銘柄コード`（Ticker ではない）。確認画面が出るか、入力エラー / 通信エラーの帯に理由が出る（無言で止まらない）。**注文は確定しない**（`POST /api/orders` は送られない） | 未着手 |
