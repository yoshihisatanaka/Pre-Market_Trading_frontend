# utils/stockTypes（銘柄マスタの区分）

- 略号: `STT`
- 対象: `src/utils/stockTypes.js`
- テスト: `src/utils/stockTypes.spec.js`

`規制情報`（取引可否）・`注文ルート`（預託先区分）・`VWAP対象区分` の 3 つについて、
検索セレクトの選択肢と一覧セルの表示名を持つ対応表。CA種別（[utils-ca-types.md](utils-ca-types.md)）と同じ形。

**コード値そのものは固定しない。** `docs/api/openapi.json` の `StockItem` に enum が無く、
`規制情報` の 0:取引可 / 1:取引不可 は画面モックに合わせた**仮置き**だから
（`src/utils/stockTypes.js` の冒頭コメント参照）。ここで守るのは値ではなく**振る舞い**で、
期待値は選択肢定数そのものから導く。バックエンドの対応表が確認できて定数が差し替わっても、
「選択肢の形」「未知の値は `'—'` / `false`」は変わらない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| STT-01 | — | `REGULATION_OPTIONS` / `ORDER_ROUTE_OPTIONS` / `VWAP_TARGET_OPTIONS` を読む | いずれも `{ value, label }` の配列。`value` は空でない文字列で重複が無く、`label` も空でない | 実装済 |
| STT-02 | — | `formatRegulation` / `formatOrderRoute` / `formatVwapTarget` を、対応する選択肢の `value` で呼ぶ | その選択肢の `label` が返る（期待値は選択肢定数から導き、仮置きのコード値を直接書かない） | 実装済 |
| STT-03 | — | 同じ 3 つの関数を未知のコード・空文字・未設定・`null` で呼ぶ | いずれも `'—'`（他の列の空値表現とそろえる） | 実装済 |
| STT-04 | — | `isRegulation` / `isOrderRoute` / `isVwapTarget` を、対応する選択肢の `value` で呼ぶ | `true` が返る | 実装済 |
| STT-05 | — | 同じ 3 つの関数を未知の値・空文字・数値・未設定・`null` で呼ぶ | `false` が返る（実 API の値は文字列なので数値は受け付けない） | 実装済 |
