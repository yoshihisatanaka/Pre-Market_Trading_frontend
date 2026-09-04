# API 仕様書 → OpenAPI 変換手順

バックエンドから仕様書を受領したとき、この手順に沿って `docs/api/openapi.yaml` を作り、フロントエンドに反映する。

## 0. 前提

- 受領したコピーは `docs/api/` 直下に **無加工**で置く（形式は問わない: Excel / Markdown / PDF / Word）。
  **仕様そのものの正はバックエンド側リポジトリの原本**で、ここに置くのはその受領コピー
- 変換後の `openapi.yaml` を **フロント実装上の正**とする。受領コピーと食い違ったらバックエンド担当に確認し、
  バックエンド側の原本を直してもらったうえで受領し直す（→ [README.md](README.md)）
- レスポンスのキー名（snake_case など）は **バックエンドの表記のまま**書く。camelCase への変換は `src/api/` で行う

## 1. 変換の実行（Claude Code スキル）

原本を `docs/api/` に置いたうえで、Claude Code で次を実行する。

```
/api-to-openapi docs/api/<原本ファイル名>
```

引数を省略すると `docs/api/` 直下の原本を自動で探す。
プロンプトの実体は [.claude/skills/api-to-openapi/SKILL.md](../../.claude/skills/api-to-openapi/SKILL.md)
にあり、出力条件（OpenAPI 3.1 / `servers: /api` / 命名規則 / `example` 必須 / `x-todo` の扱いなど）はそこで管理する。
条件を変えたいときは SKILL.md を直す。

実行すると次が自動で行われる。

1. `docs/api/openapi.yaml` を生成
2. `redocly lint` で検証（error があれば修正して再実行）
3. `redocly build-docs` で `docs/api/openapi.html` を生成（コミットしない・`.gitignore` 済み）
4. lint 結果・`x-todo` 一覧・チェックリスト自己点検を報告

### 再生成だけしたいとき（`openapi.yaml` を手で直した後など）

Redocly CLI は Docker の `redocly` サービスで動く（作業ディレクトリは `docs/api/`）。

```powershell
docker compose run --rm redocly lint openapi.yaml
docker compose run --rm redocly build-docs openapi.yaml -o openapi.html
# 編集しながらライブ表示したいとき → http://localhost:8080
docker compose run --rm -p 8080:8080 redocly preview-docs openapi.yaml -h 0.0.0.0
```

lint のルールは [redocly.yaml](redocly.yaml) で調整する。

## 2. 変換後チェックリスト

スキルが自己点検した結果を、**人が原本と突き合わせて再確認する**。
項目は [.claude/skills/api-to-openapi/checklist.md](../../.claude/skills/api-to-openapi/checklist.md)（8 項目）。
**すべて OK になるまで反映作業に進まない。**

## 3. フロントエンドへの反映手順

順番どおりに行う。**各ステップ後に `docker compose run --rm frontend npm run test:unit` が通ること。**

1. **fixtures** — `openapi.yaml` の `example` を `src/mocks/fixtures/<リソース>.js` に写す（生の形のまま）
2. **api 層** — `src/api/<リソース>.js` にエンドポイント1つにつき関数を1つ追加。レスポンスを camelCase のアプリ内モデルへ変換する `toXxx()` を書く
3. **handlers** — `src/mocks/handlers/index.js` に、そのエンドポイントの MSW ハンドラを追加（fixtures を返すだけ）
4. **store / composable** — 画面が必要とする状態と取得関数を追加
5. **view** — 画面を実装。ローディング / エラー / 空 / データあり の4状態を出し分ける
6. **テスト** — store の spec、画面の spec、E2E を1本ずつ

## 4. 既存コードとの照合表（仕様確定時に見直す箇所）

現在のサンプル実装は仮仕様で動いている。`openapi.yaml` が確定したら、以下を照合して差し替える。

| 仮仕様（現在） | 該当ファイル | 確認すること |
|---|---|---|
| `GET /api/orders` → `{ items: Order[], total: number }` | `src/api/orders.js`, `src/mocks/fixtures/orders.js` | パス・ページング形式・キー名 |
| `Order.side` = `buy` / `sell` | `src/views/OrderListView.vue`（`sideLabels`） | 実際の売買区分の値 |
| `Order.status` = `working` / `filled` / `canceled` / `rejected` | `src/views/OrderListView.vue`（`statusLabels`） | 実際の注文状態の値と表示名 |
| `Order.ordered_at` = ISO 8601 (UTC) | `src/api/orders.js`（`toOrder`）, `src/utils/format.js` | 形式とタイムゾーン |
| エラー応答 = `{ message, code }` | `src/api/client.js`（`normalizeError`） | 実際のエラー形式 |
