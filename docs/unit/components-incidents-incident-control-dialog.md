# components/incidents/IncidentControlDialog（発注停止・再開の確認ダイアログ）

- 略号: `IND`
- 対象: `src/components/incidents/IncidentControlDialog.vue`
- テスト: `src/components/incidents/IncidentControlDialog.spec.js`
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

`BaseModal size="sm"` を包んだ確認ダイアログ。開閉は呼び出し側が `open` で持つ
（`src/components/masters/ConfirmDeleteDialog.vue` と同じ）。この部品が持つ状態は
**入力中の停止理由と、その未入力エラーだけ**で、開くたびに空へ戻す。

**文言はこの部品が持つ**（`mode` と `target` から見出し / 本文 / ボタン名を決める）。画面から流し込むと、
期待値が画面のシナリオと部品のシナリオに散る。

エラーの出し先は 2 系統。未入力は停止理由の欄の下（`confirm` を emit しない）、
サーバの拒否・通信障害は `error` prop をダイアログ先頭に出す。どちらもダイアログは開いたまま。

**欠番: `IND-04` / `IND-05`**（旧「次段で実装します」の注意書きと「制御する が押せない」。
期待結果が反転したので削除した。番号は再利用しない）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| IND-01 | `open=false` | マウントする | 何も描画されない | 実装済 |
| IND-02 | `open=true` / `mode='suspend'` / 対象が IB | マウントする | 見出し「発注停止の確認」、本文に「IB」、停止理由の入力欄（必須）が表示される。全ルート停止の警告は出ない | 実装済 |
| IND-03 | `open=true` / `mode='suspend'` / 対象が全体（`ALL`） | マウントする | 警告「全ルートの発注が止まり、注文の新規受付・取消も停止します。」が表示される | 実装済 |
| IND-06 | `open=true` | 「キャンセル」を click | `close` が emit される | 実装済 |
| IND-07 | `open=true` / `mode=null` / `target=null` | マウントする | 例外を投げずに描画される（閉じる途中の props でも壊れない） | 実装済 |
| IND-08 | IND-02 の状態 | 停止理由に「IB回線障害」を入力して「停止する」を click | `confirm` が `{ reason: 'IB回線障害' }` で 1 回 emit される | 実装済 |
| IND-09 | IND-02 の状態 | 停止理由を空（または空白だけ）のまま「停止する」を click | 「停止理由を入力してください。」が出て、`confirm` は emit されない | 実装済 |
| IND-10 | IND-09 の状態 | 一度 `open=false` にしてから `open=true` に戻す | 入力欄が空に戻り、未入力のエラーも消えている | 実装済 |
| IND-11 | `pending=true` | マウントする | 主ボタンの文言が「停止中…」になり押せない。「キャンセル」も押せない | 実装済 |
| IND-12 | `pending=true` | モーダルが close を発火する（Esc など） | `close` は emit されない | 実装済 |
| IND-13 | `error` に `ApiError`（message「IBはすでに停止中です。」） | マウントする | ダイアログ先頭にその文言が表示される | 実装済 |
| IND-14 | 停止理由の入力欄 | 属性を見る | `maxlength` が 200 | 実装済 |
| IND-15 | `open=true` / `mode='resume'` / 対象が停止中の IB（理由「IB回線障害」） | マウントする | 見出し「発注再開の確認」、本文に「IB」、停止理由・停止日時・停止者が読み取り専用で表示される。停止理由の入力欄と全ルート停止の警告は出ない | 実装済 |
| IND-16 | IND-15 の状態 | 「再開する」を click | `confirm` が `{ reason: null }` で 1 回 emit される（入力が無くても止めない） | 実装済 |
| IND-17 | `mode='resume'` / `pending=true` | マウントする | 主ボタンの文言が「再開中…」になり押せない | 実装済 |
