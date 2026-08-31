# utils/marketStatus（米国市場の取引セッション判定）

- 略号: `MKS`
- 対象: `frontend/src/utils/marketStatus.js`
- テスト: `frontend/src/utils/marketStatus.spec.js`
- 仕様の出所: Manus モック `docs/mock/layout/masters-users.html` の `updateMarketStatus`

区切りはニューヨーク現地時刻（開始以上・終了未満）:
Pre-Market 04:00–09:30 / Regular 09:30–16:00 / After-Hours 16:00–20:00 / それ以外は Closed。
夏時間（EDT）と冬時間（EST）で UTC との差が 1 時間変わるため、両方の日付で検証する。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MKS-01 | `2026-03-02T08:59:00Z`（NY 03:59 EST） | `getMarketStatus(date)` | `closed` /「○ Closed」 | 実装済 |
| MKS-02 | `2026-03-02T09:00:00Z`（NY 04:00） | 同上 | `premarket` /「● Pre-Market」 | 実装済 |
| MKS-03 | `2026-03-02T14:29:00Z`（NY 09:29） | 同上 | `premarket` | 実装済 |
| MKS-04 | `2026-03-02T14:30:00Z`（NY 09:30） | 同上 | `regular` /「● Regular」 | 実装済 |
| MKS-05 | `2026-03-02T20:59:00Z`（NY 15:59） | 同上 | `regular` | 実装済 |
| MKS-06 | `2026-03-02T21:00:00Z`（NY 16:00） | 同上 | `afterhours` /「● After-Hours」 | 実装済 |
| MKS-07 | `2026-03-03T00:59:00Z`（NY 19:59） | 同上 | `afterhours` | 実装済 |
| MKS-08 | `2026-03-03T01:00:00Z`（NY 20:00） | 同上 | `closed` | 実装済 |
| MKS-09 | 夏時間 `2026-08-03T13:30:00Z`（NY 09:30 EDT。冬時間扱いなら 08:30） | 同上 | `regular` | 実装済 |
| MKS-10 | 夏時間 `2026-08-03T20:30:00Z`（NY 16:30 EDT。冬時間扱いなら 15:30） | 同上 | `afterhours` | 実装済 |
| MKS-11 | 引数を省略、システム時刻を `2026-03-02T14:30:00Z` に固定 | `getMarketStatus()` | `regular` | 実装済 |
| MKS-12 | 土曜日のニューヨーク時刻 10:00 | `getMarketStatus(date)` | 休場として `closed`（モックは Regular を返す。曜日・祝日の扱いを要確認） | 保留 |
