# stores/announcements（お知らせ管理のストア）

- 略号: `ANS`
- 対象: `src/stores/announcements.js`
- テスト: `src/stores/announcements.spec.js`

MSW の既定ハンドラ（`src/mocks/handlers/announcements.js`）に当てて、現在値の取得・保存・履歴の
3 系統がそれぞれ独立した `loading` / `error` を持つこと、保存の楽観的ロックと履歴のページ位置を守る。
`beforeEach(() => setActivePinia(createPinia()))`。期待値はフィクスチャと `ANNOUNCEMENT_HISTORY_PAGE_SIZE` から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| ANS-01 | 既定モック | `load()` | `announcement` がフィクスチャの現在値（表示フラグ・本文・更新日時）になり、`loading` は false、`error` は null、`isEmpty` は false | 実装済 |
| ANS-02 | `GET /operations/announcements` が 500 | `load()` | `error.message` に理由が入り、`announcement` は null、`isEmpty` は false | 実装済 |
| ANS-03 | レスポンスボディが `null` | `load()` | `isEmpty` が true | 実装済 |
| ANS-04 | 既定モック | `loadHistory(0)` | `history` が 1 ページぶん、`historyTotal` がフィクスチャの件数、`historyOffset` が 0 になる | 実装済 |
| ANS-05 | 既定モック | `loadHistory(PAGE_SIZE)` | `offset=PAGE_SIZE` を送り、`history` が残りの件数（フィクスチャの 2 ページ目）、`historyOffset` が `PAGE_SIZE` になる | 実装済 |
| ANS-06 | `load()` 済み・履歴 API が 500 | `loadHistory(0)` | `historyError` に理由が入り、`historyIsEmpty` は false。`announcement` と `error` は影響を受けない | 実装済 |
| ANS-07 | 履歴が 0 件の応答 | `loadHistory(0)` | `historyIsEmpty` が true | 実装済 |
| ANS-08 | `load()` / `loadHistory(0)` 済み | 本文を変えて `save()` | 応答の成功文言を返し、`announcement` の本文と更新日時が新しい値になる。`historyTotal` が 1 増え、履歴の先頭が変更後の本文になる | 実装済 |
| ANS-09 | `load()` 済み | `save()` を 2 回続けて呼ぶ | 1 回目は取得した更新日時、2 回目は 1 回目の応答の更新日時を `更新日時` として送る（どちらも 409 にならない） | 実装済 |
| ANS-10 | `loadHistory(PAGE_SIZE)` で 2 ページ目を表示中 | 本文を変えて `save()` | `historyOffset` が 0 に戻り、`history` が先頭ページになる | 実装済 |
| ANS-11 | `load()` / `loadHistory(0)` 済み | 表示フラグ・本文とも現在値のまま `save()` | 「変更はありません。」を返し、`historyTotal` と `announcement` の更新日時は変わらない | 実装済 |
| ANS-12 | `load()` 済み | 表示 ON・本文 `''` で `save()` | null を返し、`saveError` に 400 の理由（応答の `detail`）が入る。`announcement` と `historyTotal` は変わらない | 実装済 |
| ANS-13 | `load()` 済み | 本文 501 文字で `save()` | null を返し、`saveError` が 422（本文の上限超え）になる。`announcement` は変わらない | 実装済 |
| ANS-14 | `load()` 済み・その後に他の担当者が更新 | `save()` | null を返し、`saveError` が 409 になる。`announcement` は取得時の値のまま | 実装済 |
| ANS-15 | `load()` 前 | `save()` | null を返し、PUT を送らない | 実装済 |
| ANS-16 | ANS-12 の状態 | `clearSaveError()` | `saveError` が null になる | 実装済 |
| ANS-17 | PUT の応答を握ったまま | `save()` | 応答待ちの間は `saving` が true、応答後は false に戻る | 実装済 |
