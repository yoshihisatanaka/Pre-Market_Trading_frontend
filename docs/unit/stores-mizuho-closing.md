# stores/mizuhoClosing（みずほ注文締の締め状態と操作のストア）

- 略号: `MCS`
- 対象: `src/stores/mizuhoClosing.js`
- テスト: `src/stores/mizuhoClosing.spec.js`

締め状態の照会と、締めカードの 3 操作（締め・締め解除・注文ファイル作成）を持つ。
取得（`loading` / `error`）と操作（`saving` / `saveError`）は分ける。
MSW の既定ハンドラ（`src/mocks/handlers/closing.js` / `mizuho.js`）に当てる。締め状態はハンドラの中で書き換わり、
注文ファイルは締め済でないと 400 になるので、注文ファイルのシナリオは先に `close()` で締めておく。
`beforeEach(() => setActivePinia(createPinia()))`。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MCS-01 | 既定モック | `load()` を呼ぶ | `status.closed` が false、`isEmpty` が false、`loading` は false に戻る | 実装済 |
| MCS-02 | 応答の本文が空 | `load()` | `status` が null、`isEmpty` が true | 実装済 |
| MCS-03 | `GET /closing/status` が 500 | `load()` | `error.message` に理由が入り、`isEmpty` は false（エラーは空ではない） | 実装済 |
| MCS-04 | 応答を握ったまま | `load()` を呼ぶ | `loading` が true、`isEmpty` は false | 実装済 |
| MCS-05 | 既定モック（受付中）を `load()` 済み | `close()` | 操作後の状態を返し、`status` がそれに差し替わる（`closed` が true、`updatedAt` と `operator` が埋まる）。照会は取り直さない | 実装済 |
| MCS-06 | MCS-05 のあと | `reopen()` | `status.closed` が false に戻り、`updatedAt` が埋まったまま | 実装済 |
| MCS-07 | `POST /closing/mizuho` が 403。受付中を `load()` 済み | `close()` | `null` を返し、`saveError.message` に理由が入る。`error` は null のままで、`status.closed` は false のまま | 実装済 |
| MCS-08 | `POST /closing/mizuho` の応答を握ったまま | `close()` を呼ぶ | `saving` が true。応答が返ると false に戻る。取得の `loading` は立たない | 実装済 |
| MCS-09 | `close()` 済み（締め済） | `createOrderFiles()` | `side=buy` → `side=sell` の順に要求し、`files` に買い・売りの 2 冊（`side` / `filename` / 件数）が入る。`failedSide` は null | 実装済 |
| MCS-10 | `close()` 済み。売りの要求だけ 500 | `createOrderFiles()` | `files` は買いの 1 冊だけ、`failedSide` が `'sell'`、`saveError.message` に理由が入る | 実装済 |
| MCS-11 | 受付中のまま（買いから 400） | `createOrderFiles()` | `files` が空、`failedSide` が `'buy'`、`saveError.message` が 400 の理由。売りは要求しない | 実装済 |
| MCS-12 | MCS-07 のあと | `clearSaveError()` | `saveError` が null になる | 実装済 |
