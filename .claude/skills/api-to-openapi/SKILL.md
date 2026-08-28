---
name: api-to-openapi
description: バックエンドから受領した API 仕様書の原本（docs/api/ 配下の Excel / Markdown / PDF など）を読み、OpenAPI 3.1 の docs/api/openapi.yaml に変換して x-todo 一覧とチェックリスト結果を報告する。「API 仕様書を変換して」「openapi.yaml を作って」「OpenAPI にして」という依頼で使う。
argument-hint: [仕様書のパス]
allowed-tools: Read, Write, Edit, Glob, Grep
---

# API 仕様書 → OpenAPI 変換

バックエンドの API 仕様書原本を `docs/api/openapi.yaml`（OpenAPI 3.1 / YAML）に変換する。
`openapi.yaml` はこのプロジェクトで **唯一の正** となる。原本と食い違う箇所は推測で埋めず `x-todo` で残す。

## 手順

### 1. 入力の解決

- 引数 `$0` が与えられていれば、そのファイルを原本として読む。
- 引数が無ければ `docs/api/` 直下を Glob で調べ、`openapi.yaml`・`README.md`・`CONVERSION.md` を除いたファイルを原本候補とする。
  - 候補が 1 つならそれを使う。
  - 複数あるならユーザーにどれを使うか確認する。
  - 候補が無ければ「原本を docs/api/ に置いてから再実行してください」と伝えて終了する。
- 原本が Excel / PDF など直接読めない形式で、内容を取り出せない場合はその旨を伝え、Markdown か CSV への変換を依頼して終了する。

### 2. 既存 openapi.yaml の確認

`docs/api/openapi.yaml` が既にあれば、**上書きする前に**ユーザーへ「新規に作り直す」か「既存に追記・修正する」かを確認する。無ければ新規作成する。

### 3. 変換して docs/api/openapi.yaml を書く

以下の出力条件をすべて満たすこと。

- OpenAPI 3.1 / YAML。`info.title` は `US Stock Order API`、`info.version` は原本に版があればそれ、無ければ `0.1.0`。
- `servers` は `- url: /api` の 1 つだけ（フロントエンドは Vite の proxy 経由で `/api` を叩く）。
- パスは原本どおり。**原本に無いエンドポイントを推測で足さない。**
- `operationId` は 動詞+リソース の lowerCamelCase（例: `listOrders`, `getOrder`, `createOrder`, `cancelOrder`）。
- スキーマは `components/schemas` に切り出し、名前は PascalCase（例: `Order`, `OrderListResponse`, `ApiError`）。
- プロパティ名は原本の表記（snake_case 等）を **変えない**。camelCase への変換はフロントエンドの `src/api/` 層が行う。
- 各プロパティに `type` と、可能なら `description` を付ける。列挙値は `enum` に列挙する。
- 日時は `type: string` + `format: date-time`。金額・価格は `type: number`。株数などの個数は `type: integer`。
- `required` は原本で必須と明記されているものだけ。不明なものは `required` に入れず、そのプロパティに `x-todo: "必須かどうか要確認"` を付ける。
- 各レスポンスに **必ず `example` を付ける**（`frontend/src/mocks/fixtures/` にそのまま流用する）。
- エラー応答は `ApiError` スキーマ（`message: string`, `code: string`）に統一し、各操作に 400 / 401 / 403 / 404 / 500 を付ける。原本にエラー仕様が無い場合は `ApiError` に `x-todo: "エラー応答の形式が原本に無いため仮置き"` を付ける。
- 原本の記述が曖昧・矛盾している箇所は推測で埋めず、該当箇所に `x-todo` を付けて理由を書く。

### 4. 報告

変換が終わったら、次の順で報告する。

1. **x-todo 一覧** — `openapi.yaml` を Grep し、行番号と内容を箇条書きにする。0 件ならその旨。
2. **チェックリスト自己点検** — [checklist.md](checklist.md) を読み、8 項目それぞれについて `OK` / `要確認` / `該当なし` と根拠を表で示す。
3. **次の手順の案内** — 反映作業は行わず、`docs/api/CONVERSION.md` の「3. フロントエンドへの反映手順」と「4. 既存コードとの照合表」を案内するに留める。仕様の確認が先。

## やらないこと

- `frontend/` 配下のコードは変更しない（fixtures / api / handlers への反映は別作業）。
- 原本ファイルを編集・移動しない。
