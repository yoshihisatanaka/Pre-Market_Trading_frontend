# stores/activityLogTargets（操作ログの対象種別のストア）

- 略号: `ALT`
- 対象: `src/stores/activityLogTargets.js`
- テスト: `src/stores/activityLogTargets.spec.js`

操作ログ画面の「対象種別」プルダウンの選択肢を配るストア。中身はバックエンドの定義で画面を開くたびに
変わるものではないので、**一度取れたら読み直さない**（`ensureLoaded`）。失敗したときだけ次回に再試行する。
同種の文書は [stores-codes.md](stores-codes.md)。

期待値はフィクスチャ（`src/mocks/fixtures/activityLogTargets.js`）から導く。
「読み直さない」はリクエストが飛ばないこととして外から観察する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ALT-01 | 未取得 | `options` / `targets` を読む | どちらも空配列（取得前でも select を描ける） | 実装済 |
| ALT-02 | 既定モック | `ensureLoaded()` を呼ぶ | `options` がフィクスチャと同じ件数・同じ並びの `{ value: 対象種別, label: 対象種別名 }` になる | 実装済 |
| ALT-03 | 既定モック。取得済み | 選択肢の 1 件を読む | `value` / `label` の 2 キーだけを持つ | 実装済 |
| ALT-04 | 既定モック。取得済み | もう一度 `ensureLoaded()` を呼ぶ | リクエストを送らず、選択肢はそのまま | 実装済 |
| ALT-05 | API の応答が遅い | `ensureLoaded()` を 2 回続けて呼ぶ（1 回目の応答前） | 取得中は `loading` が `true`。リクエストは 1 本だけで、2 回目も同じ取得の完了を待てる（Promise が返る）。完了後に選択肢が入り `loading` が `false` になる | 実装済 |
| ALT-06 | API が 500 を返す | `ensureLoaded()` を呼ぶ | `error` に理由が入り、`options` は空配列のまま | 実装済 |
| ALT-07 | 1 回目だけ API が 500、以降は既定 | `ensureLoaded()` を 2 回呼ぶ | 2 回目で読み直し、選択肢が入って `error` が消える | 実装済 |
