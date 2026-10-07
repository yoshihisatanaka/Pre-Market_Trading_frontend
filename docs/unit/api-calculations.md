# api/calculations（仮計算 API 層）

- 略号: `TCA`
- 対象: `src/api/calculations.js`
- テスト: `src/api/calculations.spec.js`

`POST /calculations` に送る本文（CalculationRequest の日本語キー・口座番号は integer・空欄の任意項目は `null`）と、
応答（CalculationResponse。円貨 / 外貨の 2 系統）からアプリ内モデル `Calculation` への変換を守る。
期待値は MSW の既定ハンドラと同じ計算（`src/mocks/fixtures/calculations.js` の `buildCalculationResponse`）と、
顧客・銘柄・預りのフィクスチャから導く。400 / 422 は `ApiError`（`client.js` が `detail` を `message` にする）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| TCA-01 | 既定モック・任意項目はすべて空（`null`）・消費税不要なし | `calculate(条件)` | 本文が CalculationRequest の日本語キーで送られ、口座番号は integer、銘柄コード・区分はそのまま、任意の 13 項目は `null`（キーは残る）、消費税不要区分は `false` | 実装済 |
| TCA-02 | 為替・現地手数料・現地取引税・諸経費・手数料パターン・掛目・BP・下限上限をすべて入力・消費税不要あり | `calculate(条件)` | 各値が対応する日本語キー（`feeMin` → 手数料下限、`feeMax` → 手数料上限、`basisPoints` → BP、`feeMultiplier` → 掛目 など）に数値のまま載り、消費税不要区分は `true` | 実装済 |
| TCA-03 | 既定モック・口座 1230001・AAPL（ティッカー）・売り・特定 | `calculate(条件)` | 口座番号は文字列、銘柄コードはサーバが引き直した正式コード、`fxBaseDate` は為替基準日の `'YYYY-MM-DD'`、出所ラベル・計算パラメータ・残高はサーバの値のまま、`foreign` / `yen` は外貨 / 円貨の値、円貨の外貨専用項目（約定金額・現地費用）は `null`、`warnings` は `[]` | 実装済 |
| TCA-04 | 為替レートを手入力 | `calculate(条件)` | `fxRateSource` / `spreadSource` が「ハンド入力」、`spread` は 0、`fxBaseDate` は `''`（基準日が `null`） | 実装済 |
| TCA-05 | 応答の `warnings` が配列でない・Ticker / 銘柄名 / 残高数量が無い・null 許容の数値項目が文字列 | `calculate(条件)` | `warnings` は `[]`、`ticker` / `symbolName` は `''`、`holdingQuantity` と文字列だった項目は `null` | 実装済 |
| TCA-06 | 既定モック・残高を超える売り数量 | `calculate(条件)` | 例外にならず、`warnings` に残高超過の文言（`calculationMessages.overHolding`） | 実装済 |
| TCA-07 | 存在しない銘柄（ZZZZ）・API が 400 | `calculate(条件)` | `ApiError`（status 400）で reject され、`message` がサーバの `detail`（「銘柄コード ZZZZ は存在しません」） | 実装済 |
| TCA-08 | 単価 0・API が 422 | `calculate(条件)` | `ApiError`（status 422）で reject され、`message` の先頭に項目名「単価」が付く | 実装済 |
