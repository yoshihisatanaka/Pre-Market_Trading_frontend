# monkey/ — モンキーテストのランナー

指定した画面をランダムに操作し、その間に出た異常（コンソールエラー・未処理例外・
5xx・白画面）を拾う。入口は Claude Code のスキル **`/monkey-test`**
（`.claude/skills/monkey-test/SKILL.md`）で、ここはその実体。

**`e2e/` とは別物。** `e2e/` は `docs/e2e/` のシナリオに対する合否判定で、こちらは
「決められた条件を満たすか」ではなく「壊れないか」を見る探索用。混ぜると合否の意味が
変わるので、`playwright.config.js`（`testDir: ./e2e`）とは別の設定ファイルを持つ。

## 実行

**Git Bash では `MSYS_NO_PATHCONV=1` を付ける。** 付けないと `/masters/...` が
`C:/Program Files/masters/...` に変換され、「未知の指定がある」で止まる（MSYS のパス変換）。

```bash
# 1 画面だけ
MSYS_NO_PATHCONV=1 docker compose run --rm -e MONKEY_TARGETS=/masters/market-holidays e2e \
  npx playwright test --config=monkey/playwright.monkey.config.js

# 複数画面・操作 200 回・seed 指定
MSYS_NO_PATHCONV=1 docker compose run --rm \
  -e MONKEY_TARGETS=/masters/ca,/masters/hard-limits -e MONKEY_STEPS=200 -e MONKEY_SEED=42 e2e \
  npx playwright test --config=monkey/playwright.monkey.config.js

# 全画面（path を書かないのでパス変換の影響を受けない）
docker compose run --rm -e MONKEY_TARGETS=all e2e \
  npx playwright test --config=monkey/playwright.monkey.config.js
```

先に `docker compose up -d frontend` が必要（`e2e` は `depends_on: frontend`）。
Docker は worktree ごとに分離されているので、他 worktree と並行に動かせる。

| 環境変数 | 既定 | 意味 |
|---|---|---|
| `MONKEY_TARGETS` | `all` | 対象画面。カンマ区切りで、path（`/masters/fx`）でもサイドメニューのラベル（`為替マスタ`）でもよい |
| `MONKEY_SEED` | `1` | 乱数の seed。**同じ seed なら同じ操作列**になる（落ちた操作列の再現に使う） |
| `MONKEY_STEPS` | `60` | 1 画面あたりの操作回数 |
| `MONKEY_STRICT` | 未設定 | `1` で `warn` も失敗扱いにする（既定は `error` だけ） |
| `MONKEY_TRACE` | 未設定 | `1` で Playwright のトレースを採る |
| `MONKEY_RUN_ID` | `seed<SEED>` | レポートの出力先ディレクトリ名 |
| `MONKEY_ALLOW_REAL_API` | 未設定 | `1` で MSW 無しでも実行する。**実 API のデータを壊すので通常は付けない** |

## 出力

`monkey-report/<RUN_ID>/<画面>.json`（`.gitignore` 済み）に、拾った異常と**撒いた操作列
そのもの**が入る。失敗時は同じ場所にスクリーンショットも出る。
`playwright.json` は Playwright 側のレポート。

## 構成

| ファイル | 役割 |
|---|---|
| `targets.js` | 対象画面の一覧。正は `src/components/layout/navigation.js` で、ここでは二重管理しない |
| `random.js` | seed から決まる擬似乱数と、入力欄に流し込む値の種類 |
| `runner.js` | 1 画面ぶんの操作ループと異常の検出 |
| `monkey.spec.js` | 画面ごとに 1 test を立て、レポートを書く |
| `playwright.monkey.config.js` | 専用設定（`testDir: .` / 直列 / リトライ無し） |

## 安全弁

- **サイドメニューは操作対象から除く。** 画面をまたぐモンキーテストは別スキルの担当。
  URL が対象 path から離れたら `unexpected-navigation` として記録して戻る
- **確認ダイアログは必ず「いいえ」で閉じる。** 承諾すると以降の操作が
  「消えた後の画面」だけを触ることになる
- **MSW が動いていなければ中止する。** ランダムな更新操作を実 API に撒くとデータを
  壊すため（`MONKEY_ALLOW_REAL_API=1` で明示的に外せる）。
  判定は「起動ログ `[MSW] Mocking enabled`」「Service Worker の制御」「`window.fetch` が
  差し替わっているか」の 3 つ。**Service Worker の有無だけで見てはいけない** —
  E2E コンテナから見た `http://frontend:5173` は secure context ではないので SW は登録されず、
  MSW はページ内 fetch 横取りの fallback mode で動く（`src/mocks/browser.js` のコメント）
- `input[type=file]` は触らない（OS のダイアログが開く）
