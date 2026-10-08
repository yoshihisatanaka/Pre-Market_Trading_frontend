# 滞留注文抽出（`/operations/stalled-orders`）の業務説明

- 画面: `src/views/StalledOrderListView.vue`
- 受け入れ条件: [docs/e2e/stalled-orders.md](../e2e/stalled-orders.md)
- バックエンドへの依頼: [docs/api/requests.md](../api/requests.md) の #1
- API: 一覧は注文照会と同じ `GET /orders` を処理状況で 2 回引く（注文エラー `status=101,103` / 注文中 `status=003`）。
  取込は `POST /operations/stalled-orders/confirmation-import`。CSV 3 種はフロントで組み立てる

この画面が業務でどう使われるかと、用語「コンファメーション」の意味をまとめる（2026-09-28 時点）。

## どんな画面か

**障害が起きたときに、注文を手で救うための運用担当者向けの画面**。普段は使わず、障害時にだけ開く想定。

通常の注文は、このシステムからブローカーへ自動で送られる。ブローカー側か自システムの障害で送信に失敗すると、
注文は「注文エラー」のまま止まる。この止まった注文が**滞留注文**。この画面は滞留注文を拾い出し、
**別システムで代わりに発注して、その結果を取り込む**までの手順を支える。

### 業務の流れ（画面の「手動運用フロー」の 4 段階）

1. **注文エラーを CSV で出力する** — 送れなかった注文を、別システムに投入できる形式の CSV にする
2. **別システムで発注する** — 担当者がその CSV を別システムに読み込ませて発注する（この画面の外の作業）
3. **コンファメーション CSV を取り込む** — 別システムから結果の CSV を受け取り、この画面から取り込む
4. **結果を確かめる** — 約定した注文は滞留一覧から消える。まだ約定していない注文は「注文中」の一覧に移るので、引き続き様子を見る

### 画面の構成

| 部分 | 役割 |
|---|---|
| 検索（部店・口座番号・銘柄） | 対象を絞る |
| 注文エラー（別システムで発注要） | 手順 1 で出力する対象 |
| 注文中（コンファメーション取込後・未約定） | 別システムで発注済みで、まだ約定していない注文 |
| CSV サンプル 2 種 | 発注 CSV とコンファメーション CSV の書式見本 |

「別システム」は Interactive Brokers の発注ツール **TWS（Trader Workstation）** を指していると読んでいる。
進捗表に「TWS投入CSV」とあり、公開モックのファイル名も `tws_*.csv` のため。**仕様書には明記されていないので推測**。

## コンファメーションとは

証券業務でいう**コンファメーション（confirmation）は、発注先から返ってくる「注文がどうなったか」の確認通知**。
約定したか、何株をいくらで約定したか、取り消されたかなどが載る。日本語の約定確認・取引確認に近い。

この画面では、別システムで発注した注文の結果を表す CSV を指す。公開モックのサンプルは次の形:

```text
order_id,confirmation_ref,confirmation_status,filled_quantity,average_price,confirmed_at,message
6,TWS-20260904-0006,CANCELLED,0,0,2026-09-04 10:15:00,TWSで取消確認
```

| 項目 | 意味 |
|---|---|
| `order_id` | このシステムの注文 ID。どの注文の結果かを結び付ける |
| `confirmation_ref` | 別システム側の受付番号 |
| `confirmation_status` | 結果（約定・一部約定・注文中・取消など） |
| `filled_quantity` / `average_price` | 約定した数量と平均単価 |
| `confirmed_at` | 確認した日時 |
| `message` | 補足 |

取り込むと、別システムで起きたことがこのシステムの注文にも反映される。注文照会の状態が更新され、画面の一覧 2 本も入れ替わる。

`confirmation_status` の値の体系は**未確定**。公開モックのサンプルには `CANCELLED` しか出てこないため、
約定・注文中など残りの値はバックエンドに確認する。

仕様にある `/mizuho/import-confirmation` も同じ「コンファメーション」だが、あちらはみずほ証券の約定結果 Excel を
取り込む口で、この画面の CSV とは別物として扱う。

## 参考: 発注 CSV の書式（公開モックから採取）

```text
order_id,account_number,symbol,action,quantity,order_type,limit_price,time_in_force,market_category
27,200001,MSFT,BUY,35,MKT,,DAY,レギュラー
26,300001,AAPL,SELL,20,LMT,228.5,DAY,プレ
```

文字コードは BOM 付きの UTF-8、改行は CRLF。売買は `BUY` / `SELL`、注文種別は `MKT` / `LMT`、
執行条件は `DAY` 固定、成行の価格は空欄。
