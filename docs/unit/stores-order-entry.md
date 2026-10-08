# stores/orderEntry（新規注文のストア）

- 略号: `NOS`
- 対象: `src/stores/orderEntry.js`
- テスト: `src/stores/orderEntry.spec.js`

MSW の既定ハンドラ（顧客・銘柄・受注不可日・海外休場日・発注停止・事前検証・登録・為替）に当てて、
初期読み込み・顧客と銘柄の照会・事前検証・登録・為替の状態を守る。`beforeEach(() => setActivePinia(createPinia()))`。
照会は入力のたびに走るので、**追い越された応答で結果を上書きしない**ことを、後の要求を先に解決させて確かめる。
期間指定の起点 `today` は引数で固定する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| NOS-01 | 受注不可日 1 件・終日休場 1 件の応答 | `loadContext(today)` | `context.closedDates` に両方の日付（`'YYYY-MM-DD'`）が入り、`ordersSuspended` は false | 実装済 |
| NOS-02 | 既定モック | `loadContext(today)` | 受注不可日・海外休場日の取得に今日から 45 日後（`CALENDAR_LOOKAHEAD_DAYS`）までの期間が載り、海外休場日は `holiday_type=0`（終日休場）だけを求める | 実装済 |
| NOS-03 | 全体（ALL）停止中 / ルートだけ停止中 | `loadContext(today)` | 全体停止のときだけ `ordersSuspended` が true | 実装済 |
| NOS-04 | 受注不可日の取得が 500 | `loadContext(today)` | `contextError` に理由が入り、`context` は null、`contextLoading` は false に戻る | 実装済 |
| NOS-05 | 既定モック | `lookupCustomer({ branchCode: '123', accountNumber: '1230001' })` | `customerLookup.customer` がフィクスチャのその口座（顧客名）になる | 実装済 |
| NOS-06 | 既定モック | 部店を空で `lookupCustomer({ branchCode: '', accountNumber: '1230004' })` | 口座番号だけで引き当たる | 実装済 |
| NOS-07 | 既定モック | 存在しない口座番号で `lookupCustomer()` | 例外にせず `customer` が null の結果になり、`customerError` は null | 実装済 |
| NOS-08 | 既定モック | `lookupSymbol('AAPL')` / `lookupSymbol('AAP')` | `?symbol=` で入力が送られ、AAPL はフィクスチャの銘柄コードの銘柄が引ける。AAP は部分一致の行があっても完全一致しないので `symbol` が null | 実装済 |
| NOS-17 | 既定モック | AAPL の銘柄コード（`S001`）で `lookupSymbol()` | 銘柄コードの完全一致で AAPL の銘柄が引け、`symbolLookup.ticker` は入力した銘柄コードのまま | 実装済 |
| NOS-09 | 先の照会の応答を握る | 口座 A → 口座 B の順に照会し、B を先に、A を後に解決させる | `customerLookup` は B の結果のまま（A の遅れた応答で上書きしない） | 実装済 |
| NOS-10 | 先の照会の応答を握る | ティッカー A → B の順に照会し、B を先に、A を後に解決させる | `symbolLookup` は B の結果のまま | 実装済 |
| NOS-11 | 照会の応答を握る | 照会中に `clearCustomer()` / `clearSymbol()` を呼んでから解決させる | `customerLookup` / `symbolLookup` は null のまま（走っていた結果を捨てる） | 実装済 |
| NOS-12 | 顧客の取得が 500 | `lookupCustomer()` | 戻り値は null で `customerError` に理由が入る | 実装済 |
| NOS-13 | 既定モック / `POST /orders/validate` が 500 | `validate(注文)` | 成功時は `{ valid, errors, warnings }` を返し、500 のときは null を返して `validateError` に理由が入る | 実装済 |
| NOS-14 | 既定モック / `POST /orders` が 500 | `submit(注文)` | 成功時は `success: true` と注文 ID を返し、500 のときは null を返して `submitError` に理由が入る | 実装済 |
| NOS-15 | 既定モック / 為替が 404 | `loadFxRate()` | 成功時は `fxRate` がフィクスチャの為替レート、404 のときは `fxRate` が null で `fxError` も null（`src/api/fxRates.js` は 404 を「レートがまだ無い」として null で返す） | 実装済 |
| NOS-16 | 読み込み・照会・為替・エラーが残っている | `reset()` | 照会結果・照会のエラー・事前検証と登録のエラー・為替が消え、`context` は残る | 実装済 |
