# api/marketStatus（市場状況の取得）

- 略号: `MSA`
- 対象: `src/api/marketStatus.js`
- テスト: `src/api/marketStatus.spec.js`
- 仕様: `docs/api/openapi.json` の `GET /market-status`（`MarketStatusResponse` / `MarketSessionItem`）

ヘッダの取引時間帯を出すための唯一の通信。**この API は癖が多い**ので、変換がここに閉じている
ことを意識して読む。

- プロパティ名が日本語（`基準日` / `休場` / `現在のセッション` …）
- `US ET` は**空白を含むキー**。`raw['US ET']` でしか読めない
- `基準日` は integer の YYYYMMDD。アプリ内は `'YYYY-MM-DD'`
- `休場理由` / `短縮取引理由` は nullable。アプリ内は空文字に寄せる
- `休場: true` のとき `sessions` は空配列
- `現在のセッション` は **openapi に enum 宣言が無い素の string**（`docs/api/requests.md` #12）

`date` クエリは実装しない。ヘッダが欲しいのは常に「いま」（`m_基準日` の基準日）なので、
使わない引数を先に生やさない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MSA-01 | 通常営業日の応答を返すハンドラ | `fetchMarketStatus()` | `GET /api/market-status` を呼び、クエリを 1 つも付けない | 実装済 |
| MSA-02 | 同上 | 同上 | 日本語キーが camelCase になる（`基準日`→`baseDate` / `サマータイム`→`dst` / `休場`→`closed` / `短縮取引`→`shortened` / `現在のセッション`→`session`） | 実装済 |
| MSA-03 | 同上 | 同上 | `sessions[]` が `{ code, name（日本語）, nameEn（英語）, hoursJst, hoursEt, startJst, endJst, current }` になる（`名称`→`name` / `name`→`nameEn` / `US ET`→`hoursEt`） | 実装済 |
| MSA-04 | `基準日: 20260302` | 同上 | `baseDate` が `'2026-03-02'`（`Date` に通さないので実行環境のタイムゾーンで前日にずれない） | 実装済 |
| MSA-05 | `休場理由: null` / `短縮取引理由: null` | 同上 | `closedReason` / `shortenedReason` が空文字（画面が `null` を出さない） | 実装済 |
| MSA-06 | 休場の応答（`休場: true` / `sessions: []`） | 同上 | `closed` が true、`sessions` が空配列、`closedReason` に理由が入る | 実装済 |
| MSA-07 | `sessions` キーごと欠けた応答 | 同上 | 例外にならず `sessions` は空配列 | 実装済 |
| MSA-08 | 400（`{ detail: '…' }`） | 同上 | `ApiError` が throw され、`status` が 400・`message` が `detail` の文言 | 実装済 |
| MSA-09 | 500 | 同上 | `ApiError` が throw され、`status` が 500 | 実装済 |
| MSA-10 | 短縮取引の応答（`短縮取引: true`） | 同上 | `shortened` が true、`shortenedReason` に理由が入り、`sessions` の終了時刻は短縮後の値のまま渡る | 実装済 |
