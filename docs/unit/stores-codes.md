# stores/codes（コードマスタのストア）

- 略号: `CDS`
- 対象: `src/stores/codes.js`
- テスト: `src/stores/codes.spec.js`

全画面のプルダウンの選択肢を配るストア。一覧のストアと違い検索条件もページ位置も持たず、
読み込みは `main.js` が起動時に 1 回だけ行う。画面は `optionsFor()` で読むだけにする。

そのため守りたいのは「**画面が読み込みの完了を待たなくてよい**」という一点に尽きる。
未取得でも未知の名前でも取得に失敗しても、`optionsFor()` は必ず配列を返す
（`undefined` を返すと `BaseSelect` の `options` prop の型検証が落ちる）。

期待値はフィクスチャ（`src/mocks/fixtures/codes.js` の `codeMasters`）から導き、
コードマスタ名の件数を直接書かない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CDS-01 | 未取得（`load()` を呼んでいない） | `optionsFor('部店')` を読む | 空配列が返る（起動直後でも select を描ける） | 実装済 |
| CDS-02 | 既定モック | `load()` を呼ぶ | `optionsFor('部店')` がフィクスチャの部店と同じ件数・同じ並びの選択肢になる | 実装済 |
| CDS-03 | 既定モック。`load()` 済み | `optionsFor('存在しない区分')` を読む | 空配列が返る（未知の名前で落ちない） | 実装済 |
| CDS-04 | API の応答が遅い | `load()` を await せずに `loading` を読む | 取得中は `true`、完了後に `false` になる | 実装済 |
| CDS-05 | API が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`optionsFor()` は空配列を返し続ける（select が壊れない） | 実装済 |
| CDS-06 | 既定モック | `load()` 後に選択肢の 1 件を読む | `{ value, label }` の 2 キーだけを持つ（`code` のまま外へ出さない） | 実装済 |
