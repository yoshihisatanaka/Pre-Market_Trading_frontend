# フロントエンド コーディング規約

Vue 公式スタイルガイドの **優先度 A（必須）/ B（強く推奨）** を土台に、本プロジェクト固有の取り決めを加えたもの。
本プロジェクトには別メンバによるコードレビューが無いため、**この規約と ESLint / テストがレビューの代替**となる。
機械的に検査できるものは可能な限り [frontend/eslint.config.js](../frontend/eslint.config.js) に落としてある。

---

## 1. コンポーネント

- **Composition API + `<script setup>` に統一する。** Options API は使わない（`vue/component-api-style` で強制）
- ファイル名は **パスカルケースの複数語**。`OrderList.vue` は可、`Order.vue` は不可（`vue/multi-word-component-names`）
  - 例外的に許されるのは `App.vue` のみ
- テンプレート内の参照も **PascalCase**（`<OrderList />`）
- `v-for` には必ず一意な `:key` を付ける
- `v-if` と `v-for` を同一要素に書かない
- props はオブジェクト記法で `type` を必ず書き、必須でないものには `default` を書く（`vue/require-default-prop`）
- スコープの狭いスタイルは `<style scoped>`。グローバルスタイルは `src/assets/styles/` にのみ置く

### 配置ルール

| ディレクトリ | 置くもの |
|---|---|
| `src/views/` | ルーティングの単位となる画面。`router/index.js` から参照されるもののみ |
| `src/components/ui/` | ドメイン知識を持たない汎用部品（`BaseButton`, `DataTable` 等） |
| `src/components/<domain>/` | `orders/` のようにドメイン別に切る。汎用部品に業務ロジックを混ぜないこと |
| `src/composables/` | 状態を持つ再利用ロジック。`useXxx` の名前にする |
| `src/api/` | HTTP 通信。**ここだけがバックエンドのレスポンス形を知ってよい** |
| `src/stores/` | Pinia ストア。`useXxxStore` の名前にし、setup ストア形式で書く |
| `src/utils/` | 状態を持たない純関数（整形・計算など） |
| `src/mocks/` | MSW のハンドラとフィクスチャ |

---

## 2. レイヤ規約（最重要）

```
views / components  →  stores  →  api  →  (HTTP)
```

- **view / component から `axios` を直接使わない。** 必ず store か composable を経由する
- **`src/api/` の外で snake_case を扱わない。** バックエンドのレスポンスは `api/` 層で camelCase のアプリ内モデルへ変換する
  （参考実装: [frontend/src/api/orders.js](../frontend/src/api/orders.js) の `toOrder()`）
- axios インスタンスは [frontend/src/api/client.js](../frontend/src/api/client.js) の `apiClient` **1つだけ**。新しく `axios.create()` しない
- エラーは `client.js` の interceptor が `ApiError`（`message` / `status` / `code`）に正規化する。
  画面側は `error.message` をそのまま表示してよい

この規約により、**実 API 差し替え時の変更は `src/api/` 内に閉じる。**

上記は ESLint の `no-restricted-imports` で機械検査される（[eslint.config.js](../frontend/eslint.config.js) の「レイヤ規約の機械検査」ブロック）。

| 違反 | 検出される場所 |
|---|---|
| `src/api/` 以外で `import axios` | `src/**` 全体 |
| `views/` / `components/` から `@/api/*` を import | `src/views/**`, `src/components/**` |
| `api/` から `stores` / `views` / `components` / `composables` を import | `src/api/**` |

### 非同期処理

`loading` / `error` の管理は [`useAsync`](../frontend/src/composables/useAsync.js) を使い、各所で try-catch を書かない。
画面は **ローディング / エラー / 空 / データあり の4状態**を必ず出し分ける
（参考実装: [frontend/src/views/OrderListView.vue](../frontend/src/views/OrderListView.vue)）。

---

## 3. API モック（MSW）の運用

- モックは `frontend/src/mocks/handlers/index.js` に集約し、レスポンス実体は `fixtures/` に分ける
- `fixtures/` に書くのは **バックエンドが返す生の形**（snake_case のまま）。アプリ内モデルを書かない
- ブラウザ・単体テスト・E2E で **同じ handlers / fixtures を共用**する
- 未定義のリクエストは実 API へ **素通し**される（`onUnhandledRequest: 'bypass'`）

### API が実装された時の移行手順

1. バックエンドから「この API を実装した」と連絡を受ける
2. `handlers/index.js` から該当ハンドラを **削除**する
3. `docker compose up frontend` で該当画面を開く → リクエストが実 API へ流れる
4. レスポンス形が想定と違えば `src/api/` の変換関数だけを直す

段階的移行のため、**全ハンドラを一度に消す必要はない。** 実装済みのものから1本ずつ消していく。

---

## 4. API 仕様書 / OpenAPI の運用

1. バックエンドから受領した仕様書の原本を `docs/api/` にそのまま置く
2. Claude で `docs/api/openapi.yaml` へ変換する
3. **以後 `openapi.yaml` を唯一の正**とし、仕様の解釈で迷ったらここを見る。原本と食い違ったらバックエンド担当に確認する
4. `openapi.yaml` の `example` を `frontend/src/mocks/fixtures/` に反映する
5. エンドポイントが増えたら `src/api/` に関数を1つ追加する（1エンドポイント = 1関数、動詞始まりの名前）

> 本プロジェクトは JavaScript のため型の自動生成は行わない。
> 型補完が必要になった場合は `openapi-typescript` で `.d.ts` のみ生成し、JSDoc の `@typedef` から参照する余地は残してある（現時点では未導入）。

---

## 5. スタイル

- 色・余白・フォントは [`tokens.css`](../frontend/src/assets/styles/tokens.css) の CSS 変数を使う。**直値で色を書かない**
- Manus のモック HTML/CSS の原本は `docs/mock/` に無加工で保管し、コンポーネント化の際の参照元とする
- モックの CSS を取り込む時は、共通化できる値を `tokens.css` に吸い上げてから各コンポーネントの `<style scoped>` に配る

### Tailwind を後から有効化する手順

Manus のモックが Tailwind ベースだった場合、以下の3手順で切り替えられる（現時点では未導入）。

```bash
docker compose run --rm frontend npm i -D tailwindcss @tailwindcss/vite
```

1. `frontend/vite.config.js` の `plugins` に `tailwindcss()` を追加
2. `frontend/src/assets/styles/main.css` の先頭に `@import 'tailwindcss';` を1行追加
3. `tokens.css` の CSS 変数を Tailwind の `@theme` にマッピングする

素の CSS を使っている既存コンポーネントはそのまま共存できるため、一括置換は不要。

---

## 6. テスト

| 種別 | ツール | 置き場所 | 対象 |
|---|---|---|---|
| 単体 | Vitest | `src/**/*.spec.js`（対象ファイルの隣） | ストア・composable・utils のロジック |
| E2E | Playwright | `frontend/e2e/*.spec.js` | 画面の主要導線 |

- 単体テストは MSW(node) 経由で API を解決する。`vitest.setup.js` が自動で起動・リセットする
- 個別のテストでレスポンスを変えたい時は `server.use()` で上書きする（`afterEach` で自動的に戻る）
- 単体テストの見本:
  - 汎用部品（props / slots の入出力のみ）: [DataTable.spec.js](../frontend/src/components/ui/DataTable.spec.js)
  - 画面（実 Pinia + MSW で4状態を検証）: [OrderListView.spec.js](../frontend/src/views/OrderListView.spec.js)
- E2E の要素特定は `data-testid` か `getByRole` を使う。CSS クラス名に依存しない
- E2E でシナリオ別に API 応答を変えるときは [e2e/helpers/mockApi.js](../frontend/e2e/helpers/mockApi.js) の `mockApi()` を **`page.goto()` より前に**呼ぶ
  （見本: [e2e/orders.spec.js](../frontend/e2e/orders.spec.js)）。
  **`page.route()` は使えない** — MSW がページ内で fetch を横取りするため、リクエストがネットワークに出ない
- E2E はコンテナ間通信（`http://frontend:5173`）のため secure context にならず、
  MSW は Service Worker ではなく fallback mode で動作する（コンソールに `(fallback mode)` と出るが正常）。
  開発者がブラウザで開く `http://localhost:5173` は secure context なので通常の Service Worker モードになる
- **新しい画面を追加するときは、先に [docs/e2e/<画面>.md](e2e/README.md) にシナリオを書く。**
  E2E のタイトル先頭にシナリオ ID（`[OL-01]`）を付け、`docker compose run --rm frontend npm run check:scenarios` で対応漏れが無いことを確認する。
  レビュー担当が居ないため、シナリオ文書 + E2E が回帰検知の主手段になる

---

## 7. コマンド

ホストに Node は無い。**npm は必ず Docker 経由で実行する。**

```powershell
docker compose run --rm frontend npm run lint
docker compose run --rm frontend npm run format
docker compose run --rm frontend npm run test:unit
docker compose run --rm frontend npm i <package>   # 依存追加もコンテナ内で行う
```

コミット前に最低限 `lint` と `test:unit` を通すこと。
