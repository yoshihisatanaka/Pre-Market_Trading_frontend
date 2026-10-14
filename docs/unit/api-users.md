# api/users（操作者（ユーザ）マスタ API 層）

- 略号: `USA`
- 対象: `src/api/users.js`（`fetchUsers` / `updateUser`）
- テスト: `src/api/users.spec.js`

パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が全 api をまとめて見るので、ここでは
**この層の変換**（生の形 ↔ アプリ内モデル）と**送るクエリ・本文の形**だけを守る。

ここだけが**バックエンドの形**（パス・クエリ名・日本語キー・0/1 の integer）を知ってよい層なので、
「実際に送り出すリクエストの形」と「受け取った生データの変換」を守る。
呼び出し元はユーザ管理マスタ（[stores-users.md](stores-users.md)）と
操作ログの操作者プルダウン（[stores-operator-options.md](stores-operator-options.md)）。

`keyword`（社員コード・氏名）は**実 API に無いクエリ**で、送っても実 API は黙って無視する
（docs/api/requests.md #67。契約テストの `KNOWN_GAPS`）。ここでは「送る形」だけを守る（USA-10）。

更新（`PUT /masters/users/{operator_code}`）は upsert で、**本文で省いた 受注者コード は null で上書きされる**。
そのため画面で変えない 氏名 / 部店コード / 受注者コード も今の値を送り返し、空文字は `null` に寄せる（USA-12・USA-13）。
パスキーは ID ではなく業務キーの操作者コード（USA-11）。

期待値はフィクスチャ（`src/mocks/fixtures/users.js`。`004` だけ無効。受注者コードは設定済みと `null` が混在）から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| USA-01 | 既定モック | `fetchUsers()` を引数なしで呼ぶ | `GET /api/masters/users` に `limit=50` と `offset=0` だけが載る | 実装済 |
| USA-02 | 既定モック | ロール・部店コード・`includeInactive: true`・limit・offset をすべて渡して呼ぶ | クエリ名が `role` / `branch_code` / `include_inactive` / `limit` / `offset` になり、値がそのまま載る（`include_inactive=true`）。これ以外のクエリは載らない | 実装済 |
| USA-03 | 既定モック | ロール・部店コードを空文字、`includeInactive: false` にして呼ぶ | 空の条件と `include_inactive` はクエリに載らない（`false` は仕様の既定なので送らない） | 実装済 |
| USA-04 | 既定モック | `fetchUsers({ includeInactive: true, limit: <全件以上> })` を呼ぶ | `{ items, total }` を返し、`items` がフィクスチャの全員（無効を含む）を並びどおりに `{ id, code, name, roleCode, roleName, branchCode, orderTakerCode, active, updatedAt, updatedBy }` へ変換したもの、`total` がその件数 | 実装済 |
| USA-05 | 既定モック | `fetchUsers()`（無効を含めない） | 無効な操作者が含まれず、`total` は有効な操作者の件数 | 実装済 |
| USA-06 | 応答の 氏名 / ロール名 / 部店コード が `null` | `fetchUsers()` | 3 項目とも空文字になる | 実装済 |
| USA-07 | 応答の 有効フラグ が `1` / `0` | `fetchUsers()` | `active` が `true` / `false` になる | 実装済 |
| USA-08 | API が `operators` / `total` を持たない応答を返す | `fetchUsers()` | `items` が空配列、`total` が 0 になる | 実装済 |
| USA-09 | API が 500 を返す | `fetchUsers()` | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
| USA-10 | 既定モック | `fetchUsers({ keyword: <フィクスチャの氏名の一部> })` / `keyword: ''` で呼ぶ | 値があれば `keyword` クエリにそのまま載る。空文字のときは載らない | 実装済 |
| USA-11 | 既定モック | 操作者コードに `/` や空白を含む値で `updateUser()` を呼ぶ | `PUT /api/masters/users/{エンコードした操作者コード}` に送られる（パスキーは ID ではなく操作者コード） | 実装済 |
| USA-12 | 既定モック | フィクスチャの 1 件（受注者コードあり）の値で `updateUser()` を呼ぶ | 本文が `氏名` / `ロールコード` / `部店コード` / `受注者コード` / `有効フラグ`（`true` → `1`）の 5 キーちょうどで、値は渡したまま。`ID` / `更新日時` / `実行者` は送らない | 実装済 |
| USA-13 | 既定モック | 氏名・部店コード・受注者コードを空文字、`active: false` で `updateUser()` を呼ぶ | 3 項目が `null`、`有効フラグ` が `0` で送られる（キーは省かない。省くと上書きの意味が変わる） | 実装済 |
| USA-14 | 既定モック | フィクスチャの 1 件のロールを別のロールに変えて `updateUser()` を呼ぶ | 応答の `operator` を変換した 1 件が返る（`code` が同じ、`roleCode` / `roleName` が新しいロール、`orderTakerCode` が送った値） | 実装済 |
| USA-15 | 更新 API が 400（`{ detail }`）を返す | `updateUser()` を呼ぶ | 例外が投げられ、`message` に detail が入る | 実装済 |
| USA-16 | 更新 API が `operator` を持たない応答を返す | `updateUser()` を呼ぶ | 落ちずに既定値の 1 件（`id` が 0、文字列は空文字、`active` が `false`）が返る | 実装済 |
