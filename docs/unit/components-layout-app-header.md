# components/layout/AppHeader（共通ヘッダ）

- 略号: `AHD`
- 対象: `src/components/layout/AppHeader.vue`
- テスト: `src/components/layout/AppHeader.spec.js`
- E2E 側のシナリオ: [docs/e2e/layout.md](../e2e/layout.md)

画面タイトルは view ではなくヘッダが `router` の `meta.title` から描画する。
市場ステータスは `utils/marketStatus`（[docs/unit/utils-market-status.md](utils-market-status.md)）の判定を 1 分ごとに反映する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| AHD-01 | ルートの `meta.title` が「注文一覧」 | マウントする | 見出しに「注文一覧」が出る | 実装済 |
| AHD-02 | 「注文一覧」のルートでマウント済 | `meta.title` が「ページが見つかりません」のルートへ遷移 | 見出しが「ページが見つかりません」に変わる | 実装済 |
| AHD-03 | システム時刻が `2026-03-02T14:30:00Z`（NY 09:30） | マウントする | 市場ステータスに「● Regular」が出る | 実装済 |
| AHD-04 | システム時刻が `2026-03-02T20:59:00Z`（NY 15:59）でマウント済 | 60 秒経過する | 市場ステータスが「● After-Hours」に更新される | 実装済 |
| AHD-05 | 任意 | マウントする | 画面固有ボタンの差し込み先が空の状態で描画される | 実装済 |
| AHD-06 | マウント済 | アンマウントする | 定期更新のタイマーが残らない | 実装済 |
