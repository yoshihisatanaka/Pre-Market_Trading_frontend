# api/activityLogs（操作ログ API 層）

- 略号: `ALA`
- 対象: `src/api/activityLogs.js`（`fetchActivityLogs` / `fetchActivityLogTargets`）
- テスト: `src/api/activityLogs.spec.js`

ここだけが**バックエンドの形**（パス・クエリ名・日本語キー）を知ってよい層なので、
この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。
同種の文書は [api-customers.md](api-customers.md)。

ストア（[stores-activity-logs.md](stores-activity-logs.md)）と画面
（[views-activity-log-list-view.md](views-activity-log-list-view.md)）のテストは MSW のモックが返す結果を
見ている。モックとサーバの理解がずれていても気づけないので、ここでは**送信されたリクエストそのもの**を見る。

取り違えやすい点を 4 つ固定する。

- **送るクエリは 10 種だけ**（`start_date` / `end_date` / `operator` / `actor_group` / `operation` / `target_types` /
  `target_key` / `sort` / `limit` / `offset`）。空値は送らない。`sort` が空なら送らず、実 API の既定（desc）に任せる。
  `target_types` は対象種別コードの並び（`targetTypes`）をカンマ区切りにしたもの（画面の 区分 / 対象機能 を展開した結果）
- **行キー `id` は `対象種別:履歴ID`。** 履歴ID は履歴テーブルごとの連番なので、横断した一覧では単独で一意にならない（ALA-13）
- **null の扱いが項目で違う。** 対象ID / 対象キー / 操作者と、操作者名 / 実行者区分 / 対象機能 / 操作内容 は空文字に寄せ、
  変更前データ / 変更後データは null を保つ（「無い」と「空」は別物）
- **仕様に無い 結果 は読まない。** 操作者名 / 実行者区分 / 対象機能 / 操作内容 の 4 項目は 2026-09-30 の取り込みで
  仕様に入ったので読む。結果 は「追加しない」回答（#1 ③）でフィクスチャからも消えた。変換結果のキーは仕様由来の項目だけ（ALA-12）
- **区分 / 区分名 は 2026-10-06 の回答（#38）で一覧と対象種別の両方に入った。** 仕様で必須ではないので、無い応答は空文字（ALA-17 / ALA-18）

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALA-01 | 既定モック | `fetchActivityLogs()` を引数なしで呼ぶ | `GET /api/operations/activity-logs` に `limit=50` と `offset=0` だけが載る | 実装済 |
| ALA-02 | 既定モック | 期間・操作者・実行者区分・操作区分・対象種別（2 つの並び）・対象キー・並び順をすべて渡して呼ぶ | クエリ名が `start_date` / `end_date` / `operator` / `actor_group` / `operation` / `target_types` / `target_key` / `sort` になり、値がそのまま載る（`target_types` はカンマ区切り）。これ以外のクエリは載らない | 実装済 |
| ALA-03 | 既定モック | 全条件を空文字（対象種別は空配列）にして呼ぶ | 空の条件はクエリに載らない（`actor_group` / `sort` も送らない） | 実装済 |
| ALA-04 | 既定モック | `fetchActivityLogs({ limit: 20, offset: 50 })` を呼ぶ | `limit=20` と `offset=50` がそのまま載る | 実装済 |
| ALA-05 | 既定モック | `fetchActivityLogTargets()` を呼ぶ | `GET /api/operations/activity-logs/targets` を読み、各行が `code` / `name` / `category` / `categoryName` / `keyLabel` / `historyTable` に変換される。並びはフィクスチャのまま | 実装済 |
| ALA-06 | API が `targets` を持たない応答を返す | `fetchActivityLogTargets()` を呼ぶ | 空配列が返る（キーが欠けても落ちない） | 実装済 |
| ALA-07 | API が `ActivityLogItem` を 1 件返す | `fetchActivityLogs()` を呼ぶ | `id` が `対象種別:履歴ID` になり、履歴ID・対象種別・対象種別名・対象ID・対象キー・操作区分・操作者・操作日時・変更前後データがアプリ内モデルの名前に変換される。`total` も返る | 実装済 |
| ALA-08 | API が 対象ID / 対象キー / 操作者 を `null` で返す | `fetchActivityLogs()` を呼ぶ | `targetId` / `targetKey` / `operator` が空文字になる | 実装済 |
| ALA-09 | API が登録の行（変更前データ `null`）と削除の行（変更後データ `null`）を返す | `fetchActivityLogs()` を呼ぶ | `before` / `after` の `null` がそのまま `null` で残る（空オブジェクトに潰さない） | 実装済 |
| ALA-10 | API が差分を `{ 項目: { before, after } }` の形で複数項目返す | `fetchActivityLogs()` を呼ぶ | `diff` が `[{ field, before, after }]` の配列になり、並びは応答のまま。欠けた `before` / `after` は `null` | 実装済 |
| ALA-11 | API が 変更項目 を `null` / 文字列、差分 を `null` で返す | `fetchActivityLogs()` を呼ぶ | `changedFields` が空配列、`diff` が空配列になる | 実装済 |
| ALA-12 | 既定モック（4 項目が載り、結果 が無いフィクスチャ） | `fetchActivityLogs()` を呼ぶ | 変換結果のキーが仕様由来の 19 項目だけ。`operatorName` / `operatorRole` / `feature` / `operationText` に 操作者名 / 実行者区分 / 対象機能 / 操作内容 が入る | 実装済 |
| ALA-17 | 既定モック（区分 / 区分名 が載ったフィクスチャ。注文の行を含む） | `fetchActivityLogs()` を呼ぶ | `category` / `categoryName` に 区分 / 区分名 が入る。注文の行は 変更前データ / 変更後データ とも `null` のまま | 実装済 |
| ALA-18 | API が一覧・対象種別とも 区分 / 区分名 を返さない | それぞれを呼ぶ | どちらも `category` / `categoryName` が空文字になる | 実装済 |
| ALA-16 | API が 操作者名 / 対象機能 を返さず、実行者区分 / 操作内容 を `null` で返す | `fetchActivityLogs()` を呼ぶ | 4 項目とも空文字になる | 実装済 |
| ALA-13 | 既定モック（対象種別をまたいで履歴ID が重複するフィクスチャ） | 全件を 1 回で取得する | 履歴ID は重複するが `id` は全行で一意になる | 実装済 |
| ALA-14 | API が `activity_logs` を持たない応答を返す | `fetchActivityLogs()` を呼ぶ | `items` が空配列、`total` が 0 になる | 実装済 |
| ALA-15 | 一覧 / 対象種別の API が 500 を返す | それぞれを呼ぶ | どちらも例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
