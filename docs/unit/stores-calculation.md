# stores/calculation（仮計算のストア）

- 略号: `TCS`
- 対象: `src/stores/calculation.js`
- テスト: `src/stores/calculation.spec.js`

MSW の既定ハンドラ（`POST /calculations`）に当てて、実行・失敗・やり直し・`reset()` の状態を守る。
`beforeEach(() => setActivePinia(createPinia()))`。応答の待ちは、本文の銘柄で選んだ要求だけを握って再現する。
**前の条件の結果を新しい条件の結果と取り違えない**こと（実行のたびに前の結果を消す・追い越された応答を捨てる）が主眼。

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
