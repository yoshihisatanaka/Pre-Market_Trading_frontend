# stores/incidents（障害管理ストア）

- 略号: `INS`
- 対象: `src/stores/incidents.js`
- テスト: `src/stores/incidents.spec.js`
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

停止状態と操作履歴は 1 画面に同時に出すので、**取得も 1 回にまとめる**（`Promise.all`）。
取得口を 2 つに割ると、画面の 4 状態が状態側と履歴側でねじれる。
片方が落ちたら `error` は 1 本だけ立つ（どちらが落ちたかは利用者の関心ではない）。

`Promise.all` を `src/api/` ではなくここに置くのは、api 層が「1 エンドポイント = 1 関数」だから。
ストアは axios もバックエンドの生の形も知らないので、レイヤ規約には抵触しない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| INS-01 | 既定モック | `load()` を呼ぶ | `status` に停止状態、`targets` に 6 行、`histories` に履歴 4 件が入り、`error` は null | 実装済 |
| INS-02 | 停止状態の取得が 500 を返す | `load()` を呼ぶ | `error` が立ち、`status` は null のまま | 実装済 |
| INS-03 | 履歴の取得が 500 を返す（停止状態は成功） | `load()` を呼ぶ | `error` が立ち、`status` も null のまま（取得は 1 回で、片方の失敗が全体の失敗になる） | 実装済 |
| INS-04 | INS-02 の状態から API が回復する | `load()` を再度呼ぶ | `error` が null に戻り、`status` が入る | 実装済 |
| INS-05 | 取得中 | `load()` の解決前に参照する | `loading` が true、`isEmpty` は false | 実装済 |
| INS-06 | 停止状態が本文なしで返る | `load()` を呼ぶ | `isEmpty` が true、`targets` は空配列になる | 実装済 |
| INS-07 | 停止状態は取れるが履歴が 0 件 | `load()` を呼ぶ | `isEmpty` は false、`hasHistories` が false、`histories` は空配列 | 実装済 |
| INS-08 | 既定モック | `load()` を呼ぶ | `hasHistories` が true になる | 実装済 |
| INS-09 | `load()` 済み | `suspend({ target: '1', reason: 'IB回線障害' })` を呼ぶ | 操作の応答（`message` を持つ）が返る。取り直しにより `targets` の IB 行が停止中になり、`histories` が 5 件になる | 実装済 |
| INS-10 | `load()` 済み | `suspend()` を呼ぶ | 送信本文の `更新日時` が、`targets` の同じ停止対象の行の `updatedAt` になる | 実装済 |
| INS-11 | `load()` 済み・停止 API が 400 を返す | `suspend()` を呼ぶ | `null` が返り、`saveError` が立つ。`error` は立たず、`status` は元のまま残る | 実装済 |
| INS-12 | 停止の実行中 | `suspend()` の解決前に参照する | `saving` が true、`loading` は false のまま（表を消さない） | 実装済 |
| INS-13 | INS-11 の状態 | `clearSaveError()` を呼ぶ | `saveError` が null に戻る | 実装済 |
| INS-14 | `load()` 前（`targets` が空） | `suspend({ target: '1', … })` を呼ぶ | 送信本文の `更新日時` が null になる（合札が無ければ照合させない） | 実装済 |
| INS-15 | IB を停止した後 | `resume({ target: '1' })` を呼ぶ | 操作の応答が返る。取り直しにより IB 行が通常に戻り、`histories` が 1 件増える | 実装済 |
| INS-16 | 再開 API が 400 を返す | `resume()` を呼ぶ | `null` が返り、`saveError` が立つ。`status` は元のまま残る | 実装済 |
