# stores/users（ユーザ管理マスタのストア）

- 略号: `USS`
- 対象: `src/stores/users.js`
- テスト: `src/stores/users.spec.js`

`useCrudList` に任せている振る舞い（古い応答の破棄・更新後の再取得の足回り）は
[composables-use-crud-list.md](composables-use-crud-list.md) が守るので、ここでは**このストア固有の入出力**だけを書く。

MSW の既定ハンドラ（`src/mocks/handlers/users.js`）に当てて、取得・絞り込みと
4 状態のもとになる `loading` / `error` / `isEmpty` を守る。`beforeEach(() => setActivePinia(createPinia()))`。

この画面に固有の、取り違えやすい点を 3 つ固定する。

- **状態の既定は「すべて」**（`status` が空 → 無効も含める）。`USER_STATUS_ACTIVE` のときだけ有効に絞る（USS-01・USS-03）
- **編集だけを持つ。** 新規追加・削除が画面モックに無いので `create` / `remove` を公開しない（USS-08）
- **ロールの選択肢は権限マスタから作る**（`loadRoles` / `roleOptions`）。一覧の取得とは独立して失敗する（USS-10・USS-11）

期待値はフィクスチャ（`src/mocks/fixtures/users.js` / `permissions.js`）と `USERS_PAGE_SIZE` から導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| USS-01 | 既定モック | `load()` を引数なしで呼ぶ | `items` がフィクスチャの全員（無効を含む）を並びどおりに、`total` がその件数、`limit` が `USERS_PAGE_SIZE` になる | 実装済 |
| USS-02 | 既定モック | `load({ offset: 2 })` を呼ぶ | `offset` が渡した値になり、`items` がその位置以降の行になる | 実装済 |
| USS-03 | 既定モック | `load({ status: USER_STATUS_ACTIVE })` を呼ぶ | 無効な操作者が含まれず、`status` に条件が残る | 実装済 |
| USS-04 | 既定モック | `load({ branchCode })` / `load({ role })` にフィクスチャの値を渡す | 条件に合う行だけが返り（無効を含む）、それぞれの条件がストアに残る | 実装済 |
| USS-05 | 既定モック | `load({ keyword })` に社員コードの一部 / 氏名の一部を渡す | 社員コード・氏名のどちらに当たっても絞り込まれる（部分一致）。`keyword` に条件が残る | 実装済 |
| USS-06 | 既定モック | どの行にも当たらない `keyword` で `load()` | `items` が空、`total` が 0、`isEmpty` が `true` | 実装済 |
| USS-07 | 一覧 API が 500 | `load()` を呼ぶ | `error.message` に理由が入り、`items` は空、`isEmpty` は `false`、`loading` は `false` に戻る | 実装済 |
| USS-08 | 既定モック | ストアの公開名を読む | `update` / `updating` / `updateError` は持つが、`create` / `remove` は持たない | 実装済 |
| USS-09 | 既定モック。一覧を読み込み済み | 受注者コードを持つ行のロールを変えて `update()` を呼ぶ | 更新後の 1 件（新しいロール。受注者コードは今の値のまま）が返り、読み直した `items` の該当行も新しいロールになる。`total` は変わらない | 実装済 |
| USS-10 | 更新 API が 400（`{ detail }`） | `update()` を呼ぶ | `null` が返り、`updateError.message` に detail が入る。`items` は変わらない | 実装済 |
| USS-11 | 既定モック | `loadRoles()` を呼ぶ | `roleOptions` が権限マスタの並びで `{ value: ロールコード, label: ロール名 }` になる。呼ぶ前は空配列 | 実装済 |
| USS-12 | 権限マスタ API が 500 | `loadRoles()` を呼ぶ | `rolesError` に理由が入り、`roleOptions` は空配列のまま。一覧の `error` には影響しない | 実装済 |
