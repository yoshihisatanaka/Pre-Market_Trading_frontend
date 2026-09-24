# stores/activityLogs（操作ログのストア）

- 略号: `ALS`
- 対象: `src/stores/activityLogs.js`
- テスト: `src/stores/activityLogs.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/activityLogs.js`）に当てて、取得・ページング・絞り込み・並び順と
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。

操作ログは監査の記録なので**読むだけ**で、登録・更新・削除を持たない。「公開していないこと」自体も守る（ALS-13）。
同種の文書は [stores-customers.md](stores-customers.md)。

期待値はフィクスチャ（`src/mocks/fixtures/activityLogs.js`。操作日時の降順）と `ACTIVITY_LOGS_PAGE_SIZE` から導き、
件数を直接書かない。行の特定には `対象種別:履歴ID`（アプリ内モデルの `id`）を使う。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALS-01 | 既定モック | `load()` を引数なしで呼ぶ | `items` が 1 ページ分（`ACTIVITY_LOGS_PAGE_SIZE` 件）で操作日時の降順、`total` がフィクスチャの全件数、`offset` が 0 になる | 実装済 |
| ALS-02 | 既定モック | `load({ offset: ACTIVITY_LOGS_PAGE_SIZE })` を呼ぶ | 2 ページ目の残り件数が返り、`offset` が渡した値になる | 実装済 |
| ALS-03 | 既定モック | `load({ dateFrom, dateTo })` を呼ぶ | 操作日時の日付がその範囲（両端を含む）の行だけが返り、条件がストアに残る | 実装済 |
| ALS-04 | 既定モック | `load({ operator: <フィクスチャの操作者> })` を呼ぶ | 操作者が完全一致する行だけが返る | 実装済 |
| ALS-05 | 既定モック | `load({ operation: 'DELETE' })` を呼ぶ | その操作区分の行だけが返る | 実装済 |
| ALS-06 | 既定モック | `load({ targetType: <フィクスチャの対象種別> })` を呼ぶ | その対象種別の行だけが返る | 実装済 |
| ALS-07 | 既定モック | `load({ targetKey: <対象キーの一部> })` を呼ぶ | 対象キーに部分一致する行だけが返る（対象キーが無い行は含まれない） | 実装済 |
| ALS-08 | 既定モック | `load({ sort: 'asc' })` を呼ぶ | 操作日時の昇順（フィクスチャの逆順）で 1 ページ目が返り、`sort` がストアに残る | 実装済 |
| ALS-09 | 既定モック | どの行にも当たらない対象キーで `load()` を呼ぶ | `items` が空、`total` が 0、`isEmpty` が `true` になる | 実装済 |
| ALS-10 | API が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`items` が空のまま。`isEmpty` は `false` | 実装済 |
| ALS-11 | API の応答が遅い | `load()` を await せずに `loading` を読む | 取得中は `true`、完了後に `false` になる | 実装済 |
| ALS-12 | 既定モック。絞り込んだ状態を読み込み済み | `reload()` を呼ぶ | 同じ条件・同じ `offset` のまま読み直す | 実装済 |
| ALS-13 | 既定モック | ストアの公開名を読む | `create` / `update` / `remove` とその状態（`creating` / `deleting`）を持たない | 実装済 |
| ALS-14 | API の応答が遅い | 2 ページ目 → 1 ページ目の順に `load()` を続けて呼び、先に投げたほうを遅く返す | 最後に投げた `load()` の結果が残る | 実装済 |
