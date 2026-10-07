# stores/operatorOptions（操作ログの操作者プルダウンのストア）

- 略号: `OPO`
- 対象: `src/stores/operatorOptions.js`
- テスト: `src/stores/operatorOptions.spec.js`

操作ログ画面の「操作者」プルダウンの選択肢を配るストア。中身は `GET /masters/users`（m_操作者）で、
操作ログには退職・無効になった操作者の記録も残るので**無効な操作者も含める**。
顔ぶれは画面を開くたびに変わるものではないので、**一度取れたら読み直さない**（`ensureLoaded`）。
失敗したときだけ次回に再試行する。同種の文書は [stores-activity-log-targets.md](stores-activity-log-targets.md)。

MSW の既定ハンドラ（`src/mocks/handlers/users.js`）に当てる。`beforeEach(() => setActivePinia(createPinia()))`。
期待値はフィクスチャ（`src/mocks/fixtures/users.js`）と `OPERATOR_OPTIONS_LIMIT` から導く。
「読み直さない」はリクエストが飛ばないこととして外から観察する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OPO-01 | 未取得 | `options` / `users` を読む | どちらも空配列（取得前でも select を描ける） | 実装済 |
| OPO-02 | 既定モック | `ensureLoaded()` を呼ぶ | `users` がフィクスチャの全員（無効を含む）で並びどおり。`options` が `{ value: 操作者コード, label: '操作者コード 氏名' }` | 実装済 |
| OPO-03 | 既定モック | `ensureLoaded()` を呼ぶ | 送るクエリが `include_inactive=true` と `limit=OPERATOR_OPTIONS_LIMIT` | 実装済 |
| OPO-04 | 氏名が `null` の操作者を含む応答 | `ensureLoaded()` を呼ぶ | その操作者の `label` は操作者コードだけ | 実装済 |
| OPO-05 | 既定モック。取得済み | もう一度 `ensureLoaded()` を呼ぶ | リクエストを送らず、`undefined` を返す。選択肢はそのまま | 実装済 |
| OPO-06 | API の応答が遅い | `ensureLoaded()` を 2 回続けて呼ぶ（1 回目の応答前） | 取得中は `loading` が `true`。リクエストは 1 本だけで、2 回目も同じ取得の完了を待てる（Promise が返る）。完了後に選択肢が入り `loading` が `false` になる | 実装済 |
| OPO-07 | API が 500 を返す | `ensureLoaded()` を呼ぶ | `error` に理由が入り、`options` は空配列のまま | 実装済 |
| OPO-08 | 1 回目だけ API が 500、以降は既定 | `ensureLoaded()` を 2 回呼ぶ | 2 回目で読み直し、選択肢が入って `error` が消える | 実装済 |
| OPO-09 | 既定モック。取得済み | `load()` を呼ぶ | `ensureLoaded` と違い、取得済みでも読み直す（リクエストが 1 本増える） | 実装済 |
