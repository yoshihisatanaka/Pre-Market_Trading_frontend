# api/announcements（お知らせ管理 API 層）

- 略号: `ANA`
- 対象: `src/api/announcements.js`
- テスト: `src/api/announcements.spec.js`

> パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が全 api をまとめて見るので、ここでは
> **この層の変換**（生の形 ↔ アプリ内モデル）と**送る本文の形**だけを守る。

お知らせは全画面共通の 1 行だけの単一リソース。日本語キー・表示フラグの 0/1・nullable の本文・
型宣言の無い 変更後データ（実 API は JSON 文字列で返す）を、この層で吸収していることを守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ANA-01 | 既定モック | `fetchAnnouncement()` | `GET /api/operations/announcements` を呼び、フィクスチャの現在値が camelCase のアプリ内モデル（`id` / `enabled` / `visible` / `message` / `userEdited` / `updatedAt` / `updatedBy`）で返る。表示フラグ 1 は `enabled: true` | 実装済 |
| ANA-02 | 応答が初期状態（表示フラグ 0・本文 / 更新日時 / 更新者 が `null`） | `fetchAnnouncement()` | `enabled` / `visible` / `userEdited` は false、`message` と `updatedAt` は `''`、`updatedBy` は `null` | 実装済 |
| ANA-03 | レスポンスボディが `null` | `fetchAnnouncement()` | `null` を返す（画面は未登録として扱う） | 実装済 |
| ANA-04 | 入力 `{ enabled: true, message, updatedAt }` | `updateAnnouncement(入力)` | `PUT /api/operations/announcements` の本文が `{ 表示フラグ: 1, 本文, 更新日時 }` になる | 実装済 |
| ANA-05 | 入力 `{ enabled: false, ... }` | `updateAnnouncement(入力)` | 本文の `表示フラグ` が `0`（boolean ではなく integer） | 実装済 |
| ANA-06 | `updatedAt` が `''` | `updateAnnouncement(入力)` | 本文に `更新日時` のキーが無い | 実装済 |
| ANA-07 | 既定モック・フィクスチャの更新日時を合札に本文を変更 | `updateAnnouncement(入力)` | `{ announcement, message }` を返す。`announcement` は変更後の本文を持つアプリ内モデル、`message` は応答の成功文言 | 実装済 |
| ANA-08 | 既定モック | 表示 ON・本文 `''` で `updateAnnouncement` | 400 の `ApiError` で拒否され、`message` が応答の `detail` になる | 実装済 |
| ANA-09 | 既定モック | 本文 501 文字で `updateAnnouncement` | 422 の `ApiError` で拒否され、`message` に項目名 `本文` と理由が入る | 実装済 |
| ANA-10 | 既定モック | 現在値と違う `updatedAt` で `updateAnnouncement` | 409 の `ApiError` で拒否される | 実装済 |
| ANA-11 | 既定モック | `fetchAnnouncementHistory()` | `limit=50` / `offset=0` を送り、`{ items, total }` を返す。`total` はフィクスチャの件数、`items` は先頭 50 件で先頭行がフィクスチャ先頭行の値（`operation` / `operationLabel` / `operator` / `message` / `operatedAt`） | 実装済 |
| ANA-12 | 既定モック | `fetchAnnouncementHistory({ limit, offset })` | 渡した `limit` / `offset` がクエリに載り、フィクスチャのその範囲が返る | 実装済 |
| ANA-13 | 変更後データが `null`、本文が文字列でない、本文が `null`、壊れた JSON 文字列、object でない JSON 文字列の行 | `fetchAnnouncementHistory()` | いずれの行も `message` が `''` になる（一覧全体は落ちない） | 実装済 |
| ANA-14 | `histories` / `total` を持たない応答 | `fetchAnnouncementHistory()` | `{ items: [], total: 0 }` を返す | 実装済 |
| ANA-15 | 既定モック | `updateAnnouncement(入力)` | リクエストに `X-User-Code` ヘッダが載る | 実装済 |
| ANA-16 | 変更後データが JSON 文字列（実 API の形。行の全項目の写し）の行と object の行 | `fetchAnnouncementHistory()` | どちらの行も `message` に `本文` が入る | 実装済 |
