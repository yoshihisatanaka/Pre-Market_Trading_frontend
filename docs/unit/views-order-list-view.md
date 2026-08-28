# views/OrderListView（注文一覧画面）

- 略号: `OLV`
- 対象: `frontend/src/views/OrderListView.vue`
- テスト: `frontend/src/views/OrderListView.spec.js`
- E2E 側のシナリオ: [docs/e2e/order-list.md](../e2e/order-list.md)

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OLV-01 | API 応答がまだ返っていない | マウントする | ローディング表示が出て、表は出ない | 実装済 |
| OLV-02 | 既定モック（注文 3 件） | マウントして応答を待つ | ローディングが消え、行が 3 つ。1 行目に AAPL / 買 / $227.52 / 約定済 | 実装済 |
| OLV-03 | API が 500（`message` 付き）を返す | マウントして応答を待つ | エラー表示にその message と「再試行」ボタンが出て、表は出ない | 実装済 |
| OLV-04 | API が `items: []` を返す | マウントして応答を待つ | 空状態の表示が出て、表は出ない | 実装済 |
| OLV-05 | 初回応答は 0 件、2 回目は既定モック | 「再読み込み」を click | 表が 3 行に更新される | 実装済 |
