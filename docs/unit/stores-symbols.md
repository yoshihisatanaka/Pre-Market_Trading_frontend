# stores/stocks（銘柄マスタのストア）

- 略号: `STS`
- 対象: `src/stores/stocks.js`
- テスト: `src/stores/stocks.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/index.js`）に当てて、取得・ページング・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。

この一覧は**読むだけ**で、登録・更新・削除を持たない。`useCrudList` はそれらの関数を
渡さない限り更新系の名前を公開しないので、「公開していないこと」自体も守る（STS-10）。
登録系まで持つストアの例は [stores-blackout-dates.md](stores-blackout-dates.md)。

表示件数（`STOCKS_PAGE_SIZE`）は**こちらから変えられない値**で、api 層は `limit` を送らない
（[api-stocks.md](api-stocks.md)）。モックも同じ固定値でページを切る。

期待値はフィクスチャ（`src/mocks/fixtures/stocks.js`）と `STOCKS_PAGE_SIZE` から導き、
56 / 50 / `'AAPL'` のような値を直接書かない（フィクスチャが伸びてもテストが壊れないようにする）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| STS-01 | 既定モック | `load()` を引数なしで呼ぶ | `items` が 1 ページ分（`STOCKS_PAGE_SIZE` 件）銘柄コードの昇順で入り、`total` がフィクスチャの全件数、`offset` が 0 になる | 実装済 |
| STS-02 | 既定モック | `load({ offset: STOCKS_PAGE_SIZE })` を呼ぶ | 2 ページ目の残り件数が返り、`offset` が渡した値になる | 実装済 |
| STS-03 | 既定モック | `load({ stockCode: <フィクスチャの Ticker> })` を呼ぶ | その銘柄の行だけが返り、`stockCode` に条件が残る。銘柄コードと Ticker のどちらに当たってもよい（部分一致） | 実装済 |
| STS-04 | 既定モック | `load({ regulation: <取引不可のコード> })` を呼ぶ | 規制情報が一致する行だけが返り、`regulation` に条件が残る | 実装済 |
| STS-05 | 既定モック | `load({ orderRoute, vwapTarget })` を同時に渡して呼ぶ | 2 条件の AND で絞られ、どちらの条件も残る | 実装済 |
| STS-06 | 既定モック | `load({ stockCode: 'ZZZZ' })` を呼ぶ（該当なし） | `items` が空、`total` が 0、`isEmpty` が `true` になる | 実装済 |
| STS-07 | API が 500 を返す | `load()` を呼ぶ | `error` に理由が入り、`items` が空のまま。`isEmpty` は `false`（空とエラーを別の状態として出し分けるため） | 実装済 |
| STS-08 | API の応答が遅い | `load()` を await せずに `loading` を読む | 取得中は `true`、完了後に `false` になる | 実装済 |
| STS-09 | 既定モック。絞り込んだ 2 ページ目を読み込み済み | `reload()` を呼ぶ | 同じ条件・同じ `offset` のまま読み直す（条件が落ちない） | 実装済 |
| STS-10 | 既定モック | ストアの公開名を読む | `create` / `update` / `remove` とその状態（`creating` / `deleting` など）を持たない（読むだけの一覧に更新系を見せない） | 実装済 |
| STS-11 | API の応答が遅い | 2 ページ目 → 1 ページ目の順に `load()` を続けて呼び、先に投げたほうを遅く返す | 最後に投げた `load()` の結果が残る（古い応答が新しい結果を上書きしない） | 実装済 |
