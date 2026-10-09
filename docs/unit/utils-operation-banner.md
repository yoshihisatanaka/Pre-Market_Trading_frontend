# utils/operationBanner（運用バナーの表示内容）

- 略号: `OBU`
- 対象: `src/utils/operationBanner.js`
- テスト: `src/utils/operationBanner.spec.js`
- 時計と閉じた状態: [composables-use-operation-banner.md](composables-use-operation-banner.md)
- 描画: [components-layout-app-operation-banner.md](components-layout-app-operation-banner.md)

`toBannerDisplay(banner)` は Banner モデル（`src/api/banner.js`）から、ヘッダ直下の帯が描く内容
（`kind` / `tone` / `label` / `message` / `targets` / `dismissible`）を組み立てる純関数。
どちらを出すかはサーバの `kind` に従い、ここでは優先順位を組み立て直さない。

- 配色（`tone`）は `severity` で決まる（`critical` → `danger`、それ以外 → `info`）。`kind` では決めない
- ラベルと閉じられるかは `kind` で決まる（`INCIDENT` は「発注停止中」で閉じられない、`NOTICE` は「お知らせ」で閉じられる）
- 出すものが無い（`NONE`・未取得・未知の `kind`・本文が空白のみ）ときは `null`

入力は `fixtures/banner.js` の生の値を Banner モデルの形に写して作る（文言を直書きしない）。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| OBU-01 | `INCIDENT` / `critical` / 停止対象名 1 件（`incidentBannerResponse`） | `toBannerDisplay()` を呼ぶ | `kind` が `INCIDENT`、`tone` が `danger`、`label` が「発注停止中」、`message` が本文、`targets` が「停止対象: <対象名>」、`dismissible` が false | 実装済 |
| OBU-02 | `INCIDENT` / 停止対象名が 2 件 | 呼ぶ | `targets` が「停止対象: A、B」（読点でつなぐ） | 実装済 |
| OBU-03 | `INCIDENT` / 停止対象名が空配列 | 呼ぶ | `targets` が空文字（帯は出す） | 実装済 |
| OBU-04 | `NOTICE` / `info`（`noticeBannerResponse`） | 呼ぶ | `kind` が `NOTICE`、`tone` が `info`、`label` が「お知らせ」、`message` が本文、`targets` が空文字、`dismissible` が true | 実装済 |
| OBU-05 | `NOTICE` なのに停止対象名が入っている | 呼ぶ | `targets` は空文字（停止対象はお知らせに出さない） | 実装済 |
| OBU-06 | `INCIDENT` で `severity` が `info` / `NOTICE` で `severity` が `critical` | それぞれ呼ぶ | `tone` は `severity` に従う（前者 `info`、後者 `danger`）。`label` と `dismissible` は `kind` のまま | 実装済 |
| OBU-07 | 本文の前後に空白・改行があり、途中に改行がある | 呼ぶ | `message` は前後だけ削られ、途中の改行は残る | 実装済 |
| OBU-08 | `NONE`（`noneBannerResponse`。本文は空文字に寄せ済み） | 呼ぶ | `null` | 実装済 |
| OBU-09 | 引数が `null` / `undefined`（未取得） | 呼ぶ | `null` | 実装済 |
| OBU-10 | 未知の `kind`（例: `MAINTENANCE`）で本文あり | 呼ぶ | `null` | 実装済 |
| OBU-11 | `NOTICE` / `INCIDENT` で本文が空文字・空白と改行だけ | 呼ぶ | `null`（読めない帯は出さない） | 実装済 |
