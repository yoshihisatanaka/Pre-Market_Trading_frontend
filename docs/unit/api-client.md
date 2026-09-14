# api/client（HTTP クライアントとエラー正規化）

- 略号: `CLA`
- 対象: `src/api/client.js`
- テスト: `src/api/client.spec.js`

アプリ内の全 HTTP はこの 1 インスタンスを通る。ここが守るのは
**送信時に必ず載る `X-User-Code`** と、**あらゆる失敗を `ApiError` 1 種に畳む正規化**。

画面はここが決めた `message` をそのまま出す（`useAsync` が `error.message` を
`BaseAlert` に流す）ので、**文言そのものを契約として固定する**。個別の API 層
（[api-ca.md](api-ca.md) など）は「エラーが投げられること」までしか見ていないので、
どんな文言・どんな `status` / `code` になるかはこの文書だけが決める。

エラー本文は実 API（FastAPI）の 2 形（`ErrorResponse` の文字列 `detail` と
`HTTPValidationError` の配列 `detail`）に加え、まだ実 API に切り替えていないマスタの
モックが返す `{ message, code }` も受ける。3 形の優先順位もここで固定する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| CLA-01 | 既定（`VITE_USER_CODE` は `test-user`） | `apiClient.get('/__client-test')` が成功する | リクエストヘッダに `X-User-Code: test-user` が載り、URL は `/api/__client-test`（baseURL が付く） | 実装済 |
| CLA-02 | API が 200 を返す | 同上 | 応答がそのまま返る（成功時は本文もヘッダも書き換えない） | 実装済 |
| CLA-03 | API が 400 で `{ message: '…', code: 'X', detail: '別の文言' }` を返す | GET する | `message` が本文の `message`（`detail` より優先）、`status` が 400、`code` が `'X'` | 実装済 |
| CLA-04 | API が 409 で `{ detail: '休場日 20260101 は既に登録されています' }`（文字列）を返す | GET する | `message` がその `detail` 文字列、`status` が 409、`code` は `null` | 実装済 |
| CLA-05 | API が 422 で `detail` 配列 2 件（`loc` 末尾が項目名）を返す | GET する | `項目名: msg` の形にして ` / ` で連結した 1 行になる | 実装済 |
| CLA-06 | API が 422 で `loc` が `['body']` / `['query']` だけの要素を返す | GET する | `body: ` / `query: ` を前置せず、`msg` だけが出る | 実装済 |
| CLA-07 | API が 422 で `msg` の無い要素・空文字の要素を混ぜて返す | GET する | 取り出せない要素は捨てられ、残りだけが連結される（空の区切りが出ない） | 実装済 |
| CLA-08 | API が 400 で本文 `{}` を返す | GET する | `message` が `入力内容に誤りがあります。`、`code` が `null` | 実装済 |
| CLA-09 | API が 401 で本文 `{}` を返す | GET する | `message` が `ログインが必要です。` | 実装済 |
| CLA-10 | API が 403 で本文 `{}` を返す | GET する | `message` が `この操作を行う権限がありません。` | 実装済 |
| CLA-11 | API が 404 で本文 `{}` を返す | GET する | `message` が `対象が見つかりませんでした。` | 実装済 |
| CLA-12 | API が 500 / 503 で本文 `{}` を返す | GET する | どちらも `message` が `サーバーでエラーが発生しました。` | 実装済 |
| CLA-13 | API が 409 で本文 `{}`（既定文言の無い status）を返す | GET する | `message` が `エラーが発生しました。` | 実装済 |
| CLA-14 | 応答が `timeout` より遅れる | 短い `timeout` を指定して GET する | `message` が `通信がタイムアウトしました。時間をおいて再度お試しください。`、`status` が `null`、`code` が `ECONNABORTED` | 実装済 |
| CLA-15 | 応答が返らない（ネットワーク断） | GET する | `message` が `サーバーに接続できませんでした。`、`status` が `null` | 実装済 |
| CLA-16 | API が 500 を返す | GET する | 投げられるのは `ApiError` で、`name` が `'ApiError'`、`Error` を継承し、`cause` に元の axios エラー（`response.status` が 500）が入る | 実装済 |
