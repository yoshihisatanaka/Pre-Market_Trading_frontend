# API 仕様

> **仕様そのものの正はバックエンド側リポジトリにある。**
> このディレクトリに置くのは、バックエンドの `api` コンテナから**取り込んだ時点のコピー**。
> ここで直しても仕様は変わらないし、次の取り込みで消える。食い違いを見つけたらバックエンド担当に確認し、
> **バックエンド側を直してもらってから取り込み直す**。
> そのうえで、**フロントエンド実装の判断基準はこのディレクトリの `openapi.json`** とする
> （「仕様の正 = バックエンド側リポジトリ」「フロント実装の正 = `openapi.json`」の 2 層で運用する）。

原本は FastAPI が生成する **OpenAPI 3.1 の JSON**。すでに OpenAPI なので **YAML へ変換しない**
（二度手間になるうえ、2 本並ぶとどちらが正か曖昧になる）。

## 置き方

| ファイル | 内容 |
|---|---|
| `openapi.json` | `/api-spec-sync` が `api` コンテナから取得した仕様（無加工）。**フロント実装上の正。コミットする**（仕様変更が `git diff` に出る）。手で編集しない |
| `openapi.html` | `openapi.json` から Redocly で生成した閲覧用 HTML。**生成物なのでコミットしない**（`.gitignore` 済み） |
| `redocly.yaml` | Redocly CLI（lint / HTML 生成）の設定 |

Excel / Markdown / PDF など JSON 以外の仕様書を別途受領したときは、このディレクトリ直下に無加工で置く（編集しない）。

## 1. 取り込み

1. バックエンドリポジトリ（隣の `../Pre-Market_Trading`）で `api` コンテナを起動しておく

   ```bash
   (cd ../Pre-Market_Trading && docker compose up -d api)
   ```

2. Claude Code で次を実行する

   ```text
   /api-spec-sync
   ```

スキルの実体は [.claude/skills/api-spec-sync/SKILL.md](../../.claude/skills/api-spec-sync/SKILL.md)。
実行すると次が自動で行われる。

1. `api` コンテナから仕様を取得し、`docs/api/openapi.json` に無加工で上書き

   ```bash
   (cd ../Pre-Market_Trading && docker compose exec -T api python -c "import json,sys; from app.main import app; json.dump(app.openapi(), sys.stdout, ensure_ascii=False, indent=2)") > docs/api/openapi.json
   ```

   コンテナは `.:/app` しかマウントしていないため、コンテナ内から `docs/api/` へは書けない。
   stdout に出してホスト側でリダイレクトする。`api` が起動していなければスキルはここで止まる。
2. `redocly lint` で検証（**error があってもフロント側では直さない**。バックエンド担当への確認事項にする）
3. `redocly build-docs` で `docs/api/openapi.html` を生成（コミットしない）
4. 取得結果・前回からの差分・lint 結果・仕様ギャップの点検結果を報告

### 再生成だけしたいとき

Redocly CLI は Docker の `redocly` サービスで動く（作業ディレクトリは `docs/api/`）。

```bash
docker compose run --rm redocly lint openapi.json
docker compose run --rm redocly build-docs openapi.json -o openapi.html

# 編集しながらライブ表示したいとき → http://localhost:8080
docker compose run --rm -p 8080:8080 redocly preview-docs openapi.json -h 0.0.0.0
```

## 2. 仕様ギャップの確認

スキルが点検した結果を、**人が読んでバックエンド担当に送る**。
項目は [.claude/skills/api-spec-sync/checklist.md](../../.claude/skills/api-spec-sync/checklist.md)（7 項目）。

`response_model` が未宣言でレスポンスの中身が素の object になっている、`enum` が無い、
エラー応答の形が未定義 —— こうした穴は**推測で埋めない**。埋めると実装後に食い違いが発覚する。

## 3. フロントエンドへの反映手順

順番どおりに行う。**各ステップ後に `docker compose run --rm frontend npm run test:unit` が通ること。**

1. **fixtures** — `openapi.json` のスキーマから `src/mocks/fixtures/<リソース>.js` を起こす（バックエンドが返す生の形のまま）。
   原本に `example` は無く、要素の形が未定義な箇所もあるため、**そこはバックエンド担当に確認してから書く**
2. **api 層** — `src/api/<リソース>.js` にエンドポイント1つにつき関数を1つ追加。レスポンスを camelCase のアプリ内モデルへ変換する `toXxx()` を書く
3. **handlers** — `src/mocks/handlers/index.js` に、そのエンドポイントの MSW ハンドラを追加（fixtures を返すだけ）
4. **store / composable** — 画面が必要とする状態と取得関数を追加
5. **view** — 画面を実装。ローディング / エラー / 空 / データあり の4状態を出し分ける
6. **テスト** — store の spec、画面の spec、E2E を1本ずつ

## 4. 既存コードとの照合表（仕様確定時に見直す箇所）

現在のサンプル実装は仮仕様で動いている。以下を `openapi.json` と照合して差し替える。

| 仮仕様（現在） | 該当ファイル | 確認すること |
|---|---|---|
| `GET /api/orders` → `{ items: Order[], total: number }` | `src/api/orders.js`, `src/mocks/fixtures/orders.js` | パス・ページング形式・キー名 |
| `Order.side` = `buy` / `sell` | `src/views/OrderListView.vue`（`sideLabels`） | 実際の売買区分の値 |
| `Order.status` = `working` / `filled` / `canceled` / `rejected` | `src/views/OrderListView.vue`（`statusLabels`） | 実際の注文状態の値と表示名 |
| `Order.ordered_at` = ISO 8601 (UTC) | `src/api/orders.js`（`toOrder`）, `src/utils/format.js` | 形式とタイムゾーン |
| エラー応答 = `{ message, code }` | `src/api/client.js`（`normalizeError`） | 実 API は `{ detail: string }`（400 / 401 / 404 / 409 / 500）と `{ detail: ValidationError[] }`（422）の 2 形。どちらも読めるようにしてあるが、`message` を返すのは**まだ切り替えていないマスタのモックだけ** |

## 5. 実 API に切り替え済みのマスタ

| リソース | 実 API | 切り替えた版 | 残っている暫定 |
|---|---|---|---|
| 海外休場日マスタ | `/holidays`（一覧・事前検証・登録・論理削除） | `src/api/marketHolidays.js` | `X-User-Code` を `.env` の `VITE_USER_CODE` から付けている（`src/api/client.js` の interceptor）。SSO が入ったら差し替える |

切り替えても MSW ハンドラは**消していない**。単体テストと E2E が同じ `src/mocks/handlers/` を共用しており、
消すとテストが実 API を叩きにいくため。代わりにハンドラとフィクスチャを**実 API と同じ形**
（日本語キー / 休場日は integer の YYYYMMDD / 降順 / エラーは `{ detail }` / 論理削除）に寄せてある。
実 API に当てて動かすときは `.env` の `VITE_ENABLE_MSW=false`。

実 API にあってフロントがまだ持たない操作: 変更（`PUT /holidays/{holiday_date}`。楽観ロックあり）、
履歴（`GET /holidays/{holiday_date}/history`）、CSV 入出力。

## 現状

取り込み済み（65 パス / 87 オペレーション / 104 スキーマ）。海外休場日以外は主要レスポンスの中身が
未定義など**ギャップが残っている**ため、当面 [src/mocks/](../../src/mocks/) の仮フィクスチャで開発を進める。
詳細は [checklist.md](../../.claude/skills/api-spec-sync/checklist.md) の実測欄を参照。
