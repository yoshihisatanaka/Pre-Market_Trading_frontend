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

作業に入る前に effort を選ぶ。既定は `high` で、`src/` を触る回の下限も `high`。
テストや定型作業は `medium` / `low` に下げる。基準は
[docs/coding-standards.md](docs/coding-standards.md) の「9. Effort レベルの選びかた」。

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

## サブエージェント

定型のテスト作成は `.claude/agents/` のサブエージェントに委譲する（Task ツール / `/agents`）。
いずれも**シナリオ文書が先**の規約に従い、シナリオ提示 → 承認 → 実装 → 検証 → 状態更新まで通す。
**コミットはしない**（差分を見てから呼び出し側が行う）。

| エージェント | 担当 | 触る範囲 |
|---|---|---|
| `unit-test-author` | 単体テスト（Vitest） | `docs/unit/` と `src/**/*.spec.js` |
| `e2e-test-author` | E2E（Playwright・MSW のモックに当てる） | `docs/e2e/` と `e2e/` |
| `real-api-e2e-author` | E2E（Playwright・実 API に当てる） | `docs/e2e/*-real-api.md` と `e2e/*.real-api.spec.js` |

いずれも `src/` の製品コードは変更しない。`data-testid` の追加が必要な場合も
手を止めて報告する（そこで直させない）。

`real-api-e2e-author` だけは前提が 3 つある。**MSW を切る（`.env` の `VITE_ENABLE_MSW=false` に
して `docker compose up -d --force-recreate frontend`）・バックエンドの `api` を起動する・
Docker を排他で使う。** エージェントは `.env` を読み書きできない（deny ルールと guard フック）ので、
呼ぶ前にユーザが整えるか、提示された手順に応じる。終わったら `.env` を戻して frontend を作り直す
（戻すまで MSW 版の E2E とブラウザでの開発が実 API 頼みになる）。

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
- ベースは常に `main`。**`main` に直接コミットしない**。作業ブランチは
  **worktree として切る**（`bash scripts/worktree.sh add <type>/<説明>`）。
  終わったら本体セッションで `main` にマージし、worktree を撤収してブランチを削除する。
  **本体リポジトリでの `git switch` / `git checkout` は PreToolUse フックが拒否する**
  （`main` への切り替えとファイル復元は通る）。理由は次節

```text
feat/order-list-view
fix/sidebar-active-state
docs/branch-naming
refactor/api-client-layer
chore/deps-update
```

## Git worktree（並行セッション）

複数の Claude Code セッションを同時に走らせるときは、ブランチを切り替えるのではなく
**worktree を分ける**（git は 1 リポジトリ 1 チェックアウトなので、切り替えでは衝突する）。
入口はスラッシュコマンド **`/worktree`**（実体は `scripts/worktree.sh`）。
**`git worktree` を直接叩かない**（安全確認と設定ファイルの配備がスクリプト側に入っている）。

```bash
bash scripts/worktree.sh add feat/market-holiday-type    # 作成＋設定の配備（冪等）
bash scripts/worktree.sh list                            # 一覧＋Docker の現所有者
bash scripts/worktree.sh doctor                          # 配備漏れ・共有リソースの点検
bash scripts/worktree.sh remove feat/market-holiday-type
```

- 上の `bash` は **Git Bash** のこと。PowerShell / cmd で `bash ...` と打つと
  PATH の `C:\WINDOWS\system32\bash.exe`（**WSL のランチャ**）が起動し、Windows パスも
  git も docker も噛み合わず失敗する。ターミナルのプロファイルを Git Bash にするか、
  PowerShell から実行するなら Git Bash を明示する:
  `& "C:\Program Files\Git\bin\bash.exe" scripts/worktree.sh <サブコマンド>`
- 置き場所は `C:\Users\0036\worktrees\<リポジトリ名>-<ブランチ名>` 固定。
  gitignore された `.env` / `.claude/settings.local.json` は `add` が本体からコピーする
  （シンボリックリンクにしない。compose の `.:/app` マウント越しに壊れたリンクになるため）
- 作成後は worktree を **新しい VSCode ウィンドウで開き**、そこで Claude を起動する
  （`code "<worktree のパス>"`、または File > New Window でそのフォルダを開く。
  ターミナルから使うなら `cd` してから `claude`）。
  **いまの VSCode ウィンドウで新しいセッションを開いても cwd は本体のまま**で、
  `CLAUDE_PROJECT_DIR` も変わらず、フックと設定が本体側を向いたままになる
- worktree 固有の指示は各 worktree の `CLAUDE.local.md`（`add` が雛形を生成・gitignore 済み）に書く。
  「この worktree の目的」を書いておくと、複数セッションが互いの担当範囲に踏み込みにくくなる
- `main` は本体（`C:\Users\0036\dev\Pre-Market_Trading_frontend`）に常駐させる。
  **マージとブランチ削除は本体セッションで行う**（worktree が掴んでいるブランチは
  本体で `switch` も `branch -d` もできない）。順序は `main で merge` →
  `worktree.sh remove` → `git branch -d`（`remove --delete-branch` でまとめてもよい）
- **`git stash` を使わない。** stash はリポジトリ共通で、別 worktree から pop できてしまう。
  中断するときは WIP コミットで退避する
- **`/api-spec-sync` は本体セッション専用。** 参照先 `../Pre-Market_Trading` は相対パスなので、
  worktree からだと存在しない場所を見る。絶対パスは guard フックが弾く（それが正しい挙動）
- worktree セッションから**本体リポジトリのファイルを絶対パスで書き換えない**。
  guard フックが拒否する（`main` に未コミット変更が生えるのを防ぐための意図的な非対称）

### 並行セッションの事故を止めるフック

2026-09-08、4 つのセッションが本体リポジトリを共有したまま `git switch -c` でブランチを
奪い合い、同じファイルを同時に書き換える事故が起きた（このとき worktree は 1 つも作られて
いなかった）。運用を文書に書くだけでは再発するので、2 本のフックで拒否・検知する。

| フック | 実体 | 役割 |
|---|---|---|
| `PreToolUse` | `.claude/hooks/guard-main-checkout.sh` | **本体での `git switch` / `git checkout` を拒否**する。`main` への切り替えとファイル復元（`git checkout -- <path>`、実在するパス）は通す。worktree 側では何もしない |
| `SessionStart` | `.claude/hooks/session-worktree-notice.sh` | セッション冒頭に現在地（本体 / worktree・HEAD）を注入し、**同じチェックアウトで他セッションが稼働中なら警告**する |

同居の検知はロックファイル方式。`<project>/.claude/.sessions/<session_id>`（gitignore 済み）を
`SessionStart` が作り、Stop フックが毎ターン更新する。直近 2 時間に更新のあるものを稼働中とみなす。
worktree ごとに別ディレクトリになるので、判定の粒度がそのまま「1 チェックアウト」になる。

拒否されたら**迂回しない**。`bash scripts/worktree.sh add <type>/<説明>` で worktree を作り、
新しい VSCode ウィンドウで開いてそちらで作業する。動作確認は手動でもできる:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git switch -c feat/x"}}' \
  | bash .claude/hooks/guard-main-checkout.sh
```

### Docker は排他利用

compose のプロジェクト名は `us-stock-order-frontend` 固定（`docker-compose.yml` の `name:`）。
worktree を分けても **compose プロジェクト・コンテナ名・ポート・ネットワーク・`node_modules`
ボリュームは全 worktree で共有**される。ポートもプロジェクト名も変数化しない方針なので、**規律で守る**。

| 操作 | 並行 | 理由 |
|---|---|---|
| `run --rm frontend npm run lint` / `lint:fix` / `format` / `format:check` / `test:unit` / `check:scenarios` / `build` | **可** | 一時コンテナが「実行した worktree の `.:/app`」をマウントする。稼働中の frontend には触らない |
| `npm install` / `npm ci`、`package.json` / `package-lock.json` / `Dockerfile` の変更 | **排他** | `node_modules` は共有ボリューム、イメージも共有。追加だけなら無害だが、削除・ダウングレード・`npm ci` は他 worktree を壊す |
| `up -d frontend` / `restart` / `down` | **1 worktree だけ** | 同じプロジェクト名なのでコンテナが**作り直され、マウント元が奪われる**。他 worktree の dev サーバが黙って別ブランチのコードを配信し始める |
| `run --rm e2e npx playwright test` | **1 worktree だけ** | `depends_on: frontend` で frontend を起動・再作成する。接続先 `http://frontend:5173` は共有ネットワーク上の 1 個 |
| Playwright MCP（`mcp__playwright__*`） | **1 worktree だけ** | 固定ネットワーク `us-stock-order-frontend_default` の稼働中 frontend を見る |
| Chrome DevTools MCP（`mcp__chrome-devtools__*`） | **1 worktree だけ** | 同上。ローカルイメージ `us-stock-order-chrome-devtools-mcp` が要る（`docker build -t us-stock-order-chrome-devtools-mcp docker/chrome-devtools-mcp`） |
| ブラウザで `http://localhost:5173` | **1 worktree だけ** | 5173 は 1 個しか無い |
| `down -v` | **禁止** | 共有の `node_modules` ボリュームを消し、全 worktree が動かなくなる |

**Docker を使う番になったら、まず `bash scripts/worktree.sh list` の最終行で現所有者を確認する。**
自分以外が持っているなら、そのセッションのユーザに返してもらうまで `up -d` / E2E / MCP を実行しない。
持ち主が終わるときは `docker compose down`（**`-v` は付けない**）で明け渡す。

Stop フックの lint は一時コンテナなので各 worktree で並行しても安全。ただし複数セッションが
同時に `docker compose run` を叩くと、ネットワーク作成の競合で稀に失敗する。
**再実行で回復するので「lint が壊れた」と誤診しない。**

なお **コンテナ内で `git` は使えない**（worktree の `.git` は Windows の絶対パスを書いたファイルで、
その先はコンテナ内に存在しない）。現在の lint / test:unit / build / check:scenarios は git を
使わないので無害だが、`vitest --changed` や ESLint の `includeIgnoreFile(gitignore)` のような
git 依存を入れると **worktree でだけ壊れる**。導入するときは本体と worktree の両方で試す。

## レイヤ規約（違反しやすいので再掲）

```
views / components  →  stores  →  api  →  (HTTP)
```

- view / component から `axios` を直接使わない。必ず store か composable を経由する
- `axios.create()` を新たに書かない。`src/api/client.js` の `apiClient` だけを使う
- **バックエンドのレスポンス形（snake_case 等）を知ってよいのは `src/api/` だけ。**
  そこで camelCase のアプリ内モデルに変換してから外へ返す（参考: `src/api/orders.js` の `toOrder()`）
- 新しいエンドポイントを使うときは、**先に `src/api/` に関数を1つ追加**してから呼ぶ
- `docs/api/openapi.json` は**編集しない**（バックエンドの生成物。次の取り込みで消える）。lint と HTML 生成は `/api-spec-sync` が通す
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
| `scripts/` | 補助スクリプト（`check-scenarios.mjs` / `worktree.sh`） |
| `docs/api/` | バックエンドから取り込んだ `openapi.json`（フロント実装上の正）と閲覧用 HTML |
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
- API 仕様は `docs/api/openapi.json` に取り込み済み（55 パス / 76 オペレーション / 95 スキーマ）。
  原本は FastAPI が生成する **OpenAPI 3.1 の JSON** なので **YAML へ変換しない**（二度手間）。
  `/api-spec-sync` を実行すると、隣のバックエンドリポジトリ（`../Pre-Market_Trading`。**相対パスで参照する**。
  絶対パスは guard フックが弾く）の稼働中 `api` コンテナから取得し直し、lint・HTML 生成・仕様ギャップの点検まで通す。
  事前に `(cd ../Pre-Market_Trading && docker compose up -d api)` が必要。
  **仕様の正はバックエンド側リポジトリで、`docs/api/openapi.json` はその取り込みコピー（フロント実装上の正）**
- ただし主要レスポンスに `response_model` が無く中身が未定義、`enum` 0 件、エラー応答が 422 のみ、といった
  **ギャップが残っている**（→ `.claude/skills/api-spec-sync/checklist.md`）。埋まるまでは `src/mocks/` の仮フィクスチャで進める
- Manus の画面モックは受領済（素の CSS。Tailwind ではないので導入しない）。
  共通レイアウト部分だけ取り込み済み（原本 `docs/mock/layout/masters-users.html`、`tokens.css` は
  モックの配色・文字サイズに更新済み）。個別画面はまだ未着手
- サイドメニューの 15 項目は大半が未実装のため「ページが見つかりません」に落ちる。
  画面を作ったら `router/index.js` に `navigation.js` と同じ path のルートを足す
- `OrderListView` は縦串の参考実装。実仕様が来たら差し替える前提
