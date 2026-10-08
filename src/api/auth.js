import { apiClient } from './client'

/**
 * ログイン中の操作者（GET /auth/me）。
 *
 * **バックエンドのレスポンス形を知ってよいのはこの層だけ。**
 * ここで camelCase のアプリ内モデルに変換してから外へ返す。
 *
 * 実 API の形（openapi.json の CurrentOperatorResponse）は日本語キーで、権限だけが
 * 英語キーの真偽値（PermissionFlags: order / master / operation / branch_all / depositary）。
 * depositary（預託先参照権限）は画面で編集しない権限で、約定照会の預託先の出し分けに使う
 * （docs/api/requests.md #26 / #39。既定は ifa / sales = false、manager / supervisor = true）。
 * 操作者は SSO のセッション Cookie か、開発用の X-User-Code ヘッダ（src/api/client.js が載せる）で決まる。
 *
 * 認可強制 が false の間は、権限が無くても更新系 API は拒否されない（ログのみ）。
 * 画面の出し分けはこの応答のロールと権限で行う。
 */

/**
 * @typedef {object} CurrentOperator ログイン中の操作者（アプリ内モデル）
 * @property {string} operatorCode 操作者コード（社員コード）
 * @property {string} name 氏名（null は空文字）
 * @property {string} roleCode ロールコード（ifa / sales / manager / supervisor。未登録なら空文字）
 * @property {string} roleLabel ロール名
 * @property {string} branchCode 部店コード
 * @property {boolean} registered 操作者マスタに有効な行があるか
 * @property {{
 *   order: boolean, master: boolean, operation: boolean, branchAll: boolean, depositary: boolean,
 * }} permissions
 * @property {boolean} authzEnforced 認可を強制しているか（false なら権限不足でも拒否されない）
 */

/**
 * ログイン中の操作者の情報と権限を取得する。
 *
 * @returns {Promise<CurrentOperator>}
 */
export async function fetchCurrentOperator() {
  const { data } = await apiClient.get('/auth/me')
  return toCurrentOperator(data)
}

/** CurrentOperatorResponse → CurrentOperator */
function toCurrentOperator(raw) {
  const flags = raw?.['権限']
  return {
    operatorCode: raw?.['操作者コード'] ?? '',
    name: raw?.['氏名'] ?? '',
    roleCode: raw?.['ロールコード'] ?? '',
    roleLabel: raw?.['ロール名'] ?? '',
    branchCode: raw?.['部店コード'] ?? '',
    registered: Boolean(raw?.['登録済']),
    // 欠けている権限は「持っていない」と読む（誤って操作を出さない側に倒す）
    permissions: {
      order: Boolean(flags?.order),
      master: Boolean(flags?.master),
      operation: Boolean(flags?.operation),
      branchAll: Boolean(flags?.branch_all),
      depositary: Boolean(flags?.depositary),
    },
    authzEnforced: Boolean(raw?.['認可強制']),
  }
}
