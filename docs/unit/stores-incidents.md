# stores/incidents（障害管理ストア）

- 略号: `INS`
- 対象: `src/stores/incidents.js`
- テスト: `src/stores/incidents.spec.js`
- E2E 側のシナリオ: [docs/e2e/incidents.md](../e2e/incidents.md)

停止状態と操作履歴は 1 画面に同時に出すので、**取得も 1 回にまとめる**（`Promise.all`）。
取得口を 2 つに割ると、画面の 4 状態が状態側と履歴側でねじれる。
片方が落ちたら `error` は 1 本だけ立つ（どちらが落ちたかは利用者の関心ではない）。

履歴のページ送り（`loadHistory`）だけは別の取得で、`historyLoading` / `historyError` を使う。
ページ送りに失敗しても停止対象の表と操作は使えるまま残す。1 ページの件数は `INCIDENT_HISTORY_PAGE_SIZE` を `limit` で送る。

`Promise.all` を `src/api/` ではなくここに置くのは、api 層が「1 エンドポイント = 1 関数」だから。
ストアは axios もバックエンドの生の形も知らないので、レイヤ規約には抵触しない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| INS-01 | 既定モック | `load()` を呼ぶ | `status` に停止状態、`targets` に 4 行、`histories` に履歴 4 件が入り、`error` は null | 実装済 |
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
| INS-17 | 既定モック | `load()` を呼ぶ | `historyTotal` がフィクスチャの履歴件数、`historyOffset` が 0 になる | 実装済 |
| INS-18 | 既定モック | `load()` を呼ぶ | 履歴の取得が `limit` = `INCIDENT_HISTORY_PAGE_SIZE`、`offset=0` で送られる | 実装済 |
| INS-19 | 履歴の `total` が 1 ページより多い | `load(INCIDENT_HISTORY_PAGE_SIZE)` を呼ぶ | 履歴がその offset で取得され、`historyOffset` がその値、`histories` がそのページの内容になる | 実装済 |
| INS-20 | `load()` 済み・履歴の `total` が 1 ページより多い | `loadHistory(INCIDENT_HISTORY_PAGE_SIZE)` を呼ぶ | `histories` が 2 ページ目の内容に替わり、`historyOffset` / `historyTotal` が更新される。`status` はそのまま、`error` / `historyError` は null | 実装済 |
| INS-21 | `load()` 済み | `loadHistory()` の解決前に参照する | `historyLoading` が true、`loading` は false のまま（表を消さない） | 実装済 |
| INS-22 | `load()` 済み・履歴の取得だけが 500 を返す | `loadHistory(INCIDENT_HISTORY_PAGE_SIZE)` を呼ぶ | `historyError` が立ち、`historyOffset` は要求した値に動く。`error` は立たず、`status` / `targets` は元のまま残る | 実装済 |
| INS-23 | INS-22 の状態から API が回復する | `loadHistory()` を引数なしで呼ぶ | 失敗したページの offset で取り直され、`historyError` が null に戻り、`histories` がそのページの内容になる | 実装済 |
| INS-24 | 2 ページ目を表示中 | `suspend()` が成功する | 取り直しで履歴が `offset=0` で取得され、`historyOffset` が 0 に戻る | 実装済 |
| INS-25 | ページ送りに失敗して `historyError` がある | `suspend()` が成功する | `historyError` が null に戻る | 実装済 |
| INS-26 | ページ送りに失敗して `historyError` がある | `load()` を呼ぶ | `historyError` が null に戻り、`histories` が入る | 実装済 |
| INS-27 | `load()` 済み | `loadHistory(A)` の応答前に `loadHistory(B)` を呼び、B → A の順に応答が届く | `histories` と `historyOffset` は B のまま（遅れて届いた A の応答で上書きしない） | 実装済 |
| INS-28 | `load()` 済み | `loadHistory(A)` の応答前に `loadHistory(B)` を呼び、B が成功した後に A が 500 で届く | `historyError` は立たず、`histories` は B のまま | 実装済 |
| INS-29 | `load()` 済み | `loadHistory(A)` の応答前に `loadHistory(B)` を呼び、A → B の順に応答が届く | A が届いた時点では `historyLoading` が `true` のまま（B の応答待ちでページャーを押せる状態に戻さない）。B が届くと `false` になり、`histories` と `historyOffset` は B | 実装済 |
