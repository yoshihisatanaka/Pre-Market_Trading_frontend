import { apiClient } from './client'

/**
 * 操作者（ユーザ）マスタ（GET /masters/users。中身は m_操作者）。
 *
 * **バックエンドのレスポンス形（日本語キー）を知ってよいのはこの層だけ。**
 * 形は docs/api/openapi.json の OperatorListResponse / OperatorItem を正とする。
 *
 * いまの呼び出し元は操作ログの「操作者」プルダウンだけ（docs/api/requests.md #38 ④。
 * 操作者の一覧は新しい API ではなく既存のこのパスを使う、というのがバックエンドの回答）。
 * ユーザマスタの画面を作るときは、登録・更新の関数もこのファイルに足す。
 */

/**
 * @typedef {object} User 操作者 1 件（アプリ内モデル）
 * @property {number} id 行 ID
 * @property {string} code 操作者コード（社員コード）。操作ログの `operator` に載せる値
 * @property {string} name 氏名。無ければ空文字
 * @property {string} roleCode ロールコード
 * @property {string} roleName ロール名。無ければ空文字
 * @property {string} branchCode 部店コード。無ければ空文字
 * @property {boolean} active 有効か（有効フラグ 1）
 */

/**
 * 操作者の一覧を取得する。
 *
 * @param {object} [params]
 * @param {string} [params.role] ロールコード
 * @param {string} [params.branchCode] 部店コード
 * @param {boolean} [params.includeInactive] 無効な操作者も含めるか（仕様の既定は false）
 * @param {number} [params.limit] 取得件数（仕様は 1〜200。既定 50）
 * @param {number} [params.offset] 取得開始位置
 * @returns {Promise<{ items: User[], total: number }>} 並びはサーバの返したまま
 */
export async function fetchUsers({
  role = '',
  branchCode = '',
  includeInactive = false,
  limit = 50,
  offset = 0,
} = {}) {
  const { data } = await apiClient.get('/masters/users', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      role: role || undefined,
      branch_code: branchCode || undefined,
      // false は仕様の既定なので送らない
      include_inactive: includeInactive || undefined,
      limit,
      offset,
    },
  })

  return {
    items: (data?.operators ?? []).map(toUser),
    total: data?.total ?? 0,
  }
}

/** OperatorItem → User */
function toUser(raw) {
  return {
    id: raw?.ID ?? 0,
    code: raw?.操作者コード ?? '',
    // nullable な文字列は空文字に寄せる（画面が null と '' を区別しなくてよいように）
    name: raw?.氏名 ?? '',
    roleCode: raw?.ロールコード ?? '',
    roleName: raw?.ロール名 ?? '',
    branchCode: raw?.部店コード ?? '',
    active: raw?.有効フラグ === 1,
  }
}
