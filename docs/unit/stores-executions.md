# stores/executions（約定照会のストア）

- 略号: `EXS`
- 対象: `src/stores/executions.js`
- テスト: `src/stores/executions.spec.js`

> `useCrudList` に任せている振る舞い（古い応答の破棄・ページング）は `composables-use-crud-list.md` が守るので、
> ここでは**このストア固有の入出力**（件数カードの集計 `summary` を含む）だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/executions.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty`、件数カードの `summary` を守る。
`beforeEach(() => setActivePinia(createPinia()))`。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| EXS-01 | 既定モック | `load()` を呼ぶ | `items` が 1 ページぶん（50 件）、`total` が 56、`summary.count` が 56 になる | 実装済 |
| EXS-02 | 既定モック | `load({ offset: EXECUTIONS_PAGE_SIZE })` | 2 ページ目の 6 件が入る。`summary` はページではなく条件全体の集計のまま（`count` は 56） | 実装済 |
| EXS-03 | 既定モック | `load({ side: 'sell' })` | その条件に合う行だけになり、`summary.sellCount` が `total` と同じ、`summary.buyCount` が 0 になる（件数はフィクスチャから導く） | 実装済 |
| EXS-04 | `GET /executions` が 500 | `load()` | `error.message` に理由が入り、`items` は空、`loading` は false に戻る | 実装済 |
| EXS-05 | 0 件の応答 | `load()` | `isEmpty` が true、`summary.count` が 0 | 実装済 |
| EXS-06 | 1 回目の応答だけ遅らせる | `load({ side: 'buy' })` のあと待たずに `load({ side: 'sell' })` | 遅れて届いた 1 回目の集計で `summary` が上書きされず、2 回目（売り）の集計が残る | 実装済 |
| EXS-07 | 1 度も読み込んでいない | ストアを作る | `summary` が null | 実装済 |
