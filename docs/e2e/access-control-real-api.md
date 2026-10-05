# アクセス制御（実 API 接続）

- 略号: `ACR`
- 画面: `src/router/permissionGuard.js` / `src/components/layout/AppSidebar.vue` / `src/views/ForbiddenView.vue`（行き先 `/forbidden`）
- テスト: `e2e/access-control.real-api.spec.js`

[access-control.md](access-control.md)（`AC`）と対象は同じだが、**当てる先が違う**。
`AC` は MSW のモックに当てて、権限の無い操作者・取得失敗のときの画面の挙動を固定する。こちらは
**実 API（`GET /auth/me`）に当てて、応答の形とフロントの出し分けの噛み合わせだけ**を見る。

画面ではなく共通基盤（`docs/progress.md` の「アクセス制御」）なので、見る場所は 3 つ。
`router/index.js` の `meta.requiredPermission` によるガード（`permissionGuard.js`）、サイドメニューの区分の出し分け
（`navigation.js` の `requiredPermission`）、発注権限で出し分ける画面内の導線（注文照会の「新規注文」）。

## なぜ分けるか

`AC` は `mockApi()`（`window.__mswOverrides`）で `/auth/me` を差し替えて、権限なし・500 の経路を踏む。
MSW を切るとこれが効かず、**操作者は `.env` の `VITE_USER_CODE` で決まり、テストからは変えられない**。
そこで期待値を固定せず、**ブラウザ自身が受け取った `GET /auth/me` の応答から導く**。
`権限.master` が真なら `/masters/*` が開け、偽なら `/forbidden` に落ちる、という条件付きの不変条件だけを書く。
500・権限なしの経路の網羅は `AC` の担当で、ここでは求めない（どの操作者で動かすかは環境側の決定）。

この基盤の噛み合わせで壊れやすいのは次の 3 つ。

- **応答の形。** `CurrentOperatorResponse` は日本語キーで、`権限` だけ英語キーの真偽値
  （`order` / `master` / `operation` / `branch_all`）。キーが欠けると api 層が「持っていない」に倒すので、
  実 API の改名は**全画面が権限なしになる**形で現れる
- **`X-User-Code` が載っていること。** `.env` の `VITE_USER_CODE` が空だとヘッダが飛ばず、実 API は未登録の操作者として
  `登録済=false`・全権限なしを返す（モックは知らないコードを管理責任者に倒すので、MSW 版では気づけない）
- **ガードとメニューの一致。** `router/index.js` と `navigation.js` が同じ応答から同じ結論を出すこと

## 実行方法

既定では**動かない**（`E2E_REAL_API` が無ければ丸ごとスキップ）。実 API に当てるときだけ、前提をそろえて実行する。

1. `.env` の `VITE_ENABLE_MSW` を `false` にして `docker compose up -d --force-recreate frontend`
2. バックエンドを起動しておく（`(cd ../Pre-Market_Trading && docker compose up -d api)`）
3. `.env` の `VITE_USER_CODE` に操作者マスタにある社員コードを入れておく
   （未設定でもテストは動くが、全権限なしの経路しか踏まない）

```powershell
docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test access-control.real-api
```

MSW が有効なままだと実 API を見ていないので、各シナリオの冒頭で検出して失敗させる。

**実 DB には書き込まない**（`GET /auth/me` と各画面の一覧 GET だけ）。各行は独立していて、`--grep` で 1 本だけ抜き出してよい。
操作者をいろいろ変えて回すときは、`VITE_USER_CODE` を変えて frontend を作り直してから同じコマンドを流す
（1 回の実行で踏めるのは**その操作者の権限の組み合わせ 1 通り**だけ）。

## 2 本目が書き込みでない理由

合格線のスモークは「一覧 1 本・書き込み 1 本」だが、**アクセス制御に書き込みは無い**。
そこで 2 本目は**権限の要るルートの出し分け**にした（`ACR-02`）。応答の 3 つの権限フラグがそれぞれ
ガードに届いているかを 1 本で確かめられ、フラグの改名・欠落がここで判る。

## シナリオ

権限の要るルートは `router/index.js` の `meta.requiredPermission` の 3 系統。

| 権限（`権限.*`） | ルート |
|---|---|
| `master` | マスタメンテの 9 画面（`navigation.js` の「マスタメンテ」区分と同じ） |
| `operation` | 運用管理の 4 画面（「運用管理」区分と同じ） |
| `order` | 注文訂正 `/orders/<id>/amend` / 注文取消 `/orders/<id>/cancel`（メニューに無い） |

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ACR-01 | MSW off・api 起動 | 注文一覧 `/` を開く | 起動時に `GET /auth/me` が実 API から 200 で返り、リクエストに `X-User-Code` が載っている。応答に `操作者コード` / `登録済` / `権限` / `認可強制` があり、`権限` の 4 つ（`order` / `master` / `operation` / `branch_all`）がすべて真偽値。権限の要らない注文一覧はその結果に関わらず開け、権限なしの画面は出ない | 未着手 |
| ACR-02 | ACR-01 と同じ | 権限の要る 15 ルート（マスタメンテ 9 / 運用管理 4 / 注文訂正・取消 2）の URL をそれぞれ直接開く | 応答の `権限.<系統>` が真のルートは URL がそのままで、ヘッダの見出しがその画面のタイトルになり、権限なしの画面は出ない。偽のルートは URL が `/forbidden` になり、見出しが「アクセス権限がありません」、本文に「この画面を開く権限がありません。」が出て、「権限を確認できませんでした」は出ない | 未着手 |
| ACR-03 | ACR-01 と同じ | `/` を開いてサイドメニューを見る | 権限の要らない区分（顧客 / 注文・照会）は必ず出る。「マスタメンテ」は `権限.master` が真のときだけ、「運用管理」は `権限.operation` が真のときだけ区分の見出しと配下のリンクが出て、偽なら見出しもリンク（畳まれたものも含む）も無い | 未着手 |
| ACR-04 | ACR-01 と同じ | 注文照会 `/orders/inquiry` を開く | `権限.order` が真ならヘッダに「新規注文」ボタンが出て「発注権限なし」は出ない。偽なら「発注権限なし」が出て「新規注文」は無い | 未着手 |

`ACR-02` は 15 画面を読み込み直すので時間がかかる（`test.slow()`）。注文訂正・取消は存在しない注文 ID でも
ガードは先に走るので、権限があれば画面のタイトルまで出る（注文の中身は見ない）。
