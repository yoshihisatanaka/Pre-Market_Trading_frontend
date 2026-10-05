# api/calculationSettings（仮計算マスタ API 層）

- 略号: `PCA`
- 対象: `src/api/calculationSettings.js`
- テスト: `src/api/calculationSettings.spec.js`

ここだけが**バックエンドの形**（`/masters/calculation-settings` というパス・日本語キー・
`{ success, calculation_setting, message }` の包み）を知ってよい層なので、この文書は
「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。

ストア（[stores-calculation-settings.md](stores-calculation-settings.md)）と画面
（[views-calculation-settings-master-view.md](views-calculation-settings-master-view.md)）のテストは
MSW のモックが返す結果を見ているので、モックとサーバの理解がずれていても気づけない。
そこでこの文書では**送信されたリクエストそのもの**を `docs/api/openapi.json` の
`CalculationSettingUpdateRequest` と突き合わせる。

`CalculationSettingUpdateRequest` は部分更新（送らなかった項目はサーバ側で保たれる）なので、
画面に出さない `消費税率` / `譲渡益所得税率` / `譲渡益住民税率` / `備考` は**送らない**のが正しい形
（スライス基準マスタの `備考` とは逆。あちらは省略すると NULL に落ちる旧仕様の名残）。

単位は API のまま持つ（取引所税率は比率、現地手数料率は bp）。% への換算は画面の責務なのでこの層では見ない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| PCA-01 | 既定モック | `fetchCalculationSettings()` を呼ぶ | `GET /api/masters/calculation-settings` を呼ぶ。クエリは付けない（単一リソースなので絞り込みが無い） | 実装済 |
| PCA-02 | API が `CalculationSettingItem` を返す | `fetchCalculationSettings()` を呼ぶ | 日本語キーが camelCase（`id` / `fxSpread` / `localCommissionBp` / `exchangeTaxRate` / `consumptionTaxRate` / `capitalGainsIncomeTaxRate` / `capitalGainsResidentTaxRate` / `nisaFxMarkupRate` / `note` / `updatedAt` / `updatedBy`）に変換される。値と単位はそのまま | 実装済 |
| PCA-03 | API が `備考` / `更新日時` / `更新者` を null で返す | `fetchCalculationSettings()` を呼ぶ | `note` / `updatedAt` / `updatedBy` が `null` で返る（空文字に丸めない） | 実装済 |
| PCA-04 | API が本文なし（204）を返す | `fetchCalculationSettings()` を呼ぶ | `null` を返す。例外にはしない | 実装済 |
| PCA-05 | 既定モック | `updateCalculationSettings()` を呼ぶ | `PUT /api/masters/calculation-settings` の本文がちょうど 5 キー（`取引所税率` / `現地手数料率_bp` / `為替スプレッド` / `NISA為替上乗せ率` / `更新日時`）で、渡した値がそのまま載る | 実装済 |
| PCA-06 | 既定モック | `updateCalculationSettings()` を呼ぶ | 本文に `消費税率` / `譲渡益所得税率` / `譲渡益住民税率` / `備考` が**含まれない**（部分更新なので送らなければサーバ側で保たれる） | 実装済 |
| PCA-07 | API が `{ success, calculation_setting, message }` を返す | `updateCalculationSettings()` を呼ぶ | 戻り値が `{ settings, message }` になり、`settings` は camelCase のモデル、`message` はサーバの文言 | 実装済 |
| PCA-08 | `VITE_USER_CODE` が設定されている | `updateCalculationSettings()` を呼ぶ | リクエストに `X-User-Code` ヘッダが載る（実 API が操作者コードを見るため） | 実装済 |
| PCA-09 | API が 422（`detail` が 2 件）を返す | `updateCalculationSettings()` を呼ぶ | `ApiError` の `status` が 422 になり、`message` に 2 件ぶんが項目名付きで ` / ` 連結で入る | 実装済 |
| PCA-10 | API が 409（`detail` が文字列）を返す | `updateCalculationSettings()` を呼ぶ | `ApiError` の `status` が 409 になり、`message` がサーバの文言そのものになる | 実装済 |
