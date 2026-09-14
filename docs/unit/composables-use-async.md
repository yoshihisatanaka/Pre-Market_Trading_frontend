# composables/useAsync（非同期の loading / error / data）

- 略号: `UAS`
- 対象: `src/composables/useAsync.js`
- テスト: `src/composables/useAsync.spec.js`

画面とストアが **try-catch を書かずに済む**ための土台。ここが守る契約は 2 つ。

- **失敗を例外として外へ出さない。** `execute()` は失敗しても throw せず `null` を返し、
  投げられた値は `error` に入る。呼び出し側は戻り値と `error` だけを見ればよい
- **エラーを加工しない。** 投げられた値をそのまま `error` に入れる。文言・`status` の正規化は
  [api-client.md](api-client.md)（`ApiError`）の担当で、この層は素通しする

この層は HTTP を知らないので、テストでも MSW を使わず `fn` にスタブを渡して検証する。

追い越し（古い応答が新しい結果を上書きする）についても線引きをここで固定する。
**`useAsync` は競合をガードしない**（UAS-17 / UAS-18）。一覧のページャー連打などで実際に
困るのは呼び出し側なので、`src/composables/useCrudList.js` が `latestToken` で自前に防いでいる。
新しい呼び出し側が同じ問題を踏んだときに「`useAsync` が守ってくれるはず」と誤解しないための行。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| UAS-01 | 第 2 引数なし | `useAsync(fn)` を呼ぶ | `data` が `null`、`error` が `null`、`loading` が `false`。`fn` はまだ 1 度も呼ばれない（生成だけでは実行しない） | 実装済 |
| UAS-02 | `initialData` にオブジェクトを渡す | `useAsync(fn, { initialData })` を呼ぶ | `data` が渡した値そのもの（同一参照） | 実装済 |
| UAS-03 | `fn` が解決を保留する Promise を返す | `execute()` を呼び、解決前後を見る | 解決前は `loading` が `true`、解決後は `false` | 実装済 |
| UAS-04 | `fn` が値を返す | `execute()` を呼ぶ | `data` がその値（同一参照）になり、`execute` の戻り値も `data.value` と一致する | 実装済 |
| UAS-05 | `fn` が `undefined` を返す（成功） | `execute()` を呼ぶ | 戻り値は `undefined` で `null` ではない（失敗時の `null` と区別がつく）。`error` は `null` のまま | 実装済 |
| UAS-06 | `fn` が成功する | `execute('a', 2, { c: 3 })` を呼ぶ | `fn` が同じ 3 引数（オブジェクトは同一参照）で呼ばれる | 実装済 |
| UAS-07 | `fn` が成功する | `execute()` を引数なしで呼ぶ | `fn` も引数なしで呼ばれる（`undefined` を 1 つ足さない） | 実装済 |
| UAS-08 | `fn` が例外を投げる | `execute()` を呼ぶ | 例外は外へ伝播せず、戻り値が `null`（呼び出し側が try-catch を書かなくてよい） | 実装済 |
| UAS-09 | `fn` が Error を投げる | `execute()` を呼ぶ | `error` に投げられた Error オブジェクトそのものが入る（同一参照。ラップも文言の書き換えもしない） | 実装済 |
| UAS-10 | `fn` が例外を投げる | `execute()` を呼ぶ | `loading` が `false` に戻る（失敗しても読み込み中のまま固まらない） | 実装済 |
| UAS-11 | `initialData` を渡した後、`fn` が例外を投げる | `execute()` を呼ぶ | `data` は直前の値のまま（失敗で表示中のデータを消さない） | 実装済 |
| UAS-12 | `fn` が Error でない値（文字列）を投げる | `execute()` を呼ぶ | `error` にその値がそのまま入り、戻り値は `null` | 実装済 |
| UAS-13 | 1 回目が失敗した状態 | 2 回目の `execute()` が成功する | `error` が `null` に戻り、`data` が新しい結果になる（前回のエラーが残らない） | 実装済 |
| UAS-14 | 1 回目が失敗した状態 | 2 回目の `execute()` を呼び、解決前に `error` を見る | `error` は解決を待たず開始時点で `null`（再試行中に古いエラーが表示されない） | 実装済 |
| UAS-15 | 1 回目が失敗した状態 | 2 回目の `execute()` も別の Error で失敗する | `error` が新しい方の Error に入れ替わる | 実装済 |
| UAS-17 | 1 回目が遅く、2 回目が先に解決する（応答の追い越し） | `execute('old')` と `execute('new')` を続けて呼び、2 回目 → 1 回目の順に解決させる | 最後に解決した 1 回目の結果で `data` が上書きされる（この層は追い越しを防がない。防ぐのは呼び出し側の責務で、`useCrudList` は `latestToken` で自前に防いでいる） | 実装済 |
| UAS-18 | 2 本の `execute` が同時に走っている | 先に片方だけ解決させる | もう一方が未完了でも `loading` が `false` になる（同時実行の本数を数えていない） | 実装済 |
