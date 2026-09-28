# stores/currentOperator（ログイン中の操作者）

- 略号: `COS`
- 対象: `src/stores/currentOperator.js`
- テスト: `src/stores/currentOperator.spec.js`
- API 側のシナリオ: [api-auth.md](api-auth.md)
- 使う側: [components-layout-app-sidebar.md](components-layout-app-sidebar.md)（メニューの出し分け）/ [router-permission-guard.md](router-permission-guard.md)（ルートの制限）
- E2E 側のシナリオ: [docs/e2e/access-control.md](../e2e/access-control.md)

`GET /auth/me` を 1 回だけ読み、サイドメニューの出し分け（AppSidebar）とルートの制限
（permissionGuard）が共用する。**読めなかったら権限は全部「持っていない」扱い**にし、
失敗したときだけ次の `ensureLoaded()` で読み直す。

権限は運用管理（`operation`）とマスタメンテ（`master`）の両方で使う。COS-08〜12 は
2026-09-28 のマスタメンテの出し分け（feat/customer-master-edit）で足した行で、
取り込み前の同ブランチの COP 系のうち、いまの API（`ensureLoaded()` / `can()`）で意味が残るものだけを移した。
期待値はフィクスチャ（`src/mocks/fixtures/currentOperator.js`）の権限フラグから導く。

| ID | 前提 | 操作 | 期待結果 | 状態 |
|---|---|---|---|---|
| COS-01 | まだ `ensureLoaded()` を呼んでいない | `can('operation')` を見る | false | 実装済 |
| COS-02 | 既定モック（supervisorOperator） | `ensureLoaded()` を待つ | `can('operation')` が true | 実装済 |
| COS-03 | 既定モック | `ensureLoaded()` を 2 回続けて呼ぶ | どちらも読み終えて解決し、`/auth/me` へのリクエストは 1 本（Promise の同一性は見ない。Pinia が action を包んで呼ぶたびに新しい Promise を返すため、外からは観察できない） | 実装済 |
| COS-04 | `/auth/me` が `noOperationOperator` を返す | `ensureLoaded()` を待つ | `can('operation')` が false | 実装済 |
| COS-05 | `/auth/me` が 500 | `ensureLoaded()` を待つ | reject せずに解決し、`can('operation')` は false、`error` に理由が入る | 実装済 |
| COS-06 | 1 回目の `/auth/me` だけ 500 | 失敗のあと `ensureLoaded()` をもう一度待つ | 読み直して `error` が消え、`can('operation')` が true になる | 実装済 |
| COS-07 | 既定モックで読み終えたあと | `ensureLoaded()` をもう一度待つ | 読み直さない（リクエストは 1 本のまま） | 実装済 |
| COS-08 | 新しい pinia | ストアを作るだけ（`ensureLoaded()` を呼ばない） | `operator` が `null`、`loading` が false、`error` が `null` で、`/auth/me` は叩かれない | 実装済 |
| COS-09 | 既定モック（supervisorOperator） | `ensureLoaded()` を待つ | `operator` に操作者コード・氏名・ロールコードがフィクスチャどおり入り、`can('master')` が true | 実装済 |
| COS-10 | `/auth/me` が `salesOperator`（master なし・order あり）を返す | `ensureLoaded()` を待つ | `can('master')` が false、`can('order')` が true（権限ごとにフラグどおり読む） | 実装済 |
| COS-11 | `/auth/me` の応答が遅い | `ensureLoaded()` を await せずに `loading` を読む | 呼んだ直後は true、完了後に false | 実装済 |
| COS-12 | 既定モックで読み終えたあと | 定義に無い権限キー（`'unknown'`）で `can()` を呼ぶ | false（知らない権限を持っているとは読まない） | 実装済 |
