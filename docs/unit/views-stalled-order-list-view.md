# views/StalledOrderListView（滞留注文抽出画面）

- 略号: `SOV`
- 対象: `src/views/StalledOrderListView.vue`
- テスト: `src/views/StalledOrderListView.spec.js`
- E2E 側のシナリオ: [docs/e2e/stalled-orders.md](../e2e/stalled-orders.md)

実際の Pinia ストア + vue-router + MSW(node) を通して、**一覧 2 本それぞれの 4 状態**と
「検索条件は URL クエリが正」の単方向フローを守る。ページャは無い。

CSV の出力とサンプル 2 種はサーバを通さず、画面が組み立ててダウンロードさせる
（列と値の変換は `utils/stalledOrderCsv.js`、書式は `utils/csv.js`）。jsdom は `URL.createObjectURL` を
持たないので、`@/utils/download` を `vi.mock` して `downloadCsv(ファイル名, 本文)` の引数を見る。
本文の書式は [utils-stalled-order-csv.md](utils-stalled-order-csv.md) と [utils-csv.md](utils-csv.md) が持つ。

コンファメーション CSV の取込は契約提案の API に送り、既定の MSW ハンドラが本文を読んで一覧を
書き換える（成功 / 行エラー / 400 の 3 通りは既定モックのまま出せる）。
**jsdom の FormData は MSW(node) を通らない**（[api-stalled-orders.md](api-stalled-orders.md) の前書き）ので、
テストの間だけ `FormData` を Node の実装に差し替える。ただし画面では File が `FileDropZone` の
v-model（prop の型が jsdom の `File`）を通るため、jsdom の `File` を継承したテスト用のファイルを選ばせ、
差し替えた FormData の `append` で同じ中身の Node の File に詰め替える。ファイルの選択は
`FileDropZone` の中の `input[type="file"]` に `files` を生やして `change` を起こす。

分担は次のとおり。

| 論点 | E2E | 単体 | 理由 |
|---|---|---|---|
| 検索の URL 同期 | SO-04 / SO-05 / SO-06 | SOV-05 / SOV-06 / SOV-07 | 実ブラウザの履歴まで見るのは E2E、条件の受け渡しは単体 |
| ローディングの過渡状態 | SO-09 | SOV-01 | 実ブラウザでは `mockDelay` 頼みで、応答を握れるのは単体だけ |
| 取込の応答待ち | — | SOV-19 / SOV-20 / SOV-25 / SOV-26 | 応答を握れるのは単体だけ |

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOV-01 | 応答がまだ返っていない | マウントする | 2 つのカードに読み込み中の表示が出て、表は出ない | 実装済 |
| SOV-02 | 既定モック | マウントして応答を待つ | 注文エラーが 3 件・注文中が 2 件になり、注文エラーの 1 行目に MSFT / 買 / 成行 / 注文エラー が出る | 実装済 |
| SOV-03 | API が 500（`message` 付き）を返す | マウントして応答を待つ | 2 つのカードの両方にその message と「再試行」ボタンが出て、表は出ない | 実装済 |
| SOV-04 | API が 500 を返す | マウントして応答を待つ | 説明文・手動運用フロー・検索カードは残る（4 状態の外に置いてある） | 実装済 |
| SOV-05 | 既定モック | 部店コードに `123` を入れて「検索」を押す | URL に `branch_code=123` が載り、注文エラーが 2 件・注文中が 0 件になる | 実装済 |
| SOV-06 | `?branch_code=123` で開く | マウントして応答を待つ | 部店コードの入力欄に `123` が入った状態で描画される | 実装済 |
| SOV-07 | `?branch_code=123` で開いた状態 | 「クリア」を押す | URL からクエリが消え、件数が 3 件 / 2 件に戻る | 実装済 |
| SOV-08 | 両方 0 件を返す | マウントして応答を待つ | 2 つのカードにそれぞれの空の文言が出る | 実装済 |
| SOV-09 | 既定モック（`/auth/me` は全権限ありの supervisorOperator） | マウントして応答を待つ | バッジ「操作可能」と CSV のボタン 3 つが出る | 実装済 |
| SOV-10 | ファイルを選んでいない | マウントする | 「取込して注文照会へ反映」が押せない | 実装済 |
| SOV-12 | 既定モック | 「別システム発注CSVサンプル」を click | `downloadCsv` が `tws_upload_sample.csv` と `buildTwsOrderSampleCsv()` の本文で呼ばれる | 実装済 |
| SOV-13 | 既定モック | 「コンファメーションCSVサンプル」を click | `downloadCsv` が `tws_confirmation_sample.csv` と `buildConfirmationSampleCsv()` の本文で呼ばれる | 実装済 |
| SOV-14 | 既定モック | 「注文エラーをCSV出力」を click | `downloadCsv` が `tws_stalled_orders.csv` で 1 回呼ばれ、本文は発注 CSV のヘッダに続いて画面の注文エラーの行（注文 ID が画面の並びどおり）になる | 実装済 |
| SOV-15 | `?branch_code=123` で開く | 「注文エラーをCSV出力」を click | 本文のデータ行が画面の検索結果と同じ 2 行（注文 ID 26 と 5）だけになる | 実装済 |
| SOV-16 | 一覧の応答がまだ返っていない | マウントする | 「注文エラーをCSV出力」が押せない | 実装済 |
| SOV-17 | API が 500 を返す | マウントして応答を待つ | 「注文エラーをCSV出力」が押せない | 実装済 |
| SOV-18 | 注文エラー 0 件・注文中 2 件を返す | マウントして応答を待つ | 「注文エラーをCSV出力」が押せない | 実装済 |
| SOV-19 | 既定モック・ファイルを選んだ状態・取込の応答を握る | 「取込して注文照会へ反映」を click | 応答待ちの間は「注文エラーをCSV出力」が押せない | 実装済 |
| SOV-20 | 既定モック・ファイルを選んだ状態・取込の応答を握る | 「取込して注文照会へ反映」を click | 応答待ちの間は取込ボタンが押せず、文言が「取込中…」になる | 実装済 |
| SOV-21 | 既定モック | 注文 ID 27 を `FILLED`・26 を `WORKING` にしたコンファメーション CSV を選んで取込む | `stalled-orders-import-notice` に「コンファメーションを 2 件取り込みました（約定・取消で除外 1 件 / 注文中 1 件）。」が出て、注文エラーが 1 件（#5）・注文中が 3 件（#28 / #26 / #6 の順）になる。ファイルの選択が外れ（ドロップ領域が既定の案内文に戻る）、取込ボタンが押せなくなる | 実装済 |
| SOV-22 | 既定モック | 滞留一覧に無い注文 ID（999）の CSV を選んで取込む | `stalled-orders-import-errors`（warning の帯）に「1 行にエラーがあるため、取り込みませんでした。CSV を直して取り込み直してください。」と行エラーの表（行 2 / 注文ID 999 / 「注文ID「999」は滞留注文にありません。」）が出る。一覧は 3 件 / 2 件のまま、ファイルは選ばれたままで取込ボタンは押せる | 実装済 |
| SOV-23 | 既定モック | ヘッダの違う CSV を選んで取込む（モックが 400 で拒否する） | `stalled-orders-import-error` にヘッダ違いの理由が出て、成功・行エラーの帯は出ない。ファイルは選ばれたまま、一覧は 3 件のまま | 実装済 |
| SOV-24 | 取込が 500（`detail` 付き） | CSV を選んで取込む | `stalled-orders-import-error` にその `detail` が出て、ファイルは選ばれたままで取込ボタンは押せる | 実装済 |
| SOV-25 | SOV-22 の行エラーが出ている・次の取込の応答を握る | 取込ボタンをもう一度 click | 応答待ちの間に前回の行エラーの帯が消え、成功の帯も出ない | 実装済 |
| SOV-26 | 1 回目の取込が 500 でエラーが出ている・次の取込の応答を握る | 取込ボタンをもう一度 click | 応答待ちの間に前回のエラーが消える | 実装済 |
