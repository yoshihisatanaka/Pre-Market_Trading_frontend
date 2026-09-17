# stores/incidents（障害管理ストア）

- 略号: `INS`
- 対象: `src/stores/incidents.js`
- テスト: `src/stores/incidents.spec.js`（未作成）
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

運用状態と障害対応履歴は 1 画面に同時に出すので、**取得も 1 回にまとめる**（`Promise.all`）。
取得口を 2 つに割ると、画面の 4 状態が運用状態側と履歴側でねじれる。
片方が落ちたら `error` は 1 本だけ立つ（どちらが落ちたかは利用者の関心ではない）。

`Promise.all` を `src/api/` ではなくここに置くのは、api 層が「1 エンドポイント = 1 関数」だから。
ストアは axios もバックエンドの生の形も知らないので、レイヤ規約には抵触しない。

**制御の実行（状態遷移）はまだ持たない。** 実装する段で `src/stores/hardLimits.js` の
`saving` / `saveError` と同じ形で 2 本目の `useAsync` を足す（操作に失敗しても現在状態の表示は残すため）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| INS-01 | 既定モック | `load()` を呼ぶ | `status` に運用状態、`histories` に履歴 3 件が入り、`error` は null | 未着手 |
| INS-02 | 運用状態の取得が 500 を返す | `load()` を呼ぶ | `error` が立ち、`status` は null のまま | 未着手 |
| INS-03 | 履歴の取得が 500 を返す（運用状態は成功） | `load()` を呼ぶ | `error` が立ち、`status` も null のまま（取得は 1 回で、片方の失敗が全体の失敗になる） | 未着手 |
| INS-04 | INS-02 の状態から API が回復する | `load()` を再度呼ぶ | `error` が null に戻り、`status` が入る | 未着手 |
| INS-05 | 取得中 | `load()` の解決前に参照する | `loading` が true、`isEmpty` は false | 未着手 |
| INS-06 | 運用状態が本文なしで返る | `load()` を呼ぶ | `isEmpty` が true になる | 未着手 |
| INS-07 | 運用状態は取れるが履歴が 0 件 | `load()` を呼ぶ | `isEmpty` は false、`hasHistories` が false、`histories` は空配列 | 未着手 |
| INS-08 | 既定モック | `load()` を呼ぶ | `hasHistories` が true になる | 未着手 |
