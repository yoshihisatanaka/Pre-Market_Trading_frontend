# components/ui/DataTable（汎用テーブル）

- 略号: `DTB`
- 対象: `src/components/ui/DataTable.vue`
- テスト: `src/components/ui/DataTable.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| DTB-01 | columns 2 列、rows 2 行 | マウントする | ヘッダに列ラベルが順に出て、行が 2 つ描画され、セルに値が出る | 実装済 |
| DTB-02 | `numeric: true` の列がある | マウントする | その列のセルにだけ `numeric` クラスが付く | 実装済 |
| DTB-03 | `cell-<key>` スロットを渡す | マウントする | 該当列のセルがスロットの内容で描画される（`value` が渡る） | 実装済 |
| DTB-04 | `rowKey` に `id` 以外を指定し、行に `id` が無い | マウントする | 行が描画される（キー解決に失敗しない） | 実装済 |
