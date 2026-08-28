# API 仕様書 → OpenAPI 変換手順

バックエンドから仕様書を受領したとき、この手順に沿って `docs/api/openapi.yaml` を作り、フロントエンドに反映する。

## 0. 前提

- 原本は `docs/api/` 直下に **無加工**で置く（形式は問わない: Excel / Markdown / PDF / Word）
- 変換後の `openapi.yaml` を **唯一の正**とする。原本と食い違ったらバックエンド担当に確認し、**両方を直す**
- レスポンスのキー名（snake_case など）は **バックエンドの表記のまま**書く。camelCase への変換は `frontend/src/api/` で行う

## 1. Claude へ渡すプロンプト（テンプレート）

原本を `docs/api/` に置いたうえで、次をそのまま貼る。`<原本ファイル名>` だけ差し替える。

```
docs/api/<原本ファイル名> を読み、docs/api/openapi.yaml を作成してください。

## 出力条件
- OpenAPI 3.1 / YAML。`info.title` は "US Stock Order API"
- `servers` は `- url: /api` の1つだけ（Vite の proxy 前提）
- パスは原本どおり。原本に無いエンドポイントを推測で足さない
- `operationId` は 動詞+リソース の lowerCamelCase（例: listOrders, getOrder, createOrder, cancelOrder）
- スキーマは `components/schemas` に切り出し、名前は PascalCase（例: Order, OrderListResponse, ApiError）
- プロパティ名は原本の表記（snake_case 等）を **変えない**
- 各プロパティに `type` と、可能なら `description` を付ける。列挙値は `enum` に列挙する
- 日時は `type: string, format: date-time`。金額は `type: number`、株数は `type: integer`
- `required` は原本で必須とされているものだけ。不明なものは required に入れず、`x-todo: "必須かどうか要確認"` を付ける
- 各レスポンスに **必ず `example` を付ける**（frontend/src/mocks/fixtures/ に流用する）
- エラー応答は `ApiError` スキーマ（`message: string`, `code: string`）に統一し、400/401/403/404/500 を各操作に付ける。原本に無い場合は `x-todo` で明記する
- 原本の記述が曖昧・矛盾している箇所は推測で埋めず、該当箇所に `x-todo` を付けて理由を書く

## 出力後
- `x-todo` の一覧を、ファイル名・行番号つきで箇条書きにして報告してください
```

## 2. 変換後チェックリスト

Claude の出力を原本と突き合わせ、以下を1つずつ確認する。**すべて ✓ になるまで反映作業に進まない。**

| # | 確認項目 | 見落とすと起きること |
|---|---|---|
| 1 | エンドポイントの過不足が無い（原本の一覧と件数が一致） | 実装されない API を呼びに行く |
| 2 | 必須 / 任意が原本と一致 | 空表示・バリデーション漏れ |
| 3 | `enum` の値が原本の全パターンを含む（注文状態・売買区分・注文種別など） | 想定外の値で表示が「undefined」になる |
| 4 | 日時の形式（ISO 8601 か / タイムゾーン付きか / UTC か） | 日付が1日ずれる |
| 5 | 金額・価格が小数、株数が整数になっている | 端数表示の崩れ |
| 6 | エラー応答の形（`message` / `code`）が `frontend/src/api/client.js` の想定と一致 | エラーメッセージが表示されない |
| 7 | 一覧系のページング形式（`items` / `total` / `page` など）が統一されている | 画面ごとに違う処理を書く羽目になる |
| 8 | `x-todo` がすべて解消済み、または未解決の一覧をバックエンド担当に送付済み | 仕様の食い違いが実装後に発覚 |

## 3. フロントエンドへの反映手順

順番どおりに行う。**各ステップ後に `docker compose run --rm frontend npm run test:unit` が通ること。**

1. **fixtures** — `openapi.yaml` の `example` を `frontend/src/mocks/fixtures/<リソース>.js` に写す（生の形のまま）
2. **api 層** — `frontend/src/api/<リソース>.js` にエンドポイント1つにつき関数を1つ追加。レスポンスを camelCase のアプリ内モデルへ変換する `toXxx()` を書く
3. **handlers** — `frontend/src/mocks/handlers/index.js` に、そのエンドポイントの MSW ハンドラを追加（fixtures を返すだけ）
4. **store / composable** — 画面が必要とする状態と取得関数を追加
5. **view** — 画面を実装。ローディング / エラー / 空 / データあり の4状態を出し分ける
6. **テスト** — store の spec、画面の spec、E2E を1本ずつ

## 4. 既存コードとの照合表（仕様確定時に見直す箇所）

現在のサンプル実装は仮仕様で動いている。`openapi.yaml` が確定したら、以下を照合して差し替える。

| 仮仕様（現在） | 該当ファイル | 確認すること |
|---|---|---|
| `GET /api/orders` → `{ items: Order[], total: number }` | `frontend/src/api/orders.js`, `frontend/src/mocks/fixtures/orders.js` | パス・ページング形式・キー名 |
| `Order.side` = `buy` / `sell` | `frontend/src/views/OrderListView.vue`（`sideLabels`） | 実際の売買区分の値 |
| `Order.status` = `working` / `filled` / `canceled` / `rejected` | `frontend/src/views/OrderListView.vue`（`statusLabels`） | 実際の注文状態の値と表示名 |
| `Order.ordered_at` = ISO 8601 (UTC) | `frontend/src/api/orders.js`（`toOrder`）, `frontend/src/utils/format.js` | 形式とタイムゾーン |
| エラー応答 = `{ message, code }` | `frontend/src/api/client.js`（`normalizeError`） | 実際のエラー形式 |
