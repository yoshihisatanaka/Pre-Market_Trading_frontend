# api/codes（コードマスタ API 層）

- 略号: `CDA`
- 対象: `src/api/codes.js`
- テスト: `src/api/codes.spec.js`

全画面のプルダウンの選択肢がここから出るので、**選択肢の形が壊れないこと**だけを守る。
ここが `{ value, label }` を返さないと、`BaseSelect` の options が黙って空になり、
どの画面のどの条件で絞り込めなくなったのかが分からなくなる。

実 API の応答は openapi 上 `additionalProperties: true` で中身が未定義なので、
「コードマスタ名をキー、`{ code, label }` の配列を値とする object」を前提に変換している。
仕様が確定したら直すのは `toOption()` だけで済む。

守る方針は 2 つ。

- **未知のコードマスタ名も通す。** バックエンドが増やしたものを、フロントの改修なしで受け取れること
- **壊れた値では落ちない。** 配列でない値は空配列に寄せ、select の描画を止めない

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CDA-01 | 既定モック | `fetchCodes()` を呼ぶ | `GET /api/codes` を叩き、クエリを 1 つも載せない（実 API は常に全件返す） | 実装済 |
| CDA-02 | API が `{ 部店: [{ code, label }] }` を返す | `fetchCodes()` を呼ぶ | キーはコードマスタ名のまま、1 件が `{ value, label }` になる（`code` を `value` に直す） | 実装済 |
| CDA-03 | API が `code` を数値で返す | `fetchCodes()` を呼ぶ | `value` が文字列になる（select の値は常に文字列で扱う） | 実装済 |
| CDA-04 | API がフロントの知らないコードマスタ名を返す | `fetchCodes()` を呼ぶ | その名前もそのまま辞書に入る（既知の名前だけに絞らない） | 実装済 |
| CDA-05 | API が配列でない値（`null` / object / 文字列）を返す | `fetchCodes()` を呼ぶ | その名前の選択肢が空配列になる（例外にせず select を壊さない） | 実装済 |
| CDA-06 | API が空の object を返す | `fetchCodes()` を呼ぶ | 空の辞書が返る（画面側は `optionsFor()` で空配列を受け取る） | 実装済 |
| CDA-07 | API が 500 を返す | `fetchCodes()` を呼ぶ | 例外が投げられる（呼び出し側の `useAsync` が `error` に入れる） | 実装済 |
