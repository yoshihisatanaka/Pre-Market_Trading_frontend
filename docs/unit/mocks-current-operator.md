# mocks/fixtures/currentOperator（MSW の操作者の切り替え）

- 略号: `MCO`
- 対象: `src/mocks/fixtures/currentOperator.js` の `currentOperatorFor()` と、それを使う `src/mocks/handlers/permissions.js` の `GET /auth/me`
- テスト: `src/mocks/fixtures/currentOperator.spec.js`
- 使う側: [stores-current-operator.md](stores-current-operator.md)

ログイン機能が入るまで、MSW の `/auth/me` は届いた `X-User-Code`（`.env` の `VITE_USER_CODE`）で
返す操作者を選ぶ。**知らないコードは管理責任者に倒す**（既定の `.env` や単体テストの固定値
`test-user` のままでも、今までどおり全画面が見えるようにするため）。
期待値はフィクスチャの `操作者コード` から導き、コードの文字列をテストに直書きしない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MCO-01 | `devOperators` の 4 人 | それぞれの `操作者コード` で `currentOperatorFor()` | その操作者が返る | 実装済 |
| MCO-02 | なし | 知らないコード（`test-user`）・空文字・`null`・`undefined` で `currentOperatorFor()` | どれも `supervisorOperator` | 実装済 |
| MCO-03 | 既定の handlers | `X-User-Code: <salesOperator のコード>` を付けて `GET /api/auth/me` | 本文が `salesOperator` | 実装済 |
| MCO-04 | 既定の handlers | `X-User-Code` を付けずに `GET /api/auth/me` | 本文が `supervisorOperator` | 実装済 |
| MCO-05 | `devOperators` の 4 人 | それぞれの `権限.depositary` を見る | ロールが `manager` / `supervisor` のときだけ true、`sales` / `ifa` は false（バックエンドの預託先参照権限の既定と同じ） | 実装済 |
