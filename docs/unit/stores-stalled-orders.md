# stores/stalledOrders（滞留注文抽出ストア）

- 略号: `SOS`
- 対象: `src/stores/stalledOrders.js`
- テスト: `src/stores/stalledOrders.spec.js`（未実装）
- E2E 側のシナリオ: [docs/e2e/stalled-orders.md](../e2e/stalled-orders.md)

ページャを持たないので `useCrudList` ではなく `useAsync` を直に使う。
1 回の検索で 2 本の一覧が同時に埋まるため、空状態の判定も 2 本ある。
1 件の形は `src/api/stalledOrders.js` の JSDoc を参照。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| SOS-01 | まだ `load()` を呼んでいない | — | `orderErrors` / `workingOrders` はどちらも空配列 | 未着手 |
| SOS-02 | 既定モック | `load()` を呼んで応答を待つ | `orderErrors` 3 件 / `workingOrders` 2 件になる | 未着手 |
| SOS-03 | 応答がまだ返っていない | `load()` を呼ぶ | `loading` が true になり、空状態のフラグはどちらも false のまま | 未着手 |
| SOS-04 | API が 500 を返す | `load()` を呼んで応答を待つ | `error` にその理由が入り、空状態のフラグは false のまま（エラーと空が二重に出ない） | 未着手 |
| SOS-05 | 両方 0 件を返す | `load()` を呼んで応答を待つ | `isOrderErrorsEmpty` / `isWorkingOrdersEmpty` がどちらも true | 未着手 |
| SOS-06 | 注文エラーだけ 0 件を返す | `load()` を呼んで応答を待つ | `isOrderErrorsEmpty` だけが true になる | 未着手 |
| SOS-07 | `load({ branchCode: '123' })` を呼んだあと | `reload()` を呼ぶ | 直前と同じ条件で引き直される | 未着手 |
| SOS-08 | 一度失敗したあと | `reload()` を呼ぶ | `error` が消えて結果が入れ替わる | 未着手 |
