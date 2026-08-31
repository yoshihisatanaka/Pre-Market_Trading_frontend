# CLAUDE.md

米国株注文システム。フロントエンド（Vue 3 + Vite / JavaScript）を Claude 主導で開発する。

## 絶対に守る制約

1. **ホストに Node.js / npm は無い。** すべてのコマンドは `docker compose run --rm frontend ...` 経由で実行する。
   ホストで `npm` / `npx` / `node` を直接叩かない（存在しないので必ず失敗する）。
2. **TypeScript を導入しない。** JavaScript のまま書く。`.ts` / `.tsx` ファイルを作らない。
3. **実装前に [docs/coding-standards.md](docs/coding-standards.md) を読む。**
   別メンバによるコードレビューが無いため、規約違反はそのまま残る。
4. コードを書き終えたら **必ず** 次を実行して通す:
   ```
   docker compose run --rm frontend npm run lint
   docker compose run --rm frontend npm run test:unit
   docker compose run --rm frontend npm run check:scenarios
   ```
   lint はターン終了時の Stop フック（`.claude/hooks/lint-on-stop.sh`）でも自動実行され、失敗すると差し戻される。
   ただし **unit / E2E は自動では走らない**。画面を追加・変更したら E2E（`docker compose run --rm e2e npx playwright test`）も手動で回す。

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
| `frontend/src/views/` | ルーティング単位の画面 |
| `frontend/src/components/ui/` | ドメイン非依存の汎用部品 |
| `frontend/src/components/<domain>/` | ドメイン別の部品 |
| `frontend/src/components/layout/` | 共通の骨格（`AppLayout` / `AppSidebar` / `AppHeader`）とメニュー定義 `navigation.js` |
| `frontend/src/composables/` | `useXxx` の再利用ロジック |
| `frontend/src/api/` | HTTP 通信。1エンドポイント = 1関数 |
| `frontend/src/stores/` | Pinia（setup ストア形式）。`useXxxStore` |
| `frontend/src/utils/` | 純関数（整形・計算） |
| `frontend/src/mocks/` | MSW ハンドラ / フィクスチャ |
| `docs/api/` | API 仕様書原本と `openapi.yaml`（仕様の正） |
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

- 未実装 API は `frontend/src/mocks/handlers/index.js` にハンドラを足してモックする
- 応答データは `frontend/src/mocks/fixtures/` に **バックエンドが返す生の形**で書く
- API が実装されたら、該当ハンドラを **削除**する。未定義のリクエストは実 API へ素通しされる
- ブラウザ / 単体テスト / E2E で同じ handlers・fixtures を共用する

## テスト

- 単体テスト: 対象ファイルの隣に `*.spec.js`。MSW(node) が `vitest.setup.js` で自動起動する
- **単体テストも `docs/unit/<対象>.md` のシナリオが先。** `it('[OST-01] …')` のようにタイトル先頭に ID を付ける（略号は 3 文字）
- 個別のレスポンス差し替えは `server.use()`（`afterEach` で自動リセット）
- E2E: `frontend/e2e/*.spec.js`。要素特定は `data-testid` か `getByRole` を使い、CSS クラスに依存しない
- E2E でエラー応答などを再現するときは `e2e/helpers/mockApi.js` の `mockApi()` を `page.goto()` の前に呼ぶ。`page.route()` は MSW と併用できない
- レイヤ規約（axios 直接利用、view→api 直接 import）は ESLint がエラーにする。エラーが出たら迂回せず設計を直す
- **E2E は `docs/e2e/<画面>.md` のシナリオが先。** タイトル先頭に ID を付ける（`test('[OL-01] …')`）。
  シナリオが無い画面は先に文書を書き、テストを書いたら状態を `実装済` に更新して `check:scenarios` を通す

## 画面を実際に見る（Playwright MCP）

`.mcp.json` に Playwright MCP（Docker 版）を定義してある。画面の見た目や DOM を
**推測せず実物で確認する**ために使う。

- **使う前に `docker compose up -d frontend` が必要。** MCP コンテナは compose の
  ネットワーク `us-stock-order_default` に参加して動くため、frontend が落ちていると接続できない
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

- API 仕様書は未受領。`docs/api/openapi.yaml` はまだ無い。受領したら `/api-to-openapi docs/api/<原本>` で変換する
- Manus の画面モックは受領済（素の CSS。Tailwind ではないので導入しない）。
  共通レイアウト部分だけ取り込み済み（原本 `docs/mock/layout/masters-users.html`、`tokens.css` は
  モックの配色・文字サイズに更新済み）。個別画面はまだ未着手
- サイドメニューの 14 項目は大半が未実装のため「ページが見つかりません」に落ちる。
  画面を作ったら `router/index.js` に `navigation.js` と同じ path のルートを足す
- `OrderListView` は縦串の参考実装。実仕様が来たら差し替える前提
