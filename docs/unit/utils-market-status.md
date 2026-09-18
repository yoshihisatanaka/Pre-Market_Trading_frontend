# utils/marketStatus（ヘッダの市場状況の表示内容を組み立てる）

- 略号: `MKS`
- 対象: `src/utils/marketStatus.js`
- テスト: `src/utils/marketStatus.spec.js`
- 情報源: `GET /market-status`（[api-market-status.md](api-market-status.md)）

`toMarketDisplay(status, now, { error })` は**サーバが言ったこと**をヘッダの表示内容に変換する純関数。
`now` を引数で受けるので、フェイクタイマーもマウントも要らない。

**ローカルの時刻判定は持たない。** 旧 `getMarketStatus()` はニューヨーク現地時刻から
セッションを推定していたが、祝日・短縮取引・プレ拡大期間を知らず、感謝祭の NY 10:00 に
「● Regular」と出していた。`MKS-01`〜`MKS-13` はその関数のシナリオで、関数ごと消えたため削除した
（**番号は振り直さない**。過去のコミットの ID がどの行を指していたかを保つため）。

現在セッションの判定は `JPN開始` / `JPN終了`（tz 付き ISO の絶対時刻）の比較だけで行う。
**開始以上・終了未満**で、タイムゾーンも夏時間も日跨ぎの計算も要らない。祝日・短縮取引は
サーバが境界に織り込んで返すので、この関数が祝日を知らなくても誤らない。
`現在のセッション`（enum 宣言の無い素の string）に依存するのは異常系だけに留める。

戻り値:

| 項目 | 中身 |
|---|---|
| `key` | `premarket` / `regular` / `afterhours` / `closed` / `unknown`。CSS の色と `data-status` に使う |
| `label` | `● Pre-Market` / `● Regular` / `● After-Hours` / `○ Closed` / `—`（未取得） |
| `sessions` | 時間帯グリッドの列。`{ code, key, name, hoursJst, hoursEt, current }`。休場・未取得では空 |
| `note` | 休場理由や取得失敗の断り書き。出すものが無ければ空文字 |
| `shortened` | 短縮取引日なら true（ラベルの隣に目印を出す） |
| `title` | `title` 属性に出す全文（基準日・サマータイム・3 セッションの JST / ET・理由） |

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MKS-14 | 通常営業日のモデル / `now` がレギュラーの窓の中 | `toMarketDisplay(status, now)` | `key` が `regular`、`label` が「● Regular」。`sessions` は 3 列で、レギュラーだけ `current` が true | 実装済 |
| MKS-15 | 同上 / `now` がプレの `startJst` ちょうど | 同上 | プレが `current`（**開始以上**） | 実装済 |
| MKS-16 | 同上 / `now` がプレの `endJst` ちょうど | 同上 | プレは `current` でなく、レギュラーが `current`（**終了未満**） | 実装済 |
| MKS-17 | 同上 / `now` が日跨ぎ後（レギュラー終了が翌日の 06:00 JST） | 同上 | レギュラーが `current`。JST の表記に `(翌)` が付き、ET の表記には付かない | 実装済 |
| MKS-18 | `closed` が true / `closedReason` が「感謝祭」/ `sessions` が空 | 同上 | `key` が `closed`、`label` が「○ Closed」、`note` が「休場（感謝祭）」、`sessions` は空 | 実装済 |
| MKS-19 | `closed` が true / `closedReason` が空文字 | 同上 | `note` が「休場」だけになる | 実装済 |
| MKS-20 | 通常営業日のモデル / `now` が最終セッションの終了後 | 同上 | `key` が `closed`、`label` が「○ Closed」。`sessions` は 3 列出るが `current` はどれも false | 実装済 |
| MKS-21 | 通常営業日のモデル / `now` が最初のセッションの開始前 | 同上 | `key` が `closed`。`sessions` は 3 列出るが `current` はどれも false | 実装済 |
| MKS-22 | 短縮取引日のモデル | 同上 | `shortened` が true。`title` に短縮取引の理由が含まれる。`sessions` の終了時刻は短縮後の値のまま | 実装済 |
| MKS-23 | `status` が null（起動直後） | `toMarketDisplay(null, now)` | `key` が `unknown`、`label` が「—」、`sessions` は空、`note` は空文字（推定を出さない） | 実装済 |
| MKS-24 | `status` が null / `error` に `ApiError` | `toMarketDisplay(null, now, { error })` | `label` が「—」、`note` が「市場状況を取得できません」、`title` に `error.message` が入る | 実装済 |
| MKS-25 | 取得済みのモデル / `error` に `ApiError` | `toMarketDisplay(status, now, { error })` | **古い値を出し続ける**（`key` は `regular` のまま。`note` に取得失敗を出さない） | 実装済 |
| MKS-26 | 通常営業日のモデル | 同上 | `title` に基準日とサマータイムの別（`基準日 2026-03-02（EST）`）、3 セッションの日本語名・JST・ET が並ぶ | 実装済 |
| MKS-27 | `session` が `SNACK_TIME`、`sessions[].code` も未知の文字列 | 同上 | 例外にならず、窓に入っていれば `current` が立ち、`key` は `closed` に落ちる（綴りが変わっても表示が壊れない） | 実装済 |
