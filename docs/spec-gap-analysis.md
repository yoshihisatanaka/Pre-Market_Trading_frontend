# 仕様書 × モック × 実装 の三者照合

- 作成: 2026-10-14
- 仕様書: [specification.md](specification.md)（議事録 15 件からの逆引き仕様・2026-10-14）
- モック: `../premarket-order-202609`（`7ee3ad9`・2026-10-12）。パスは `python_app/` 起点
- 実装: `main`（2026-10-14）

**仕様とモックが一致していればそれが正**（実装を直す）。**仕様とモックが食い違う項目は何が正しいか判らない**ので
担当者に質問する（質問票は [spec-questions.md](spec-questions.md)）。この 2 群に分けて載せる。

前提:

- 対象は Ph.1。仕様書で【要確認】の項目は §14 の No. を添える
- フロントの責務でない章（§8 IB 連携、§9 Dream、§10 Access、§11 帳票、§13 インフラ）は判定しない
- 「実 API」は `docs/api/openapi.json`（2026-10-13 取り込み）

## A. 仕様＝モック≠実装（実装を直す対象・11 件）

| # | 項目 | 仕様（§） | モック（根拠） | 実装（根拠） | 備考 |
|---|---|---|---|---|---|
| A-1 | 初期画面 | 顧客検索がログイン後の初期画面（§6.1 画面 1） | `/` は `/customers/search` へ 302（`routers/auth.py:8-11`） | `/` は注文一覧（縦串の参考実装）（`src/router/index.js:14-19`） | 差し替え前提の参考実装が残っている |
| A-2 | 認証 | ONEGATE（Entra ID）（§7） | 署名付き Cookie の sub が Entra メールアドレス。非本番は `as_user`（`security.py:48-90`） | SSO 無し。`.env` の `VITE_USER_CODE` を `X-User-Code` に載せる暫定（`src/api/client.js:28-31`） | requests #79 |
| A-3 | 強制区分チェックの表示権限 | 承認権限者のみ強制可（§4.1） | `can_force_order` があるときだけ強制区分を表示。無いと「発注（強制）の権限がありません」（`templates/order_input.html:364`） | 強制区分チェックを発注権限者全員に表示（`src/components/orders/OrderEntryForm.vue:462-486`） | `GET /auth/me` に権限キーが無い。requests #75 |
| A-4 | 売却残数チェック（保有−注文中） | 画面でチェック（§3.6） | フロコン警告 `BALANCE_OVER`（`compliance/flocon_check.py:93-110`） | 画面無し。売りの初期数量に売却可能株数を入れるだけ（`src/utils/orderEntryQuery.js:18-20`） | 実 API が返すか未確認。requests #77 |
| A-5 | ハードリミット（3 倍・ワンショット 5,000 万） | ツール側でチェック（§3.7） | 警告 `ASSET_OVER` / `LARGE_TRADE`（`compliance/flocon_check.py:47-64,129-135`） | 画面無し。MSW の fixture にだけ「大口取引」（`src/mocks/fixtures/orderEntry.js:15-17`） | 同上。当日累計は仕様のみ（B2-7）。requests #77 |
| A-6 | 仮計算の初期値 | 前日終値・保有残数・為替を自動セット（§6.3） | 単価＝現在値か前日終値、数量＝売りのとき売却可能数量、為替＝現在レートを自動（`routers/calculations.py:116-133`） | 単価・数量・為替は空欄。為替はサーバ補完（`src/utils/calculationForm.js:63-91`） | フロントで閉じる |
| A-7 | CSV 一括注文の権限 | 本店限定（§3.9） | `can_csv_order` で表示・実行を判定（`routers/orders.py:48-51,812,843,881`） | ルート・メニューに権限指定無し（`src/router/index.js:84-88`） | `GET /auth/me` に権限キーが無い。requests #76 |
| A-8 | CSV 1 件エラーで全差戻し | 通過分のみ発注はしない（§3.9） | 1 件でもエラーなら受付不可。行ごとの強制は無い（`templates/order_csv_preview.html:41,110-121`） | NG 行があれば受付不可だが、`forceable` 行は行ごとに強制で通せる（`src/views/OrderCsvPreviewView.vue:26-29`） | 実 API の `forceable` に追随して緩めた。フロントで閉じる |
| A-9 | 銘柄の受付開始時刻（IPO 用） | 銘柄マスタに持つ（§3.12 / §5.5） | 「有効開始時間（日本時間）」列とフォーム項目（`templates/master_symbols.html:83,123-178`） | 無し | API に項目が無い。requests #40 に追記 |
| A-10 | 手数料優遇マスタの編集 | 外債売買システムから自動連携。画面は表示（§5.7） | 表示だけ。「要件確定後に登録・編集を追加」（`templates/master_fee_preferences.html:10-11,36`） | 追加・編集・削除まで持つ（`src/views/FeePreferenceListView.vue:410`） | requests #11 の回答で実 API は登録・変更を持つ。自動連携なら画面の編集は不要 |
| A-11 | 緊急停止の 2 パターン | ①入力不可 ②入力可だが IB へ送らない（§12.2） | 「IB送信制御」と「注文入力制御」の 2 区画（`templates/operation_incident_management.html:54,65-76`） | 停止対象 ALL ＋ ルート別の停止・再開（`src/views/IncidentManagementView.vue:49-52,196-226`） | 実 API の形に合わせてモックの 2 区画を捨てた。requests #78 |

## B. 仕様≠モック（担当者に質問する対象）

### B-1. モック＝実装≠仕様（実装はモックに従った・39 件）

| # | 項目 | 仕様（§） | モック＝実装 | 備考 |
|---|---|---|---|---|
| B1-1 | VWAP 特殊権限ユーザー登録 | 画面 21。高権限者 3 名程度のみ発注可（§3.10 / §6.1） | 画面も権限キーも無い。VWAP トグルは全員に表示（`templates/order_input.html:353`） | |
| B1-2 | 注文受付締め（20:00 締めボタン・延長） | 画面 26。締めボタンで開閉（§2.2 / §6.1） | モックに無い。実装も無し | 実 API には `/closing/ib` `/masters/schedule-times` がある |
| B1-3 | 注文訂正 | Ph.1 は入力と取消のみ。訂正の機能も文言も設けない（§3.4） | 「訂正」ボタンと訂正画面「外株注文訂正」（`templates/order_amend.html:2-3,46`） | モックは Dream登録待ちのみ訂正可、実装は 000/003/010 |
| B1-4 | 顧客詳細のタブ | 外貨預り／注文入力／約定照会／仮計算（§6.1 画面 3） | 外株預り／注文入力／注文照会／仮計算（`templates/customer_summary.html:252-256`） | |
| B1-5 | ユーザ管理マスタ | 画面一覧に無い。ID/PW は本システムで管理しない（§7） | Entra ID にロールと有効／無効を割り当てる画面（`templates/master_users.html:4,34-35`） | ID/PW は持たないので矛盾は弱い |
| B1-6 | 仮計算マスタ | 画面一覧に無い。スプレッドは標準（§6.3） | `/masters/provisional-calculation` でスプレッド・税率等を編集 | |
| B1-7 | 市場区分「プレのみ」 | 本店は 3 択。プレのみは採用未決（§3.2・No.2） | 「プレ＋レギュラー」「レギュラー」の 2 択（`validators/order_validator.py:10-18`） | 実 API も 2026-10-02 に '01' を外した |
| B1-8 | アフター含む区分の表示 | Ph.1 スコープ外（§1.4） | disabled で「Ph.2予定」表示（`templates/order_input.html:349`） | 軽微 |
| B1-9 | プレ含む注文の期間指定 | 当日限り（§3.2 / §3.3。No.3 で未整合） | 区分に関係なく「当日中〜14 営業日後」（`routers/orders.py:66-80`） | 仕様内でも §3.2 末尾と矛盾 |
| B1-10 | みずほ銘柄のプレ不可・期間指定不可 | 画面で制御（§3.11） | 制御無し。注文の預託先は IB 固定（`routers/orders.py:397,447`） | |
| B1-11 | フロコンの段階 | 3 段階（§4.1） | errors と warnings の 2 段階（`compliance/flocon_check.py:8-12`） | 実 API も errors / warnings |
| B1-12 | 継続中注文の冗長承認 | 「継続中ですが、それでも発注しますか」（§3.6） | 無し | |
| B1-13 | スライス対象のアラート | 「アラートを上げる作りも可能」（§3.8） | 入力・確認にアラート無し。照会で「自動分割 N件」のみ | 仕様も任意表現 |
| B1-14 | 18:00 判断期限の表示 | 画面に表示（§2.2） | 無し | |
| B1-15 | 円貨概算金額 | 注文入力時に表示（§5.6） | 確認画面のみ（`templates/_order_readback.html:39-43`） | |
| B1-16 | 入力項目の多さ | プルダウンを極力減らす（§6.5） | 決済通貨／預り売買／勧誘／資金性格／受注方法／注文チャネル／受注日時／受注者（`templates/order_input.html:345-364`） | |
| B1-17 | 事故処理口座（666）・同業口座 | フロコン無視で発注可（§3.1） | 特別扱い無し | |
| B1-18 | 失敗理由の見せ方 | ポップアップ（§6.2） | `title` ホバー（`templates/order_inquiry.html:123`） | |
| B1-19 | 失敗件数の見せ方 | 画面内にボタン表示（§6.2） | サイドバーの赤バッジ（`templates/base.html:229`） | |
| B1-20 | 注文照会の絞り込み | スライス済み／マルチ等のフィルタ（§3.8） | 部店／口座／銘柄／出来状況 の 4 条件（`templates/order_inquiry.html:55-79`） | |
| B1-21 | 手動ステータス強制上書き | TWS 手発注分を手動で上書き（§8.3 / §12.2） | Dream 登録状況の STS変更と、滞留注文の CSV 取込のみ | |
| B1-22 | 「為替は参考値」の明示 | 参考値と明示（§6.4） | 約定照会に注記無し | |
| B1-23 | IFA の担当顧客絞込 | 担当顧客で絞込（§6.1 画面 8） | 無し（`routers/executions.py:134`） | |
| B1-24 | 約定照会の「不出来」 | 「出来・不出来」（§6.4。§6.1 は「約定済みのみ」で仕様内矛盾） | 全部出来／一部出来／取消済（出来有）（`templates/execution_management.html:100-106`） | 仕様の矛盾を戻す |
| B1-25 | オーダーシート作成の場所 | 約定照会で抽出→作成（§6.1 画面 8） | みずほ注文締画面の「注文ファイル作成」（`templates/execution_management.html:13,49-58`） | 配置の差 |
| B1-26 | Dream STS変更・みずほ締めの権限 | 本店のみ（§6.1 画面 7 / 10） | 権限条件無し（`routers/orders.py:313-333`、`routers/executions.py:218-240`） | |
| B1-27 | 顧客マスタ編集の範囲 | フロコン項目に限定。氏名・住所は対象外（§5.4） | 全項目を編集可（`templates/partials/customer_master_form.html:5-24`） | |
| B1-28 | 顧客詳細の「前日の資産状況」 | 表示項目にある（§5.4） | 無し（`templates/customer_summary.html:243-247`） | 非課税枠は「成長投資枠」、外貨預りは「USD預り金」 |
| B1-29 | 銘柄マスタの Primary Exchange | 保持属性（§5.5） | 無し | |
| B1-30 | 銘柄ファイル取込 | ユニバース・VWAP 取扱銘柄（§5.5） | 取込ボタン無し（`templates/master_symbols.html:8-15`） | 実 API に `import-csv` はある |
| B1-31 | スライス有効／無効 | 将来無効化できること（§3.8・No.9） | スイッチ無し（`templates/master_hard_limits.html:14-16`） | requests #43 |
| B1-32 | CA マスタのみんかぶ取込 | ファイル取込（§5.3） | 手入力 CRUD のみ（`templates/master_ca.html:8,77-78`） | 実 API に `import-csv` はある |
| B1-33 | 残高マスタの CSV アップロード | ダイレクト入庫ファイルを取込（§5.2） | 無し（`templates/master_balance_adjustments.html:99,119`） | 実 API に `/operations/balance-transfers` はある |
| B1-34 | 売却不可のグレーアウト | 預り明細でグレーアウト（§5.2） | 「売り」ボタンだけ disabled（`templates/customer_summary.html:106,338`） | 軽微 |
| B1-35 | 権限の区分 | Entra ID の区分を 1〜9 に変換（§7） | ifa／sales／manager／supervisor の 4 ロール（`mock_data/masters.py:30-35`） | |
| B1-36 | 緊急停止の操作者 | 最高権限者のみ（§12.2） | 運用・障害管理権限（`routers/operations.py:41-44`）。実装は `operation` | |
| B1-37 | 受注抑止中の案内 | コールセンターへの電話案内（§12.2） | 「注文受付を停止しています」のみ（`mock_data/operations.py:17-19`） | |
| B1-38 | セッション表示の文言 | クローズ／プレ／レギュラー／アフター（§6.1 画面 1） | Pre-Market／Regular／After-Hours／Closed（`main.py:29-66`） | 軽微 |
| B1-39 | 売り遷移時の数量 | 全数量（§3.3） | 売却可能株数 | §3.6 と整合するので実装側が妥当。軽微 |

### B-2. 三者とも違う（7 件）

| # | 項目 | 仕様 | モック | 実装 | 備考 |
|---|---|---|---|---|---|
| B2-1 | 必須欠落時の送信ボタン | 押下不可（§3.3） | 主要 7 欄に HTML `required`（`templates/order_input.html:345-356,369`） | 押せる。押下後に項目ごとのエラー表示（`src/components/orders/OrderEntryForm.vue:488-497`） | 送信されない点は同じ。見せ方の差 |
| B2-2 | 買付重複アラート | 同一顧客・同一銘柄の買付があればアラート（§3.6） | 無し | 実 API が売買とも errors で返し、重複確認区分=1 で warnings（`src/api/orderEntry.js:10-12,92-95`） | requests #80 |
| B2-3 | 受付時間外・属性ロック・口座ロック・取引可否 | 送信時に即時エラー（§3.3） | 受注不可日はエラー。取引停止は警告。禁止銘柄の判定は未定義で発火しない。ロック系は無し | 画面判定無し。実 API の errors / warnings を表示 | エラーか警告かが揃っていない |
| B2-4 | 注文ステータスの名称 | 受注済み→市場執行待ち→執行中→約定…（§8.3） | Dream登録待ち／発注済／未出来／注文中／…（`mock_data/orders.py:946-953`） | 実 API の 18 種をそのまま表示（`src/utils/orderTypes.js:47-66`） | 「市場執行待ち」に当たる名前がどこにも無い |
| B2-5 | 取消後の一覧表示 | 元注文が「取消済み」、新規注文が下に並ぶ（§3.4） | 同じ行を「取消済」に書き換え、`?status=取消済` で一覧へ（`mock_data/orders.py:1031,1252-1265`） | 取消画面内で完了表示。`sort` 未送信（`src/views/OrderCancelView.vue:25-27`） | |
| B2-6 | 権限マスタの権限項目 | 発注可／参照のみ／マスタ更新可（§7） | 8 列（参照／発注／発注（強制）／CSV一括発注／マスタ更新／運用・障害管理／操作ログ閲覧／ユーザ管理）（`templates/master_permissions.html:27`） | 4 つ（発注／マスタ更新／運用管理／全店参照）（`src/utils/permissionTypes.js:27-52`） | requests #75 / #76 |
| B2-7 | ハードリミットの当日累計 | 当日合計 5,000 万超もチェック（§3.7） | 無し | 無し | §14 No.8。requests #77 |

## C. 仕様が要確認で保留のもの

| §14 No. | 項目 | 関連 |
|---|---|---|
| 2 | プレのみの実現方式と採用可否 | B1-7 |
| 3 | プレを含む注文の期間指定 | B1-9 |
| 8 | ハードリミット超過時の運用・集計単位 | A-5 / B2-7 |
| 9 | スライス機能の有効化 | B1-31 |
| 18 | ティッカー入力 | 実装済み（ティッカー／銘柄コード両対応） |
| — | §5.5 受付開始時刻の保持方式 | A-9 |

## D. 件数

| 群 | 件数 | 扱い |
|---|---|---|
| A. 仕様＝モック≠実装 | 11 | 実装を直す。うち 7 件は API の契約に関わる（requests #40 / #75〜#79） |
| B-1. モック＝実装≠仕様 | 39 | 担当者に「仕様書とモックのどちらが正か」を質問（spec-questions.md） |
| B-2. 三者とも違う | 7 | 担当者に正を決めてもらう（同上。B2-2 は requests #80） |

仕様書自体の矛盾 2 点（§6.1 と §6.4 の「不出来」、§3.2 末尾と §3.3 の期間指定）は仕様書の作成者へ戻す（spec-questions.md の末尾）。

## E. フロントで閉じる実装タスク（A 群のうち 4 件）

いずれも `src/` を触るので worktree を切り、3 軸（実装 / UnitTest / E2E(MSW)）を揃えて main へマージする。

| タスク | 対象 | 変更の要点 | ブランチ案 |
|---|---|---|---|
| A-1 初期画面を顧客検索にする | `src/router/index.js`、`src/views/OrderListView.vue` と `OL` / `OLV` / `OST` のテスト、`docs/e2e/layout.md` | `/` を `customer-search` へ redirect。注文一覧は参考実装なので view と spec ごと外す（`docs/progress.md` の「対象外の画面」からも消す）。レイアウトの E2E で `/` の見出しを「顧客検索」に直す | `feat/home-customer-search` |
| A-6 仮計算の初期値 | `src/views/CustomerCalculationView.vue`、`src/utils/calculationForm.js`、`src/utils/calculationQuery.js`、`docs/unit/utils-calculation-form.md`、`docs/unit/views-customer-calculation-view.md`、`docs/e2e/customer-detail.md` | 預り明細・預り検索からの遷移で、単価に `GET /holdings` の現在値（無ければ銘柄マスタの前日終値）、売りなら数量に売却可能株数、為替に `GET /masters/fx/latest` を入れる。顧客詳細タブ直開きは銘柄が無いので空のまま。手修正可は維持 | `feat/calculation-defaults` |
| A-8 CSV の行ごと強制を外す | `src/views/OrderCsvPreviewView.vue`、`src/stores/orderCsv.js`、`src/api/orderCsv.js`、`docs/e2e/order-csv.md`（`OCP`）、`docs/unit/views-order-csv-preview-view.md`、`docs/unit/stores-order-csv.md` | `forceable` の行も NG として扱い、全行解消まで受付不可にする。`forceable` の読み取りは残す（将来の切り替え用）。**着手前に requests #58（CSV の強制区分の列）の回答を見る**。列が仕様に残るなら「取込前に CSV 側で強制区分を立て直す」運用になり、画面の行ごと強制は不要 | `fix/csv-no-row-force` |
| A-10 手数料優遇マスタを表示のみにする | `src/views/FeePreferenceListView.vue`、`docs/e2e/fee-preferences.md`（`FP`）、`docs/unit/views-fee-preference-list-view.md` | 追加・編集・削除の導線を外し、一覧・検索だけにする。api 層の関数は残す。**着手前に A-10 の質問（spec-questions.md Q-A10）の回答を待つ**。実 API（#11）は登録・変更を持つので、自動連携でも手修正を許す判断がありうる | `refactor/fee-preference-readonly` |

A-8 と A-10 は回答待ちを置く。A-1 と A-6 は回答に依らず着手できる。
