/*
 * モックのレスポンス実体。
 * GET /auth/me が返す生の形（openapi.json の CurrentOperatorResponse）。
 *
 * 既定は管理責任者で入っている想定（バックエンドの開発用操作者 `admin` と同じ）。
 * 権限マスタの「操作」列と編集ボタンが出る。
 * **「閲覧のみ」の見た目を確かめたいときは viewerOperator を返させる**
 * （単体テストは server.use()、E2E は e2e/helpers/mockApi.js の mockApi()）。
 * **運用管理権限の無い利用者は noOperationOperator**（サイドメニューの「運用管理」区分が消え、
 * 運用管理の 4 画面は権限なしの画面に回される）。
 *
 * **ブラウザで別の権限の見た目を確かめるときは .env の VITE_USER_CODE を書き換える。**
 * /auth/me のハンドラは届いた X-User-Code を currentOperatorFor() に通すので、
 * admin / manager01 / sales01 / ifa01 にするとその操作者が返る（反映には frontend の再起動が要る）。
 * ログイン機能が入るまでのつなぎ。
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

/**
 * 営業員（マスタ更新権限が無い。権限は fixtures/permissions.js の sales 行と同じ）。
 * サイドメニューのマスタメンテが隠れ、/masters/* を開くと「アクセス権限がありません」に回される。
 */
export const salesOperator = {
  操作者コード: 'sales01',
  氏名: '開発用営業員',
  ロールコード: 'sales',
  ロール名: '営業員',
  部店コード: '123',
  登録済: true,
  権限: { order: true, master: false, operation: false, branch_all: true },
  認可強制: false,
}

/**
 * IFA（権限は全部なし。fixtures/permissions.js の ifa ロールと同じ）。
 * 運用管理権限が無いので、運用管理の 4 画面に入れない。
 */
export const noOperationOperator = {
  操作者コード: 'ifa01',
  氏名: '開発用IFA',
  ロールコード: 'ifa',
  ロール名: 'IFA',
  部店コード: '123',
  登録済: true,
  権限: { order: false, master: false, operation: false, branch_all: false },
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

/** .env の VITE_USER_CODE で選べる操作者（並びはロール ID の逆順。上ほど権限が強い） */
export const devOperators = [supervisorOperator, viewerOperator, salesOperator, noOperationOperator]

/**
 * 社員コード（X-User-Code）から、/auth/me が返す操作者を引く。
 *
 * 知らないコード・未設定は管理責任者に倒す。既定の .env（実 API 向けのコード）や
 * 単体テストの固定値（vitest.config.js の test-user）のままでも、今までどおり全画面が見えるようにするため。
 * 実 API は操作者マスタに無いコードを未登録（権限なし）として返すので、ここは実 API と挙動が違う。
 *
 * @param {string|null|undefined} code 社員コード
 * @returns {object} CurrentOperatorResponse の生の形
 */
export function currentOperatorFor(code) {
  return devOperators.find((operator) => operator.操作者コード === code) ?? supervisorOperator
}
