import { apiClient } from './client'

/**
 * 操作者（ユーザ）マスタ（GET /masters/users・PUT /masters/users/{operator_code}。中身は m_操作者）。
 *
 * **バックエンドのレスポンス形（日本語キー）を知ってよいのはこの層だけ。**
 * 形は docs/api/openapi.json の OperatorListResponse / OperatorItem / OperatorUpsertRequest を正とする。
 *
 * 呼び出し元はユーザ管理マスタの画面（stores/users.js）と、操作ログの「操作者」プルダウン
 * （stores/operatorOptions.js。docs/api/requests.md #38 ④）。
 *
 * 吸収している差（成熟度 A。パスは仕様に在る）:
 *   - パスキーは ID ではなく業務キーの操作者コード（社員コード）。画面・ストアは id で行を指し、
 *     パスに載せるキーはこの層が選ぶ
 *   - PUT は登録／更新の兼用（upsert）で、本文の `受注者コード` は**省くと null で上書き**される。
 *     部分更新ではないので、画面で変えない項目も今の値を送り返す
 *   - 画面モックの検索にある「メールアドレス・氏名」のキーワードは仕様にクエリが無い。
 *     `keyword` で送り、実 API は黙って無視する（docs/api/requests.md #67。契約テストの KNOWN_GAPS に載せてある）
 */

/**
 * @typedef {object} User 操作者 1 件（アプリ内モデル）
 * @property {number} id 行 ID
 * @property {string} code 操作者コード（社員コード）。操作ログの `operator` に載せる値で、更新のパスキー
 * @property {string} name 氏名。無ければ空文字
 * @property {string} roleCode ロールコード
 * @property {string} roleName ロール名。無ければ空文字
 * @property {string} branchCode 部店コード。無ければ空文字
 * @property {string} orderTakerCode 受注者コード（Dream の受注担当者コード。4 文字以内）。無ければ空文字
 * @property {boolean} active 有効か（有効フラグ 1）
 * @property {string} updatedAt 更新日時。無ければ空文字
 * @property {string} updatedBy 更新者。無ければ空文字
 */

/**
 * 操作者の一覧を取得する。
 *
 * @param {object} [params]
 * @param {string} [params.role] ロールコード
 * @param {string} [params.branchCode] 部店コード
 * @param {string} [params.keyword] 社員コード・氏名の部分一致（実 API は未対応。上の冒頭コメント）
 * @param {boolean} [params.includeInactive] 無効な操作者も含めるか（仕様の既定は false）
 * @param {number} [params.limit] 取得件数（仕様は 1〜200。既定 50）
 * @param {number} [params.offset] 取得開始位置
 * @returns {Promise<{ items: User[], total: number }>} 並びはサーバの返したまま
 */
export async function fetchUsers({
  role = '',
  branchCode = '',
  keyword = '',
  includeInactive = false,
  limit = 50,
  offset = 0,
} = {}) {
  const { data } = await apiClient.get('/masters/users', {
    // クエリ名を知ってよいのはこの層だけ。値が undefined のパラメータは axios が送らない
    params: {
      role: role || undefined,
      branch_code: branchCode || undefined,
      keyword: keyword || undefined,
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

/**
 * 操作者 1 件のロールと有効／無効を更新する。
 *
 * 実 API の約束（openapi.json）:
 *   - 登録／更新の兼用（upsert）。マスタ更新権限が必要
 *   - 権限マスタに無いロールコードは 400
 *   - 楽観的ロックは無い（`更新日時` を受け取らない）
 *
 * 氏名・部店コード・受注者コードは画面で変えないが、**省くと null で上書きされる**ものがあるので
 * 今の値をそのまま送り返す（空文字は null に戻す）。`実行者` は認証から解決されるので送らない。
 *
 * @param {Pick<User, 'code' | 'name' | 'roleCode' | 'branchCode' | 'orderTakerCode' | 'active'>} user
 *   更新後の値。code はパスキー（変えられない）
 * @returns {Promise<User>} サーバが返した更新後の 1 件
 */
export async function updateUser({ code, name, roleCode, branchCode, orderTakerCode, active }) {
  const { data } = await apiClient.put(`/masters/users/${encodeURIComponent(code)}`, {
    氏名: name || null,
    ロールコード: roleCode,
    部店コード: branchCode || null,
    受注者コード: orderTakerCode || null,
    有効フラグ: active ? 1 : 0,
  })

  return toUser(data?.operator)
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
    orderTakerCode: raw?.受注者コード ?? '',
    active: raw?.有効フラグ === 1,
    updatedAt: raw?.更新日時 ?? '',
    updatedBy: raw?.更新者 ?? '',
  }
}
