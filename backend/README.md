# backend

このディレクトリはバックエンド担当メンバの管轄です。フロントエンド側からは触りません。

## 分担と接続の取り決め

| 項目 | 内容 |
|---|---|
| 言語 | Python |
| 想定ポート | 8000 |
| 接続方法 | フロントエンドの Vite dev サーバが `/api/*` を `http://backend:8000` にプロキシする |
| API 仕様 | 仕様書を [docs/api/](../docs/api/) に置き、`openapi.yaml` を唯一の正とする |

## バックエンドを繋ぐときの手順

1. このディレクトリに Dockerfile と実装を置く
2. リポジトリルートの [docker-compose.yml](../docker-compose.yml) に `backend` サービスを追加する
   （サービス名は `backend`、コンテナ内で 8000 番を listen すること。フロント側の proxy 設定は変更不要）
3. 実装が完了した API については、フロント側の MSW ハンドラ
   （[frontend/src/mocks/handlers/index.js](../frontend/src/mocks/handlers/index.js)）から該当ハンドラを削除する。
   MSW は未定義のリクエストを実 API へ素通しするため、削除するだけで本物に切り替わる。
