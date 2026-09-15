# components/ui/BaseSpinner（回転スピナー）

- 略号: `BSP`
- 対象: `src/components/ui/BaseSpinner.vue`
- テスト: `src/components/ui/BaseSpinner.spec.js`

通信待ちを示す回転マーク。色を指定する prop は持たず、置いた場所の文字色（`currentColor`）を継承する。

`label` を空文字にすると、読み上げテキストも `role` も出さず `aria-hidden` になる。
ボタンの中のように「追加中…」という別の文字が既に状態を伝えている場所で使うためのもので、
**スピナーがボタンの文字を汚さない**ことをここで固定する（BSP-04）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BSP-01 | 既定のまま | マウントする | `role="status"` が付き、既定のラベル「読み込み中」が読める（`visually-hidden` なので目には見えない）。`base-spinner--md` が付く | 実装済 |
| BSP-02 | `size="sm"` / `size="lg"` | マウントする | そのサイズの class だけが付き、既定の `base-spinner--md` は付かない | 実装済 |
| BSP-03 | `label="選択肢を読み込み中"` | マウントする | その文言が読める | 実装済 |
| BSP-04 | `label=""` | マウントする | `role` が付かず `aria-hidden="true"` になり、テキストを一切出さない（`text()` が空） | 実装済 |
| BSP-05 | 既定のまま | ルート要素のタグ名を読む | `span`（置き先の 4 状態は `<p>` なので、ブロック要素だと DOM が壊れる） | 実装済 |
