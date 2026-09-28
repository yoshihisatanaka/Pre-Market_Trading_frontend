# stores/currentOperator（ログイン中の操作者と権限）

- 略号: `COP`
- 対象: `src/stores/currentOperator.js`
- テスト: `src/stores/currentOperator.spec.js`
- API 側のシナリオ: [api-auth.md](api-auth.md)
- 使う側: [components-layout-app-sidebar.md](components-layout-app-sidebar.md)（メニューの出し分け）/ [router-index.md](router-index.md)（ルートのガード）

全画面共通・起動時 1 回のストア（`stores/marketStatus.js` と同じ型）。`main.js` が起動時に `load()` し、
ルートのガードは `ensureLoaded()` でその完了を待つ。

守るのは 2 つ。

- **取得に失敗したら「権限なし」に倒す。** 未取得・取得失敗のあいだ `hasPermission()` はすべて false
  （誤って操作を出すより、出さないほうが安全）。理由は `error` に残る
- **読み込みは 1 本にまとめる。** `main.js` の `load()` とガードの `ensureLoaded()` が重なっても
  `/auth/me` を 2 回叩かない

MSW の既定ハンドラ（`/auth/me` は管理責任者 `supervisorOperator` = 全権限あり）に当て、
権限の無い操作者は `salesOperator` を `server.use()` で返させる。期待値はフィクスチャから導く。
`beforeEach(() => setActivePinia(createPinia()))`。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| COP-01 | 新しい pinia | ストアを作るだけ | `operator` が `null`、`loading` が false、`error` が `null`。`hasPermission('master')` は false で、`/auth/me` は叩かれない | 実装済 |
| COP-02 | 既定モック（管理責任者） | `load()` を呼ぶ | `operator` に操作者コード・氏名・ロールがフィクスチャどおり入り、`hasPermission('master')` / `('order')` が true になる | 実装済 |
| COP-03 | `/auth/me` が営業員（`salesOperator`）を返す | `load()` を呼ぶ | `hasPermission('master')` が false、`hasPermission('order')` が true（フィクスチャの権限フラグどおり） | 実装済 |
| COP-04 | `/auth/me` の応答が遅い | `load()` を await せずに `loading` を読む | 呼んだ直後は true、完了後に false | 実装済 |
| COP-05 | `/auth/me` が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`operator` は `null` のまま。どの権限でも `hasPermission()` が false（権限なしに倒す） | 実装済 |
| COP-06 | 既定モック | `load()` を await せずに `ensureLoaded()` を 2 回続けて呼び、すべて待つ | `/auth/me` は 1 回だけ叩かれ、どの呼び出しも同じ操作者で解決する（読み込みを 1 本にまとめる） | 実装済 |
| COP-07 | 既定モック。まだ読み込んでいない | `ensureLoaded()` だけを呼んで待つ | 読み込みが始まり、完了後に `operator` が入る（`load()` を先に呼んでいなくても待てる） | 実装済 |
| COP-08 | 既定モック。読み込み済み | 定義に無い権限キー（`'unknown'`）で `hasPermission()` を呼ぶ | false（知らない権限を持っているとは読まない） | 実装済 |
| COP-09 | `/auth/me` が 1 回目だけ 500、以降は既定（管理責任者） | `load()` が失敗したあとに `ensureLoaded()` を呼ぶ | `/auth/me` が読み直され（計 2 回）、`error` が `null` に戻って `hasPermission('master')` が true になる（一時的な失敗で権限なしのまま固まらない） | 実装済 |
| COP-10 | 既定モック。`load()` が成功済み | `ensureLoaded()` を 2 回呼ぶ | `/auth/me` は叩き直されない（計 1 回のまま）。成功した結果は読み直さない | 実装済 |
