# composables/useRouteLoading（画面遷移の確定待ち）

- 略号: `RLD`
- 対象: `src/composables/useRouteLoading.js`
- テスト: `src/composables/useRouteLoading.spec.js`
- 使う側: [components-layout-app-layout.md](components-layout-app-layout.md) / [components-layout-app-sidebar.md](components-layout-app-sidebar.md)
- E2E 側のシナリオ: [docs/e2e/layout.md](../e2e/layout.md)

画面は遅延 import なので、vue-router はチャンクが届くまで遷移を確定しない。その間の
「確定待ち」（`isLoading` と行き先の `pendingPath`）をアプリで 1 つだけ持つのがこの composable。
`trackRouteLoading(router)` が router に差し、`useRouteLoading()` は読むだけ。

仕様の要は**解除の条件**で、ここで見るのは router の各フックがどう動いても表示が立ちっぱなし /
途中で消えることが無いこと:

- 行き先のチャンクが届いて遷移が確定したら消える
- 保留中に別の項目を押したら**後から押した方が勝つ**。古い遷移の取り消し（チャンクが遅れて届いてから起きる）で
  新しい表示を消さない
- 現在地への遷移（DUPLICATED）は即座に消す（古い遷移の取り消しを待たない）
- ガードのリダイレクトは**行き先に引き継ぐ**（リダイレクト元では消さない）
- ガードの中止（ABORTED）と、チャンクの取得失敗（`onError` 経路。`afterEach` は来ない）は消す
- 登録を外した後は router の動きに反応しない

テストはメモリ履歴の実ルータに、解決を手で止められる遅延ルート `/slow` と静的ルートを置く。
`router.push()` は await せず、`flushPromises()` で `beforeEach` まで進めてから状態を見る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| RLD-01 | `/` にいる / `/slow` のチャンクが未解決 | `/slow` へ push する | 読み込み中になり、行き先が `/slow` になる | 実装済 |
| RLD-02 | RLD-01 の状態 | `/slow` のチャンクを解決する | push が完了し、読み込み中が解除されて行き先が空になる | 実装済 |
| RLD-03 | `/slow` の確定待ち中 | 静的ルート `/fast` へ push する | `/fast` の完了で解除される。その後 `/slow` のチャンクが届いても解除されたままで、現在地は `/fast` | 実装済 |
| RLD-04 | `/slow` の確定待ち中 | 現在地 `/` へ push する（DUPLICATED） | 即座に解除される（古い遷移の取り消しを待たない）。`/slow` のチャンクが届いても現在地は `/` のまま | 実装済 |
| RLD-05 | `beforeEnter` が `/slow` へリダイレクトするルートがある | そのルートへ push する | 行き先が `/slow` に移って読み込み中のまま。`/slow` のチャンクを解決すると解除される | 実装済 |
| RLD-06 | `beforeEnter` が `false` を返すルートがある | そのルートへ push する | 解除される（ABORTED） | 実装済 |
| RLD-07 | チャンクの取得が失敗（reject）するルートがある | そのルートへ push する（push は失敗する） | 解除される（`afterEach` が来ない `onError` 経路） | 実装済 |
| RLD-08 | `trackRouteLoading` の戻り値で登録を外した | `/slow` へ push する | 読み込み中にならず、行き先も空のまま | 実装済 |
