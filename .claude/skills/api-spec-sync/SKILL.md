---
name: api-spec-sync
description: バックエンドの api コンテナから最新の OpenAPI 仕様（FastAPI 生成の JSON）を docs/api/openapi.json に取得し、Redocly CLI で lint と閲覧用 HTML 生成（docs/api/openapi.html）を行い、前回からの差分と仕様ギャップ（response_model 未宣言・enum 無し・エラー応答未定義など）を報告する。「API 仕様を取り込んで」「API 仕様を最新にして」「openapi.json を更新して」「API ドキュメントを生成して」という依頼で使う。
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(docker compose run --rm redocly *), Bash((cd ../Pre-Market_Trading && docker compose ps *), Bash((cd ../Pre-Market_Trading && docker compose exec -T api python *), Bash(git diff *), Bash(git status *)
---

# API 仕様の取り込み

バックエンドの API 仕様は **FastAPI が生成する OpenAPI 3.1 の JSON**。すでに OpenAPI なので
**変換しない**（`openapi.yaml` は作らない。二度手間になるうえ、原本と 2 本並ぶとどちらが正か曖昧になる）。

`docs/api/openapi.json` を **フロント実装上の正**とする。このスキルの役割は
**取得 → 検証 → 閲覧用 HTML 生成 → 仕様ギャップの点検**まで。

## 手順

### 1. `api` コンテナの確認

バックエンドリポジトリへは**必ず相対パス**で触れる。絶対パスは
`.claude/hooks/guard-secret-paths.sh` が「プロジェクト外の絶対パス」として拒否する。

```bash
(cd ../Pre-Market_Trading && docker compose ps --services --filter status=running)
```

出力に `api` が無い、または `docker` 自体が失敗する場合は **ここで手を止めて報告する**。
**自分で `docker compose up` しない。** 報告には次を「バックエンドリポジトリで手動実行してください」として載せる。

```bash
(cd ../Pre-Market_Trading && docker compose up -d api)
```

既存の `docs/api/openapi.json` がある場合は、あわせて「古い取り込み済み仕様のまま作業を続けてよいか」を確認する。

### 2. 取得して docs/api/openapi.json に置く

```bash
(cd ../Pre-Market_Trading && docker compose exec -T api python -c "import json,sys; from app.main import app; json.dump(app.openapi(), sys.stdout, ensure_ascii=False, indent=2)") > docs/api/openapi.json
```

- コンテナは `.:/app` しかマウントしていないため、**コンテナ内からフロントエンドの `docs/api/` へは書けない**。
  stdout に出してホスト側でリダイレクトする。
- `exec -T` は必須（TTY 割り当てによる CR 混入を防ぐ）。
- リダイレクトは **Bash ツール**で行う。PowerShell の `>` は UTF-8 BOM が付きうる。
- `cd` はサブシェル `( ... )` の中だけなので、実行後もカレントディレクトリはフロントエンドのまま。
- 毎回**上書き**する。このファイルは **Git 管理対象**なので、仕様変更は `git diff` に出る。

### 3. 検証

`docs/api/openapi.json` を Read し、`{` で始まり `"openapi"` / `"paths"` キーを含むことを確かめる。
空・0 バイト・Python のトレースバックが混ざっている場合は**先に進まず**、出力をそのまま報告して終了する。

### 4. lint と閲覧用 HTML の生成

Redocly CLI は Docker の `redocly` サービス（`docker-compose.yml`、作業ディレクトリは `docs/api/`）で実行する。
ホストに Node は無い。**JSON をそのまま入力にできる。**

1. **lint**

   ```bash
   docker compose run --rm redocly lint openapi.json
   ```

   **error / warning があっても直さない。** `openapi.json` はバックエンドの生成物であり、
   フロント側で編集すると次回の取得で消える。件数と内容をそのまま報告し、バックエンド担当への確認事項にする。

2. **HTML ドキュメント生成**

   ```bash
   docker compose run --rm redocly build-docs openapi.json -o openapi.html
   ```

   → `docs/api/openapi.html` が生成される（`.gitignore` 済み。コミットしない）。

3. コマンドが失敗し、原因が Docker の未起動（`docker info` 相当のエラー）である場合は、
   lint と生成をスキップし、報告に「Docker 起動後に次を手動実行」として上記 2 コマンドを載せる。

### 5. 報告

次の順で報告する。

| # | 項目 | 内容 |
|---|---|---|
| 1 | 取得結果 | `docs/api/openapi.json` のバイト数、`info.title` / `info.version`、パス / オペレーション / スキーマの件数 |
| 2 | 前回からの差分 | `git diff --stat docs/api/openapi.json`。増減したエンドポイントがあれば一覧にする。初回取得ならその旨 |
| 3 | lint 結果 | error / warning の件数と内容。**直していないこと**を明記する。スキップした場合はその旨と手動コマンド |
| 4 | 仕様ギャップ | [checklist.md](checklist.md) を読み、各項目について `OK` / `要確認` と根拠（件数・該当箇所）を表で示す |
| 5 | 次の手順 | 反映作業は行わず、[docs/api/README.md](../../../docs/api/README.md) の「フロントエンドへの反映手順」と「既存コードとの照合表」を案内するに留める。ギャップの確認が先 |

ドキュメントの開き方も添える。

```powershell
Start-Process .\docs\api\openapi.html
```

編集しながら見たい場合は `docker compose run --rm -p 8080:8080 redocly preview-docs openapi.json -h 0.0.0.0` → http://localhost:8080 。

## やらないこと

- **`docs/api/openapi.json` を編集しない。** バックエンドの生成物であり、次回取得で消える。
  仕様がおかしい場合はバックエンド担当に直してもらい、取得し直す。
- **`openapi.yaml` を作らない。** 原本がすでに OpenAPI 3.1 なので変換は二度手間。
- `src/` / `e2e/` 配下のコードは変更しない（fixtures / api / handlers への反映は別作業）。
- バックエンドリポジトリ（`../Pre-Market_Trading`）のファイルを編集しない。コンテナも起動しない
  （触ってよいのは `docker compose ps` と `docker compose exec` の読み出しだけ）。
- `docs/api/openapi.html` はコミットしない（`.gitignore` 済み）。
