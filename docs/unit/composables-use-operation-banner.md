# composables/useOperationBanner（運用バナーの取り直しと閉じた状態）

- 略号: `UOB`
- 対象: `src/composables/useOperationBanner.js`
- テスト: `src/composables/useOperationBanner.spec.js`
- 表示内容の組み立て: [utils-operation-banner.md](utils-operation-banner.md)
- 描画: [components-layout-app-operation-banner.md](components-layout-app-operation-banner.md)

ヘッダ直下の帯を「新しく保ち続ける」時計と、利用者が閉じたお知らせの記憶。スコープは次の 2 つに絞る。

- **取り直し**: `BANNER_REFRESH_MS` ごとに `useBannerStore().load()`。タブが裏（`document.hidden`）の間は取らず、
  `visibilitychange` で表に戻ったらすぐ取る。アンマウントでタイマーとリスナを外す
- **閉じた状態**: 閉じたお知らせの本文を sessionStorage（`DISMISSED_STORAGE_KEY`）に覚え、同じ本文なら出さない。
  本文が変われば再び出す。発注停止（`INCIDENT`）は閉じられない。sessionStorage が使えない環境でもタブ内では閉じられる

表示内容そのもの（ラベル・配色・停止対象）は `toBannerDisplay()` の担当（OBU）なので、期待値は
`toBannerDisplay()` の戻り値と突き合わせる。**通信は起こさない**（store に値を直接置き、`store.load` は差し替える）。
時計は fake timers、タブの表裏は `document.hidden` を差し替えて `visibilitychange` を送る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| UOB-01 | ストアにお知らせ（`NOTICE`）が入っている | `useOperationBanner()` を呼ぶホストをマウントする | `display` が `toBannerDisplay()` の戻り値と同じ | 実装済 |
| UOB-02 | ストアが未取得（`banner` が null） | マウントする | `display` が null | 実装済 |
| UOB-03 | マウント済・タブが表 | `BANNER_REFRESH_MS` の 1ms 手前まで進める | まだ取り直さない | 実装済 |
| UOB-04 | マウント済・タブが表 | `BANNER_REFRESH_MS` の 2 倍まで進める | 間隔ごとに取り直す（2 回） | 実装済 |
| UOB-05 | マウント済・タブが裏 | `BANNER_REFRESH_MS` まで進める | 取り直さない | 実装済 |
| UOB-06 | マウント済・タブが裏 | タブを表に戻して `visibilitychange` を送る（時計は進めない） | すぐに 1 回取り直す | 実装済 |
| UOB-07 | マウント済・タブが表 | タブを裏にして `visibilitychange` を送る | 取り直さない | 実装済 |
| UOB-08 | マウント済 | アンマウントしてから間隔ぶん進め、`visibilitychange` も送る | 保留中のタイマーが残らず、取り直しもしない | 実装済 |
| UOB-09 | ストアにお知らせ | `dismiss()` を呼ぶ | `display` が null になり、sessionStorage の `DISMISSED_STORAGE_KEY` に本文が入る | 実装済 |
| UOB-10 | sessionStorage に同じ本文が保存済み（再読み込み相当） | マウントする | `display` が null | 実装済 |
| UOB-11 | お知らせを閉じた後 | ストアの本文が別の本文に変わる | `display` が新しい本文で再び出る | 実装済 |
| UOB-12 | ストアに発注停止（`INCIDENT`） | `dismiss()` を呼ぶ | `display` は変わらず、sessionStorage にも書かない | 実装済 |
| UOB-13 | お知らせを閉じた後 | ストアが同じ本文の発注停止（`INCIDENT`）に変わる | `display` が発注停止として出る（閉じた記憶は発注停止に効かない） | 実装済 |
| UOB-14 | sessionStorage の読み書きが例外を投げる | マウントして `dismiss()` を呼ぶ | マウントは失敗せずお知らせが出て、閉じるとそのタブ内では `display` が null になる | 実装済 |
| UOB-15 | 何も無い（`NONE`）でマウント | ストアにお知らせが入る | `display` がお知らせの内容に変わる | 実装済 |
