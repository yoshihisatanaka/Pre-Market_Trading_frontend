---
name: monkey-test
description: 指定した 1 画面（または複数画面）をランダムに操作し、コンソールエラー・未処理例外・5xx・白画面が出ないかを Playwright で確かめて報告する。対象画面はユーザに選ばせる。「モンキーテストして」「この画面をランダムに触って壊れないか見て」「ランダム操作で落ちないか確認して」という依頼で使う。画面をまたぐ操作（画面遷移を含むモンキーテスト）は扱わない。実装の修正もしない。
allowed-tools: Read, Glob, Grep, AskUserQuestion, Bash(bash scripts/worktree.sh list), Bash(docker compose ps *), Bash(docker compose up -d frontend), Bash(docker compose run --rm -e * e2e *), Bash(docker compose run --rm e2e *), Bash(docker compose run --rm frontend npm run lint), Bash(ls monkey-report *), Bash(cat monkey-report/*), Bash(git status *)
---

# モンキーテスト（1 画面）

対象の画面を開き、**その画面の中だけを**ランダムに触って、壊れないかを見る。
ランナーは `monkey/`（使い方は [monkey/README.md](../../../monkey/README.md)）。
このスキルは **対象画面の選定 → 前提の確認 → 実行 → 拾った異常の切り分け → 報告** を通す。

**受け入れ条件のテストではない。** 合否を出すのは従来どおり `e2e/`（`docs/e2e/` のシナリオ）。
こちらは「シナリオに書いていない操作で落ちないか」を探す道具なので、
**シナリオ文書は書かないし `check:scenarios` の対象にもしない。**

**画面をまたぐ操作は対象外。** サイドメニューはランナーが操作対象から除いている。
画面遷移を含むモンキーテストは別スキルの担当なので、**ここで拡張しない。**

## 手順

### 1. 対象画面をユーザに選ばせる

**勝手に全画面を回さない。** 15 画面の大半はルート未実装で、回しても
「ページが見つかりません」を確認するだけになる。

まず実装済みの画面を機械的に拾う。

- `src/router/index.js` の `path`（`/:pathMatch(.*)*` は除く）= 到達できる画面
- `src/components/layout/navigation.js` の `label` = 画面名

そのうえで `AskUserQuestion` で選ばせる。選択肢は最大 4 つなので、実装済み画面が多いときは
「実装済みの全画面」を 1 つの選択肢にまとめ、残りを個別に挙げる。

| 選択肢の例 | `MONKEY_TARGETS` |
|---|---|
| 実装済みの全画面 | 実装済みの path をカンマでつないだもの |
| 個別の画面（例: 海外休場日マスタ） | `/masters/market-holidays` |
| 全画面（未実装も含む・未実装は skip される） | `all` |

あわせて**操作回数**も確認する。既定の 60 回は 1 画面あたり 1〜2 分。
「軽く」なら 30、「しっかり」なら 200 を目安にする（`MONKEY_STEPS`）。
seed は既定 1 のままでよい（**変えると操作列が変わる**）。

### 2. Docker の所有者を確認する

E2E コンテナは `depends_on: frontend` で **稼働中の frontend を作り直す**。
CLAUDE.md「Docker は排他利用」に従い、先に現所有者を見る。

```bash
bash scripts/worktree.sh list
```

- 最終行の `Docker(frontend)` が**自分以外なら、ここで手を止めて報告する。**
  奪うと他セッションの dev サーバが別ブランチのコードを配信し始める
- 誰も持っていなければ `docker compose up -d frontend` で起動する
- `docker compose down -v` は**絶対にしない**（共有の `node_modules` ボリュームが消える）

### 3. MSW が効いているかを確かめる

ランダム操作は削除ボタンも押す。MSW が切れていると**実 API のデータを壊す。**

ランナーは「起動ログ / Service Worker / `window.fetch` の差し替え」の 3 点で自動判定して
中止する（**Service Worker の有無だけで見ない** — E2E コンテナから見た `http://frontend:5173`
は secure context ではないので SW は登録されず、MSW は fallback mode で動く）。
**判定を迂回する
`MONKEY_ALLOW_REAL_API=1` を自分の判断で付けない。** 中止したときは、
環境変数ファイル（`VITE_ENABLE_MSW`）を `true` に戻して frontend を作り直す手順を
**ユーザに実行してもらう**（このスキルは環境変数ファイルを読み書きできない。deny ルールと
guard フックで遮断されている）。

```powershell
docker compose up -d --force-recreate frontend
```

### 4. 実行する

```bash
MSYS_NO_PATHCONV=1 docker compose run --rm \
  -e MONKEY_TARGETS=/masters/market-holidays -e MONKEY_STEPS=60 e2e \
  npx playwright test --config=monkey/playwright.monkey.config.js
```

- **`MSYS_NO_PATHCONV=1` を落とさない。** Git Bash が `/masters/...` を
  `C:/Program Files/masters/...` へ変換し、「未知の指定がある」で止まる
- 対象が複数なら `MONKEY_TARGETS=/a,/b,/c` のようにカンマでつなぐ
- **失敗（exit 1）は「異常を拾った」という結果であって、実行の失敗ではない。**
  出力を捨てずにレポートを読む
- ルート未定義の画面は `skip` になる（`not-implemented`）。これは異常ではない

### 5. レポートを読んで切り分ける

```bash
ls monkey-report/seed1
cat monkey-report/seed1/masters-market-holidays.json
```

JSON には拾った異常（`findings`）と**撒いた操作列**（`actions`）が両方入っている。
`findings[].step` の番号を `actions` で引けば、**どの操作で出たか**が分かる。

**そのまま「バグ N 件」と報告しない。** 既知のノイズが混ざる。
切り分けは [triage.md](triage.md) に従い、`実バグ` / `ノイズ` / `判断保留` に分ける。

必要なら同じ seed で再実行して再現性を確かめる（同じ seed・同じ画面なら同じ操作列）。
再現しない異常は**タイミング依存の可能性**として、そのまま「判断保留」に置く。

### 6. 報告する

| # | 項目 | 内容 |
|---|---|---|
| 1 | 実行条件 | 対象画面・`MONKEY_STEPS`・`MONKEY_SEED`・MSW の有無 |
| 2 | 結果 | 画面ごとに `異常なし` / `異常 n 件` / `未実装で skip` |
| 3 | 実バグ | 種類・メッセージ・**再現手順（操作列の該当部分）**・該当ファイルの推定（`src/...` の行リンク） |
| 4 | ノイズ | triage.md のどの項目に当たるかだけ挙げる（詳細は書かない） |
| 5 | 判断保留 | 再現しなかったもの、仕様が決まっていないもの |
| 6 | 次の手順 | 修正が必要なら**何を直すかの提案まで**。修正自体はしない |

レポートの所在（`monkey-report/<RUN_ID>/<画面>.json`）と再現コマンドを必ず添える。
**口頭の要約だけで済ませない**（根拠のファイルがあるのだから、そこを指す）。

## やらないこと

- **`src/` を修正しない。** 見つけた異常は報告までで、直すかどうかは呼び出し側が決める
- **`data-testid` を足さない。** ランナーは tag / role / aria-label で要素を拾うので不要
- **`e2e/` と `docs/e2e/` を触らない。** モンキーテストはシナリオを持たない
- **`monkey/` のランナーを対象画面のために作り込まない。** 特定画面向けの分岐を入れると
  「ランダムに触る」道具ではなくなる。要素の拾い方が足りないなら
  `CANDIDATE_SELECTOR` の一般的な拡張として直す
- **画面遷移を伴う操作を足さない**（別スキルの担当）
- **コミットしない。** 差分を見てから呼び出し側が行う
- `docker compose down -v` / `restart` をしない
- 他 worktree が Docker を持っている間に E2E コンテナを起動しない
