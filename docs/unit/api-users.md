# api/users（操作者（ユーザ）マスタ API 層）

- 略号: `USA`
- 対象: `src/api/users.js`（`fetchUsers`）
- テスト: `src/api/users.spec.js`

パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が全 api をまとめて見るので、ここでは
**この層の変換**（生の形 ↔ アプリ内モデル）と**送るクエリの形**だけを守る。

ここだけが**バックエンドの形**（パス・クエリ名・日本語キー・0/1 の integer）を知ってよい層なので、
「実際に送り出すリクエストの形」と「受け取った生データの変換」を守る。
いまの呼び出し元は操作ログの操作者プルダウン（[stores-operator-options.md](stores-operator-options.md)）だけ。

期待値はフィクスチャ（`src/mocks/fixtures/users.js`。`004` だけ無効）から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| USA-01 | 既定モック | `fetchUsers()` を引数なしで呼ぶ | `GET /api/masters/users` に `limit=50` と `offset=0` だけが載る | 実装済 |
| USA-02 | 既定モック | ロール・部店コード・`includeInactive: true`・limit・offset をすべて渡して呼ぶ | クエリ名が `role` / `branch_code` / `include_inactive` / `limit` / `offset` になり、値がそのまま載る（`include_inactive=true`）。これ以外のクエリは載らない | 実装済 |
| USA-03 | 既定モック | ロール・部店コードを空文字、`includeInactive: false` にして呼ぶ | 空の条件と `include_inactive` はクエリに載らない（`false` は仕様の既定なので送らない） | 実装済 |
| USA-04 | 既定モック | `fetchUsers({ includeInactive: true, limit: <全件以上> })` を呼ぶ | `{ items, total }` を返し、`items` がフィクスチャの全員（無効を含む）を並びどおりに `{ id, code, name, roleCode, roleName, branchCode, active }` へ変換したもの、`total` がその件数 | 実装済 |
| USA-05 | 既定モック | `fetchUsers()`（無効を含めない） | 無効な操作者が含まれず、`total` は有効な操作者の件数 | 実装済 |
| USA-06 | 応答の 氏名 / ロール名 / 部店コード が `null` | `fetchUsers()` | 3 項目とも空文字になる | 実装済 |
| USA-07 | 応答の 有効フラグ が `1` / `0` | `fetchUsers()` | `active` が `true` / `false` になる | 実装済 |
| USA-08 | API が `operators` / `total` を持たない応答を返す | `fetchUsers()` | `items` が空配列、`total` が 0 になる | 実装済 |
| USA-09 | API が 500 を返す | `fetchUsers()` | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
