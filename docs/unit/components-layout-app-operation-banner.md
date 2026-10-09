# components/layout/AppOperationBanner（ヘッダ直下の運用バナー）

- 略号: `AOB`
- 対象: `src/components/layout/AppOperationBanner.vue`
- テスト: `src/components/layout/AppOperationBanner.spec.js`
- 表示内容の組み立て: [utils-operation-banner.md](utils-operation-banner.md)
- 時計と閉じた状態: [composables-use-operation-banner.md](composables-use-operation-banner.md)
- 置き場所: [components-layout-app-layout.md](components-layout-app-layout.md)（ALY-08）

`GET /operations/banner` の応答を、ヘッダ直下の全幅の帯として描く部品。
ここが検証するのは「ストアの応答 → 帯の描画（testid・role・文言）→ 閉じる操作」の結線。
取り直しの時計と閉じた記憶の細部は composable（UOB）、文言の組み立ては utils（OBU）の担当。

応答は MSW の `server.use()` で `fixtures/banner.js` の 3 種を返し、`useBannerStore().load()` の後に
マウントして描画を見る（起動時の取得は `main.js` が済ませている前提）。期待値はフィクスチャから導く。
配色は jsdom で見られないので、`role`（発注停止は `alert`、お知らせは `status`）と `data-kind` で見分ける。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| AOB-01 | バナー API が発注停止中（`incidentBannerResponse`） | 取得してからマウントする | 帯が `data-kind="INCIDENT"`・`role="alert"` で出て、ラベル「発注停止中」、本文、「停止対象: <対象名>」が出る。閉じるボタンは出ない | 実装済 |
| AOB-02 | バナー API がお知らせ（`noticeBannerResponse`） | 取得してからマウントする | 帯が `data-kind="NOTICE"`・`role="status"` で出て、ラベル「お知らせ」と本文が出る。停止対象は出ず、「お知らせを閉じる」ボタンが出る | 実装済 |
| AOB-03 | バナー API が何も無い（`noneBannerResponse`） | 取得してからマウントする | 帯を描かない | 実装済 |
| AOB-04 | まだ取得していない | マウントする | 帯を描かない | 実装済 |
| AOB-05 | バナー API が 500 | 取得してからマウントする | 帯を描かない（業務は止めない） | 実装済 |
| AOB-06 | AOB-02 の状態 | 「お知らせを閉じる」を click | 帯が消える | 実装済 |
| AOB-07 | お知らせの本文に改行が入っている | 取得してからマウントする | 本文の要素が改行をそのまま含む文字列を持つ（前後の空白は付かない） | 実装済 |
| AOB-08 | AOB-02 の状態 | バナー API を 500 にしてもう一度取得する | 直前のお知らせが出たまま | 実装済 |
