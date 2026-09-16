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

取り違えやすい点を 7 つ固定する。

- **主キーは `id`（実 API の integer な `ID`）で、`銘柄コード` ではない。** 銘柄コードは
  一意な業務コードに格下げされ、画面が行を見分けるのに使う。`ID` が欠けた応答では
  `id` を空文字のまま外へ出し、**銘柄コードへフォールバックしない**（STA-24）。
  取り込み時点の `openapi.json` はまだ `SymbolItem` に `ID` を持たず `銘柄コード (主キー)` と
  書いてあるが、DB 全テーブルの主キーを id に統一する方針に合わせてこちらが先行している
- **パスは `/masters/symbols`。** リソース名も `stocks` から `symbols` へ変わった
  （マスタ系は 2026-09-15 の取り込みでまとめて `/masters/` 配下へ移っている）
- **リクエストのクエリ名は英語、レスポンスのキーは日本語。** 送るのは
  `symbol` / `restriction` / `route` / `vwap_target` で、返ってくるのは
  `銘柄コード` / `規制情報` / `注文ルート` / `VWAP対象区分`。**名前の系統が向きで違う**ので、
  レスポンスのキーをそのままクエリ名に使っていないことを STA-03 が押さえる
- **`limit` を送る。** `GET /masters/symbols` の limit は 1..200・既定 50 で、こちらから指定できる
  （`GET /masters/ca` と同じ。`GET /masters/blackout-dates` だけが `limit` を持たない）
- **相場の 3 項目だけは `null` のまま通す。** 他の nullable は空文字に寄せるが、
  `前日終値` / `前日出来高` / `平均出来高` は「0 株」と「未取得」を区別する必要がある
- **登録・更新の本文（`SymbolRequest`）は日本語キーで、`ID` / `市場名` / `前日出来高` / `Pre区分` を
  載せない。** `ID` はどの行かをパスが決めるため（本文とパスの両方に識別子があると、
  食い違ったときにどちらが勝つかが仕様に無い。STA-26）。残り 3 項目は画面のフォームが
  持たないため（STA-14）。`PUT` はレコード全体を差し替える仕様なので
  「送らなかった項目の現在値を保つ」のはバックエンドの責務とする（この割り切りは
  `src/api/symbols.js` の JSDoc にも書いてある）
- **事前検証の不合格は例外にしない。** `{ valid: false, errors }` を返す（STA-21）。
  throw は通信・サーバ障害だけで、呼び出し側（`useCrudList`）が両者を別の入れ物に分ける。
  楽観的ロックの競合（409）は事前検証ではなく通信・サーバ障害の側に入る（STA-28）
- **新規検証か変更検証かは `id` の有無で決まる**（STA-20）。`isUpdate` のような真偽値では
  受けない — `useCrudList` は `validateItem` と `updateItem` に同じ payload を渡すので、
  フラグにすると画面が「api 層が本文を組むためだけの値」を知って付けることになる。
  **CA と違い対象の id はクエリに載せない**（`/masters/symbols/validate` のパラメータは
  `is_update` ただ 1 つで、`ca_id` に当たるものが仕様に無い）。対象は本文の `銘柄コード` から
  引かれる前提で、**これは編集で銘柄コードを変更させないことに依存している**

未設定の送りかたは項目ごとに違う。文字列の任意項目（`銘柄名_英字` / `規制情報` / `備考`）と
数値 2 項目は `null` を明示するが、**`注文ルート` と `VWAP対象区分` だけは `'0'` に寄せる**
（`SymbolRequest` の型宣言が `注文ルート` に null を許さず、どちらも既定が `'0'` のため）。
STA-17 / 18 がその非対称を守る。

応答の配列名だけは `stocks`（モデル名は `SymbolListResponse` なのにワイヤ上はここだけ stock を名乗る）。
登録の応答（`SymbolResponse`）も 1 件の入れ物が `stock`。この層で吸収して外へは出さないので、
STA-06 以降のアプリ内モデルには現れない。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| STA-01 | 既定モック | `fetchSymbols()` を引数なしで呼ぶ | `GET /api/masters/symbols` に `limit=50` と `offset=0` だけが載る。4 つの絞り込みクエリと `include_deleted` は送らない | 実装済 |
| STA-02 | 既定モック | `fetchSymbols({ limit: 20 })` を呼ぶ | `limit` が渡した値で載る（既定の 50 に固定しない） | 実装済 |
| STA-03 | 既定モック | 銘柄コード・規制情報・注文ルート・VWAP対象区分を渡して呼ぶ | クエリ名が `symbol` / `restriction` / `route` / `vwap_target` になり、値がそのまま載る。日本語の `銘柄コード` では送らない | 実装済 |
| STA-04 | 既定モック | 4 つの条件に空文字を渡して呼ぶ | どれもクエリに載らない（「条件なし」を空文字として送らない） | 実装済 |
| STA-05 | 既定モック | `fetchSymbols({ offset: 50 })` を呼ぶ | `offset` が渡した値で載る | 実装済 |
| STA-06 | API が `SymbolItem` を 1 件返す | `fetchSymbols()` を呼ぶ | `{ id, symbolCode, ticker, name, nameEn, marketName, regulation, regulationName, orderRoute, orderRouteName, vwapTarget, vwapTargetName, note, previousClose, previousVolume, averageVolume, userModified, updatedAt }` に変換される。`id` は実 API の integer な `ID` を文字列に寄せたもの。`更新日時` は楽観的ロックの合札なので整形せず素の文字列で持ち、`null` は空文字に寄せる | 実装済 |
| STA-07 | API が `Ticker` / 区分名 / `備考` などを `null` で返す | `fetchSymbols()` を呼ぶ | 該当項目が空文字になる（`null` を画面へ流さない） | 実装済 |
| STA-08 | API が相場の 3 項目を `null` で返す | `fetchSymbols()` を呼ぶ | `previousClose` / `previousVolume` / `averageVolume` が `null` のまま返る（空文字や 0 に寄せない） | 実装済 |
| STA-09 | API が相場の 3 項目を `0` で返す | `fetchSymbols()` を呼ぶ | 3 項目が `0` のまま返る（未取得と混ざらない） | 実装済 |
| STA-10 | API が `ユーザー操作フラグ` を 1 / 0 で返す | `fetchSymbols()` を呼ぶ | `userModified` が `true` / `false` の boolean になる（0/1 の integer を外へ出さない） | 実装済 |
| STA-11 | API が `stocks` を持たない応答を返す | `fetchSymbols()` を呼ぶ | `items` が空配列、`total` が 0 になる（`stocks` が欠けても落ちない） | 実装済 |
| STA-12 | API が 500 を返す | `fetchSymbols()` を呼ぶ | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
| STA-13 | 既定モック | `createSymbol({ symbolCode: 'S900', ticker: 'ZZZZ', name: 'テスト銘柄', nameEn: 'Test Inc.', regulation: '0', orderRoute: '1', vwapTarget: '1', previousClose: 12.5, averageVolume: 1000, note: 'メモ' })` を呼ぶ | `POST /api/masters/symbols` の本文が日本語キー（`銘柄コード` / `Ticker` / `銘柄名` / `銘柄名_英字` / `規制情報` / `注文ルート` / `VWAP対象区分` / `前日終値` / `平均出来高` / `備考`）になる。応答の `stock` がアプリ内モデルに変換されて返る | 実装済 |
| STA-14 | 既定モック | `createSymbol()` を呼ぶ | 本文に `市場名` / `前日出来高` / `Pre区分` / `更新日時` のキーが載らない（画面が持たない項目は送らない） | 実装済 |
| STA-15 | 既定モック | `createSymbol()` に `previousClose` / `averageVolume` を空文字で渡す | 本文の `前日終値` / `平均出来高` が `null` で載る（キーごと省かない） | 実装済 |
| STA-16 | 既定モック | `createSymbol()` に `previousClose: '12.5'` / `averageVolume: '1000'` と文字列で渡す | 本文では number になる（入力欄が持つ文字列をこの層で数値に直す） | 実装済 |
| STA-17 | 既定モック | `createSymbol()` に `nameEn` / `regulation` / `note` を空文字で渡す | 本文の `銘柄名_英字` / `規制情報` / `備考` が `null` で載る（空文字を送らない） | 実装済 |
| STA-18 | 既定モック | `createSymbol()` に `orderRoute` / `vwapTarget` を空文字で渡す | 本文の `注文ルート` / `VWAP対象区分` が `'0'` で載る（この 2 つだけは `null` を送らない） | 実装済 |
| STA-19 | 既定モック | `validateSymbol({ symbolCode: 'S900', ticker: 'ZZZZ', name: 'テスト銘柄' })` を `id` なしで呼ぶ | `POST /api/masters/symbols/validate` にクエリが付かない（新規検証が既定）。本文は `createSymbol()` と同じ `SymbolRequest` の形 | 実装済 |
| STA-20 | 既定モック | `validateSymbol({ id: '42', … })` を呼ぶ | クエリに `is_update=true` が載る（**`isUpdate` フラグではなく `id` の有無で決まる**）。CA の `ca_id` に当たるクエリは仕様に無いので送らない。本文に `id` / `ID` は載らない | 実装済 |
| STA-21 | 事前検証が `{ valid: false, errors: ['…'] }` を返す | `validateSymbol()` を呼ぶ | 例外にならず `{ valid: false, errors }` が返る（不合格は通信エラーと区別する） | 実装済 |
| STA-22 | 事前検証が `warnings` を含む応答を返す | `validateSymbol()` を呼ぶ | 戻り値は `{ valid, errors }` だけで `warnings` を含まない（銘柄マスタでは警告を扱わない） | 実装済 |
| STA-23 | `POST /api/masters/symbols` が 400 を返す | `createSymbol()` を呼ぶ | 例外が投げられ、`message` にサーバの `detail` が入る | 実装済 |
| STA-24 | API が `ID` を持たない `SymbolItem` を返す | `fetchSymbols()` を呼ぶ | `id` が空文字になり、`symbolCode` は従来どおり入る（**銘柄コードへフォールバックしない**。実 API が `ID` を返し始めるまでの取り違えを、値で取り繕わずテストで検知する） | 実装済 |
| STA-25 | 既定モック | `updateSymbol({ id: '1', …, updatedAt: '2026-08-20T09:30:00' })` を呼ぶ | `PUT /api/masters/symbols/1` に登録と同じ日本語キーの本文が載り、`更新日時` が送った値のまま含まれる。応答の `stock` が `id` 込みでアプリ内モデルに変換されて返る | 実装済 |
| STA-26 | 既定モック | `updateSymbol()` を呼ぶ | 本文に `ID` / `市場名` / `前日出来高` / `Pre区分` のキーが載らない（どの行かはパスが決めるので本文に識別子を二重に置かない。画面が持たない 3 項目は送らない） | 実装済 |
| STA-27 | 既定モック | `updateSymbol()` に `updatedAt` を空文字で渡す | 本文に `更新日時` のキーごと載らない（合札を持たない行も更新できる） | 実装済 |
| STA-28 | `PUT /api/masters/symbols/{id}` が 409 を返す | `updateSymbol()` を呼ぶ | 例外が投げられ、`message` にサーバの `detail` が入る（競合も通信・サーバ障害として扱う） | 実装済 |
| STA-29 | 既定モック | 編集の payload（`id` と `updatedAt` 込み）をそのまま `validateSymbol()` に渡す | 本文（`SymbolRequest`）に `id` / `ID` / `更新日時` が載らない（事前検証は楽観的ロックを照合しない） | 実装済 |
