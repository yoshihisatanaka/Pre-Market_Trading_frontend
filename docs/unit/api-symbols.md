# api/symbols（銘柄マスタ API 層）

- 略号: `STA`
- 対象: `src/api/symbols.js`
- テスト: `src/api/symbols.spec.js`

ここだけが**バックエンドの形**（パス・英語のクエリ名・日本語のレスポンスキー・0/1 の integer）を
知ってよい層なので、この文書は「**実際に送り出す HTTP リクエストの形**」と「受け取った生データの変換」を守る。

ストア（[stores-symbols.md](stores-symbols.md)）と画面
（[views-symbol-list-view.md](views-symbol-list-view.md)）のテストは MSW のモックが返す結果を見ている。
モックはこちらの実装と同じ理解で書かれているので、**モックとサーバの理解がずれていても気づけない**。
そこでこの文書では、モックの応答ではなく**送信されたリクエストそのもの**を
`docs/api/openapi.json` の宣言と突き合わせる。CAマスタの同種の文書は [api-ca.md](api-ca.md)。

取り違えやすい点を 4 つ固定する。

- **パスは `/masters/symbols`。** 他のマスタ（`/ca` など）と違って `/masters` 配下にある
- **リクエストのクエリ名は英語、レスポンスのキーは日本語。** 送るのは
  `symbol` / `restriction` / `route` / `vwap_target` で、返ってくるのは
  `銘柄コード` / `規制情報` / `注文ルート` / `VWAP対象区分`。**名前の系統が向きで違う**ので、
  レスポンスのキーをそのままクエリ名に使っていないことを STA-03 が押さえる
- **`limit` を送る。** `GET /masters/symbols` の limit は 1..200・既定 50 で、こちらから指定できる
  （`GET /ca` と同じ）
- **相場の 3 項目だけは `null` のまま通す。** 他の nullable は空文字に寄せるが、
  `前日終値` / `前日出来高` / `平均出来高` は「0 株」と「未取得」を区別する必要がある

応答の配列名だけは `stocks`（モデル名は `SymbolListResponse` なのにワイヤ上はここだけ stock を名乗る）。
この層で吸収して外へは出さないので、STA-06 以降のアプリ内モデルには現れない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| STA-01 | 既定モック | `fetchSymbols()` を引数なしで呼ぶ | `GET /api/masters/symbols` に `limit=50` と `offset=0` だけが載る。4 つの絞り込みクエリと `include_deleted` は送らない | 実装済 |
| STA-02 | 既定モック | `fetchSymbols({ limit: 20 })` を呼ぶ | `limit` が渡した値で載る（既定の 50 に固定しない） | 実装済 |
| STA-03 | 既定モック | 銘柄コード・規制情報・注文ルート・VWAP対象区分を渡して呼ぶ | クエリ名が `symbol` / `restriction` / `route` / `vwap_target` になり、値がそのまま載る。日本語の `銘柄コード` では送らない | 実装済 |
| STA-04 | 既定モック | 4 つの条件に空文字を渡して呼ぶ | どれもクエリに載らない（「条件なし」を空文字として送らない） | 実装済 |
| STA-05 | 既定モック | `fetchSymbols({ offset: 50 })` を呼ぶ | `offset` が渡した値で載る | 実装済 |
| STA-06 | API が `SymbolItem` を 1 件返す | `fetchSymbols()` を呼ぶ | `{ symbolCode, ticker, name, nameEn, marketName, regulation, regulationName, orderRoute, orderRouteName, vwapTarget, vwapTargetName, note, previousClose, previousVolume, averageVolume, userModified }` に変換される | 実装済 |
| STA-07 | API が `Ticker` / 区分名 / `備考` などを `null` で返す | `fetchSymbols()` を呼ぶ | 該当項目が空文字になる（`null` を画面へ流さない） | 実装済 |
| STA-08 | API が相場の 3 項目を `null` で返す | `fetchSymbols()` を呼ぶ | `previousClose` / `previousVolume` / `averageVolume` が `null` のまま返る（空文字や 0 に寄せない） | 実装済 |
| STA-09 | API が相場の 3 項目を `0` で返す | `fetchSymbols()` を呼ぶ | 3 項目が `0` のまま返る（未取得と混ざらない） | 実装済 |
| STA-10 | API が `ユーザー操作フラグ` を 1 / 0 で返す | `fetchSymbols()` を呼ぶ | `userModified` が `true` / `false` の boolean になる（0/1 の integer を外へ出さない） | 実装済 |
| STA-11 | API が `stocks` を持たない応答を返す | `fetchSymbols()` を呼ぶ | `items` が空配列、`total` が 0 になる（`stocks` が欠けても落ちない） | 実装済 |
| STA-12 | API が 500 を返す | `fetchSymbols()` を呼ぶ | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
