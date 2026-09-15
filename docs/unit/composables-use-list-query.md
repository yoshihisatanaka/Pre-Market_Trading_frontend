# composables/useListQuery（URL クエリと一覧状態の同期）

- 略号: `ULQ`
- 対象: `src/composables/useListQuery.js`
- テスト: `src/composables/useListQuery.spec.js`

一覧画面の「ページ位置と検索条件は URL クエリを正とする単方向フロー」。守る契約は 3 つ。

- **読み込みの入口は URL だけ。** 操作（検索 / ページ移動）は `router.push` するだけで
  `load` を直接呼ばない。`load` は `route.query` の watch からしか走らないので、
  1 操作 = 1 フェッチになり、ブラウザバックやブックマークにも追加のコードなしで追従する
- **既定値（`offset: 0` / 空文字の条件）は URL に出さない。** URL を短く保つためで、
  `?offset=0` と `?` は同じ状態を指す。正規化後に同じなら再フェッチもしない
- **ページ移動は入力欄ではなく URL 側の条件を引き継ぐ。** 入力欄を編集しただけで
  ページ送りしたとき、未検索の条件が混ざらないようにするため

初回読み込みは watch の `immediate` が担い、常に 1 回走る（切り替えるオプションは持たない）。
呼び出し側は `onMounted` での初回読み込みを書かない。

値の正規化そのもの（`?offset=abc` → `0` など）は [utils-query-params.md](utils-query-params.md) の
担当なので、この文書では「正規化を通った値が `load` と再取得の判定に届く」ことだけを見る。
テストは `load` にスタブを渡し、`createMemoryHistory` のルータで URL を動かす
（この層は HTTP もストアも知らないので MSW / Pinia は使わない）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ULQ-01 | filters 2 件、クエリなしの URL | セットアップする | `load` が 1 回だけ、`{ offset: 0, 各 key: '' }` で呼ばれる（呼び出し側が初回読み込みを書かなくてよい） | 実装済 |
| ULQ-02 | filters 2 件、`?offset=<位置>&stock_code=<コード>` | セットアップする | `load` が 1 回、`{ offset: <位置>, stockCode: <コード>, caType: '' }` で呼ばれる。params のキーは URL 名ではなくモデル側の `key` | 実装済 |
| ULQ-03 | 同上 | セットアップ直後の `inputs` を見る | `inputs` が URL の条件で埋まっている（リロードしても検索欄に条件が残る） | 実装済 |
| ULQ-04 | `?offset=abc`（不正な値） | セットアップする | `load` に渡る `offset` が `0`（正規化を通った値だけが外へ出る） | 実装済 |
| ULQ-05 | `parse` 付きの filter に、`parse` が空文字へ落とす値が入った URL | セットアップする | `load` の該当 key と `inputs` の両方が空文字（未知の条件は捨てられる） | 実装済 |
| ULQ-06 | `parse` なしの filter に、同名クエリ 2 個（値が配列になる URL） | セットアップする | 該当 key が空文字（文字列でない値を素通ししない） | 実装済 |
| ULQ-07 | `filters` を省略 | セットアップする | `load` が `{ offset: 0 }` だけで呼ばれ、`inputs` はキーを持たない | 実装済 |
| ULQ-08 | クエリなしでセットアップ済み | `inputs` の値を書き換えるだけ | URL は変わらず、`load` も追加で呼ばれない（inputs → URL の自動反映はしない） | 実装済 |
| ULQ-09 | `inputs` に条件を入れた状態 | `submitSearch()` | URL のクエリが filters の `query` 名（`stock_code` など）になり、`load` がその条件で 1 回だけ呼ばれる | 実装済 |
| ULQ-10 | `?offset=<位置>` で読み込み済み、`inputs` に条件を入れる | `submitSearch()` | URL から `offset` が消える（条件を変えたら 1 ページ目に戻る）。`load` の `offset` も `0` | 実装済 |
| ULQ-11 | `inputs` がすべて空 | `submitSearch()` | URL のクエリが空（`?offset=0` も空の条件も書かない） | 実装済 |
| ULQ-12 | `?stock_code=<コード>` で読み込み済み。`inputs` を別の値に編集するが検索は押さない | `goToOffset(<位置>)` | URL は `offset=<位置>` と編集前の `stock_code=<コード>`。編集中の値は持ち込まれない | 実装済 |
| ULQ-13 | `?offset=<位置>` で読み込み済み | `goToOffset(0)` | URL から `offset` が消え、`load` が `offset: 0` で呼ばれる | 実装済 |
| ULQ-14 | クエリなしで読み込み済み | `goToOffset(<位置>)` | URL が `offset=<位置>`、`load` がその `offset` で 1 回だけ呼ばれる | 実装済 |
| ULQ-15 | 条件とページ位置が入った URL で読み込み済み | `clearSearch()` | URL のクエリが空になり、`inputs` も空に戻り、`load` が既定 params で呼ばれる | 実装済 |
| ULQ-16 | `inputs` に条件を入れて `submitSearch()` 済み | 同じ `inputs` のまま `submitSearch()` をもう一度 | `load` の呼び出しが増えない（同じ状態への遷移で二重フェッチしない） | 実装済 |
| ULQ-17 | クエリなしで読み込み済み（`offset` は 0） | `?offset=0` へ遷移する | `load` の呼び出しが増えない（正規化後に同じ状態なら再取得しない） | 実装済 |
| ULQ-18 | 条件付き URL へ遷移して読み込み済み | ブラウザバック相当の操作 | 戻り先のクエリで `load` が呼ばれ、`inputs` もその URL の条件に戻る | 実装済 |
| ULQ-19 | filters に無いクエリ（`?foo=1`）が付いた URL | `goToOffset(<位置>)` | 新しい URL に `foo` が残らない（URL 上の契約は filters 定義がすべて） | 実装済 |
