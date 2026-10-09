# 各画面の操作が操作ログに載るか（2026-10-09 の手動確認）

結合テスト（画面をまたぐ確認）を起こすときの下敷き。chrome-devtools MCP で実 API に当てて手で確かめた記録で、
**自動テストではない**。結合テストのシナリオを書くときは、ここの「画面 × 操作 × 期待するログ」をそのまま行にできる。

## なぜ実 API でしか確かめられないか

MSW の操作ログ（`src/mocks/handlers/activityLogs.js`）は固定フィクスチャを返すだけで可変状態を持たない。
他画面で登録・更新しても一覧は変わらないので、**画面をまたぐ確認は MSW では成立しない**。
実 API の操作ログは各マスタの履歴テーブルを UNION ALL で横断したもの。

## 環境の作りかた（`.env` を触らない）

```powershell
docker compose run -d --name pmt-frontend-realapi --use-aliases -e VITE_ENABLE_MSW=false frontend npm run dev
```

- Vite は既存の環境変数を `.env` で上書きしないので、`-e` で MSW を切れる。`--use-aliases` で MCP から `http://frontend:5173` に届く
- 実 API を見ていることは `navigator.serviceWorker.controller` が `null` であることで確かめた
- 片付けは `docker stop pmt-frontend-realapi; docker rm pmt-frontend-realapi`（`docker stop` は承認が要る）
- 前提: バックエンドの `api` 稼働、DB を排他で使う（他の実 API E2E と同時に流すとログが混ざる）

## 確かめかた

1. 画面で操作し、`list_network_requests` で書き込みが 2xx かを見る（失敗は「ログ以前の問題」として分ける）
2. `GET /api/operations/activity-logs?target_types=<対象種別>&limit=3` の先頭行で
   操作日時・`操作区分`・`対象キー`・`操作者`・`実行者区分`・`操作内容`・`差分` を見る
3. 最後に操作ログ画面（`?start_date=…&end_date=…`）で同じ行が出ること、詳細ダイアログの差分を見る

ページ内の `fetch()` は `X-User-Code` を載せない（`apiClient` を通らない）ので、GET の確認にだけ使う。

## 対象種別（実 API・15 種）

`orders` 注文ID / `customers` 口座番号 / `symbols` 銘柄コード / `fx` 基準日/通貨コード / `ca` CA_ID /
`blackout-dates` 受注不可日 / `market-holidays` 休場日 / `fee-patterns` 手数料パターンID /
`fee-preferences` 口座番号 / `balance-adjustments` 口座番号/銘柄コード / `hard-limits` 設定ID /
`order-suspensions` 停止対象 / `announcements` お知らせID / `schedule-times` 時刻設定ID / `permissions` ロールコード

`src/mocks/fixtures/activityLogTargets.js` は 9 種で、`market_holidays` / `balance_adjustments` がアンダースコアのまま（実 API はハイフン）。

## 結果

操作者は全行 `admin`・実行者区分 `管理責任者`。

| 画面 | 操作 | 対象種別 | 操作区分 / 操作内容 | 対象キーの例 | 結果 |
|---|---|---|---|---|---|
| 海外休場日マスタ | 登録 → 削除 | `market-holidays` | CREATE / DELETE | `20991231` | 載る |
| 受注不可日マスタ | 登録 → 更新 → 削除 | `blackout-dates` | CREATE / UPDATE / DELETE | `20991230` | 載る |
| CA マスタ | 登録 → 更新 → 削除 | `ca` | CREATE / UPDATE / DELETE | `23`（CA_ID） | 載る |
| 手数料優遇マスタ | 登録 → 更新 → 削除 | `fee-preferences` | CREATE / UPDATE / DELETE | `1000002` | 載る（削除済み口座の再登録は 500。requests.md #63） |
| 銘柄マスタ | 登録 → 更新 → 削除 | `symbols` | CREATE / UPDATE / DELETE | `Z9901` | 載る |
| 為替マスタ | レート更新 → 戻す | `fx` | UPDATE | `20261009/USD` | 載る |
| 顧客マスタ | 更新 → 戻す | `customers` | UPDATE | `1000000` | 載る |
| 残高マスタ | 売却停止 → 解除 / 数量加算 | `balance-adjustments` | UPDATE | `1000000/A0002` | 載る |
| スライス基準マスタ | 更新 → 戻す | `hard-limits` | UPDATE | `1` | 載る |
| 権限マスタ | ifa の全店参照 → 戻す | `permissions` | UPDATE | `ifa` | 載る |
| 仮計算マスタ | 設定の更新 → 戻す | （無し） | — | — | **載らない**（requests.md #62） |
| お知らせ管理 | 表示 → 非表示 | `announcements` | SHOW / HIDE | `1` | 載る |
| 障害管理 | VWAP 停止 → 再開 | `order-suspensions` | SUSPEND / RESUME（「発注停止を停止」） | `2` | 載る |
| 顧客詳細の注文入力 → 注文照会 | 受付 → 訂正 → 取消 | `orders` | CREATE / UPDATE / DELETE（訂正は数量と理由が文中に入る） | `1959` | 載る |
| CSV 一括注文 → 注文取消 | 受付 → 取消 | `orders` | CREATE / DELETE（画面の受付と同じ文言） | `1960` | 載る |

未実施: みずほ注文締・滞留注文の確認ファイル取込（業務状態ごと変わる）、Dream 登録状況の STS 変更（戻せない。対象種別も無い）、
残高の新規保有追加（削除手段が無い）、銘柄の VWAP 一括解除（全銘柄に効く）。

## 結合テストに起こすときの注意

- **戻せない操作がある**: 残高の数量加算（加算のみ）、更新で立つ `ユーザー操作フラグ` 0→1、注文は取消しても履歴に残る。
  テストデータは識別できる値（銘柄 `Z99xx`、日付 `2099-12-xx`、備考 `操作ログ確認`）にし、登録したものは削除する
- **手数料優遇は削除歴の無い口座を選ぶ**（#63 が直るまで）
- 注文入力の受注者は 4 文字以内（`admin` は不可）。フロコン警告が出たら強制区分を付けて送り直す
- 注文入力の受注時刻はブラウザの時計で入る。ヘッドレスのコンテナは UTC なので 9 時間ずれる
- 残高マスタの先頭行（口座 `1`・部店 `001`）は部店マスタに無いデータで、数量加算が 400 になる
- 自分の行は先頭行だけで決めず、`対象キー` と `操作者` で特定する（他セッションの実 API E2E が並行して行を積む）
