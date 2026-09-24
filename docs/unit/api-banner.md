# api/banner（全画面ヘッダ用バナー API 層）

- 略号: `BNA`
- 対象: `src/api/banner.js`
- テスト: `src/api/banner.spec.js`

> パス・クエリ名が仕様に在るかは `api-contract.md`（`CON`）が見る。ここでは BannerResponse の
> 日本語キー → アプリ内モデルの変換と、nullable 項目の寄せ方だけを守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| BNA-01 | 既定モック（お知らせの現在値が表示中） | `fetchBanner()` | `GET /api/operations/banner` を呼び、`kind` / `severity` が NOTICE 応答の値、`message` と `announcementMessage` がお知らせの現在の本文、`ordersSuspended` は false、`announcementVisible` は true | 実装済 |
| BNA-02 | 応答が発注停止中（INCIDENT） | `fetchBanner()` | `kind` が `INCIDENT`、`ordersSuspended` が true、`suspendedTargets` / `suspendedTargetNames` が応答の配列、`announcementVisible` と `announcementMessage` も応答のまま | 実装済 |
| BNA-03 | 応答が NONE（メッセージ・お知らせ本文が `null`） | `fetchBanner()` | `kind` が `NONE`、`message` と `announcementMessage` は `''`、`announcementVisible` は false | 実装済 |
| BNA-04 | 応答が空のオブジェクト | `fetchBanner()` | `kind: 'NONE'` / `severity: 'normal'` / 文字列は `''` / boolean は false / 配列は `[]` に寄る | 実装済 |
