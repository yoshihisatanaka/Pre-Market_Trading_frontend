# components/orders/DreamStatusChangeDialog（STS変更の確認ダイアログ）

- 略号: `DSD`
- 対象: `src/components/orders/DreamStatusChangeDialog.vue`
- テスト: `src/components/orders/DreamStatusChangeDialog.spec.js`

一覧の行のプルダウンで遷移先を選ぶと開く確認ダイアログ。入出力は props（`open` / `order` / `targetStatus` /
`pending` / `error`）と `close` / `confirm` の emit だけに絞る（送信そのものは画面とストアの仕事）。
BaseModal の Teleport を `global: { stubs: { teleport: true } }` で wrapper 内に描かせる。

受付番号欄は「登録済（`'2'`）へ変える」かつ「受注番号が未設定」のときだけ出す（DSD-03〜05）。
「変更する」で `confirm` に `{ status, receiptNumber, reason }` を載せる。`receiptNumber` は欄が出ているときだけ
入力値で、出ていなければ `''`（DSD-07 / DSD-13）。欄が出ていて空のままなら欄の下にエラーを出して emit しない（DSD-14）。
`pending` 中はボタンと入力を止め、閉じる操作も emit しない（DSD-15 / DSD-16）。
`error`（サーバに弾かれた理由）はダイアログの先頭に message を出す（DSD-17）。

`order` は store の items の 1 行（アプリ内モデル）。component から api 層は import できないので、
テストはフィクスチャ（生の形）から組み立てる。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| DSD-01 | `open: false` | マウントする | ダイアログを描画しない | 実装済 |
| DSD-02 | 登録失敗の行・遷移先 `'0'` | マウントする | 見出しが「Dream状況を変更しますか？」。対象の表に 注文ID（`#` 前置）/ 顧客（口座番号と顧客名）/ 銘柄（Ticker と売買・数量）/ 現在の状況 / 変更後（遷移先の説明付きの名前）が出る | 実装済 |
| DSD-03 | 受注番号なしの行・遷移先 `'2'` | マウントする | 必須の「Dream受付番号」欄が出る | 実装済 |
| DSD-04 | 受注番号ありの行・遷移先 `'2'` | マウントする | 受付番号欄は出ない | 実装済 |
| DSD-05 | 受注番号なしの行・遷移先 `'0'` / `'8'` / `'C2'` | マウントする | どの遷移先でも受付番号欄は出ない | 実装済 |
| DSD-06 | 登録失敗の行・遷移先 `'0'`・`error: null` | マウントする | 変更理由の入力欄が出る。エラー表示と、送信が未接続である旨の案内は出ない | 実装済 |
| DSD-07 | 受付番号欄の出る条件で受付番号と理由を入力済み | 「変更する」を click | 主ボタンは押せる状態で、`confirm` を 1 回 emit し、payload が `{ status: '2', receiptNumber: 入力値, reason: 入力値 }`。`close` は emit しない | 実装済 |
| DSD-08 | 開いた状態 | 「キャンセル」を click | `close` を 1 回 emit する | 実装済 |
| DSD-09 | 開いた状態 | モーダルが閉じる操作（Esc / オーバーレイ）を伝える | `close` を emit する | 実装済 |
| DSD-10 | 受付番号と理由を入力済み | 閉じて開き直す | 受付番号と理由が空に戻る（前回の入力を別の行へ持ち越さない） | 実装済 |
| DSD-11 | `order: null` | 開いた状態でマウントする | 例外にならず、対象の表は空で描画される | 実装済 |
| DSD-12 | 遷移先が行の遷移先一覧に無いコード | マウントする | 変更後にコードがそのまま出る | 実装済 |
| DSD-13 | 受付番号欄が出ない遷移先（受注番号なしの行の `'0'` / 受注番号ありの行の `'2'`）で理由を入力 | 「変更する」を click | `confirm` の payload の `receiptNumber` が `''`、`status` が遷移先、`reason` が入力値 | 実装済 |
| DSD-14 | 受付番号欄の出る条件で、受付番号が空 / 空白だけ | 「変更する」を click | 受付番号欄の下に「Dream受付番号を入力してください。」が出て、`confirm` を emit しない | 実装済 |
| DSD-15 | `pending: true`（受付番号欄の出る条件） | マウントする | 主ボタンの文言が「変更中…」で、主ボタン・キャンセル・受付番号・理由の入力がどれも disabled | 実装済 |
| DSD-16 | `pending: true` | 「変更する」「キャンセル」の click・Esc・オーバーレイのクリック | `confirm` も `close` も emit しない | 実装済 |
| DSD-17 | `error` にサーバの理由を持つエラー | マウントする | ダイアログの先頭のエラー表示に message が出る | 実装済 |
| DSD-18 | DSD-14 の状態（受付番号欄にエラー） | 閉じて開き直す | 欄のエラーが消える | 実装済 |
