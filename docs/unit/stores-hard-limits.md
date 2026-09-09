# stores/hardLimits（ハードリミットストア）

- 略号: `HLS`
- 対象: `src/stores/hardLimits.js`
- テスト: `src/stores/hardLimits.spec.js`

バックエンドの呼称は「スライス注文設定」（`GET` / `PUT /slice-settings`）で、レスポンスのキーは
日本語のまま返る。ストアから外に出るのは `src/api/hardLimits.js` が畳んだ camelCase のモデル。

市場関与率は**比率**（`0.05` = 5%）で持つ。% への換算は画面側の関心なのでストアでは扱わない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| HLS-01 | 既定モック（市場関与率 0.05 / 数量 10000 / 金額 1000000） | `load()` を呼ぶ | `settings` が `participationRate` 0.05、`maxQuantity` 10000、`maxAmount` 1000000 になる。`loading` は false、`error` は null | 実装済 |
| HLS-02 | 取得が 500（`message` 付き）を返す | `load()` を呼ぶ | `error` に status 500 と message を持つエラーが入り、`settings` は null のまま。`loading` は false | 実装済 |
| HLS-03 | 取得が本文なしを返す | `load()` を呼ぶ | `isEmpty` が true になり、`settings` は null | 実装済 |
| HLS-04 | 既定モックを読み込み済み | `save({ participationRate: 0.03, maxQuantity: 5000, maxAmount: 500000 })` を呼ぶ | 戻り値が更新後の設定になり、`settings` も同じ値に変わる。`saveError` は null | 実装済 |
| HLS-05 | 既定モックを読み込み済み | `save({ participationRate: 0, maxQuantity: 5000, maxAmount: 500000 })` を呼ぶ | 戻り値が null で、`saveError` にエラーが入る。`settings` は 0.05 のまま変わらない | 実装済 |
| HLS-06 | スライス有効フラグが 0 の設定を読み込み済み | 3 つの上限だけを変えて `save()` を呼ぶ | 保存後の `sliceEnabled` が false のまま（画面に無い項目が保存で書き換わらない） | 実装済 |
| HLS-07 | `save()` が失敗した直後 | `clearSaveError()` を呼ぶ | `saveError` が null になる | 実装済 |
