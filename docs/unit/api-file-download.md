# api/fileDownload（ファイル応答の変換）

- 略号: `FDL`
- 対象: `src/api/fileDownload.js`
- テスト: `src/api/fileDownload.spec.js`

`toFileDownload(response, fallbackFilename)` は、axios の応答（本文は ArrayBuffer）を画面が落とせる
`{ blob, filename }` にする純関数。HTTP を通さず、応答の形のオブジェクトを直接渡して確かめる。
ファイル名は `Content-Disposition` から取り、日本語名は RFC 5987 の `filename*=UTF-8''…` で届く
（実 API のオーダーシート）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| FDL-01 | `Content-Disposition: attachment; filename*=UTF-8''<百分率符号化した オーダーシート_20260928_BUY_US.xlsx>` | `toFileDownload(応答, '既定名.xlsx')` | `filename` が復号した `オーダーシート_20260928_BUY_US.xlsx` になる | 実装済 |
| FDL-02 | `Content-Disposition: attachment; filename=executions.csv`（引用符なし）と `filename="a b.csv"`（引用符あり） | 同上 | それぞれ `executions.csv` / `a b.csv` になる | 実装済 |
| FDL-03 | `filename*` と `filename` の両方がある | 同上 | `filename*` の方を採る | 実装済 |
| FDL-04 | `Content-Disposition` が無い（別オリジンで読めない場合を含む） | 同上 | `filename` が渡した既定名になる | 実装済 |
| FDL-05 | 本文が 4 バイトの ArrayBuffer、`Content-Type` が xlsx | 同上 | `blob` は type がその `Content-Type` で、size が 4 の Blob になる | 実装済 |
