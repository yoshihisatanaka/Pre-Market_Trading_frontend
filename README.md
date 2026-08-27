# us-stock-order

米国株注文システム。フロントエンド（Vue 3）とバックエンド（Python）をディレクトリ分離で開発する。

```
├─ frontend/   Vue 3 + Vite（このリポジトリで整備済み）
├─ backend/    Python（別メンバ管轄・未着手）
└─ docs/       API 仕様書 / 画面モック / コーディング規約
```

## 前提

**ホストに Node.js / npm は不要（インストールしない）。すべて Docker コンテナ内で実行する。**
必要なのは Docker Desktop のみ。

## セットアップ

```powershell
# 1. 環境変数ファイルを作る
Copy-Item frontend\.env.example frontend\.env

# 2. 依存をインストール（コンテナ内の node_modules ボリュームに入る）
docker compose run --rm frontend npm install

# 3. MSW の Service Worker を public/ に生成する（初回のみ）
docker compose run --rm frontend npm run msw:init

# 4. 開発サーバを起動
docker compose up frontend
```

→ http://localhost:5173 で注文一覧（MSW のモックデータ3件）が表示される。

## よく使うコマンド

| 目的 | コマンド |
|---|---|
| 開発サーバ | `docker compose up frontend` |
| 停止 | `docker compose down` |
| Lint | `docker compose run --rm frontend npm run lint` |
| 自動整形 | `docker compose run --rm frontend npm run format` |
| 単体テスト | `docker compose run --rm frontend npm run test:unit` |
| E2E テスト | `docker compose run --rm e2e npx playwright test`（`frontend` 起動中に実行） |
| 本番ビルド確認 | `docker compose run --rm frontend npm run build` |
| 依存の追加 | `docker compose run --rm frontend npm i <package>` |

> `npm` をホストで直接叩かないこと。Node が入っていないため動作せず、
> 仮に入れても `node_modules` は named volume 側にあるためコンテナ内と一致しない。

## API モックについて

バックエンド未実装の API は **MSW** でモックしている。

- ハンドラ: [frontend/src/mocks/handlers/index.js](frontend/src/mocks/handlers/index.js)
- 応答データ: [frontend/src/mocks/fixtures/](frontend/src/mocks/fixtures/)
- ON/OFF: `frontend/.env` の `VITE_ENABLE_MSW`

ハンドラが定義されていないリクエストは、Vite の proxy 経由で実 API（`http://backend:8000`）へ素通しされる。
**API が実装されたら、該当ハンドラを削除するだけで本物に切り替わる。**

## ドキュメント

- [コーディング規約](docs/coding-standards.md) — Vue 公式スタイルガイド準拠 + レイヤ規約。**実装前に必読**
- [API 仕様の運用](docs/api/README.md) — 仕様書 → OpenAPI 変換の手順
- [画面モックの運用](docs/mock/README.md) — Manus 出力の Vue 化手順
- [CLAUDE.md](CLAUDE.md) — AI 駆動開発時に Claude が守る制約

## バージョンを上げるときの注意

`docker-compose.yml` の Playwright イメージタグ（`v1.62.1-noble`）と
`frontend/package.json` の `@playwright/test` は、**必ず同じバージョンに揃える**こと。
ずれるとブラウザとクライアントの不整合で E2E が起動しない。
