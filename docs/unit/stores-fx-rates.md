# stores/fxRates（為替マスタのストア）

- 略号: `FXS`
- 対象: `src/stores/fxRates.js`
- テスト: `src/stores/fxRates.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/fxRates.js`）に当てて、現在レートの取得（latest → 詳細）と
4 状態のもとになる `loading` / `error` / `isEmpty`、**当日（JST）の行だけを保存する**分岐（今日の行があれば変更、
無ければ登録）と事前検証の出し分けを守る。`beforeEach(() => setActivePinia(createPinia()))`。

「今日」は `vi.useFakeTimers({ toFake: ['Date'] })` で固定する。固定する日はフィクスチャから導く
（最新の有効行の基準日 = 変更の経路、全行より後の日 = 登録の経路）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FXS-01 | 既定モック、今日はフィクスチャの全行（取消済み含む）より後 | `load()` | `rate` が有効行のうち基準日が最新の 1 件（詳細の全項目つき）になる。基準日がより新しい取消済みの行は出ない | 実装済 |
| FXS-02 | 既定モック、今日は最新行の基準日の JST 00:00（UTC ではまだ前日） | `load()` | `rate` が最新行になる（今日を UTC ではなく JST で決めている） | 実装済 |
| FXS-03 | latest が 404 | `load()` | `rate` は null、`error` は null、`isEmpty` が true | 実装済 |
| FXS-04 | latest が 500 | `load()` | `error.message` に理由が入り、`rate` は null、`loading` は false、`isEmpty` は false | 実装済 |
| FXS-05 | latest は成功、詳細が 500 | `load()` | `error` に理由が入り、`rate` は null | 実装済 |
| FXS-06 | 既定モック、今日の行が無い | `save({ rate })` | 今日の基準日・USD・その値で登録された 1 件が返り、`rate` がそれに入れ替わる。前日までの行（元の現在行）は書き換わらない | 実装済 |
| FXS-07 | 既定モック、今日 = 最新行の基準日 | `save({ rate })` | 同じ `id` の行がその値で変更されて返り、`rate` がそれに入れ替わる（新しい行を作らない） | 実装済 |
| FXS-08 | 今日 = 最新行の基準日、PUT を記録するハンドラ | `save({ rate })` | `PUT /masters/fx/{現在行の ID}` の本文が `基準日` = 今日・`通貨コード` = USD・`為替レート` = その値・`更新日時` = 取得時の値 になる | 実装済 |
| FXS-09 | validate が `valid: false` | `save({ rate })` | null を返し、`validationErrors` に理由が入る。`saveError` は null、`rate` は変わらない（保存しない） | 実装済 |
| FXS-10 | 既定モック、一般的な範囲から外れるレート | `save({ rate })` | null を返し、`validationWarnings` に警告が入る。`rate` は変わらない（保存しない） | 実装済 |
| FXS-11 | FXS-10 と同じレート | `save({ rate, acknowledgedWarnings: true })` | 保存された 1 件が返り、`validationWarnings` は空 | 実装済 |
| FXS-12 | 既定モック、レート 0（本文の型違反） | `save({ rate: 0 })` | null を返し、`saveError` が 422 で `message` に「為替レート: 」の前置付きの理由が入る。`validationErrors` は空 | 実装済 |
| FXS-13 | 今日 = 最新行の基準日、PUT が 409 | `save({ rate })` | null を返し、`saveError.message` に detail が入る。`rate` は変わらない | 実装済 |
| FXS-14 | FXS-12 / FXS-10 の後 | `clearSaveError()` | `saveError` / `validationErrors` / `validationWarnings` がすべて空に戻る | 実装済 |
