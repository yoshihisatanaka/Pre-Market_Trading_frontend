# stores/calculation（仮計算のストア）

- 略号: `TCS`
- 対象: `src/stores/calculation.js`
- テスト: `src/stores/calculation.spec.js`

MSW の既定ハンドラ（`POST /calculations`）に当てて、実行・失敗・やり直し・`reset()` の状態を守る。
`beforeEach(() => setActivePinia(createPinia()))`。応答の待ちは、本文の銘柄で選んだ要求だけを握って再現する。
**前の条件の結果を新しい条件の結果と取り違えない**こと（実行のたびに前の結果を消す・追い越された応答を捨てる）が主眼。

`loadDefaults()` は画面を開いたときの初期値（単価 = 銘柄マスタの前日終値 `GET /masters/symbols`、
為替 = 為替マスタの現在レート `GET /masters/fx/latest`）を並行に引く。意味はモックの `calculations.py`（`_default_input`）と同じ。
取れなかった項目は `null` で返し、例外にしない（画面は空のまま進める）。既定モックの最新レートは 150.25（基準日 2026-07-31）、
AAPL の前日終値は 227.16。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| TCS-01 | 既定モック | `run(条件)` | 戻り値と `result` が仮計算の結果（銘柄・数量が条件のもの）、`error` は null、`loading` は false | 実装済 |
| TCS-02 | 応答を握る | `run(条件)` を呼んで解決前に見る | `loading` が true、`result` は null。解決後は `loading` が false で `result` が入る | 実装済 |
| TCS-03 | 前の結果あり・次の応答を握る | 条件を変えて `run()` | 応答を待つ間は `result` が null（前の結果を残さない）。解決後は新しい条件の結果 | 実装済 |
| TCS-04 | 前の結果あり・API が 400（存在しない銘柄） | `run(条件)` | 戻り値は null、`error` にサーバの理由、`result` は null（前の結果を残さない）、`loading` は false | 実装済 |
| TCS-05 | 前回が失敗（`error` あり） | 正しい条件で `run()` | `error` が null に戻り、`result` が入る | 実装済 |
| TCS-06 | 結果とエラーが残っている | `reset()` | `result` / `error` が null、`loading` が false | 実装済 |
| TCS-07 | 応答を握る | `run()` → `reset()` → 応答を解決（成功） | `result` は null のまま（あとから届いた結果を捨てる） | 実装済 |
| TCS-08 | 応答を握る・その要求は 400 になる | `run()` → `reset()` → 応答を解決（失敗） | `error` は null のまま（あとから届いた失敗を捨てる） | 実装済 |
| TCS-09 | 先の要求（銘柄 A）の応答を握る | A → B の順に `run()` し、B を先に、A を後に解決させる | `result` は B の結果のまま（A の遅れた応答で上書きしない） | 実装済 |
| TCS-10 | 先の要求（銘柄 A）の応答を握る・A は 400 になる | A → B の順に `run()` し、B を先に、A を後に解決させる | `error` は null、`result` は B の結果のまま（追い越された要求の失敗を出さない） | 実装済 |
| TCS-11 | 先の要求（A）と後の要求（B）の両方を握る | A → B の順に `run()` し、A だけを先に解決させる | B を待っている間は `loading` が true のまま（A の終わりで false に戻らない）。B が解決したら false | 実装済 |
| TCS-12 | 既定モック | `loadDefaults({ symbol: 'aapl' })` / `loadDefaults({ symbol: 'S001' })`（銘柄コード）/ `loadDefaults()`（銘柄なし）/ `loadDefaults({ symbol: 'ZZZZ' })`（銘柄マスタに無い） | ティッカー・銘柄コードのどちらでも `unitPrice` は AAPL の前日終値 227.16、`fxRate` は 150.25。銘柄なし・無い銘柄は `unitPrice` が null で `fxRate` は 150.25。`GET /masters/symbols` は銘柄なしのときは呼ばれない | 実装済 |
| TCS-13 | `GET /masters/fx/latest` が 404 / 500、`GET /masters/symbols` が 500 | `loadDefaults({ symbol: 'AAPL' })` | 失敗した項目だけ null（404 の為替は null・単価は 227.16、500 の為替も同じ。銘柄が 500 なら単価 null・為替 150.25）。例外は投げず、`error`（仮計算の結果のエラー）は null のまま | 実装済 |
| TCS-14 | 為替・銘柄の応答を握る | `loadDefaults({ symbol: 'AAPL' })` → `reset()` → 応答を解決 | 戻り値は両方 null（開き直したあとに届いた初期値を捨てる） | 実装済 |
