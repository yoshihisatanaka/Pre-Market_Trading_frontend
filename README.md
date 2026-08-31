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
| E2E テスト | `docker compose run --rm e2e npx playwright test`（`frontend` は自動で起動する） |
| E2E（トレース付き） | `docker compose run --rm e2e npm run test:e2e:trace` → 下記「トレースで『実行中』を巻き戻して見る」 |
| E2E レポート閲覧 | 下記「E2E テスト結果の見かた」を参照 |
| シナリオ対応チェック（E2E / 単体） | `docker compose run --rm frontend npm run check:scenarios`（[docs/e2e/](docs/e2e/README.md), [docs/unit/](docs/unit/README.md)） |
| 本番ビルド確認 | `docker compose run --rm frontend npm run build` |
| 依存の追加 | `docker compose run --rm frontend npm i <package>` |
| API 仕様の lint | `docker compose run --rm redocly lint openapi.yaml` |
| API ドキュメント生成 | `docker compose run --rm redocly build-docs openapi.yaml -o openapi.html` → `docs/api/openapi.html` |

> テストを書く・直すときは、コマンドを叩く前に下の「[テスト](#テスト)」を読むこと。
> シナリオ文書との対応づけ（ID）が必須で、守らないと `check:scenarios` で落ちる。

> `npm` をホストで直接叩かないこと。Node が入っていないため動作せず、
> 仮に入れても `node_modules` は named volume 側にあるためコンテナ内と一致しない。

## Claude Code から画面を見る（Playwright MCP）

Claude Code が実際にブラウザで画面を開き、スクリーンショットや DOM 構造を取れる。
E2E のセレクタ調査や、画面の 4 状態（ローディング / エラー / 空 / データあり）の目視確認に使う。
設定はリポジトリ直下の `.mcp.json`（コミット済み）。

### 実行方法

```powershell
# 1. 初回だけ: イメージを取得する
docker pull mcr.microsoft.com/playwright/mcp

# 2. 毎回: frontend を起動しておく（落ちていると MCP から接続できない）
docker compose up -d frontend
```

3. Claude Code に **「注文一覧の画面を見て」** のように日本語で頼む。専用コマンドは無い。
   初回だけ `.mcp.json` の承認ダイアログが出るので許可する（接続状態は `/mcp` で確認）

### 確認方法

```powershell
explorer .\.playwright-mcp
```

このフォルダに、Claude がやったことが**すべて**出力される。

| ファイル | 中身 |
|---|---|
| `session-<時刻>\session.md` | **操作ログ。まずこれを読む。** 操作ごとの引数・実行された Playwright コード（`await page.goto(...)`）・その時点のページ構造 |
| `page-<時刻>.png` | スクリーンショット |
| `page-<時刻>.yml` | DOM のアクセシビリティ構造（role / name の木） |
| `console-<時刻>.log` | ブラウザのコンソール出力 |

`.gitignore` 済みなので、溜まったら中身ごと消してよい。

### 注意

- 接続先は `http://frontend:5173`。`localhost:5173` では届かない（コンテナ間通信のため）
- headless chromium のみ。**ブラウザ画面をリアルタイムに覗くことはできない**
  （実行中を追いたいときは下記「トレースで『実行中』を巻き戻して見る」）
- スクリーンショットは**ファイル名を指定させない**こと。ホスト側パスとして解決され失敗する
- **E2E テストの代替ではない。** 合否判定は `docker compose run --rm e2e npx playwright test`

## テスト

このリポジトリのテストは **「シナリオ文書が先、テストコードは後」** という運用になっている。
テストを書く/直す前に、必ずこの節と [docs/e2e/README.md](docs/e2e/README.md) / [docs/unit/README.md](docs/unit/README.md) を読むこと。

### 2 種類のテスト

| 種別 | ツール | テストコード | シナリオ文書 | 対象 |
|---|---|---|---|---|
| 単体 | Vitest | `frontend/src/**/*.spec.js`（対象ファイルの隣） | `docs/unit/<src 相対パスのケバブケース>.md` | ストア・composable・utils・コンポーネント |
| E2E | Playwright | `frontend/e2e/*.spec.js` | `docs/e2e/<画面のケバブケース>.md` | 画面の主要導線 |

例: `src/stores/orders.js` → テスト `src/stores/orders.spec.js` / 文書 [docs/unit/stores-orders.md](docs/unit/stores-orders.md)
　　注文一覧画面 → テスト `frontend/e2e/orders.spec.js` / 文書 [docs/e2e/order-list.md](docs/e2e/order-list.md)

### シナリオ文書とテストの対応づけ

シナリオ文書は `ID | 前提 | 操作 | 期待結果 | 状態` の表で、1 行 = 1 テスト。

- **ID** は `<略号>-<連番>`（E2E は `OL-01`、単体は `OST-01` のように略号 3 文字）。
  **E2E・単体を通して一意**。欠番になっても振り直さない
- **テストのタイトル先頭に ID を書く** — `test('[OL-01] 注文が 3 件表示される', …)` / `it('[OST-01] …')`
- **状態** は次の 3 つだけ

| 状態 | 意味 |
|---|---|
| `実装済` | 対応するテストが必須。無いと `check:scenarios` が **error** |
| `未着手` | これから書く。テストが無くてよい（warning のみ） |
| `保留` | 仕様待ちなどで書かない（warning のみ） |

### テストを追加する流れ

1. シナリオ文書に行を足す（状態は `未着手`）。**文書に無い ID をテストに付けない**
2. テストを実装して通す
3. 文書の状態を `実装済` に更新する
4. 検査を通してコミットする

```powershell
docker compose run --rm frontend npm run test:unit
docker compose run --rm e2e npx playwright test
docker compose run --rm frontend npm run check:scenarios
```

`check:scenarios` は「`実装済` なのにテストが無い」「文書に無い ID がテストに付いている」「ID の重複」を
エラーにする。ID の無い `test()` / `it()` は warning で件数が出る。

1 シナリオだけ流したいとき:

```powershell
docker compose run --rm e2e npx playwright test --grep "\[OL-01\]"
```

### 書くときの注意

- 単体テストでは MSW(node) が `frontend/vitest.setup.js` で自動起動する。
  個別にレスポンスを差し替えるときは `server.use()`（`afterEach` で自動リセット）
- E2E の要素特定は `data-testid` か `getByRole` を使い、CSS クラス名に依存しない
- E2E でエラー応答などを再現するときは [frontend/e2e/helpers/mockApi.js](frontend/e2e/helpers/mockApi.js) の `mockApi()` を
  **`page.goto()` の前に**呼ぶ。MSW がページ内の fetch を横取りするため `page.route()` は併用できない

## E2E テスト結果の見かた

`docker compose run --rm e2e npx playwright test` を実行すると、結果は3か所に出る。

### 1. ターミナル（list レポーター）

成功/失敗と失敗理由がその場に出る。**まずはこれを読む。**

### 2. HTML レポート（`frontend/playwright-report/index.html`）

毎回上書き生成される。1ファイルに全データが埋め込まれているので、**そのままブラウザで開けばよい**。

```powershell
Start-Process .\frontend\playwright-report\index.html
```

失敗時はスクリーンショット等が `playwright-report/data/` に出るため、
それらも表示したい場合はローカルサーバー経由で開く（トレースの閲覧にも必要）。

```powershell
docker compose run --rm -p 9323:9323 e2e npx playwright show-report --host 0.0.0.0 playwright-report
```

→ http://localhost:9323 で開く。終了は `Ctrl+C`。

### 3. 失敗時の生データ（`frontend/test-results/`）

テストごとのディレクトリに `test-failed-1.png`（スクリーンショット）と
`error-context.md`（失敗時点のページ構造）が出る。原因調査はこれが速い。

> `playwright-report/` と `test-results/` は毎回上書きされ、`.gitignore` で除外済み。

### トレースで「実行中」を巻き戻して見る

Playwright のトレースビューアを使うと、テスト実行中の各ステップを**タイムライン付きで再生**できる。
操作ごとの DOM スナップショット・ネットワーク・コンソールが揃うので、
ブラウザを覗いているのとほぼ同じことが事後にできる。

**注意: 既定ではローカルにトレースは残らない。**
`playwright.config.js` は `trace: 'on-first-retry'` だが、ローカルは `retries: 0` のため
リトライが発生せず、トレースが一度も採取されない。見たいときは明示的に `--trace on` を付ける。

```powershell
# 1. トレース付きで実行（全テスト分の trace.zip が test-results/ に出る）
docker compose run --rm e2e npm run test:e2e:trace

# 2. HTML レポートをサーバー経由で開く（トレース閲覧にはサーバーが必要）
docker compose run --rm -p 9323:9323 e2e npx playwright show-report --host 0.0.0.0 playwright-report
```

→ http://localhost:9323 でテストを開き、**Trace** から再生する。終了は `Ctrl+C`。

単一のトレースを直接開くこともできる:

```powershell
docker compose run --rm -p 9323:9323 e2e npx playwright show-trace --host 0.0.0.0 --port 9323 `
  "test-results/orders-注文一覧-OL-01-注文が-3-件あるとき一覧に表示される-chromium/trace.zip"
```

> Playwright MCP（上記）は headless のため、ブラウザ画面をリアルタイムに覗くことはできない。
> 「動いているところを見たい」用途はこのトレースビューアで代替する。

## API モックについて

バックエンド未実装の API は **MSW** でモックしている。

- ハンドラ: [frontend/src/mocks/handlers/index.js](frontend/src/mocks/handlers/index.js)
- 応答データ: [frontend/src/mocks/fixtures/](frontend/src/mocks/fixtures/)
- ON/OFF: `frontend/.env` の `VITE_ENABLE_MSW`

ハンドラが定義されていないリクエストは、Vite の proxy 経由で実 API（`http://backend:8000`）へ素通しされる。
**API が実装されたら、該当ハンドラを削除するだけで本物に切り替わる。**

## ドキュメント

- [コーディング規約](docs/coding-standards.md) — Vue 公式スタイルガイド準拠 + レイヤ規約。**実装前に必読**
- [E2E シナリオの書きかた](docs/e2e/README.md) — 画面ごとの受け入れ条件。**E2E を書く前に必読**
- [単体テストシナリオの書きかた](docs/unit/README.md) — 対象ファイルごとのシナリオ。**単体テストを書く前に必読**
- [API 仕様の運用](docs/api/README.md) — 仕様書 → OpenAPI 変換の手順
- [画面モックの運用](docs/mock/README.md) — Manus 出力の Vue 化手順
- [CLAUDE.md](CLAUDE.md) — AI 駆動開発時に Claude が守る制約

## バージョンを上げるときの注意

`docker-compose.yml` の Playwright イメージタグ（`v1.62.1-noble`）と
`frontend/package.json` の `@playwright/test` は、**必ず同じバージョンに揃える**こと。
ずれるとブラウザとクライアントの不整合で E2E が起動しない。
