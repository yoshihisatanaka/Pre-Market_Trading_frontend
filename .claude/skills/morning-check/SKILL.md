---
name: morning-check
description: 本体セッションで毎朝 1 回だけ回す定型点検。API 仕様の取り込み（/api-spec-sync）→ npm run verify（lint / 単体 / 契約テスト / シナリオ対応）→ 実 API E2E 全件 を 1 ターンで流し、仕様差分・契約テストの落ち・実 API の退行を 1 つの表で報告する。「朝の点検をして」「毎朝のチェックを回して」「/morning-check」で使う。実装・テストの追加やコミットは行わない。
allowed-tools: Skill, Read, Glob, Grep, Bash(docker compose run --rm frontend npm run *), Bash(docker compose run --rm e2e npx playwright *), Bash(docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright *), Bash(docker compose up -d *), Bash(docker compose ps *), Bash((cd ../Pre-Market_Trading && docker compose ps *), Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git rev-parse *), Bash(bash scripts/worktree.sh *)
---

# 朝の点検（本体セッション専用）

**目的は「実 API を見ない日を作らない」こと。** 仕様の取り込みと実 API への接触を毎日 1 回に集約し、
食い違いを **1 日分**で止める。worktree の並行作業は止めない（排他リソースを使うのはこの 1 回だけ）。

## 前提

- **本体セッションで実行する。** `/api-spec-sync` は `../Pre-Market_Trading` を相対パスで見るため worktree からは動かない。
  `git rev-parse --show-toplevel` が `.claude/worktrees/` や `worktrees/` を含んでいたら手を止め、本体で実行するよう伝える
- 実 API E2E には **環境変数 `VITE_ENABLE_MSW` を `false` にした frontend** と **バックエンドの `api` の起動**が要る。
  設定ファイル（`.env`）はこのスキルからは読み書きできない（deny ルール）ので、実 API の段だけはユーザに次を頼む
  （頼んだうえで残りの段は先に進める）:

```powershell
# バックエンド側（別リポジトリ）
(cd ../Pre-Market_Trading && docker compose up -d api)
# フロント側。.env の VITE_ENABLE_MSW=false にしてから
docker compose up -d --force-recreate frontend
```

## 手順（順に。失敗しても次へ進み、最後にまとめて報告する）

### 1. 仕様の取り込み

`api-spec-sync` スキルを **Skill ツールで 1 回**呼ぶ。報告のうち次だけを控える:
差分の有無 / 変わったパス・クエリ名・スキーマ / 仕様ギャップの増減。

### 2. verify（lint / 単体 / 契約テスト / シナリオ対応）

```powershell
docker compose run --rm frontend npm run verify
```

- **契約テスト（`src/api/contract.spec.js`・略号 `CON`）が落ちたら、それが今日の主役。**
  落ちた項目を「仕様が変わった（フロントを直す）」「フロントの送り方が古い」「`KNOWN_GAPS` が解消した（一覧から外す）」に分ける
- ほかの単体が落ちたら手を止めて報告する（この点検では直さない）

### 3. 実 API E2E 全件

前提が整っていることを確認してから、実 API 版だけを流す:

```powershell
(cd ../Pre-Market_Trading && docker compose ps --services --filter status=running)
docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test --grep real-api
```

- `api` が動いていない、または前提を整えてもらえない日は **この段をスキップと明記**する（黙って飛ばさない）
- 落ちたテストは「昨日まで通っていた（退行）」か「もとから保留・未対応」かを `git log` と
  `docs/e2e/*-real-api.md` の状態列で分ける

### 4. 実 API スモーク（3 軸が揃った画面がある日だけ）

前日に **実装 / UnitTest / E2E(MSW) が揃った画面**があれば、その `docs/e2e/<画面>-real-api.md` の
**最初の 2 行**（一覧 1 本・書き込み 1 本）が `実装済` になっているかを見る。無ければ「スモーク未作成」として報告に載せる
（作るのは `real-api-e2e-author` の仕事。この点検では作らない）。

### 5. 報告

次の 1 表だけを出す。長文にしない。

| 段 | 結果 | 要対応 |
|---|---|---|
| 仕様取り込み | 差分あり / なし（変わった名前を列挙） | フロントで直す箇所 |
| verify | OK / 落ちた項目 | 契約テストの分類結果 |
| 実 API E2E | 通過 n / 失敗 m / スキップ | 退行 と 未対応 を分けて |
| スモーク | 未作成の画面 | 依頼先 |

要対応のうち **バックエンド起因**のものは `docs/api/requests.md` に行を足すことを提案する
（足すのはユーザの確認後）。

## やらないこと

- 実装・テストの追加・修正、コミット、設定ファイルの読み書き、`docker compose up` のバックエンド側の実行
- 進捗表の再生成（それは `/progress-report`。この点検の結果を材料に別途回す）
