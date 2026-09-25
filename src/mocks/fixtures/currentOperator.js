/*
 * モックのレスポンス実体。
 * GET /auth/me が返す生の形（openapi.json の CurrentOperatorResponse）。
 *
 * 既定は管理責任者で入っている想定（バックエンドの開発用操作者 `admin` と同じ）。
 * 権限マスタの「操作」列と編集ボタンが出る。
 * **「閲覧のみ」の見た目を確かめたいときは viewerOperator を返させる**
 * （単体テストは server.use()、E2E は e2e/helpers/mockApi.js の mockApi()）。
 *
 * ブラウザ(MSW worker)・単体テスト・E2E で共用する。
 */

/** 管理責任者（権限マスタを変更できる） */
export const supervisorOperator = {
  操作者コード: 'admin',
  氏名: '開発用管理責任者',
  ロールコード: 'supervisor',
  ロール名: '管理責任者',
  部店コード: null,
  登録済: true,
  権限: { order: true, master: true, operation: true, branch_all: true },
  認可強制: false,
}

/** 管理者（権限マスタは閲覧のみ。ほかの権限は全部ある） */
export const viewerOperator = {
  操作者コード: 'manager01',
  氏名: '開発用管理者',
  ロールコード: 'manager',
  ロール名: '管理者',
  部店コード: '001',
  登録済: true,
  権限: { order: true, master: true, operation: true, branch_all: true },
  認可強制: false,
}
