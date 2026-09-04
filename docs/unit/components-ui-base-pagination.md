# components/ui/BasePagination（件数表示付きページャー）

- 略号: `BPG`
- 対象: `src/components/ui/BasePagination.vue`
- テスト: `src/components/ui/BasePagination.spec.js`

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BPG-01 | total=56 / limit=50 / offset=0 | マウントする | 「56 件中 1–50 件」が出て、ページ番号 1・2 が並び、「前へ」が無効 | 実装済 |
| BPG-02 | total=56 / limit=50 / offset=50（最終ページ） | マウントする | 「56 件中 51–56 件」が出て、「次へ」が無効・「前へ」が有効 | 実装済 |
| BPG-03 | total=0 | マウントする | 「0 件」だけが出て、ページ番号ボタンは出ない | 実装済 |
| BPG-04 | total=10 / limit=50（1 ページに収まる） | マウントする | 前へ / ページ番号 / 次へ がどれも出ない | 実装済 |
| BPG-05 | total=56 / limit=50 / offset=0 | ページ番号「2」を click | `update:offset` に 50 が渡る | 実装済 |
| BPG-06 | total=56 / limit=50 / offset=0 | 「次へ」を click | `update:offset` に 50 が渡る | 実装済 |
| BPG-07 | total=56 / limit=50 / offset=50 | 「前へ」を click | `update:offset` に 0 が渡る | 実装済 |
| BPG-08 | total=56 / limit=50 / offset=0 | 現在ページ「1」を click | そのボタンは強調表示で `aria-current="page"` を持ち、`update:offset` は発火しない | 実装済 |
| BPG-09 | total=56 / limit=50 / `disabled` | ページ番号「2」を click | すべてのボタンが無効で、`update:offset` は発火しない | 実装済 |
| BPG-10 | total=1000 / limit=50 / offset=450（20 ページ中 10 ページ目） | マウントする | ページ番号は 1・9・10・11・20 だけになり、飛んだ箇所 2 つが「…」に畳まれる | 実装済 |
| BPG-11 | total=56 / limit=50 / offset=9999（範囲外） | マウントする | 最終ページ扱いになり「56 件中 51–56 件」が出て、「次へ」が無効になる | 実装済 |
