# components/operations/StalledOrderListCard（滞留注文の一覧カード）

- 略号: `SOC`
- 対象: `src/components/operations/StalledOrderListCard.vue`
- テスト: `src/components/operations/StalledOrderListCard.spec.js`（未実装）

件数の表示と「ローディング / エラー / 空 / データあり」の 4 状態の出し分けだけを持つ器。
`MasterListCard` と違いページャを持たない。props と slot の入出力だけを見る
（滞留注文そのものの知識は持たせない）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOC-01 | `loading` が true | マウントする | 読み込み中の表示が出て、件数も既定スロットも描かれない | 未着手 |
| SOC-02 | `error` にメッセージがある | マウントする | その message と「再試行」ボタンが出て、既定スロットは描かれない | 未着手 |
| SOC-03 | `error` にメッセージがある | 「再試行」を click | `reload` が emit される | 未着手 |
| SOC-04 | `isEmpty` が true | マウントする | `emptyMessage` がそのまま出て、既定スロットは描かれない | 未着手 |
| SOC-05 | 4 状態のいずれでもない（データあり） | マウントする | 既定スロットが描かれる | 未着手 |
| SOC-06 | `total` が 3・`loading` が false | マウントする | ヘッダに「3 件」が出る | 未着手 |
| SOC-07 | `testidPrefix` を渡す | マウントする | 出す data-testid が `{prefix}-count` / `-loading` / `-error` / `-empty` になる | 未着手 |
