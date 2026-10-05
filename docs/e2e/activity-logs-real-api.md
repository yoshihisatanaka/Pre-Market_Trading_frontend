# 操作ログ（実 API 接続）

- 略号: `ALR`
- 画面: `src/views/ActivityLogListView.vue`
- テスト: `e2e/activity-logs.real-api.spec.js`

[activity-logs.md](activity-logs.md)（`AL`）と対象画面は同じだが、**当てる先が違う**。
`AL` は MSW のモックに当てて画面の挙動を細かく固定する。こちらは**実 API
（`/operations/activity-logs` と `/operations/activity-logs/targets`）に当てて、
フロントとバックエンドの噛み合わせだけ**を見る。

いまはリリースまでの合格線どおり**スモーク 2 本**（一覧 1 本・検索 1 本）だけを置く。
網羅（ページング・操作者／対象キー／期間の絞り込み・並び順・詳細ダイアログの差分）は
10/15 以降のステージング期間に足す。

## なぜ分けるか

`AL` は「フィクスチャの件数」「1 行目の対象キー」「`symbols` の件数」のように
フィクスチャの中身を期待値にしている。実 API に当てるとデータが違うので全滅し、しかも
`mockApi()`（`window.__mswOverrides`）は MSW を切ると効かないため、
エラー応答（AL-11 / AL-17）や 0 件（AL-10）の再現も成立しない。
`AL` を実データでも通るように書き換えると、代わりに画面の精度を失う。

そこで**期待値の立てかたを変えた別ファイル**にする。ここでは
「件数表示が API の `total` と一致する」「絞り込んだ行はすべて条件を満たす」のように、
**データの中身に依存しない不変条件**だけを書く。件数・対象種別・操作区分は実行時に API から読み取って比べる。
エラー応答・ローディング・0 件の網羅は `AL` の担当で、ここでは求めない。

## 2 本目が書き込みでない理由

合格線のスモークは「一覧 1 本・書き込み 1 本」だが、**この画面は参照専用**で書き込みの操作を持たない
（追加・訂正・削除の導線が無い。AL-12 で固定している）。操作ログを増やすには別のマスタを更新するしかなく、
それは他画面の実 API E2E の担当で、ここでやると排他の範囲が広がる。

そこで 2 本目は**検索**にした。この画面の噛み合わせで最も壊れやすいのは**クエリ名**で、
FastAPI は知らないクエリを黙って無視するため、送出名がずれても MSW 版では気づけない
（モックのハンドラはフロントと同じ名前を読む）。対象種別（`target_types`）と操作区分（`operation`）を
同時に送り、表示行がすべて条件どおりであることを見れば、両方のクエリ名が実 API に効いていることが判る。

## 実行方法

既定では**動かない**（`E2E_REAL_API` が無ければ丸ごとスキップ）。実 API に当てるときだけ、
前提をそろえて実行する。

1. `.env` の `VITE_ENABLE_MSW` を `false` にして `docker compose up -d --force-recreate frontend`
2. バックエンドを起動しておく（`(cd ../Pre-Market_Trading && docker compose up -d api)`）

```powershell
docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test activity-logs.real-api
```

MSW が有効なままだと実 API を見ていないので、各シナリオの冒頭で検出して失敗させる。

**実 DB には書き込まない**（GET だけ）。ただし件数を画面と API の両方から読んで比べるので、
**他の実 API E2E（マスタの登録・更新）と同時に流すと、その間に操作ログが増えて件数が揺れる**ことがある。
バックエンドの `api` と DB は 1 つしかないので、実 API E2E は worktree 間で排他にする。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALR-01 | 実 API に接続。件数は問わない | 操作ログ `/operations/activity-logs` を開く | 件数表示が `GET /api/operations/activity-logs` の `total` と一致し、表の行数が min(total, 50)。対象機能プルダウンに `GET /api/operations/activity-logs/targets` の件数 +「全て」が並ぶ。ローディング・エラーは残らない（0 件なら空状態） | 実装済 |
| ALR-02 | 実 API に接続。画面の「操作内容」で選べる操作区分（CREATE … VWAP_BULK の 9 種）ごとに `operation=` 付きで API を直接引き、最初に 1 件以上返った操作区分と、その最新行の対象種別を組にする（その組は必ず 1 件以上ある） | その対象機能・操作内容を選んで「検索」 | URL に `target_types=` と `operation=` が付き、件数が同じクエリで API に投げた `total` と一致し全件以下。表示行の 対象機能・操作 のセルがすべて「その対象種別名 + その行の操作内容」で、操作区分バッジが対象種別から導いた区分（クエリ名が黙って無視されていないことの確認）。9 種のどれも 0 件ならスキップ | 実装済 |

## ALR-02 の前提の作りかた（2026-09-29 / 2026-10-05 の実測）

9 種の操作区分の操作ログが 1 件も無い DB では、前提が成立せずスキップされる
（絞り込みが効いたことを確かめられない）。障害管理・お知らせ管理の実 API E2E が流れていれば
`SUSPEND` / `RESUME` / `SHOW` / `HIDE` の行が積まれているので、通常は成立する。
マスタの行（CREATE / UPDATE / DELETE）も欲しければ、マスタの実 API E2E（CA・海外休場日・受注不可日）を先に流す。

実測した値:

- 2026-09-29: `GET /api/operations/activity-logs` の `total` は実行中に 4 → 12 に増えた（並行して流れていた障害管理・
  お知らせ管理の実 API E2E が積んだ行）。内訳は `order-suspensions` の `SUSPEND` / `RESUME` と、
  `announcements` の `SHOW` / `HIDE` だけで、CREATE / UPDATE / DELETE / BATCH は 0 件
- 2026-09-29: `operation=SUSPEND` は **400**（`指定できない操作区分です: SUSPEND（指定可能: CREATE, UPDATE, DELETE, BATCH）`）。
  **2026-10-05 に再測したところ 200 になり**、`openapi.json`（2026-09-30 取り込み）の説明も 9 種
  （CREATE / UPDATE / DELETE / BATCH / SUSPEND / RESUME / SHOW / HIDE / VWAP_BULK）に増えていた。
  `GET /codes` の `操作区分` も同じ 9 種を返す。画面の「操作内容」の選択肢はこの 9 種
- 2026-10-05: 一覧の行には `操作者名` / `実行者区分` / `対象機能` / `操作内容` が入っている
  （`操作内容` は「発注停止を停止」「銘柄情報を削除」のような表示文。操作者がマスタに無い `e2e` は
  `操作者名` が「システム」、`実行者区分` が `null`）
- ALR-01 は件数が増えている最中でも通った（画面の件数と API の `total` を続けて読むので、その間に
  行が増えると揺れうる。揺れたら他の実 API E2E を止めて流し直す）
- 対象種別コードは 14 種。2026-09-29 は `schedule_times` だけがアンダースコアだったが、2026-10-05 には
  `schedule-times` になり全部ケバブケース（`order-suspensions` 等）。
  知らないコードは 400（`指定できない対象種別です`）で弾かれるので、黙って無視はされない。
  画面の「操作区分」（マスタ更新 / 運用管理）は対象種別から導き、運用管理は `order-suspensions` / `announcements`
  の 2 種（`src/utils/activityLogTypes.js` の `OPERATION_TARGET_TYPES`）。バックエンドが運用管理の対象種別を
  増やしたときは、この定数に足すまでマスタ更新に数えられる（`docs/api/requests.md` #38 で区分の返却を依頼中）

