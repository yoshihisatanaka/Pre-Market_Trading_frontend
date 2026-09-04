# CLAUDE.md

米国株注文システムの**フロントエンド専用リポジトリ**（Vue 3 + Vite / JavaScript）を Claude 主導で開発する。
バックエンドは別リポジトリ・別サーバ（別メンバ管轄）。`docker-compose.yml` に `backend` サービスは追加しない。

## 絶対に守る制約

1. **ホストに Node.js / npm は無い。** すべてのコマンドは `docker compose run --rm frontend ...` 経由で実行する。
   ホストで `npm` / `npx` / `node` を直接叩かない（存在しないので必ず失敗する）。
2. **TypeScript を導入しない。** JavaScript のまま書く。`.ts` / `.tsx` ファイルを作らない。
3. **Markdown のコードブロックには必ず言語を指定する。** ` ```js ` / ` ```vue ` / ` ```powershell ` など。
   該当する言語が無いときも ` ```text ` を付け、無指定にしない（ハイライトが効かず読みづらい）。
   `docs/` 配下の文書でも、チャットの回答でも、**プランモードで提示するプラン**でも同じ。詳細は
   [docs/coding-standards.md](docs/coding-standards.md) の「8. Markdown の書きかた」。
4. **実装前に [docs/coding-standards.md](docs/coding-standards.md) を読む。**
   別メンバによるコードレビューが無いため、規約違反はそのまま残る。
5. コードを書き終えたら **必ず** 次を実行して通す:
   ```powershell
   docker compose run --rm frontend npm run lint
   docker compose run --rm frontend npm run test:unit
   docker compose run --rm frontend npm run check:scenarios
   ```
   lint はターン終了時の Stop フック（`.claude/hooks/lint-on-stop.sh`）でも自動実行され、失敗すると差し戻される。
   ただし **unit / E2E は自動では走らない**。画面を追加・変更したら E2E（`docker compose run --rm e2e npx playwright test`）も手動で回す。

## 読ませないファイル

機密パスは 2 層で遮断してある。**拒否されたら迂回しない。**
別のコマンド・別のツールで読み直さず、何を読もうとして止められたかをユーザに伝えて手を止める。

| 層 | 実体 | 守備範囲 |
|---|---|---|
| deny ルール | `.claude/settings.json` の `permissions.deny` | `Read` / `Glob` / `Grep` / `Edit` に対するパス指定 |
| PreToolUse フック | `.claude/hooks/guard-secret-paths.sh` | 上記に加えて **Bash / PowerShell のコマンド文字列**（`cat` / `Get-Content` / `sed` / `docker cp` 等の抜け道） |

対象は `.env` 系（`.env.example` は除く）、秘密鍵・証明書（`*.pem` / `*.key` / `id_rsa` 等）、
`.ssh` / `.aws` などの認証情報ディレクトリ、および**プロジェクト外の絶対パス**
（例外はスクラッチパッドと `~/.claude/`）。

読ませたくないものが増えたら **`settings.json` の `deny` とフックの両方**に足す。
フックの動作確認は手動実行できる:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"cat some/secret/path"}}' \
  | bash .claude/hooks/guard-secret-paths.sh
```

なお設定は事故防止であって隔離ではない。**本当に読まれてはいけない値は
ワークツリーに置かない**（秘密管理側かリポジトリ外に置く）のが本筋。

## Git ブランチ

```text
<type>/<kebab-case の短い説明>
```

- `<type>` は**コミットメッセージと同じ語彙**から、その作業の**主目的**にあたるものを 1 つ選ぶ:
  `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `style`
- 説明は英小文字・数字・ハイフンのみ。2〜4 語、目安 30 文字以内
- 日本語・大文字・アンダースコア・末尾スラッシュは使わない
- 1 ブランチ = 1 目的。**コミットは何本あってもよい**。バグ修正に伴うテスト追加やドキュメント更新は、
  同じブランチで `fix:` → `test:` → `docs:` と type を変えてコミットしてよい（ブランチは `fix/...` のまま）
- 目的そのものが変わったとき（例: 修正と無関係な画面を作り始めた）だけブランチを切り直す
- ベースは常に `main`。**`main` に直接コミットしない**。作業前に `git switch -c <type>/<説明>` で切り、
  終わったら `main` にマージしてブランチを削除する

```text
feat/order-list-view
fix/sidebar-active-state
docs/branch-naming
refactor/api-client-layer
chore/deps-update
```

## レイヤ規約（違反しやすいので再掲）

```
views / components  →  stores  →  api  →  (HTTP)
```

- view / component から `axios` を直接使わない。必ず store か composable を経由する
- `axios.create()` を新たに書かない。`src/api/client.js` の `apiClient` だけを使う
- **バックエンドのレスポンス形（snake_case 等）を知ってよいのは `src/api/` だけ。**
  そこで camelCase のアプリ内モデルに変換してから外へ返す（参考: `src/api/orders.js` の `toOrder()`）
- 新しいエンドポイントを使うときは、**先に `src/api/` に関数を1つ追加**してから呼ぶ
- `docs/api/openapi.yaml` を編集したら `docker compose run --rm redocly lint openapi.yaml` を通す（HTML は `build-docs` で再生成。コミットしない）
- 非同期は `src/composables/useAsync.js` を使い、各所で try-catch を書かない
- 画面は **ローディング / エラー / 空 / データあり の4状態**を必ず出し分ける（参考: `src/views/OrderListView.vue`）

## ディレクトリ

| パス | 役割 |
|---|---|
| `src/views/` | ルーティング単位の画面 |
| `src/components/ui/` | ドメイン非依存の汎用部品 |
| `src/components/<domain>/` | ドメイン別の部品 |
| `src/components/layout/` | 共通の骨格（`AppLayout` / `AppSidebar` / `AppHeader`）とメニュー定義 `navigation.js` |
| `src/composables/` | `useXxx` の再利用ロジック |
| `src/api/` | HTTP 通信。1エンドポイント = 1関数 |
| `src/stores/` | Pinia（setup ストア形式）。`useXxxStore` |
| `src/utils/` | 純関数（整形・計算） |
| `src/mocks/` | MSW ハンドラ / フィクスチャ |
| `e2e/` | Playwright の E2E テスト |
| `scripts/` | 補助スクリプト（`check-scenarios.mjs`） |
| `docs/api/` | バックエンドから受領した仕様書の**コピー**と `openapi.yaml`（フロント実装上の正） |
| `docs/e2e/` | 画面ごとの E2E シナリオ（受け入れ条件）。ID をテスト名に付けて対応づける |
| `docs/unit/` | テスト対象ファイルごとの単体テストシナリオ。同じ形式・同じチェック |
| `docs/mock/` | Manus 出力の画面モック原本（編集しない） |

## Vue の書き方

- `<script setup>` + Composition API のみ。Options API は使わない
- SFC のファイル名はパスカルケースの複数語（`OrderList.vue`。`Order.vue` は ESLint エラー）
- props は `type` 必須、非必須なら `default` も必須
- 色・余白は `src/assets/styles/tokens.css` の CSS 変数を使う。直値で色を書かない
- **画面は `<h1>` を持たない。** タイトルは `router/index.js` の `meta.title` を `AppHeader` が表示する
- 画面固有のヘッダ操作ボタンは `<Teleport defer to="#topbar-actions">` で差し込む。
  その画面の単体テストには `global: { stubs: { teleport: true } }` を付ける
- サイドメニューに項目を足すときは `src/components/layout/navigation.js` を編集する

## API モック（MSW）

- 未実装 API は `src/mocks/handlers/index.js` にハンドラを足してモックする
- 応答データは `src/mocks/fixtures/` に **バックエンドが返す生の形**で書く
- API が実装されたら、該当ハンドラを **削除**する。未定義のリクエストは実 API へ素通しされる
- ブラウザ / 単体テスト / E2E で同じ handlers・fixtures を共用する

## テスト

- 単体テスト: 対象ファイルの隣に `*.spec.js`。MSW(node) が `vitest.setup.js` で自動起動する
- **単体テストも `docs/unit/<対象>.md` のシナリオが先。** `it('[OST-01] …')` のようにタイトル先頭に ID を付ける（略号は 3 文字）
- 個別のレスポンス差し替えは `server.use()`（`afterEach` で自動リセット）
- E2E: `e2e/*.spec.js`。要素特定は `data-testid` か `getByRole` を使い、CSS クラスに依存しない
- E2E でエラー応答などを再現するときは `e2e/helpers/mockApi.js` の `mockApi()` を `page.goto()` の前に呼ぶ。`page.route()` は MSW と併用できない
- レイヤ規約（axios 直接利用、view→api 直接 import）は ESLint がエラーにする。エラーが出たら迂回せず設計を直す
- **E2E は `docs/e2e/<画面>.md` のシナリオが先。** タイトル先頭に ID を付ける（`test('[OL-01] …')`）。
  シナリオが無い画面は先に文書を書き、テストを書いたら状態を `実装済` に更新して `check:scenarios` を通す

## 画面を実際に見る（Playwright MCP）

`.mcp.json` に Playwright MCP（Docker 版）を定義してある。画面の見た目や DOM を
**推測せず実物で確認する**ために使う。

- **使う前に `docker compose up -d frontend` が必要。** MCP コンテナは compose の
  ネットワーク `us-stock-order-frontend_default` に参加して動くため、frontend が落ちていると接続できない
  （この名前は `docker-compose.yml` の `name:` 固定値。リポジトリ名 `Pre-Market_Trading_frontend` や
  ディレクトリ名とは意図的に別物なので、旧名のまま揃えなくてよい）
- 接続先は **`http://frontend:5173`**（`localhost:5173` ではない。コンテナ間通信のため）
- MSW はブラウザ側で動くので、バックエンド未実装のままでも画面はモックデータで描画される
- Docker 版は **headless chromium のみ**（Firefox / WebKit は使えない）
- `--save-session` により、全操作のログが `.playwright-mcp/session-<時刻>/session.md` に残る。
  何を見て何を判断したかは**このファイルで検証できる**（口頭の報告を信用させない）
- スクリーンショット等の出力先は `.playwright-mcp/`（`/output` にマウント済み・`.gitignore` 済み）。
  **`filename` は指定しない。** 指定するとホスト側のパスとして解決され、コンテナ内に存在せず
  `ENOENT` で失敗する。省略すれば自動命名で `.playwright-mcp/` に保存され、画像は応答にも返る

使いどころ:

- E2E を書く前に、`data-testid` / role が実在するかを実画面のスナップショットで確かめる
- ローディング / エラー / 空 / データありの4状態が実際に出し分けられているかを目視する
- Manus の画面モック受領後、`docs/mock/` の原本と Vue 実装を見比べる

**これは E2E の代替ではない。** 合否判定は従来どおり
`docker compose run --rm e2e npx playwright test` で行う。MCP は探索・調査用。

headless なので**ブラウザ画面をリアルタイムには覗けない**。実行中の様子を追いたいときは
`docker compose run --rm e2e npm run test:e2e:trace` でトレースを採り、ビューアで再生する
（既定の `trace: 'on-first-retry'` はローカルの `retries: 0` では採取されない。詳細は README）。

## 現在の状況

- **このリポジトリはフロントエンド専用。** バックエンドは別リポジトリ・別サーバ。`/api` は Vite dev サーバが
  `.env` の `VITE_PROXY_TARGET`（既定 `http://host.docker.internal:8000`）へプロキシする。
  取り決めは README の「バックエンドとの連携」
- API 仕様書は未受領。`docs/api/openapi.yaml` はまだ無い。受領したら `/api-to-openapi docs/api/<原本>` で変換する。
  **仕様の正はバックエンド側リポジトリの原本で、`docs/api/` に置くのは受領コピー**
- Manus の画面モックは受領済（素の CSS。Tailwind ではないので導入しない）。
  共通レイアウト部分だけ取り込み済み（原本 `docs/mock/layout/masters-users.html`、`tokens.css` は
  モックの配色・文字サイズに更新済み）。個別画面はまだ未着手
- サイドメニューの 14 項目は大半が未実装のため「ページが見つかりません」に落ちる。
  画面を作ったら `router/index.js` に `navigation.js` と同じ path のルートを足す
- `OrderListView` は縦串の参考実装。実仕様が来たら差し替える前提
