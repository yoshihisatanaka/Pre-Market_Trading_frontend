---
name: progress-report
description: 画面 × 機能ごとの 実装 / UnitTest / E2E(MSW) / E2E(実API) の進捗を docs/progress.md に markdown の表として出力する。ルート定義・サイドメニュー・docs/e2e・docs/unit・check:scenarios・git log を突き合わせ、完了日は前回の表から引き継ぐ。「進捗を出して」「進捗一覧を更新して」「どこまで終わってるか一覧にして」という依頼で使う。実装やテストの追加は行わない。
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(git log *), Bash(git status *), Bash(bash scripts/worktree.sh list), Bash(docker compose ps *), Bash(docker compose up -d frontend), Bash(docker compose run --rm frontend npm run check:scenarios), mcp__playwright
---

# 進捗一覧の出力

「何がどこまで終わっているか」の材料は 5 か所に分散している。`src/router/index.js` のルート、
`src/components/layout/navigation.js` の 15 項目、`docs/e2e/` と `docs/unit/` のシナリオ表、
`e2e/*.real-api.spec.js` の有無、`git log`。このスキルはそれを突き合わせて
**画面 × 機能の 1 枚の表**にし、`docs/progress.md` に書く。

**進捗を記録するだけで、実装もテストの追加もしない。** 材料を都合よく書き換えないこと
（判定対象のファイルを触ると、そのターンの表が自己申告になる）。

## 手順

### 1. 前回の表を読む

`docs/progress.md` があれば Read する。**完了日・更新日の引き継ぎ元はこのファイルだけ**で、
git から再計算しない（実行のたびに日付が揺れるのを防ぐ）。無ければ初回生成として進む。

### 2. モック確認の深さをユーザに確認する

**勝手に全画面を巡回しない。** 15 画面ぶんの遷移で時間がかかる。`AskUserQuestion` で 3 択を出す。

| 選択肢 | やること |
|---|---|
| 全画面を巡回 | 公開モック `https://uspreorder-vmbhej3k.manus.space/` のサイドバー全項目を順に開き、snapshot から画面と機能ブロック（ボタン・タブ・フォーム）を拾う。**機能名の分解までモックを正とする** |
| サイドバーだけ | base URL を 1 回開いて snapshot し、画面一覧（分母）だけ更新する |
| 見ない（既定） | `navigation.js` の 15 項目と `docs/mock/` の受領済みモックを分母にする。Docker も Playwright も使わない |

「全画面を巡回」「サイドバーだけ」を選ばれたときだけ Playwright MCP を使う。使う前に、
CLAUDE.md の「Docker は排他利用」に従って現所有者を確かめる。

```bash
bash scripts/worktree.sh list
```

- 最終行の `Docker(frontend)` の所有者が**自分以外なら手を止めて報告する**。`up -d` を奪わない
  （他 worktree の dev サーバが黙って別ブランチのコードを配信し始める）
- 所有者が自分、または誰も持っていなければ `docker compose up -d frontend` を実行する。
  MCP コンテナはネットワーク `us-stock-order-frontend_default` に参加するので、
  frontend が落ちていると起動できない
- スクリーンショットの `filename` は**指定しない**。ホスト側パスとして解決され `ENOENT` になる
- 見に行くのは**外部の公開モック**であって `http://frontend:5173` ではない。コンテナから外へ出られない
  場合は**手を止めて報告する**。別のツールで取りに行かない（何を見て判断したかが
  `.playwright-mcp/session-<時刻>/session.md` に残らなくなる）

### 3. 画面一覧（分母）を確定する

- `src/components/layout/navigation.js` の 3 セクション 15 項目を、表の `## 顧客` /
  `## 注文` / `## マスタメンテ` にそのまま対応させる（並びも変えない）
- 画面を持たない区分（共通レイアウト / UI 部品 / マスタ共通部品 / 共通ロジック /
  API クライアント層 / MSW モック基盤）は `## 共通基盤` に置く。
  **画面列にはその区分名を書く**（例: 画面 `共通レイアウト`、機能名 `サイドバー`）
- サイドメニューに無い画面（`/` 注文一覧、`/dev/ui-catalog`）は
  `## 対象外の画面（集計に含めない）` に置く。**状態は載せるが集計の分母から外す**
  （注文一覧は実仕様が来たら差し替える前提の参考実装、UI カタログは開発用ページで、
  どちらも納品対象ではない）。この 2 行を集計に混ぜると進捗率が実態より高く出る

機能名の分解は、モックを見たならモックの機能ブロックを正とする。見ていないなら
`docs/e2e/` / `docs/unit/` のシナリオ内容と view / store の実装から起こす
（マスタ系なら `一覧・検索` / `新規追加` / `編集` / `削除` が既定の並び）。

### 4. 4 軸の判定材料を集める

```bash
docker compose run --rm frontend npm run check:scenarios
```

シナリオ ID ごとの状態と対応テストファイルが一度に出る。`run --rm` は一時コンテナなので
他 worktree と並行しても安全。ネットワーク作成の競合で稀に落ちるが、**再実行で回復するので
「壊れた」と誤診しない**。あわせて次を読む。

- `src/router/index.js` — ルートの有無 = 画面が到達可能か
- `docs/e2e/*.md` / `docs/unit/*.md` — 冒頭の `- 略号:` / `- 画面:`（Unit は `- 対象:`）/ `- テスト:`
  で画面とファイルを対応づける。`-real-api.md` は E2E(実API) 軸
- Glob で `src/**/*.spec.js` / `e2e/*.spec.js` / `e2e/*.real-api.spec.js`

判定は [criteria.md](criteria.md) を読んで行う。**シナリオ表の「状態」欄だけを見ない**
（理由は criteria.md に書いてある）。

### 5. 進行中の作業を検出する

```bash
git status --porcelain
bash scripts/worktree.sh list
```

`.claude/.sessions/` のファイル更新時刻（直近 2 時間のものが稼働中）とあわせて、
他 worktree・他セッションが仕掛かり中の範囲を**補足列に書く**（例: `feat/order-new で作業中`）。

**コミットされていない作業を「完了」と数えない。** 未コミット差分がある行は
判定を上げずに補足へ回す。

### 6. 日付を決める

[criteria.md](criteria.md) の「日付」節に従う。要点は 2 つ。

- 前回の表に完了日があれば**そのまま引き継ぐ**
- 新たに埋める日付は**パス指定の `git log` から機械的に取る**。コミット件名からの推測に頼らない

### 7. `docs/progress.md` を書く

節の順は `凡例` → `顧客` → `注文` → `マスタメンテ` → `共通基盤` → `対象外の画面` → `集計`。
冒頭に生成日・生成コマンド・分母・モック確認の深さを箇条書きで置く。列は固定する。

```text
| 画面 | 機能名 | 実装 | UnitTest | E2E(MSW) | E2E(実API) | 完了日 | 更新日 | 補足 |
```

日付が無い欄は `-`。集計は 2 本の表を出す。

- **区分ごと** — `区分` / `行数` / 軸ごとの `✅` 数 / `完了` / `残数` / `進捗率`。
  `残数` = 行数 − 完了、`進捗率` = 完了 ÷ 行数（小数第 1 位を四捨五入して整数 %）
- **軸ごと** — `軸` / `分母` / `✅` / `残数` / `進捗率`。
  **各軸の分母はその軸が `—` の行を除いた数**（対象外を分母に残すと進捗率が実態より低く出る）

どちらの集計にも `## 対象外の画面` の行は含めない。`docs/progress.md` は `docs/e2e/` でも `docs/unit/` でもないので
`check:scenarios` の検査対象にならない（ID 列の正規表現にも当たらない）。

### 8. 報告

次の順で報告する。

| # | 項目 | 内容 |
|---|---|---|
| 1 | 生成結果 | 行数、`✅` / `🟡` / `❌` / `—` の内訳、完了した行の数 |
| 2 | 前回からの差分 | `git diff --stat docs/progress.md`。判定が上がった行・下がった行を一覧にする。初回ならその旨 |
| 3 | 判定できなかった行 | 材料が足りず `❌` にした行と、その理由（シナリオ文書が無い / ルートが無い / モックが未受領） |
| 4 | 進行中の作業 | 他 worktree・未コミット差分で仕掛かり中の範囲 |
| 5 | 次の手順 | 最も安く埋まる軸を 1〜3 件だけ挙げる（例: シナリオ文書はあるがテストが無い行）。**実装の提案はしない** |

## やらないこと

- **`src/` / `e2e/` / `docs/e2e/` / `docs/unit/` を編集しない。** 判定材料を書き換えると、
  その表は事実の記録ではなく自己申告になる
- テストを追加・実行して通す作業をしない。それは `unit-test-author` / `e2e-test-author` /
  `real-api-e2e-author` の担当（このスキルは記録であって実装ではない）
- **コミットしない。** 差分を見てから呼び出し側が行う
- **材料の無い軸を推測で埋めない。** `❌` か `—` にし、根拠を補足列に書く
- `docs/api/openapi.json` を触らない
- Docker の `down` / `down -v` / `restart` をしない（`down -v` は共有の `node_modules` ボリュームを消す）
- Playwright MCP を、他 worktree が Docker を持っている間に起動しない
