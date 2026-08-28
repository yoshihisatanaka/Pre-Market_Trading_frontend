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
| `frontend/src/composables/` | `useXxx` の再利用ロジック |
| `frontend/src/api/` | HTTP 通信。1エンドポイント = 1関数 |
| `frontend/src/stores/` | Pinia（setup ストア形式）。`useXxxStore` |
| `frontend/src/utils/` | 純関数（整形・計算） |
| `frontend/src/mocks/` | MSW ハンドラ / フィクスチャ |
| `docs/api/` | API 仕様書原本と `openapi.yaml`（仕様の正） |
| `docs/e2e/` | 画面ごとの E2E シナリオ（受け入れ条件）。ID をテスト名に付けて対応づける |
| `docs/mock/` | Manus 出力の画面モック原本（編集しない） |

## Vue の書き方

- `<script setup>` + Composition API のみ。Options API は使わない
- SFC のファイル名はパスカルケースの複数語（`OrderList.vue`。`Order.vue` は ESLint エラー）
- props は `type` 必須、非必須なら `default` も必須
- 色・余白は `src/assets/styles/tokens.css` の CSS 変数を使う。直値で色を書かない

## API モック（MSW）

- 未実装 API は `frontend/src/mocks/handlers/index.js` にハンドラを足してモックする
- 応答データは `frontend/src/mocks/fixtures/` に **バックエンドが返す生の形**で書く
- API が実装されたら、該当ハンドラを **削除**する。未定義のリクエストは実 API へ素通しされる
- ブラウザ / 単体テスト / E2E で同じ handlers・fixtures を共用する

## テスト

- 単体テスト: 対象ファイルの隣に `*.spec.js`。MSW(node) が `vitest.setup.js` で自動起動する
- 個別のレスポンス差し替えは `server.use()`（`afterEach` で自動リセット）
- E2E: `frontend/e2e/*.spec.js`。要素特定は `data-testid` か `getByRole` を使い、CSS クラスに依存しない
- E2E でエラー応答などを再現するときは `e2e/helpers/mockApi.js` の `mockApi()` を `page.goto()` の前に呼ぶ。`page.route()` は MSW と併用できない
- レイヤ規約（axios 直接利用、view→api 直接 import）は ESLint がエラーにする。エラーが出たら迂回せず設計を直す
- **E2E は `docs/e2e/<画面>.md` のシナリオが先。** タイトル先頭に ID を付ける（`test('[OL-01] …')`）。
  シナリオが無い画面は先に文書を書き、テストを書いたら状態を `実装済` に更新して `check:scenarios` を通す

## 現在の状況

- API 仕様書は未受領。`docs/api/openapi.yaml` はまだ無い。受領したら `/api-to-openapi docs/api/<原本>` で変換する
- Manus の画面モックも未受領。現在の画面は素の CSS + CSS 変数による暫定実装
  （モックが Tailwind だった場合の切替手順は docs/coding-standards.md に記載済み）
- `OrderListView` は縦串の参考実装。実仕様が来たら差し替える前提
