# api/〈name〉（〈画面名〉API 層・雛形）

- 略号: `XXA`
- 対象: `src/api/〈name〉.js`
- テスト: `src/api/〈name〉.spec.js`

> **これは雛形。** コピーして `XXA` / `〈…〉` を差し替え、固有の行を足す。原型は `api-symbols.md`。
> パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が全 api をまとめて見るので、ここでは
> **この層の変換**（生の形 ↔ アプリ内モデル）と**送る本文の形**だけを守る。

ここだけが**バックエンドの形**（パス・クエリ名・レスポンスキー・0/1 の integer・YYYYMMDD の integer）を
知ってよい層なので、「実際に送り出すリクエストの形」と「受け取った生データの変換」を守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| XXA-01 | 既定モック | `fetch〈Name〉s()` | `{ items, total }` を返し、`items[0]` のキーがすべて camelCase（`〈rawKey〉` → `〈camelKey〉`） | 未着手 |
| XXA-02 | 既定モック | `fetch〈Name〉s({ 〈filter〉: '' })` | 空文字の条件はクエリに載せない（MSW が受けた URL にそのキーが無い） | 未着手 |
| XXA-03 | 既定モック | `fetch〈Name〉s({ 〈filter〉: 値 })` | 仕様のクエリ名 `〈query〉` でその値が送られる | 未着手 |
| XXA-04 | 応答の nullable 項目が `null` | `fetch〈Name〉s()` | 文字列項目は `''`、数値項目は `null` のまま（0 と未取得を区別する） | 未着手 |
| XXA-05 | 応答の 0/1 の integer | `fetch〈Name〉s()` | boolean に変換される | 未着手 |
| XXA-06 | （CRUD のみ）入力 | `create〈Name〉(入力)` | 本文が `*Request` の形（キー名・integer の日付・nullable は `null`）で、ID は本文に載せない | 未着手 |
| XXA-07 | （CRUD のみ）入力 + `id` | `update〈Name〉({ id, ... })` | パスに **仕様のキー**（ID 対応済みなら id、業務キーなら業務キーの項目）が載り、`更新日時` が本文に載る | 未着手 |
| XXA-08 | （CRUD のみ） | `delete〈Name〉(id)` | パスに仕様のキーが載り、本文は送らない。戻り値は削除した id | 未着手 |
| XXA-09 | （CRUD のみ）`validate` の応答が `valid: false` | `validate〈Name〉(入力)` | 例外にせず `{ valid: false, errors }` を返す | 未着手 |
