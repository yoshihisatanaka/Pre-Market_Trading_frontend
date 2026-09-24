# stores/marketStatus（市場状況）

- 略号: `MSS`
- 対象: `src/stores/marketStatus.js`
- テスト: `src/stores/marketStatus.spec.js`
- API 側のシナリオ: [api-market-status.md](api-market-status.md)

全画面共通・起動時 1 回のストア（`stores/codes.js` と同じ型）。検索条件もページングも無い
単一リソースなので `useCrudList` ではなく `useAsync` を直に使う（`stores/permissions.js` と同じ）。

**このストアは「サーバが言ったこと」を持つだけ**で、表示に必要な加工は
`utils/marketStatus` の `toMarketDisplay()`（[utils-market-status.md](utils-market-status.md)）が行う。
タイマーも持たない（ストアは unmount されないので `setInterval` が永久に残る）。
定期実行は `composables/useMarketStatus` の担当。

**取得に失敗しても `status` は変えない。** 画面を開いたまま一時的に通信が切れたときに、
直前まで出ていた時間帯を消さないため（`MKS-25` と対になる）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MSS-01 | 新しい pinia | ストアを作るだけ | `status` が `null`、`loading` が false、`error` が `null`（通信は起きない） | 実装済 |
| MSS-02 | 通常営業日の応答を返すハンドラ | `load()` | `status` にアプリ内モデルが入り、`error` は `null` のまま | 実装済 |
| MSS-03 | 同上 | `load()` を await せずに見る | 呼び出した直後に `loading` が true、解決後に false | 実装済 |
| MSS-04 | 500 を返すハンドラ | `load()` | `error` に `ApiError` が入り、`status` は `null` のまま | 実装済 |
| MSS-05 | 1 度成功したあと 500 を返すハンドラに差し替え | もう一度 `load()` | `error` が入るが、`status` は**前回の値のまま**残る | 実装済 |
| MSS-06 | 1 度 `load()` 済み | 別の応答を返すハンドラに差し替えて `load()` | `status` が新しい応答に差し替わり、`error` は `null` に戻る | 実装済 |
