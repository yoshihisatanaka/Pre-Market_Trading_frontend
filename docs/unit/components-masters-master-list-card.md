# components/masters/MasterListCard（マスタ一覧カード）

- 略号: `MLC`
- 対象: `src/components/masters/MasterListCard.vue`
- テスト: `src/components/masters/MasterListCard.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MLC-01 | `testidPrefix="market-holidays"` | マウントする | 状態に応じた testid が `market-holidays-count` / `-loading` / `-error` / `-empty` / `-pagination` の形で出る | 実装済 |
| MLC-02 | `title` を渡す | マウントする | カードのヘッダにその文字列が出る | 実装済 |
| MLC-03 | `loading: false` で `total` を渡す | マウントする | `{prefix}-count` に「〈total〉 件」が 1 つのテキストとして出る | 実装済 |
| MLC-04 | `loading: true` | マウントする | `{prefix}-count` は出ない（確定前の件数を見せない） | 実装済 |
| MLC-05 | `loading: true` | マウントする | `{prefix}-loading` に回転マークが出る | 実装済 |
| MLC-06 | `loading: true` かつ `error` あり | マウントする | `{prefix}-loading` だけが出て `{prefix}-error` は出ない | 実装済 |
| MLC-07 | `loading: false` で `error` あり | マウントする | `{prefix}-error` に `error.message` と「再試行」ボタンが出る | 実装済 |
| MLC-08 | `error` を表示中 | 「再試行」をクリックする | `reload` が 1 回発火する | 実装済 |
| MLC-09 | `error` あり かつ `isEmpty: true` | マウントする | `{prefix}-error` だけが出て `{prefix}-empty` は出ない | 実装済 |
| MLC-10 | `isEmpty: true`・`error` なし・`loading: false` | マウントする | `{prefix}-empty` に `emptyMessage` が出る | 実装済 |
| MLC-11 | データあり（`loading: false` / `error` なし / `isEmpty: false`）で既定スロットに表を差す | マウントする | スロットの内容と `{prefix}-pagination` が出る | 実装済 |
| MLC-12 | ローディング / エラー / 空 のそれぞれ | マウントする | いずれの状態でも既定スロットと `{prefix}-pagination` は描画されない | 実装済 |
| MLC-13 | データありで `total: 120` / `limit: 50` / `offset: 0` | ページャーの 2 ページ目をクリックする | `update:offset` が `50` を伴って発火する | 実装済 |
