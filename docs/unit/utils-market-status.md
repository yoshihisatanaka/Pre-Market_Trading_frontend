# utils/marketStatus（ヘッダの市場状況の表示内容を組み立てる）

- 略号: `MKS`
- 対象: `src/utils/marketStatus.js`
- テスト: `src/utils/marketStatus.spec.js`
- 情報源: `GET /market-status`（[api-market-status.md](api-market-status.md)）

`toMarketDisplay(status, now, { error })` は**サーバが言ったこと**をヘッダの表示内容に変換する純関数。
`now` を引数で受けるので、フェイクタイマーもマウントも要らない。

**ローカルの時刻判定は持たない。** 旧 `getMarketStatus()` はニューヨーク現地時刻から
セッションを推定していたが、祝日・短縮取引・プレ拡大期間を知らず、感謝祭の NY 10:00 に
「Regular」と出していた。`MKS-01`〜`MKS-13` はその関数のシナリオで、関数ごと消えたため削除した
（**番号は振り直さない**。過去のコミットの ID がどの行を指していたかを保つため）。

現在セッションの判定は `JPN開始` / `JPN終了`（tz 付き ISO の絶対時刻）の比較だけで行う。
**開始以上・終了未満**で、タイムゾーンも夏時間も日跨ぎの計算も要らない。祝日・短縮取引は
サーバが境界に織り込んで返すので、この関数が祝日を知らなくても誤らない。
`現在のセッション`（enum 宣言の無い素の string）に依存するのは異常系だけに留める。

表示の形は Manus モック（`../premarket-order-202609` の `base.html`、08986d1）のバッジ 1 個に合わせる:

```text
[●] Pre-Market │ 日本時間 17:00–22:30（夏時間）  ET 04:00–09:30
```

2026-09-25 に、3 セッション × JST / ET のグリッドと「短縮取引」の目印をやめてこの形に移した。
短縮取引の理由は `title` にだけ残る。

戻り値:

| 項目 | 中身 |
|---|---|
| `key` | `premarket` / `regular` / `afterhours` / `closed`（営業日のセッション外）/ `holiday`（土日・終日休場）/ `unknown`。CSS の配色と `data-status` に使う |
| `label` | `Pre-Market` / `Regular` / `After-Hours` / `Closed`（`closed` と `holiday` の両方）/ `—`（未取得）。丸印は画面側が要素で描くので含めない |
| `jst` | JST 側の文言。セッション中は `日本時間 23:30–翌06:00（冬時間）`（日跨ぎの端点に `翌` を前置）、セッション外は `日本時間 10:00–18:00（冬時間）`（最後の終了 → 最初の開始。`翌` は付けない）、休場は `休場（理由）`、未取得で失敗していれば「市場状況を取得できません」。出すものが無ければ空文字 |
| `et` | ET 側の文言。`ET 09:30–16:00`、休場は `ET Market Holiday`（土日は `ET Weekend`）。未取得は空文字 |
| `title` | `title` 属性に出す全文（基準日・サマータイム・3 セッションの JST / ET・休場や短縮取引の理由） |

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| MKS-14 | 通常営業日のモデル（EST）/ `now` がレギュラーの窓の中 | `toMarketDisplay(status, now)` | `key` が `regular`、`label` が「Regular」、`jst` が「日本時間 23:30–翌06:00（冬時間）」、`et` が「ET 09:30–16:00」 | 実装済 |
| MKS-15 | 同上 / `now` がプレの `startJst` ちょうど | 同上 | `key` が `premarket`（**開始以上**）。`jst` が「日本時間 18:00–23:30（冬時間）」 | 実装済 |
| MKS-16 | 同上 / `now` がプレの `endJst` ちょうど | 同上 | `key` が `regular`（**終了未満**なのでプレではない） | 実装済 |
| MKS-17 | 同上 / `now` が日跨ぎ後（レギュラー終了が翌日の 06:00 JST）、およびアフターの窓の中 | 同上 | 日跨ぎ後もレギュラーのまま。アフターでは `jst` が「日本時間 翌06:00–翌10:00（冬時間）」、ET 側には `翌` が付かない | 実装済 |
| MKS-18 | `closed` が true / `closedReason` が「感謝祭」/ `sessions` が空 | 同上 | `key` が `holiday`、`label` が「Closed」、`jst` が「休場（感謝祭）」、`et` が「ET Market Holiday」 | 実装済 |
| MKS-19 | `closed` が true / `closedReason` が空文字 | 同上 | `jst` が「休場」だけになる | 実装済 |
| MKS-20 | 通常営業日のモデル / `now` が最終セッションの終了後 | 同上 | `key` が `closed`、`label` が「Closed」、`jst` が「日本時間 10:00–18:00（冬時間）」、`et` が「ET 20:00–04:00」 | 実装済 |
| MKS-21 | 通常営業日のモデル / `now` が最初のセッションの開始前 | 同上 | MKS-20 と同じ `key` / `jst` / `et` になる | 実装済 |
| MKS-22 | 短縮取引日のモデル | 同上 | `title` に短縮取引の理由が含まれる。表示の時間帯はサーバが返した短縮後の値のまま | 実装済 |
| MKS-23 | `status` が null（起動直後） | `toMarketDisplay(null, now)` | `key` が `unknown`、`label` が「—」、`jst` / `et` は空文字（推定を出さない） | 実装済 |
| MKS-24 | `status` が null / `error` に `ApiError` | `toMarketDisplay(null, now, { error })` | `label` が「—」、`jst` が「市場状況を取得できません」、`title` に `error.message` が入る | 実装済 |
| MKS-25 | 取得済みのモデル / `error` に `ApiError` | `toMarketDisplay(status, now, { error })` | **古い値を出し続ける**（`key` は `regular` のまま。`jst` に取得失敗を出さない） | 実装済 |
| MKS-26 | 通常営業日のモデル | 同上 | `title` に基準日とサマータイムの別（`基準日 2026-03-02（EST）`）、3 セッションの日本語名・JST・ET が新しい表記（`23:30–翌06:00`）で並ぶ | 実装済 |
| MKS-27 | `session` が `SNACK_TIME`、`sessions[].code` も未知の文字列 | 同上 | 例外にならず、窓に入っていれば `key` は `closed`・`label` は「Closed」に落ち、時間帯はそのセッションのものが出る（綴りが変わっても表示が壊れない） | 実装済 |
| MKS-28 | `closed` が true / `closedReason` が「土日」 | 同上 | `jst` が「休場（週末）」、`et` が「ET Weekend」（モックの週末表記） | 実装済 |
| MKS-29 | 通常営業日のモデルで `dst` が true | 同上 | `jst` の末尾が「（夏時間）」になる。`title` は `（EDT）` | 実装済 |
| MKS-30 | `hoursJst` / `hoursEt` が `HH:MM - HH:MM` の形でない | 同上 | 例外にならず、セッション中は文字列をそのまま出す。セッション外の窓は組み立てられないので `jst` / `et` を空文字にする | 実装済 |
