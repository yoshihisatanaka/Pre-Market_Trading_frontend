# 顧客詳細（実 API 接続）

- 略号: `CDTR`
- 画面: `src/views/CustomerDetailView.vue`（枠）/ `src/views/CustomerSummaryView.vue`（外株預り）/ `src/views/CustomerOrdersView.vue`（注文照会）
- テスト: `e2e/customer-detail.real-api.spec.js`

顧客詳細 `/customers/:customerId/summary`・`/orders` を**実 API（`GET /masters/customers/{account_id}`・
`GET /holdings`・`GET /orders`）に当てて、フロントとバックエンドの噛み合わせだけ**を見る。
MSW のモックに当てる版（`docs/e2e/customer-detail.md`）はこの文書の作成時点ではまだ無い。
作るときは別ファイル・別略号にし、こちらと混ぜない。

いまはリリースまでの合格線どおり**スモーク 2 本**（外株預り 1 本・注文照会 1 本）を先頭に置き、
任意の 1 本（存在しない顧客）を足してある。

## なぜ分けるか

MSW 版はフィクスチャの中身（顧客 ID・保有銘柄・注文の件数）を期待値にする。実 API に当てるとデータが違うので全滅し、
`mockApi()`（`window.__mswOverrides`）は MSW を切ると効かないため、エラー応答や 0 件の再現も成立しない。
そこで**データの中身に依存しない不変条件**だけを書く。

- **顧客 ID は固定しない**（実 DB の ID は分からない）。顧客検索の一覧の**先頭の顧客名リンク**から入る
- **0 件でも通る**書き方にする。実 API のテストデータは薄く（`docs/api/requests.md` の「テストデータの不足（#32）」）、
  顧客マスタの口座は保有 0 件、注文は 100 件が 1 状態だけで顧客マスタの口座と噛み合っていない見込み
- **`GET /holdings` の値の正しさは見ない**（項目の意味を確認中。`docs/api/requests.md` #33）。
  件数と行数が食い違わないこと、4 状態のどれに落ちたかだけを見る

## 2 本目が書き込みでない理由

合格線のスモークは「一覧 1 本・書き込み 1 本」だが、**この画面は読むだけ**（訂正・取消・新規注文は別画面へ移る）。
そこで 2 本目は**注文照会タブ**にした。顧客カードの部店と口座番号を、api 層が `branch_code` / `account_no`
（integer）に変えて `GET /orders` に送る。FastAPI は知らないクエリを黙って無視するので、送出名がずれても
MSW 版では気づけない。リクエストに顧客の口座番号が載っていることを直接見る。

## 実行方法

既定では**動かない**（`E2E_REAL_API` が無ければ丸ごとスキップ）。実 API に当てるときだけ、前提をそろえて実行する。

1. `.env` の `VITE_ENABLE_MSW` を `false` にして `docker compose up -d --force-recreate frontend`
2. バックエンドを起動しておく（`(cd ../Pre-Market_Trading && docker compose up -d api)`）

```powershell
docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test customer-detail.real-api
```

MSW が有効なままだと実 API を見ていないので、各シナリオの冒頭で検出して失敗させる。
顧客が 1 件も無い DB では入口が無いので、CDTR-01 / CDTR-02 はスキップされる。

**実 DB には書き込まない**（GET だけ）。各行は独立していて、`--grep` で 1 本だけ抜き出してよい。

## シナリオ

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CDTR-01 | MSW off・api 起動。顧客が 1 件以上ある（0 件ならスキップ） | 顧客検索の一覧の先頭の顧客名を押す | `/customers/<ID>/summary` に移り、顧客カードが出て口座番号が一覧の行と一致する。実 API へ `GET /holdings` が `account_no=<その口座番号>` 付きで送られる。外株預りの件数表示（「N 銘柄」）と表の行数が一致し、0 なら「保有外株なし」が出る。顧客・預りのエラーは出ない | 未着手 |
| CDTR-02 | CDTR-01 と同じ | 顧客詳細で「注文照会」タブへ切り替える | `/customers/<ID>/orders` に移り、実 API へ `GET /orders` が `account_no=<顧客の口座番号>` 付きで送られる（部店コードがあれば `branch_code` も）。件数が 1 以上なら表とページ送りが出て、元注文の行が 1 以上・min(件数, 50) 以下。0 なら「この顧客の注文はありません」が出る。エラーは出ない | 未着手 |
| CDTR-03 | MSW off・api 起動 | 実 API の顧客 ID の最大値より十分大きい ID で `/customers/<ID>/summary` を開く | 実 API が 404 を返し、「該当する顧客が見つかりません。」と「顧客検索へ戻る」が出る（通信エラーの表示にはならない）。顧客カードは出ない | 未着手 |
