# バックエンドへの依頼（集約）

フロントの手では動かせない依存を **1 枚**に集め、**解消で戻るセル数の順**に並べる。
進捗表（[docs/progress.md](../progress.md)）の `## バックエンド待ち` と `## 残作業の内訳` から起こしたもので、
数字はそちらの定義（1 行 = 4 軸 = 4 セル）に合わせている。

**運用**: 解消したら「状態」を `解消（YYYY-MM-DD）` にして行は残す（過去行は消さない）。
新しい依頼は末尾ではなく、戻るセル数の位置に差し込む。契約テスト（`src/api/contract.spec.js`）の
`KNOWN_GAPS` に載せた食い違いは、必ずこの表にも行を持つ。

## 依頼一覧

| # | 依頼 | 影響する画面 | 戻るセル（目安） | フロント側の暫定 | 状態 | 起票日 |
|---|---|---|---|---|---|---|
| 2 | **約定照会の API**（`/executions` 系: 検索・CSV 出力）と **注文訂正**（`/orders/{order_id}/amend` 相当。`dream-correct` は Dream 用） | 約定照会 / 注文照会（訂正）/ みずほ注文締 | 24.0 | 同上 | 依頼中。**注文訂正は解消**（2026-09-24 の取り込みで `POST /orders/{order_id}/amend` が入り、2026-09-30 にフロントの訂正画面 `/orders/:orderId/amend` を接続） | 2026-09-17 |
| 3 | **レスポンスの中身が未定義**: `/mizuho/*` / `GET /orders/{order_id}` / `/customers`（注文画面用）/ `/batch/*`（`/codes`・`/branches`・`/handlers` は 2026-09-30 の取り込みで `CodesResponse` / `BranchListResponse` / `HandlerListResponse` が付いたので外した。2026-10-01 にフロントが実形へ追随）。**`GET /orders/{order_id}` について（2026-09-30 追記）**: 注文照会の訂正・取消画面がこの API で対象注文を読む。`OrderDetailResponse.order` は型が無い（`additionalProperties: true`）ので、フロントはバックエンドの実装（`get_order_detail` が `d_注文` を `SELECT *` で返す）から列名を読んだ。① `order` を一覧の `OrderItemResponse` と同じく型付きのスキーマにしてほしい ② 一覧が付ける派生項目（`顧客名` / `処理状況名` / `表示状況名` / `出来数量` / `有効残数量`）を `order` にも付けてほしい（いまはフロントが出来数量を `executions` の `約定数量` から合計し、処理状況名をコードマスタの写しで引いている）③ `指値単価`（decimal）が数値で来るのか文字列で来るのか | 新規注文 / 顧客詳細 / みずほ注文締 / 滞留注文抽出 / 注文照会（訂正・取消） | 16.0 | `src/mocks/` の仮フィクスチャで進める。注文詳細は `src/mocks/handlers/orders.js` が `d_注文` の形（派生項目なし）で返し、`src/api/orderInquiry.js` の `toOrderDetail` は数値と数値の文字列の両方を受ける | 依頼中 | 2026-09-16 |
| 4 | **権限マスタをフロント側で仕様の形に合わせ直す**（依頼ではなく**フロントの作業**）。`/masters/permissions` は 2026-09-18 の取り込みで GET / PUT / history が入ったが、**形が違う**: 仕様は `RolePermissionItem`（日本語キー・`発注権限` / `マスタ更新権限` / `運用管理権限` の 3 権限 + `全店参照権限`）、フロントは画面モック由来（英語キー・`can_order` / `can_master_update` / `can_order_stop` / `can_activity_log_view` / `can_admin_function` の 5 権限）。**仕様を正とすることで確定（2026-09-25）**。あわせて `RolePermissionUpdateRequest` / `OperatorUpsertRequest` の `実行者` だけ description が空（`SuspendRequest` ほかは「未指定時は認証情報から解決」）。フロントは送らず `X-User-Code` に任せるので同じ扱いでよいか確認 | 権限マスタ / アクセス制御 | 12.0 | **フロントは 2026-09-25 に追随済み**。画面・api 層・fixture を `RolePermissionItem` の 4 権限に張り替え、保存を `PUT /masters/permissions/{role_code}` に繋いだ。モックの「操作ログ閲覧」「管理者機能」は画面から外した。`KNOWN_GAPS` の行も外した | **解消（2026-09-25・フロントが追随）**。`実行者` の扱いのみ問合せ中 | 2026-09-18 |
| 1 | **滞留注文抽出の API と操作ログの項目**: ① **滞留注文抽出の一覧。二択で回答がほしい**: (a) `GET /operations/stalled-orders` を足す（形は `src/mocks/fixtures/stalledOrders.js`。注文エラー / 注文中の 2 配列）、(b) 既存の `GET /orders` を拡張する —— `status` のカンマ区切り複数指定（2026-09-25 実測で `?status=101,003` は 400「指定できない処理状況です」）と、`OrderItemResponse` への `発注範囲名` / `確認状況` の追加（無いのはこの 2 つだけ）。(b) ならフロントが注文エラー・注文中を 2 回に分けて呼ぶ。`GET /orders/error-summary` は件数だけなので一覧には使えない。② **確認 CSV（TWS の約定コンファメーション）の取込**（`確認状況` を書き戻す口。`/mizuho/import-confirmation` はみずほの Excel 用で別物）。**2026-09-28 にフロントが形を提案した**（下の「契約提案: コンファメーション CSV の取込」。パス・項目名 `file`・応答は既存の `CsvImportResponse`）。この形でよいか、`confirmation_status` の値の体系とあわせて回答がほしい。**CSV 出力 3 種（別システム発注 CSV・発注サンプル・コンファメーションのサンプル）は一覧データからフロントで生成する方針に変え、依頼から外した**（2026-09-28 実装済み）。③ 操作ログの**項目**（操作者名・実行者区分・対象機能・操作内容・結果。2026-09-24 に画面を `ActivityLogItem` の形へ張り替え、この 5 項目は画面から外して fixture にだけ提案として残した。絞り込みクエリ `feature` / `action` / `actor_group` / `result` は送るのをやめた）。**2026-09-30 の取り込みで 結果 以外の 4 項目が `ActivityLogItem` に入り、残るのは 結果 だけ**（画面に 4 項目を出し直すのはフロントの作業として残る）。お知らせ管理と障害管理は 2026-09-24 に解消（下の「解消済み」） | 滞留注文抽出 / 操作ログ | 6.5（一覧 3.0 + 確認取込 3.5。CSV 出力・サンプル 2 種の 10.5 はフロントで消化済み） | **fixture を契約提案として先に書き**、3 軸を埋める（`src/mocks/fixtures/` の生の形がそのまま提案書）。一覧の応答キーは依頼書に合わせて `注文エラー` / `注文中`。CSV 出力とサンプル 2 種はフロント生成で実装済み（`src/utils/stalledOrderCsv.js`）。取込は MSW のハンドラ（`src/mocks/handlers/stalledOrders.js`）が提案の形で応答し、契約テストの `KNOWN_GAPS` に一覧と取込の 2 パスを載せてある | 依頼中 | 2026-09-17 |
| 1-b | **操作ログの `操作区分` の値の体系**: 仕様の `operation` は CREATE / UPDATE / DELETE / BATCH、画面は「業務操作 / マスタ更新 / 運用管理」。いまは**名前だけ合わせて値はそのまま**送っている | 操作ログ | （#1 に含む） | 画面を仕様の値（CREATE / UPDATE / DELETE / BATCH）に合わせた | **解消（2026-09-24・フロントが追随）** | 2026-09-18 |
| 13 | **残高マスタの画面項目 2 つを仕様に足す**: ~~① 一覧・更新の `売却不可区分`~~（**2026-09-25 の取り込みで解消**。下の「解消済み」）② 検索の **銘柄名**（`GET /masters/balance-adjustments` に `symbol_name` 相当のクエリが無い。実 API は無視するので絞り込みが黙って効かない） | 残高マスタ（一覧・検索 / 売却不可区分の切替） | 2.0 | `symbol_name` は送っている（MSW だけが解釈する）。契約テストの `KNOWN_GAPS` に載せてある。①は 2026-09-25 にフロントが追随した（専用の口へ張り替え、`KNOWN_GAPS` から外した）。実 API E2E（`BAR`）は銘柄名の絞り込みだけ解消まで保留 | 依頼中（②のみ） | 2026-09-24 |
| 24 | **新規注文の送信で未確定の 5 点**: ① `POST /orders/validate`・`POST /orders` の**業務エラー**（残高不足・売買規制・発注停止中など）を 200 の `valid:false` / `success:false` で返すのか、4xx で返すのか（宣言されている応答は 200 と 422 だけ）② **`強制区分` の値の体系**（0 / 1 だけか）と、フロコン警告を強制区分付きの検証でどう返すか（`valid:true` で `warnings` を残すのか、消すのか）③ **`作成者`（必須）・`受注者`（任意）をフロントが埋めるのか**、`X-User-Code` から解決されるのか ④ **`預り売買区分` の 0 / 1 の向き**: csv-spec は「0: 特定, 1: 非特定」、`SpecificDepositEnum` を使う残高マスタ（`特定預り区分`）とフロントの写しは「0: 非特定, 1: 特定」で逆。同じ意味の区分なのか ⑤ **`証券受渡方法` の既定**（画面に欄が無い。モックは初期値が 当社保管 `100`、実際の送信値が 他社保管 `500` で食い違う） | 新規注文（注文の送信） | 2.0 | ①はどちらでも止まる作り（200 の不合格は「入力エラー」の帯、4xx / 5xx は通信エラーの帯）②は警告が返ったら強制区分を付けて送り直させ、`warnings` があっても `errors` が空なら確認へ進む ③は受注者・作成者ともログイン中の社員コードを送る ④は csv-spec に従い「一般」を `1` で送る ⑤は `500` で送る（`src/api/orderEntry.js`・`src/utils/orderEntryOptions.js`）。MSW は業務エラーを 200 で返す | 問合せ中 | 2026-09-29 |
| 5 | **PUT / DELETE のパスキーの統一** → **ID に統一で確定**（下の「解消済み」を参照）。残るのは**ロール権限（`role_code`）とユーザ（`operator_code`）の 2 つだけ**で、この 2 つは業務コードが主キーのまま・DELETE のオペレーション自体が無い。**削除をどう表現するか**（論理削除の PUT で代替するのか、DELETE を足すのか）は未回答 | 権限マスタ / ユーザマスタ | 1.0 | 削除の導線を作らない（一覧・登録・変更まで） | **解消（2026-09-25・要件で確定）**: ロール権限は Web 画面に削除の導線が無く、ユーザは管理画面で管理しないので削除も無い。DELETE が無いままでよく、バックエンドへの問い合わせは不要 | 2026-09-17 |
| 8 | **`/masters/customers` の検索クエリ追加**: `handler_code` / `restriction` / `account_type` / `corporate_type`。画面モックにある検索条件で、いまは実 API が無視する（絞り込みが黙って効かない） | 顧客マスタ（一覧・検索） | 1.0 | 送っている。2026-09-30 の取り込みで 4 つとも仕様に入り、契約テストの `KNOWN_GAPS` から外した | **解消（2026-09-30）** | 2026-09-14 |
| 19 | **`GET /masters/symbols` の `symbol` を Ticker にも当ててほしい**: 2026-09-25 実測で `?symbol=AAPL`（Ticker）は 0 件、`?symbol=A0030`（銘柄コード）と `?ticker=AAPL` は 1 件。同じ `AAPL` を `/masters/ca?symbol=` は 3 件、`/masters/balance-adjustments?symbol=` は 5 件返す（description も「銘柄コードまたはTicker」）。**銘柄マスタだけ挙動が違う**。画面の検索欄「銘柄コード・ティッカーコード」は `symbol` に乗せるので、Ticker 検索が実 API で黙って 0 件になる。当てない方針ならその回答をもらい、フロントが検索欄を分ける（`ticker` は効いている） | 銘柄マスタ（一覧・検索） | 1.0 | 検索欄 1 つのまま。MSW は銘柄コードと Ticker の両方に当てるので E2E `SM-03` は通る（`src/mocks/handlers/symbols.js`）。実 API E2E を書くときは Ticker 検索を保留にする | 依頼中 | 2026-09-25 |
| 20 | **`POST /masters/balance-adjustments` の `銘柄コード` に Ticker を受けるか**: 画面の新規追加はティッカー入力をそのまま `銘柄コード` に載せる。2026-09-25 実測で `POST …/validate` に `銘柄コード: "AAPL"` は「指定された銘柄コードが存在しません: AAPL」、`"A0030"` は通る（`details` に `Ticker: AAPL` が付く）。**実装済みの「残高マスタ / 新規」が実 API では必ず失敗する**。バックエンドで Ticker も受けるか、フロントが `GET /masters/symbols?ticker=` で銘柄コードに引き直してから送るかの二択 | 残高マスタ（新規追加） | 1.0 | フロント側の追随でも解消できる。10/15 の実 API スモークまでにどちらかに決める（回答が無ければフロントで引き直す） | 要判断 | 2026-09-25 |
| 22 | **みずほ注文締の画面項目 4 つ**: ① `ExecutionSummary` に**一部出来の件数**が無い（画面モックの件数カード「一部出来」）② `ExecutionItem` に**円貨の約定金額**が無い（約定代金は USD のみ。モックの列「約定金額(円)」）③ `GET /executions` の `status` は処理状況コードを 1 つしか受け取らず、**取消済（出来有）で絞れない**（取消済は `032` / `034` の 2 つ。カンマ区切りを受けるか、出来状況の区分で絞るクエリがほしい）④ **締め・締め解除の履歴を返す口が無い**（`ClosingStatusResponse` は最後の 1 回の 更新日時 / 実行者 だけ。モックは「状態変更履歴」を並べる） | みずほ注文締（検索・結果一覧 / 注文締め・締め解除）/ **約定照会（一覧・件数カード）**（①〜③は同じ `GET /executions` の項目なので両画面に効く） | 1.0 | ①②は `—` を出す（約定照会は USD の約定代金を出し、「一部出来」カードを `—`）。③はみずほ注文締は `status` を送らない（E2E `MZ-17` を保留）、約定照会は `034` だけを送る。④は最後の 1 回だけを 1 行で出す（`src/api/mizuhoExecutions.js` / `src/api/closing.js` / `src/views/ExecutionListView.vue`） | 依頼中 | 2026-09-28 |
| 14 | **全体停止中にルート単位の停止・再開を受け付けるか**: `POST /operations/order-suspensions/suspend` の description は「全体停止はルート単位の停止に優先」とだけ書き、全体停止中にルートを操作したときの応答（受け付ける / 400）が無い | 障害管理（停止・再開） | 1.0 | 画面は**全体停止中はルート行のボタンを押せなくする**（誤操作防止。`IN-23` / `INV-21`）。サーバが受け付けるかは見ていない | 問合せ中 | 2026-09-24 |
| 10 | **再有効化の ID**: 取消済みの休場日 / 受注不可日を登録し直したとき、元の行の ID を引き継ぐのか新しく採番するのか | 海外休場日 / 受注不可日（新規追加） | 0.5 | モックの挙動（元の ID を引き継ぐ）が実 API と一致していた。実 API E2E（`MR-07` / `MR-08`）は**どちらでも通る**書き方のまま置く（「id が付いていること」だけを見る） | **解消（2026-09-18・海外休場日で実測）** | 2026-09-17 |
| 17 | **スライス基準マスタの更新が最新の `更新日時` を送っても 409 になる**（退行）: `GET /masters/hard-limits` で取った `更新日時`（`2026-08-26T00:00:00`）をそのまま添えた `PUT /masters/hard-limits` が「他のユーザーによってスライス設定が更新されました」の 409 を返す。画面からの保存も、テストの API 直叩きも同じ。2026-09-17 から実 API E2E `SCR-03` は通っており、フロント・テストとも変更なし。バックエンドの 2026-09-24 の変更（Phase 39〜45）以降に出たと見ている。楽観ロックで比べる値が GET の返す値とずれていないか確認してほしい | スライス基準マスタ（設定変更） | 0.5 | 手を入れない（フロント側で回避すると楽観ロックの意味が無くなる）。実 API E2E `SCR-03` 以降は失敗のまま置き、朝の点検で解消を見る。2026-09-28 の朝の点検でも再現（`SCR-03` の最初の PUT が同じ 409）。2026-09-29 も再現し、GET 直後に同じ `更新日時` で PUT しても 409（画面を介さず API 単独で再現）。serial 実行のため `SCR-04`〜`07` は未実行になる | 依頼中 | 2026-09-25 |
| 18 | **受注不可日の事前検証が日付の変更を弾く**（PUT とのねじれ）: `POST /masters/blackout-dates/validate?blackout_date_id=<id>&is_update=true` は、本文の `受注不可日` が ID の指す日付と違うだけで 400「IDが指す受注不可日（20350101）とリクエストの受注不可日（20350102）が一致しません。」を返す（`pick_key` の整合検査）。一方 `PUT /masters/blackout-dates/{blackout_date_id}` は ID から旧日付・本文から新日付を取り、**日付の変更を受け付ける**（`BlackoutDateRequest.受注不可日` も required）。画面は「事前検証を通ったら PUT」なので、日付を変える編集が実 API では必ず事前検証で止まる。**日付の変更を許すなら validate も PUT と同じく本文の日付を変更先として扱ってほしい**。許さない方針なら PUT も弾いてほしい（フロントは日付欄を読み取り専用にする） | 受注不可日マスタ（編集） | 0.5 | 画面は日付を編集可能のまま（実 API では事前検証の 400 がモーダル内に出て止まる）。実 API E2E `BDR-07` は `test.fixme` で保留。理由だけの編集（`BDR-06`）は通る | 依頼中 | 2026-09-25 |
| 15 | **履歴の `変更前データ` / `変更後データ` / `差分データ` の中身の型**: `SuspensionHistoryItem` でも `AnnouncementHistoryItem` でも `anyOf: [{}, null]`（any）。障害管理の停止理由は履歴の独立項目に無く、この中にしか無い | 障害管理（操作履歴）/ お知らせ管理（履歴） | 0.5 | 障害管理は `変更後データ.停止理由` を読み、無ければ「—」に落とす（`src/api/incidents.js`）。fixture は `{ 発注停止フラグ, 停止理由 }` の写しで提案している。2026-09-30 の取り込みで両スキーマとも `object`（または `null`）になり、description に中身のキーが書かれた。お知らせの fixture / MSW も文字列から object に直した | **解消（2026-09-30）** | 2026-09-24 |
| 24 | **注文照会・取消の API の 3 点**: ① `GET /orders` の `status` がコードを 1 つしか受けない（#1 の (b) と同じ）。画面の出来状況のうち **取消済は 032 / 034、注文エラーは 101 / 103 の 2 コードにまたがる**ので、片方しか絞れない。カンマ区切りを受けるか、出来状況の区分で絞るクエリがほしい ② `POST /orders/{order_id}/cancel` の `responses` に **400 / 404 が宣言されていない**（実装は `ValueError` を 400 で返し、description にも「取消不可（400エラー）」とある）。amend と同じく `ErrorResponse` を宣言してほしい ③ `OrderCancelRequest.取消者` の既定値が `"user"` で、**誰が取り消したかが記録に残らない**。amend と同じく `X-User-Code` / セッションから解決してほしい（フロントは `取消者` も `理由` も送らない。`理由` は削除予定と聞いている） | 注文照会（検索・結果一覧 / 注文取消） | 0.5 | ①取消済は 034、注文エラーは 101 だけを送る（`src/api/orderInquiry.js` の `EXECUTION_STATUS_CODES`。約定照会と同じ扱い）②画面は `detail` の文言をそのまま出すので、宣言が無くても動く ③送らない | 依頼中 | 2026-09-30 |
| 12 | **`/market-status` のセッションコードに enum 宣言が無い**: `現在のセッション`（`PRE` / `REGULAR` / `AFTER` / `BEFORE_OPEN` / `CLOSED`）と `MarketSessionItem.code` がどちらも素の `string`。値の体系は description の文章にしかないので、**綴りが変わっても `apiEnums.spec.js`（`*Enum` の写ししか見ない）でも契約テストの `KNOWN_GAPS`（型と項目名しか見ない）でも構造的に検知できない** | 共通レイアウト（ヘッダの市場ステータス・取引時間帯） | 0 | 表示の主判定を `JPN開始` / `JPN終了` の時刻比較に寄せ、この文字列への依存を異常系だけに留めた（`src/utils/marketStatus.js`）。未知の綴りが来ても `○ Closed` に落ちるだけで壊れない。2026-09-30 に `MarketState` / `MarketSessionCode` として enum 宣言され、`src/utils/apiEnums.js` に写した（`apiEnums.spec.js` が綴りの変更を検知する） | **解消（2026-09-30）** | 2026-09-18 |
| 16 | **発注再開に理由を残すか**: `ResumeRequest` に理由の項目が無く、履歴には「誰がいつ再開したか」しか残らない（停止理由は再開後も直前の値を保持する）。障害報告で再開の判断根拠を残す要件があるか | 障害管理（再開） | 0 | 再開のダイアログは理由を取らず、停止時の理由・日時・停止者を読み取り専用で見せる | 問合せ中 | 2026-09-24 |
| 21 | **`limit` の無い一覧・履歴 4 本に `limit`（1〜200・既定 50）を足してほしい**: `GET /masters/blackout-dates`・`GET /customers`（注文画面用）・`GET /masters/customers/{account_id}/history`・`GET /masters/blackout-dates/{blackout_date_id}/history` は `offset` だけ。2026-09-25 実測で `?limit=2` は無視される（受注不可日は応答が `limit: 50`、`/customers` は 50 行）。他の一覧・履歴はすべて `limit` を持つ | 受注不可日マスタ（一覧）/ 新規注文（顧客検索） | 0 | 受注不可日は 50 件固定に合わせてある（`src/api/blackoutDates.js`・`src/stores/blackoutDates.js`）。**一覧の件数はフロントが決めて `limit` で送る方針に確定（2026-09-28）**。全画面の件数は `src/utils/pagination.js` の `DEFAULT_PAGE_SIZE` で変えるが、受注不可日だけはこれに従えず 50 のまま残る | 依頼中（2026-09-25 に一度取り下げ、2026-09-28 に再依頼。件数をフロント管理にしたため必要になった） | 2026-09-25 |
| 23 | **操作ログの `操作区分` が一覧と絞り込みで食い違う**: 2026-09-29 実測で `GET /operations/activity-logs` の一覧は障害管理の `SUSPEND` / `RESUME`、お知らせ管理の `SHOW` / `HIDE` を返すが、同じ API に `?operation=SUSPEND` を送ると 400（`指定可能: CREATE, UPDATE, DELETE, BATCH`）になる。`ActivityLogItem.操作区分` の description も 4 種だけ。**発注停止・お知らせの行を操作区分で絞り込めない**。①区分の値の体系（この 4 種を増やすのか、`SUSPEND` などを `UPDATE` に寄せて返すのか）②増やすなら `operation` の指定可能値と `openapi.json` への反映、を回答してほしい。あわせて対象種別コードは `schedule_times` だけがアンダースコアで、他はハイフン区切り（`order-suspensions` など）。動作には影響しないが、揃えるならいまのうちに知りたい | 操作ログ（一覧・検索） | 0 | 画面の操作区分は 4 種のまま。知らない値はバッジに生の値（`SUSPEND` など）をそのまま出す（`src/utils/activityLogTypes.js` の `operationLabel`）。実 API E2E `ALR-02` は 4 種の区分で絞るので、この食い違いには当たらない（2026-09-29 にマスタの実 API E2E で 4 種の行を積んで通した） | 依頼中 | 2026-09-29 |
| 24 | **みずほ注文締めの `実行者` を認証情報から解決してほしい**: `POST /closing/mizuho` と `/closing/mizuho/reset` は本文 `ClosingActionRequest.実行者` をそのまま `d_締め管理` に記録し、省くと `'SYSTEM'` になる（`X-User-Code` / セッションは権限判定にしか使っていない）。画面から任意の値を送れてしまい、監査上の記録として信用できない。発注停止（`/operations/order-suspensions/*`。未指定時は認証情報から解決）と同じく、操作者を認証情報から取る形にしてほしい（本文の `実行者` は廃止か無視） | みずほ注文締（締め・締め解除） | 0 | `src/api/closing.js` が `.env` の `VITE_USER_CODE`（`X-User-Code` と同じ値）を本文の `実行者` に載せている。サーバが解決するようになったら本文から外す | 依頼中 | 2026-09-30 |
| 25 | **為替レート更新の実行者の記録**: 画面モックは更新のたびに実行者（社員コード・氏名・ロール）を残すが、`FxItem` にあるのは `更新者`（コード）だけで氏名もロールも返らない。①一覧・詳細で実行者の氏名（とロール）を返すか ②手動変更と自動取込の区別は `ユーザー操作フラグ` で足りるか、を回答してほしい | 為替マスタ（現在レートの最終更新） | 0 | 最終更新は `更新日時` と `更新者` のコードだけを出す（`src/views/FxRateMasterView.vue`） | 依頼中 | 2026-09-30 |
| 26 | **約定の預託先（注文ルート）をロールで制限してほしい（要件）**: 預託先は管理者（`manager`）・管理責任者（`supervisor`）にだけ見せる要件（画面モック `routers/executions.py` の `can_view_depositary`）。いまの `GET /executions` と `GET /executions/export-csv` はロールに関係なく `注文ルート` / `注文ルート名` を返し、`route` の絞り込みも受け付ける。CSV には「預託先」列が常に入る。①見られないロールには一覧・CSV とも預託先を返さない（CSV は列ごと落とす）②見られないロールの `route` 指定は無視か 403 ③`PermissionFlags`（`/auth/me`）に預託先の参照権限を足すか、ロールで固定するか、を決めて実装してほしい | 約定照会（一覧・CSV 出力）/ みずほ注文締（約定一覧） | 0 | 画面側だけで出し分けている: `src/views/ExecutionListView.vue` が `/auth/me` の `ロールコード` が manager / supervisor のときだけ検索欄「預託先区分」と列「預託先」を出し、それ以外は URL の `route` を条件に使わない。API を直接呼べば取れ、CSV の預託先列も全ロールに出る。③が決まったら判定を権限フラグに差し替える | 依頼中 | 2026-09-30 |
| 27 | **CSV一括注文の事前検証に顧客名を足す**: `POST /orders/validate-csv` の行（`CsvOrderRowResult`）に `customer_name`（部店＋口座番号から引いた顧客名。引けなければ `null`）を追加してほしい（バックエンドで追加予定と聞いている）。画面モックのプレビュー・受付完了の「顧客名」列に出す。銘柄名（`details.stock_name`）と違い、値の変換に失敗して `details` が `null` になる行でも、口座が読めれば返してほしい。置き場所を `details` の中にするなら知らせてほしい（フロントは `src/api/orderCsv.js` の 1 行を直す） | CSV一括注文（取込内容の確認） | 0 | `customer_name` を読み、無ければ「—」を出す。fixture と MSW は行に `customer_name` を返す。2026-09-30 の取り込みで `CsvOrderRowResult.customer_name`（`string \| null`）が入り、契約テストの `KNOWN_GAPS` から外した | **解消（2026-09-30）** | 2026-09-29 |
| 28 | **コードマスタ（`app/config/codes.json`）に 4 カテゴリを足してほしい**: 画面の選択肢はすべて `GET /codes` から取る方針だが、次の 4 つは `/codes` にも他の API にも取得先が無い。① `注文照会出来状況`（注文照会の検索。コードは `GET /orders` の `status` に載せる処理状況コード）② `約定出来状況`（約定照会・みずほ注文締の検索。`GET /executions` の `status`）③ `VWAP区分`（新規注文の注文種別。`OrderRequest.VWAP区分`）④ `操作区分`（操作ログの検索。`GET /operations/activity-logs` の `operation`）。コードと名称は下の「契約提案: コードマスタに足す 4 カテゴリ」。カテゴリ名・名称を変えるなら知らせてほしい（フロントは `src/mocks/fixtures/codes.js` と画面のカテゴリ名を直す）。④は #23 の回答で値が増えるなら、増えた値もここに入れてほしい | 注文照会 / 約定照会 / みずほ注文締 / 新規注文 / 操作ログ（いずれも検索・入力の選択肢） | 0 | 4 画面とも選択肢を `useCodesStore().optionsFor()` から引く形で実装済み。MSW の `/codes`（`src/mocks/fixtures/codes.js` の `PROPOSED_CODE_MASTERS`）が提案の形で返す。**実 API ではこの 4 つのプルダウンが空になる**（絞り込みなし・注文種別は既定の 0 のまま送る） | 依頼中 | 2026-10-01 |
| 11 | **手数料優遇マスタの要件**: モック自体が「設定内容は要件整理中」 | 手数料優遇マスタ | 4.0 | 着手しない | 要件待ち | 2026-09-17 |

## 契約提案: コードマスタに足す 4 カテゴリ（#28）

2026-10-01 にフロントが形を決め、MSW の `/codes` に先に入れた（写しは `src/mocks/fixtures/codes.js` の
`PROPOSED_CODE_MASTERS`）。形は既存の `codes.json` と同じ `{カテゴリ: {コード: 名称}}`。
コードは各 API がいま受け取っている値のままにしてあるので、API 側の変更は要らない。

```json
{
  "注文照会出来状況": {
    "000": "未出来",
    "003": "注文中",
    "010": "一部出来",
    "011": "全部出来",
    "034": "取消済（出来有・無）",
    "101": "注文エラー"
  },
  "約定出来状況": {
    "010": "一部出来",
    "011": "全部出来",
    "034": "取消済（出来有）"
  },
  "VWAP区分": {
    "0": "通常",
    "1": "VWAP"
  },
  "操作区分": {
    "CREATE": "登録",
    "UPDATE": "更新",
    "DELETE": "削除",
    "BATCH": "一括処理"
  }
}
```

- `注文照会出来状況` の取消済は `034` だけ、注文エラーは `101` だけで絞る（`status` はコードを 1 つしか受けない。
  `032` / `103` を拾えないのは #1 / #3 と同じ問題）
- `約定出来状況` の取消済（出来有）も `034` だけ。`032` も拾う指定のしかたは引き続き確認したい
- 画面は選択肢をコードの文字列順に並べる（`JSON.parse` は `"101"` のような整数に見えるキーを先頭へ並べ直すので、
  object のキーの並びには頼らない）。並びを指定したいなら、形を配列にするかどうかも含めて相談したい

## 契約提案: コンファメーション CSV の取込（#1 ②）

2026-09-28 にフロントが先に形を決め、MSW（`src/mocks/handlers/stalledOrders.js`）と
`src/api/stalledOrders.js` の `importConfirmationCsv` をこの形で実装した。バックエンドが同じ形で作れば
ハンドラを消すだけで切り替わる。違う形になるなら `src/api/` の変換だけを直す。

```text
POST /operations/stalled-orders/confirmation-import
Content-Type: multipart/form-data
  file: コンファメーション CSV（UTF-8。BOM の有無はどちらも可）

200 → 既存の CsvImportResponse をそのまま使う
  { success, total_count, success_count, error_count, errors: CsvImportErrorItem[], message }
  CsvImportErrorItem = { line_number, errors: string[], row_data: { order_id, ... } }
400 → 空ファイル・ヘッダ不一致・データ行なし（detail）
422 → file 欠落（FastAPI の検証エラー）
```

CSV の列は公開モックのサンプル実物のとおり:

```text
order_id,confirmation_ref,confirmation_status,filled_quantity,average_price,confirmed_at,message
6,TWS-20260904-0006,CANCELLED,0,0,2026-09-04 10:15:00,TWSで取消確認
```

| 論点 | 提案 | 理由 |
|---|---|---|
| パス | モックのとおり `/operations/stalled-orders/confirmation-import` | 一覧と同じ配下に置く |
| 項目名 | モックの `confirmation_file` ではなく `file` | 既存の `/masters/*/import-csv` と揃え、取込の部品を流用しやすくする |
| `confirmation_status` の値 | `FILLED`（約定）/ `CANCELLED`（取消）→ 滞留一覧から除外。`WORKING`（注文中）/ `PARTIALLY_FILLED`（一部約定）→ 注文中へ移す | モックのサンプルに出るのは `CANCELLED` だけ。**残りの値の体系を確認したい** |
| 行エラーの扱い | 1 行でも不備があれば **1 行も反映しない**（`success: false`・`success_count: 0`） | 直した CSV を丸ごと取り込み直せるようにするため（一部だけ反映されると、どの行を除いて再取込するかを人が判断することになる） |
| 行の不備の例 | 滞留一覧に無い注文 ID / 知らない `confirmation_status` / 同じ注文 ID の重複 | MSW が返すもの。文言はサーバが決めてよい（画面は `errors` をそのまま出す） |
| 成功の文言 | サーバが `message` で返す | 画面は `message` をそのまま出し、自前で組み立てない（障害管理と同じ方針） |

## 未使用の API / パラメータ（2026-09-25 棚卸し）

実装済み 13 画面が使う `src/api/`（43 関数）と `openapi.json`（117 パス / 147 オペレーション）を突き合わせた結果。
**バックエンドが優先度を下げてよい口**と、**フロントが既定値に頼っているクエリ**を 1 か所で見せるための表で、
取り込みのたびに更新するものではなく、画面の実装状況が変わったときに直す。
`/` の注文一覧は開発初期のサンプルで実装済み画面には数えない（`Orders` 系 API はフロントから 1 本も使っていない）。

契約テストが見る範囲（パス・クエリ名・fixture の型）に新しい食い違いは無い。本文の項目で 1 つだけ注記:
銘柄の `PUT /masters/symbols/{symbol_id}` は本文に `銘柄コード` を含めて送るが `SymbolUpdateRequest` に無い。
実 API は未知の項目を黙って捨てる（`validate` に未知項目を足して実測）ので無害。画面は銘柄コードを読み取り専用にしている。

**実装済み画面のパスにあるが使っていないオペレーション**（画面モックに導線が無い）:

| 画面 | 未使用のオペレーション |
|---|---|
| 顧客マスタ | `POST` / `GET {id}` / `PUT {id}` / `DELETE {id}` / `validate` / `{id}/history` / `export-csv` / `import-csv`（新規・編集は未実装。着手時に使う） |
| 銘柄マスタ | `GET {id}` / `{id}/history` / `export-csv` / `import-csv` |
| CA マスタ | `GET {id}` / `{id}/history` / `export-csv` / `import-csv` |
| 受注不可日マスタ | `GET {id}` / `{id}/history` / `export-csv` / `import-csv` |
| 海外休場日マスタ | `PUT {id}`（画面に行編集が無い）/ `GET {id}` / `{id}/history` / `export-csv` / `import-csv` |
| 残高マスタ | `validate` / `DELETE {id}` / `GET {id}` / `{id}/history` / `export-csv` / `import-csv` |
| スライス基準マスタ | `history` / `simulate` |
| 権限マスタ | `PUT {role_code}` / `history`（#4 の形合わせ後に使う） |
| 障害管理 | `history` の `target` / `offset`（直近 50 件固定） |

**実装済み画面で送っていないクエリ**（既定に頼っている・画面に条件が無い）:

| エンドポイント | 送っていないクエリ | 理由 |
|---|---|---|
| 6 マスタの一覧（顧客 / 銘柄 / CA / 受注不可日 / 海外休場日 / 残高） | `include_deleted` | 既定 false。取消済みを見せる導線が画面に無い |
| `GET /masters/symbols` | `ticker` / `symbol_name_ja` / `symbol_name_en` | 検索欄が 1 つで `symbol` に乗せる（#19） |
| `GET /masters/blackout-dates` | `blackout_date` | 期間指定（`start_date` / `end_date`）で足りる |
| `GET /market-status` | `date` | 当日しか見ない |
| `GET /operations/activity-logs` | `target_types` の複数指定 | セレクトが単一選択 |

**未実装画面のオペレーション**（未使用だが依頼対象ではない・参考。`GET /orders` を含む）:
Orders 13 / DreamStatus 3 / Customers・Balances・Closing 5 / MasterFx 9 / MasterFeePatterns 9 / MasterFeePreferences 9 /
Executions 2 / Calculations 1 / HoldingSearch 1 / MizuhoIntegration 4 / Batch 10 / Auth・MasterPermissions（users）3 / `/branches` `/handlers` 2。
`POST /calculations` の `CalculationResponse` は 2026-09-30 の取り込みで `外貨` / `円貨` のブロック形式に確定した
（旧 18 項目は削除）。フロントに使用箇所は無く、顧客詳細の仮計算タブはこの形で着手可能になった。

## 解消済み

| # | 依頼 | 解消日 | 備考 |
|---|---|---|---|
| 8 | `/masters/customers` の検索クエリ（`handler_code` / `restriction` / `account_type` / `corporate_type`） | 2026-09-30 | 4 つとも仕様に入った。フロントは先行して送っていたので変更なし。契約テストの `KNOWN_GAPS` の行を外した（`CON-07` が解消を検出していた） |
| 12 | `/market-status` のセッションコードの enum 宣言 | 2026-09-30 | `MarketState`（PRE / REGULAR / AFTER / BEFORE_OPEN / CLOSED）と `MarketSessionCode`（PRE / REGULAR / AFTER）が入った。`src/utils/apiEnums.js` に `MARKET_STATE` / `MARKET_SESSION_CODE` として写した（`AEN-01` が検出していた）。表示の判定は時刻比較のまま |
| 15 | 履歴の `変更前データ` / `変更後データ` / `差分データ` の型 | 2026-09-30 | `SuspensionHistoryItem` / `AnnouncementHistoryItem` とも `object`（または `null`）になり、description に中身のキーが書かれた。お知らせの fixture と MSW は JSON 文字列から object に直した（`CON-03` が検出していた）。2026-09-29 の実測では実 API が JSON 文字列で返していたので、`src/api/announcements.js` は両方を読むまま残す |
| 27 | CSV一括注文の事前検証の顧客名（`CsvOrderRowResult.customer_name`） | 2026-09-30 | `string \| null` で入った。フロントは先行して読んでいたので変更なし。`KNOWN_GAPS` の 3 行を外した |
| 1（一部） | 操作ログの項目 操作者名 / 実行者区分 / 対象機能 / 操作内容 | 2026-09-30 | `ActivityLogItem` に入った（結果 は未）。`KNOWN_GAPS` は 結果 だけにした。`src/api/activityLogs.js` はまだ読まず、画面に出し直す作業がフロントに残る |
| 9 | 銘柄更新で未送信項目（`市場名` / `前日出来高` / `Pre区分`）を保つか | 2026-09-25 | **保つ（実測）**。`PUT /masters/symbols/{symbol_id}` は部分更新（description「含めなかった項目は既存値を維持」）。ID 13 に `備考` と `更新日時` だけを送ったところ `市場名: NASDAQ` / `Pre区分: 0` はそのまま残った（直後に戻した）。`src/api/symbols.js` は 3 項目を送らないままでよい。MSW の PUT（`src/mocks/handlers/symbols.js`）は全項目を差し替える形のままで実 API と違うので、部分更新に寄せる作業がフロントに残る |
| 1（一部） | お知らせ管理の API（取得・更新・操作履歴・全画面バナー） | 2026-09-24 | タグ `Announcements` の 4 パス（`GET` / `PUT /operations/announcements`・`/history`・`GET /operations/banner`）が入った。パス・スキーマ・エラー応答（400 / 409）・description まで揃っており成熟度 `A`。未マージの画面ブランチの推測形（`{ お知らせ: … }` ラッパ・`お知らせ内容` ほか）は捨て、`feat/announcements-management` で実仕様に合わせて書き直した。**残る曖昧さは 2 点**: 履歴の `変更前データ` / `変更後データ` / `差分データ` の中身の型が無い（`anyOf: [{}, null]`。フロントは `{ 表示フラグ, 本文 }` を前提に読む）、本文 500 文字超は description では 400 だが `maxLength: 500` があるので実際は 422 になる見込み（実 API スモークで確かめる） |
| 1（一部） | 障害管理の API（照会・履歴・停止・再開） | 2026-09-24 | タグ `OrderSuspensions` の 4 パス（`GET /operations/order-suspensions`・`/history`・`POST /suspend`・`/resume`）が既に入っていた（未マージの画面ブランチは「API が無い」前提の創作パス `/operations/incidents` のままだった）。成熟度 `A`。`feat/order-suspension-control` で実仕様に合わせて書き直した。**画面は公開モックの「IB送信制御 / 注文入力制御」の 2 区画を捨て、仕様の停止対象（`ALL` + 注文ルート 5 種）の表にした**。IB送信 → `'1'`・注文入力 → `'ALL'` の対応づけは採らない（`ALL` は IB を含むので 2 つを独立に出すと実態とねじれる・みずほ / VWAP / 自己取引 / OTC の停止が画面に出ない・対応づけが契約テストで守れない）。残る問いは #14〜#16 |
| 4 | 権限マスタの形（仕様とモックのどちらを正とするか） | 2026-09-25 | 依頼ではなく**フロントが仕様に合わせた**。権限の列は仕様の 4 つ（発注 / マスタ更新 / 運用管理 / 全店参照）。モックの「操作ログ閲覧」「管理者機能」は仕様に保存先が無いので外した（要件として要るなら、改めて仕様側に足す依頼を起こす）。編集可否は一覧の応答に無いので `GET /auth/me` のロールが `supervisor` かで決める。変更履歴（`/masters/permissions/history`）の画面は作らない（モックが個別履歴を廃して横断の操作ログに寄せたため） |
| 13（一部） | 残高マスタの `売却不可区分`（一覧・切替） | 2026-09-25 | `BalanceAdjustmentItem` に `売却不可区分` が入り、専用の口 `PUT /masters/balance-adjustments/{balance_id}/sell-prohibited`（本文 `SellProhibitedUpdateRequest`: `売却不可区分` 必須・`更新日時` 任意）が足された。`HoldingItem` にも同じ項目が入った。**フロントは同日追随**: `src/api/balanceAdjustments.js` の `updateBalanceSellProhibited` が専用の口へ送り、汎用の PUT からは `売却不可区分` を外した。契約テストの `KNOWN_GAPS` の行も外した（`CON-07` が解消を検出していた） |
| — | 一覧レスポンスに `ID` を返す（`BlackoutDateItem` / `MarketHolidayItem` ほか全 `*Item`） | 2026-09-18 | 取り込み済み。行の特定（`data-testid`）が全マスタで可能になった |
| 10 | 再有効化で元の行の ID を引き継ぐか | 2026-09-18 | **引き継ぐ**（モックの挙動と一致）。海外休場日の実 API E2E `MR-04〜08` を通したあと実 DB を読んで確認した。1 回の実行で行は 1 行だけ（`ID` 固定・作成日時はそのまま・更新日時だけ進む）で、再有効化は**同じ行を生き返らせる**。受注不可日も同じ実装と見込む（未実測） |
| 5 | **PUT / DELETE のパスキーを ID に統一する** | 2026-09-18 | 顧客 `account_id` / 銘柄 `symbol_id` / 為替 `fx_id` / CA `ca_id` / 受注不可日 `blackout_date_id` / 海外休場日 `holiday_id` / 残高調整 `balance_id` / 手数料パターン `fee_pattern_id` / 手数料優遇 `fee_preference_id` の 9 種すべてが **integer の行 ID** になった。海外休場日は `fix/market-holidays-id-key` で追随済み（実 API E2E `MR-04〜08` の保留を解除）。受注不可日も `fix/blackout-dates-id-key` で追随済み（2026-09-25。実 API E2E `BDR-04〜06` / `08` / `09` の保留を解除。`BDR-07` の日付変更は別件の #18 で保留）。ロール権限 `role_code` / ユーザ `operator_code` の 2 つだけ業務コードのまま残り、削除の表現が #5 に残っている |
| — | 権限マスタのパス（`GET` / `PUT` / `history`） | 2026-09-18 | パスは入ったが形が違う。フロント側の追随が #4 に残っている |
| 6 | `/masters/symbols/validate` に変更対象を渡す手段 | 2026-09-18 | `symbol_id` が入った。`src/api/symbols.js` が送るようにし、モックも ID で対象を引く形に合わせた。銘柄コードを変える編集も作れる |
| 1-b | 操作ログの `操作区分` の値の体系 | 2026-09-24 | 依頼ではなく**フロントが仕様に合わせた**。画面の操作区分を CREATE / UPDATE / DELETE / BATCH（表示は 登録 / 更新 / 削除 / 一括処理）にし、検索条件・列も `ActivityLogItem` と `GET /operations/activity-logs` のクエリだけで組み直した。契約テストの `KNOWN_GAPS` は fixture の提案 5 項目（#1）だけが残る |
| 7 | `/masters/blackout-dates/validate` の変更対象 | 2026-09-18 | `blackout_date_id` が仕様に入り、先行実装のまま一致。`KNOWN_GAPS` の行を外した。他マスタも `<x>_id` で揃った（`account_id` / `fx_id` / `holiday_id` / `balance_id` / `fee_pattern_id` / `fee_preference_id`） |

**2026-09-18 の取り込みで黙って壊れかけた箇所**（契約テスト `CON-05` が検出し、同日追随済み）:
操作ログの期間クエリが `date_from` / `date_to` から `start_date` / `end_date` へ、操作区分が
`category` から `operation` へ改名されていた。旧名は無視されるだけで絞り込みが効かなくなる。

## 渡しかた

- バックエンド担当者に渡す**依頼書**は本表から起こす: [backend-request-2026-09-25.md](backend-request-2026-09-25.md)
  （未解消の行だけを区分 A〜D に並べ替え、各項目に回答欄を付けた版。番号は本表と同じ）。
  回答を受けたら本表の「状態」を更新し、依頼書は起票日付きで残す。
  2026-09-25 版以降の起票（#23）は [backend-request-2026-09-29.md](backend-request-2026-09-29.md) に分けた
- 依頼 1〜4 は **fixture の生の形**（`src/mocks/fixtures/<画面>.js`）をそのまま「こういう応答を返してほしい」の提案として添える。
  フロントはその形に対して実装・単体・MSW E2E を先に埋め、バックエンドが後から同じ形で実装すれば `src/api/` の変換だけで済む
- 依頼 1 の滞留注文抽出は (a) 新パス / (b) `GET /orders` の拡張 のどちらでもよい。(b) なら fixture は捨て、
  `src/api/stalledOrders.js` の変換だけを書き直す（store と画面は無変更）
- 依頼 19 / 20 は**実装済み画面が実 API で黙って失敗する**類なので、回答が「変えない」でもよいから 10/15 までにほしい
  （回答が無ければフロント側で回避する: 検索欄を分ける / Ticker を銘柄コードに引き直す）
- 依頼 5 のパスキーは ID に確定した（画面は `id` で行を指し、api 層がパスに載せるキーを選ぶ設計に
  してあったので、`src/api/` の外は触らずに済んだ）。ロール権限とユーザの削除は要件で「導線なし」と確定し、
  問い合わせは不要になった（2026-09-25）
