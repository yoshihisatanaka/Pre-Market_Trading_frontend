---
name: real-api-e2e
description: E2E(実API) が未完了の画面をまとめて実装する。docs/progress.md から対象の画面を拾い、real-api-e2e-author を作成モードで画面ごとに並列起動してシナリオ（docs/e2e/<画面>-real-api.md）と spec（e2e/<画面>.real-api.spec.js）を書かせ、実 API の準備が整っていれば最後に検証モードを 1 回流して状態を確定し、画面ごとの結果を 1 つの表で報告する。「実 API の E2E を未実装の画面ぶん書いて」「E2E(実API) をまとめて実装して」「/real-api-e2e」「/real-api-e2e 為替 顧客」で使う。コミットはしない。
---

# E2E(実API) の一括実装

画面ごとに `claude -p "〈画面〉の E2E(実API) を実装して" …` と打つ代わりに、**1 回の指示で未完了の画面をまとめて片付ける**。
書く作業（作成モード）は DB に触らないので並列にし、排他の実 API に当てる作業（検証モード）は最後の 1 回にまとめる。

## 前提

- **手順 1〜5 は worktree のセッションで行う。** エージェントはこのセッションのチェックアウトにファイルを書くので、
  本体で回すと `main` に未コミットの変更が生える。`git rev-parse --show-toplevel` が本体
  （`worktrees/` も `.claude/worktrees/` も含まない）なら、**手順 1〜5 を自分では回さず**、
  ラッパーを Bash ツールで 1 回だけ実行する（`run_in_background: true`、`timeout` は上限の 7200000）:

  ```bash
  bash scripts/real-api-e2e.sh 〈引数の画面名をそのまま〉
  ```

  ラッパーは worktree（`test/real-api-e2e-<MMDD>`。冪等で再利用）を `scripts/worktree.sh add` で用意し、
  その frontend を起動し、**その worktree の中で** `claude -p "/real-api-e2e 〈引数〉" --permission-mode acceptEdits`
  を起動する。完了通知が来たら、内側の出力にある最終表（手順 5）と「次にやること」を**そのまま報告に転記**して終わる。
  本体の cwd は変わらないので、このセッションから `docker compose` やファイル編集をしてはいけない。
  ユーザが端末から打つときも同じ 1 本で足りる（PowerShell なら Git Bash を明示:
  `& "C:\Program Files\Git\bin\bash.exe" scripts/real-api-e2e.sh 〈画面名…〉`。
  `--model` / `--effort` など claude へのフラグは `--` の後ろに置く）。
  内側は `--permission-mode acceptEdits` で起動される（`plan` では編集できずに止まる）
- その worktree の frontend を起動しておく（`docker compose up -d frontend`）。作成モードの lint は起動中のコンテナに exec する
- worktree のブランチに `e2e/helpers/realApi.js` と `docs/e2e/_template-real-api.md` が入っていること（無ければ `main` を取り込む）

## 手順

### 1. 対象の画面を決める

引数があれば、その画面名（`docs/progress.md` の「画面」列の表記。部分一致でよい）だけを対象にする。
無ければ `docs/progress.md` の画面 × 機能の表から、次を**すべて**満たす行を集めて**画面ごとにまとめる**:

- `実装` が `✅`
- `E2E(MSW)` が `✅` か `🟡`（MSW 版の spec が locator の裏取りの材料になる）
- `E2E(実API)` が `❌` か `🟡`

集めた画面のうち、次に当たるものは**起動せず**、表に「ブロック」として理由付きで載せる:

- API のパスが `docs/api/openapi.json` に無い（成熟度 D。補足欄に「API パスが無い」「fixture を契約提案」とある画面）
- `docs/e2e/<画面>-real-api.md` があり、`未着手` の行が無い（残りが `保留` だけ。バックエンドの回答待ち）

**画面を決めたら、確認を求めずに 2 へ進む。** 対象とブロックの一覧は最後の報告に載せる。

### 2. 作成モードを並列で起動する

`real-api-e2e-author` を **画面ごとに 1 体**、Agent ツールを **1 メッセージでまとめて**呼ぶ。
同時に動かすのは **4 体まで**。5 画面以上あるときは 4 体ずつの組に分け、前の組が全部返ってから次の組を起動する。

各エージェントへのプロンプトには次を入れる（画面ごとに差し替える）:

```text
作成モードで動くこと（実 API は流さない・Playwright MCP は使わない）。
対象画面: 〈画面〉（docs/progress.md の行: 〈機能名を列挙〉）
画面の path: 〈router/index.js の path〉 / view: 〈src/views/…View.vue〉 / MSW 版 spec: 〈e2e/….spec.js〉
既存の実 API 版: 〈docs/e2e/…-real-api.md があればそのパス。無ければ「無し（新規・略号は自分で決めて Grep で重複確認）」〉
先頭 2 行はスモーク（-01 一覧 / -02 書き込み。書き込みの無い画面は -02 を絞り込み）。そのあと型の標準の行を足す。
e2e/helpers/realApi.js は書き換えない。報告の最後に SUMMARY 行を付ける。
```

path / view / MSW 版 spec は起動前に `src/router/index.js` と `e2e/` を Grep して埋める（エージェントに探させない）。

### 3. 作成の結果を確かめる

全エージェントが返ったら、このセッションで 1 回だけ通す:

```powershell
docker compose exec -T frontend npx eslint e2e
docker compose exec -T frontend npm run check:scenarios
```

- 略号の重複（並列で同じ略号を選んだ）は `check:scenarios` が落とす。後から書いたほうの略号を振り直す
- error が残る画面は、その画面のエージェントを SendMessage で呼び戻して直させる（新しく起動し直さない）

### 4. 検証モードを 1 回流す（準備が整っているときだけ）

実 API に当てられるかを確かめる。

```powershell
docker compose exec -T frontend node -e "fetch('http://localhost:5173/api/masters/ca?limit=1').then(r=>console.log(r.status))"
```

200 が返れば `api` は動いている（MSW はブラウザ側で動くので、これでは MSW の ON/OFF は判らない）。
200 で、かつユーザから「MSW を切ってある」と聞いていれば、`real-api-e2e-author` を**検証モードで 1 体だけ**起動する
（対象は 2 で書いた spec の一覧を渡す）。返らなければ 4 は飛ばし、報告の「未検証」欄に、検証モードを流すための手順を書く:

```powershell
# バックエンド側（別リポジトリ）
(cd ../Pre-Market_Trading && docker compose up -d api)
# この worktree の .env の VITE_ENABLE_MSW=false にしてから
docker compose up -d --force-recreate frontend
```

そのあと「検証モードで流して」と頼めば 4 だけ回す。`/morning-check` の実 API 段でも、作成済みの spec はまとめて流れる。

### 5. 報告する

画面ごとに 1 行の表にする。エージェントの `SUMMARY` 行と検証モードの結果から埋める。

| 画面 | 略号 | 追加した行 | 検証 | 保留とその理由 | 止まった理由 |
|---|---|---|---|---|---|
| 為替マスタ | `FXR` | 01〜06 | 実装済 5 / 保留 1 | FXR-04: PUT が 422（requests.md に追記案） | 無し |

表の下に次を並べる:

- **ブロック** — 1 で外した画面と理由
- **バックエンドへの依頼の案** — 保留の理由のうちバックエンド起因のもの。`docs/api/requests.md` の形式で書いた案（追記はしない）
- **共通化の候補** — 各エージェントが挙げた、`e2e/helpers/realApi.js` に足すと良さそうな部品
- **環境を戻す手順** — 4 を流したときだけ。`.env` の `VITE_ENABLE_MSW` を `true` に戻して `docker compose up -d --force-recreate frontend`
- **次にやること** — 差分を見てコミット → `main` にマージ（実装コミットができた日にマージする規約）

## やらないこと

- **コミットしない。** 差分のレビューは人が 1 回で行う（シナリオ表と spec を一緒に見る）
- **検証モードを並列にしない。** バックエンドの `api` と DB は 1 つで、データを読み書きする
- **`.env` を読まない・書かない**（deny ルールと guard フック）。MSW の切り替えはユーザに頼む
- **`src/` の製品コードを直さない。** `data-testid` が足りない画面は「止まった理由」に書いて次へ進む
- `docs/progress.md` を書き換えない（`/progress-report` の担当）
- `docs/api/requests.md` に追記しない（案を出すだけ。依頼の並び順は解消で戻るセル数で決めるため人が判断する）
