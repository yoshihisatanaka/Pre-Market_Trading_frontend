# stores/permissions（権限マスタストア）

- 略号: `PMS`
- 対象: `src/stores/permissions.js`
- テスト: `src/stores/permissions.spec.js`

一覧（`GET /masters/permissions`）と、いまの利用者（`GET /auth/me`）を一緒に読む。一覧の応答には
「編集できるか」が無いので、`canEdit` は `/auth/me` のロールが管理責任者（`supervisor`）のときだけ `true`。
`/auth/me` が落ちても一覧は見せ、閲覧のみに倒す。

保存（`PUT /masters/permissions/{role}`）は楽観的ロックの合札 `updatedAt` を**手元の行から補って**送り、
応答の行で差し替える（取得し直さない）。取得と保存は `loading` / `error` を分けて持つ。
リクエストの形そのものは [api-permissions.md](api-permissions.md)（`PMA`）が守る。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| PMS-01 | 既定モック | `load()` を呼ぶ | `roles` がフィクスチャと同じ件数・並びになり、各行のロールコードと権限がフィクスチャどおり。`loading` は false、`error` は null | 実装済 |
| PMS-02 | 既定モック（`/auth/me` は管理責任者） | `load()` を呼ぶ | `canEdit` が true | 実装済 |
| PMS-03 | `/auth/me` が管理者（`viewerOperator`）を返す | `load()` を呼ぶ | `canEdit` が false。`roles` は読み込まれる | 実装済 |
| PMS-04 | `/auth/me` が 500 | `load()` を呼ぶ | `canEdit` が false で、`error` は null、`roles` は読み込まれる（一覧は見せる） | 実装済 |
| PMS-05 | 一覧が 500（`detail` 付き） | `load()` を呼ぶ | `error` に status 500 と message を持つエラーが入り、`roles` は空、`isEmpty` は false | 実装済 |
| PMS-06 | 一覧が `roles: []` | `load()` を呼ぶ | `isEmpty` が true | 実装済 |
| PMS-07 | 既定モックを読み込み済み | 全権限なしのロールで `canOrder` だけ true にして `save()` を呼ぶ | 戻り値の `role` が更新後の行、`message` がサーバの文言になる。`roles` の該当行だけが差し替わり、他の行は変わらない。`saveError` は null | 実装済 |
| PMS-08 | 既定モックを読み込み済み（対象行に `updatedAt` あり） | `save()` を呼ぶ（引数に `updatedAt` を含めない） | 送信本文の `更新日時` がその行の `updatedAt` になる | 実装済 |
| PMS-09 | 既定モックを読み込み済み（対象行の `updatedAt` が空） | `save()` を呼ぶ | 送信本文に `更新日時` が無い | 実装済 |
| PMS-10 | 既定モックを読み込み済み | 同じロールを続けて 2 回、値を変えて `save()` する | 2 回目も成功する（1 回目の応答の `updatedAt` が次の合札になり、409 にならない） | 実装済 |
| PMS-11 | 既定モックを読み込み済み、PUT が 409（`detail` 付き） | `save()` を呼ぶ | 戻り値が null で、`saveError` に status 409 と message が入る。`roles` は変わらない | 実装済 |
| PMS-12 | `load()` 前 | `save()` を呼ぶ | 戻り値が null で、PUT は送られない。`saveError` は null | 実装済 |
| PMS-13 | 既定モックを読み込み済み、PUT の応答を握る | `save()` を呼ぶ | 応答待ちの間 `saving` が true、応答後は false | 実装済 |
| PMS-14 | `save()` が失敗した直後 | `clearSaveError()` を呼ぶ | `saveError` が null になる | 実装済 |
| PMS-15 | 既定モックを読み込み済み | 現在値と同じ権限で `save()` を呼ぶ | `message` が「変更はありません。」で、行の `updatedAt` は変わらない | 実装済 |
