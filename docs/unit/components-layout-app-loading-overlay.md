# components/layout/AppLoadingOverlay（起動時の全画面ローディング）

- 略号: `ALO`
- 対象: `src/components/layout/AppLoadingOverlay.vue`
- テスト: `src/components/layout/AppLoadingOverlay.spec.js`

起動時のコードマスタ取得（`GET /codes`）が終わるまで画面全体を覆う。
`index.html` のスプラッシュ（バンドル読込中）から引き継ぎ、白い画面と
組み立て途中の画面を見せないようにする。

この部品は**状態を持たず、ストアも読まない**。`loading` / `error` を props で受け、
「再試行」は `retry` で外へ出すだけにする（配線は `src/App.vue` が持つ）。

取得に失敗したら理由と「再試行」を出し、**覆ったまま先へ進ませない**。
選択肢が空のまま操作させないための仕様。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALO-01 | `loading` が true | マウントする | 覆いの中にシステム名・回転マーク・「読み込んでいます」が出る | 実装済 |
| ALO-02 | `loading` が false で `error` が無い | マウントする | 何も描かない（覆いが消える） | 実装済 |
| ALO-03 | `loading` が false で `error` がある | マウントする | 覆いの中に理由と「再試行」が出る。回転マークは出ない | 実装済 |
| ALO-04 | `loading` が false で `error` がある | 「再試行」を click | `retry` が 1 回だけ出る（この部品は読み直さない） | 実装済 |
| ALO-05 | `loading` が true で `error` もある | マウントする | 回転マークだけが出る（読み直し中に前回の失敗を見せない） | 実装済 |
