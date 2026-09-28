# アクセス制御（権限の要る画面）

- 略号: `AC`
- 画面: `src/router/permissionGuard.js` / `src/views/ForbiddenView.vue`（行き先 `/forbidden`）
- テスト: `e2e/access-control.spec.js`

`router/index.js` の `meta.requiredPermission` を持つルートを、その権限の無い利用者が
**URL を直接開いたとき**の受け入れ条件。いまの対象は運用管理権限（`GET /auth/me` の `権限.operation`）が要る
運用管理の 4 画面（お知らせ管理 `/operations/announcements` / 滞留注文抽出 `/operations/stalled-orders` /
操作ログ `/operations/activity-logs` / 障害管理 `/operations/incidents`）。

既定モックの `/auth/me` は全権限ありの管理責任者（`supervisorOperator`）なので、各画面の E2E は影響を受けない。
権限なしは `noOperationOperator`（`src/mocks/fixtures/currentOperator.js`）を `mockApi()` で返させる。
`/auth/me` が読めないときは権限なしに倒し、権限なしの画面で「確認できなかった」ことを出し分ける。

サイドメニューの区分の出し分けは [layout.md](layout.md)（`LAY-16` / `LAY-17`）が持つ。
ガードの分岐（権限の要らないルートは待たない・読み直し）は単体テスト側が持つ。
ここでは各画面の中身は見ず、**開けたか / 権限なしの画面へ回されたか**だけを見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| AC-01 | `/auth/me` が運用管理権限の無い利用者を返す | 運用管理の 4 画面の URL をそれぞれ直接開く | どれも URL が `/forbidden` になり、ヘッダの見出しが「アクセス権限がありません」、本文に「この画面を開く権限がありません。」が表示される。開こうとした画面の中身は表示されない | 実装済 |
| AC-02 | AC-01 の状態（`/operations/stalled-orders` から回された） | 「注文一覧へ戻る」を押す | URL が `/` になり、ヘッダの見出しが「注文一覧」になる | 実装済 |
| AC-03 | `/auth/me` が 500 を返す | 運用管理の 4 画面の URL をそれぞれ直接開く | どれも URL が `/forbidden` になり、「権限を確認できませんでした（<理由>）。時間をおいて開き直してください。」が表示される。「この画面を開く権限がありません。」は表示されない | 実装済 |
| AC-04 | 既定モック（全権限あり） | 運用管理の 4 画面の URL をそれぞれ直接開く | どれも URL はそのままで、ヘッダの見出しがその画面のタイトルになる。権限なしの画面は表示されない | 実装済 |
