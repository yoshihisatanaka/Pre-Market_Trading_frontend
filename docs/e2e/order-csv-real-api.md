# CSV一括注文（実 API 接続）

- 略号: `OCR`
- 画面: `src/views/OrderCsvUploadView.vue`（`/orders/csv/upload`）/ `src/views/OrderCsvPreviewView.vue`（`/orders/csv/preview`）/ `src/views/OrderCsvCompleteView.vue`（`/orders/csv/complete`）
- テスト: `e2e/order-csv.real-api.spec.js`

[order-csv.md](order-csv.md)（`OC`）と対象画面は同じだが、**当てる先が違う**。
`OC` は MSW のモックに当てて 3 画面の挙動を細かく固定する。こちらは**実 API（`GET /orders/csv-spec` /
`GET /orders/csv-template` / `POST /orders/validate-csv` / `POST /orders/bulk-create`）に当てて、
フロントとバックエンドの噛み合わせだけ**を見る。

## なぜ分けるか

`OC` はフィクスチャの中身（22 列・テンプレートの 3 行・注文 ID `#90001`〜・事前検証の文言）を期待値にしている。
実 API に当てると列の数もサンプル行も採番も違うので全滅し、`mockApi()`（`window.__mswOverrides`）は
MSW を切ると効かないため、500 や 400 の再現（`OC-07` / `OC-12` / `OC-17`）も成立しない。
そこで**データの中身に依存しない不変条件**だけを書く。列名は画面が受け取った `GET /orders/csv-spec` から、
CSV に書く口座と銘柄は実 DB の顧客マスタ・銘柄マスタの先頭の有効な行から、区分の値は実 API の
テンプレートの 1 行目から、**実行時に読む**。

この画面の噛み合わせで壊れやすいのは次の 4 つ。

- **テンプレートの中身。** `OC-10` が保留なのは、MSW の fallback が XHR の blob から BOM を落とすため。
  BOM と `Content-Disposition` のファイル名は実 API でしか確かめられない（この文書の `OCR-01`）
- **multipart の送り方。** `validate-csv` は `file` を multipart で受ける。`Content-Type` の境界をブラウザに付け直させている
- **事前検証の行の形。** `rows[].data` は CSV の列名そのもの（日本語キー）で、`customer_name` と `details.stock_name` は
  サーバが口座・銘柄から引く。api 層（`src/api/orderCsv.js`）の変換がずれると口座番号・顧客名・銘柄名の列が「—」になる
- **一括受付の本文。** `OrderRequest` は `作成者` が必須で、事前検証の行には無い。api 層が `/auth/me` の操作者コードを足して送る

エラー応答・ローディング・0 件・画面間の遷移は `OC` の担当で、ここでは求めない。

## 実行方法

既定では**動かない**（`E2E_REAL_API` が無ければ丸ごとスキップ）。実 API に当てるときだけ、前提をそろえて実行する。

1. `.env` の `VITE_ENABLE_MSW` を `false` にして `docker compose up -d --force-recreate frontend`
2. バックエンドを起動しておく（`(cd ../Pre-Market_Trading && docker compose up -d api)`）
3. `.env` の `VITE_USER_CODE` が設定されていること（無いと `X-User-Code` が飛ばず、`bulk-create` が 422 になる）

```powershell
docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test order-csv.real-api
```

MSW が有効なままだと実 API を見ていないので、各シナリオの冒頭で検出して失敗させる。
各行は独立していて、`--grep` で 1 本だけ抜き出してよい（下ごしらえは `beforeAll` が毎回行う）。

## 実データを書き換える

`OCR-05` だけが**実 DB に注文を登録する**（`POST /orders/bulk-create`）。ローカルの開発 DB 前提。

- CSV は 1 行だけ。口座は顧客マスタの先頭の有効な行、銘柄は銘柄マスタの先頭の有効な行、売買は買い、数量 1、
  指値は銘柄の `前日終値`（無ければテンプレートの値）。受注日と有効期限は実行日（JST）
- 受け付けた注文は **同じシナリオの中で `POST /orders/{order_id}/cancel` で取り消す**。未発注（処理状況 `000`）は
  即時取消（`034`）になる（openapi.json の取消 API の説明）。取消は画面が `bulk-create` に付けた `X-User-Code` と
  同じ操作者で行う（部店の限定で他店扱いにならないよう）
- 途中で落ちて取り消せなかった注文 ID は `afterAll` でもう一度取り消す。それでも残ったときは標準出力の
  `[OCR-05]` の行に注文 ID が出るので、手で取り消す

1 回の実行につき DB に残るもの: **取消済み（`034`）の注文が 1 件**。有効な注文は残らない。
`OCR-02` / `OCR-03` / `OCR-04` / `OCR-06` は事前検証（DB 登録なし）までなので何も残らない。

## 実行日の注意

有効期限は「当日または国内 14 営業日以内」（csv-spec の説明）。実行日が休場日・非営業日のときは `OCR-02` / `OCR-05` の
行が NG になりうる。そのときは標準出力の `[OCR-02]` の応答にサーバの理由が出る（テスト側で日付をずらさない。
基準日を返す API が無いため）。

## シナリオ

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OCR-01 | MSW off・api 起動 | `/orders/csv/upload` を開き、CSVフォーマットの表が出てから「テンプレートDL」を押す | 実 API へ `GET /orders/csv-template` が送られ、応答の `Content-Disposition` のファイル名で保存される。中身は UTF-8 の BOM で始まり、1 行目の見出しが画面が受け取った `GET /orders/csv-spec` の列名（`index` 順）と同じ並び。データ行（サンプル）が 1 行以上あり、各行の列数が見出しと同じ。CSVフォーマットの表の行数も列数と同じ。テンプレートのエラーは出ない | 未着手 |
| OCR-02 | MSW off・api 起動。顧客マスタ・銘柄マスタに有効な行が 1 件以上（無ければスキップ） | 実 DB の口座・銘柄で組んだ 1 行の CSV を選んで「内容を確認する」 | 実 API へ multipart で `POST /orders/validate-csv` が送られ 200 が返る。URL が `/orders/csv/preview` になり、取込み件数 1 / 正常 1 / エラー 0、表は 1 行で状態「OK」。口座番号の列が「部店-口座番号」、顧客名が顧客マスタの顧客名、銘柄の列に銘柄コードが出る。エラーの帯は出ず、受付ボタンは「1件を受付する」で押せる | 未着手 |
| OCR-03 | OCR-02 と同じ | 銘柄コードを存在しない値（`E2E-NONE`）にした 1 行の CSV を選んで「内容を確認する」 | 200 が返ってプレビューへ進み、取込み件数 1 / 正常 0 / エラー 1 とエラーの帯が出る。行は「NG」でエラー内容に 1 つ以上の理由（文言は固定しない）が出る。受付ボタンは「エラーを修正してください」で押せない | 未着手 |
| OCR-04 | MSW off・api 起動 | 見出しから最後の列を抜いた CSV（データ行なし）を選んで「内容を確認する」 | `POST /orders/validate-csv` が 400 を返し、取込み画面に留まる。CSVファイル取込みカードに「内容を確認できませんでした。」とサーバの理由が出る | 未着手 |
| OCR-05 | OCR-02 と同じ。`VITE_USER_CODE` が設定されている | OCR-02 の CSV でプレビューまで進み「1件を受付する」を押す | 実 API へ `POST /orders/bulk-create` が送られ、本文の `orders` は 1 件で `作成者` を持つ。200 で `order_ids` が 1 件返る。URL が `/orders/csv/complete` になり、受付件数 1 / Dream登録待ち 1、「CSV注文を受け付けました。」、表は 1 行で注文ID が `#<返った ID>`。**そのあと同じ操作者で `POST /orders/{order_id}/cancel` が受理される**（`success: true`） | 未着手 |
| OCR-06 | OCR-01 と同じ | 実 API からダウンロードしたテンプレートを**そのまま**選んで「内容を確認する」 | 200 が返ってプレビューへ進み、取込み件数がテンプレートのサンプル行の数と同じで、表の行数も同じ。各行は「OK」か「NG」のどちらか（サンプルの口座・銘柄が実 DB に無ければ NG でよい）。エラーは出ない | 未着手 |
