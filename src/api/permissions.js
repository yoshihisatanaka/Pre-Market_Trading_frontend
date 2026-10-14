import { apiClient } from './client'

/**
 * 権限マスタ（GET /masters/permissions・PUT /masters/permissions/{role_code}）。
 *
 * **バックエンドのレスポンス形を知ってよいのはこの層だけ。**
 * ここで camelCase のアプリ内モデルに変換してから外へ返す。
 *
 * 実 API の形（openapi.json の RolePermissionItem）:
 *   - プロパティ名が日本語（ロールコード / ロール名 / 発注権限 …）
 *   - 権限は 発注 / マスタ更新 / 運用管理 / 全店参照 / 預託先参照 で、値は 0 / 1 の integer
 *   - 同じ内容を英語キーの真偽値で持つ `権限`（PermissionFlags）もあるが、更新の本文は日本語キーなので
 *     読むのも日本語キーに揃える
 *
 * 画面は画面モック（2026-10-12）の 8 権限に合わせる（src/utils/permissionTypes.js）。
 * 実 API に保存先が無い 4 権限は **契約提案のキー**（PROPOSED_FLAGS）で読み書きする
 * （docs/api/requests.md #75 / #76 / #81）。実 API が返さない間は null（未対応）にし、更新の本文にも載せない。
 * バックエンドが提案どおりのキーで返し始めたら、ここを直さずに有効になる。
 *
 * 全店参照権限 / 預託先参照権限 は画面に出さないので読まず、送らない（未指定ならサーバは現在値を保つ）。
 *
 * 一覧の応答には「いまの利用者が編集できるか」が無い。判定は GET /auth/me のロールで行う
 * （src/api/auth.js。組み合わせるのはストア）。
 */

/**
 * 実 API に保存先がある権限（RolePermissionUpdateRequest の必須項目）。
 * 応答に欠けていたら「持っていない」と読み、更新では常に送る。
 */
const FLAGS = [
  ['canOrder', '発注権限'],
  ['canMasterUpdate', 'マスタ更新権限'],
  ['canOperation', '運用管理権限'],
]

/**
 * 実 API に保存先が無い権限（契約提案のキー）。
 * 応答に無ければ null（未対応）と読み、null のものは更新で送らない。
 */
const PROPOSED_FLAGS = [
  ['canReference', '参照権限'],
  ['canForceOrder', '強制発注権限'],
  ['canCsvOrder', 'CSV一括発注権限'],
  ['canUserManagement', 'ユーザ管理権限'],
]

/**
 * @typedef {object} RolePermission ロール 1 件の権限（アプリ内モデル）
 * @property {number|null} id 行 ID（`ID`）
 * @property {string} role ロールコード（ifa / sales / manager / supervisor）。一覧の行キーで、更新のパスキー
 * @property {string} roleLabel ロール名（IFA / 営業員 / 管理者 / 管理責任者）
 * @property {string} description 運用概要（`説明`。nullable を空文字に寄せる）
 * @property {boolean|null} canReference 参照権限（契約提案。null は未対応）
 * @property {boolean} canOrder 発注権限
 * @property {boolean|null} canForceOrder 強制発注権限（契約提案。null は未対応）
 * @property {boolean|null} canCsvOrder CSV一括発注権限（契約提案。null は未対応）
 * @property {boolean} canMasterUpdate マスタ更新権限
 * @property {boolean} canOperation 運用管理権限（画面では「運用・障害管理」）
 * @property {boolean} canActivityLogView 操作ログ閲覧（マスタ更新か運用管理から導く。保存しない）
 * @property {boolean|null} canUserManagement ユーザ管理権限（契約提案。null は未対応）
 * @property {string} updatedAt 楽観的ロックの合札（`更新日時`。null は空文字）
 */

/**
 * ロール別の権限を取得する。
 *
 * @returns {Promise<RolePermission[]>} 並びはサーバが決める（ID 順 = ifa → sales → manager → supervisor）
 */
export async function fetchPermissions() {
  const { data } = await apiClient.get('/masters/permissions')
  return (data?.roles ?? []).map(toRolePermission)
}

/**
 * ロール 1 件の権限を更新する。
 *
 * 実 API の約束（openapi.json の description）:
 *   - 更新できるのは管理責任者（supervisor）だけ。強制モードでは他のロールは 403
 *   - 存在しないロールは 404
 *   - 更新日時 を送ると楽観的ロックが効き、他の担当者が先に更新していれば 409
 *   - 変更が無ければ履歴を残さず現在値を返す
 *
 * パスキーは業務キーのロールコード（仕様どおり。ID ではない）。
 * `説明` は画面で編集しないので送らない（未指定なら現在値が保たれる）。
 * 契約提案の権限は値が null（未対応）なら送らない。canActivityLogView は導出値なので送らない。
 * updatedAt が空のときは `更新日時` をキーごと送らない（照合する相手が無い）。
 *
 * @param {string} role 対象のロールコード
 * @param {{ canOrder: boolean, canMasterUpdate: boolean, canOperation: boolean,
 *   canReference?: boolean|null, canForceOrder?: boolean|null, canCsvOrder?: boolean|null,
 *   canUserManagement?: boolean|null, updatedAt?: string }} values
 * @returns {Promise<{ role: RolePermission, message: string }>}
 *   role は更新後の行。message はサーバの文言（「〈ロール名〉の権限設定を更新しました。」、
 *   変更が無ければ「変更はありません。」）で、画面はそのまま出す
 */
export async function updateRolePermission(role, values) {
  const { updatedAt = '' } = values
  const proposed = PROPOSED_FLAGS.filter(([key]) => typeof values[key] === 'boolean')

  const { data } = await apiClient.put(`/masters/permissions/${encodeURIComponent(role)}`, {
    ...Object.fromEntries(FLAGS.map(([key, column]) => [column, toFlag(values[key])])),
    ...Object.fromEntries(proposed.map(([key, column]) => [column, toFlag(values[key])])),
    ...(updatedAt ? { 更新日時: updatedAt } : {}),
  })

  return {
    role: toRolePermission(data?.role),
    message: data?.message ?? '',
  }
}

/** 真偽値 → 0 / 1（更新の本文は integer） */
function toFlag(value) {
  return value ? 1 : 0
}

/** 契約提案の権限を読む。キーが無い（null も含む）なら未対応の null */
function toProposedFlag(raw, column) {
  const value = raw?.[column]
  return value === undefined || value === null ? null : value === 1
}

/** RolePermissionItem → RolePermission */
function toRolePermission(raw) {
  // 0 / 1。欠けている項目は「持っていない」と読む
  const flags = Object.fromEntries(FLAGS.map(([key, column]) => [key, raw?.[column] === 1]))
  const proposed = Object.fromEntries(
    PROPOSED_FLAGS.map(([key, column]) => [key, toProposedFlag(raw, column)]),
  )
  return {
    id: raw?.ID ?? null,
    role: raw?.['ロールコード'] ?? '',
    roleLabel: raw?.['ロール名'] ?? '',
    description: raw?.['説明'] ?? '',
    ...flags,
    ...proposed,
    // 画面モックの規則: マスタ更新か運用・障害管理を許可したロールは操作ログを閲覧できる
    canActivityLogView: flags.canMasterUpdate || flags.canOperation,
    // 照合はサーバが行うので Date に通さず素の文字列で持つ
    updatedAt: raw?.['更新日時'] ?? '',
  }
}
