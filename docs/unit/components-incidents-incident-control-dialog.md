# components/incidents/IncidentControlDialog（障害制御の確認ダイアログ）

- 略号: `IND`
- 対象: `src/components/incidents/IncidentControlDialog.vue`
- テスト: `src/components/incidents/IncidentControlDialog.spec.js`（未作成）
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

`BaseModal size="sm"` を包んだ確認ダイアログ。`src/components/masters/ConfirmDeleteDialog.vue` と同じく
**状態は持たず**、開閉は呼び出し側が `open` で持つ。

**文言はこの部品が持つ**（`intent` → 見出し / 本文 / ボタン名の対応表）。画面から流し込むと、
期待値が画面のシナリオと部品のシナリオに散る。

**主ボタン「制御する」は常に押せない。** 状態遷移が未実装のため。押せるのに何も起きないボタンにすると
「押しても何も起きないこと」をテストが守ってしまい、次段で確実に嘘になる。実装する段で `disabled` を外し、
`confirm` イベントと `pending` / `error` props を足す。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| IND-01 | `open=false` | マウントする | 何も描画されない | 未着手 |
| IND-02 | `open=true` / `intent='ib-send'` | マウントする | 見出し「IB送信制御の確認」と、IB送信の説明文が表示される | 未着手 |
| IND-03 | `open=true` / `intent='order-entry'` | マウントする | 見出し「注文入力制御の確認」と、注文入力の説明文が表示される（IB送信の文言は出ない） | 未着手 |
| IND-04 | `open=true` / いずれの intent | マウントする | 注意書き「実際の状態遷移は次段で実装します。この確認では運用状態は変わりません。」が表示される | 未着手 |
| IND-05 | `open=true` | マウントする | 「制御する」ボタンが押せない状態で表示される | 未着手 |
| IND-06 | `open=true` | 「キャンセル」を click | `close` が emit される | 未着手 |
| IND-07 | `open=true` / `intent=null` | マウントする | 既定の見出しが出るだけで、どちらの制御の説明文も出ない（intent 未指定でも壊れない） | 未着手 |
