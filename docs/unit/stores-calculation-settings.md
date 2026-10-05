# stores/calculationSettings（仮計算マスタストア）

- 略号: `PCS`
- 対象: `src/stores/calculationSettings.js`
- テスト: `src/stores/calculationSettings.spec.js`

仮計算マスタは DB に 1 行だけの設定（`GET` / `PUT /masters/calculation-settings`）。ストアから外に出るのは
`src/api/calculationSettings.js` が畳んだ camelCase のモデルで、単位は API のまま（取引所税率は比率、
現地手数料率は bp）。API 層のリクエストの形そのものは [api-calculation-settings.md](api-calculation-settings.md)（`PCA`）が守る。

保存は部分更新で、ストアが**現在値の `updatedAt` を補って**送る（楽観的ロック）。成功したら PUT の応答で
現在値を差し替え、サーバの文言（「仮計算マスタを変更しました。」/「変更はありません。」）を返す。
取得と保存で `loading` / `error` を分ける（保存に失敗しても現在値の表示を残すため）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| PCS-01 | 既定モック | `load()` を呼ぶ | `settings` がフィクスチャの値（`exchangeTaxRate` / `fxSpread` / `localCommissionBp` / `nisaFxMarkupRate` / `updatedAt` ほか）になる。`loading` は false、`error` は null、`isEmpty` は false | 実装済 |
| PCS-02 | 取得が 500（`detail` 付き）を返す | `load()` を呼ぶ | `error` に status 500 と message を持つエラーが入り、`settings` は null のまま。`loading` は false、`isEmpty` は false | 実装済 |
| PCS-03 | 取得が本文なしを返す（実 API では起きないが、画面の 4 状態を保つための防御） | `load()` を呼ぶ | `isEmpty` が true になり、`settings` は null | 実装済 |
| PCS-04 | 既定モックを読み込み済み | 4 項目を現在値と違う値にして `save()` を呼ぶ | 戻り値が「仮計算マスタを変更しました。」になり、`settings` が更新後の値に変わる。`saveError` は null | 実装済 |
| PCS-05 | 既定モックを読み込み済み | 4 項目を現在値のまま `save()` を呼ぶ | 戻り値が「変更はありません。」になり、`settings` の値は変わらない | 実装済 |
| PCS-06 | 既定モックを読み込み済み | `save()` を呼ぶ | 送られた `更新日時` が読み込んだ `updatedAt` と一致する（呼び出し側は更新日時を渡さない） | 実装済 |
| PCS-07 | 読み込んだ後にサーバ側の更新日時が進んでいる | 4 項目を変えて `save()` を呼ぶ | 戻り値が null で、`saveError` に status 409 と「他のユーザーによって更新されています。最新の情報を取得してからやり直してください。」が入る。`settings` は変わらない | 実装済 |
| PCS-08 | 既定モックを読み込み済み | `NISA為替上乗せ率` を上限（100）超にして `save()` を呼ぶ | 戻り値が null で、`saveError` に status 422 のエラーが入り、メッセージから項目（`NISA為替上乗せ率`）が分かる。`settings` は変わらず、取得側の `error` は null のまま | 実装済 |
| PCS-09 | まだ `load()` していない | `save()` を呼ぶ | 戻り値が null で、PUT は送られない。`saveError` も null のまま | 実装済 |
| PCS-10 | 既定モックを読み込み済み（`備考` などに値がある） | 4 項目を変えて `save()` を呼ぶ | 保存後の `note` / `consumptionTaxRate` / `capitalGainsIncomeTaxRate` / `capitalGainsResidentTaxRate` が元のまま（送らない項目が保存で消えない） | 実装済 |
| PCS-11 | `save()` が失敗した直後 | `clearSaveError()` を呼ぶ | `saveError` が null になる | 実装済 |
| PCS-12 | 既定モックを読み込み済み | `save()` の応答を待つ前に状態を見る | `saving` が true で `loading` は false（保存中に現在値の表示がローディングに切り替わらない）。応答後は `saving` が false | 実装済 |
