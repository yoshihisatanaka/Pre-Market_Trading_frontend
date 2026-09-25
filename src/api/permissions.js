import { apiClient } from './client'

/**
 * 権限マスタ（GET /masters/permissions・PUT /masters/permissions/{role_code}）。
 *
 * **バックエンドのレスポンス形を知ってよいのはこの層だけ。**
 * ここで camelCase のアプリ内モデルに変換してから外へ返す。
 *
 * 実 API の形（openapi.json の RolePermissionItem）:
 *   - プロパティ名が日本語（ロールコード / ロール名 / 発注権限 …）
 *   - 権限は 4 つ（発注 / マスタ更新 / 運用管理 / 全店参照）で、値は 0 / 1 の integer
 *   - 同じ内容を英語キーの真偽値で持つ `権限`（PermissionFlags）もあるが、更新の本文は日本語キーなので
 *     読むのも日本語キーに揃える
 *
 * 画面モックにあった「操作ログ閲覧」「管理者機能」は仕様に無いので扱わない（2026-09-25 に仕様へ追随。
 * docs/api/requests.md #4）。
 *
 * 一覧の応答には「いまの利用者が編集できるか」が無い。判定は GET /auth/me のロールで行う
 * （src/api/auth.js。組み合わせるのはストア）。
 */

/**
 * @typedef {object} RolePermission ロール 1 件の権限（アプリ内モデル）
 * @property {number|null} id 行 ID（`ID`）
 * @property {string} role ロールコード（ifa / sales / manager / supervisor）。一覧の行キーで、更新のパスキー
 * @property {string} roleLabel ロール名（IFA / 営業員 / 管理者 / 管理責任者）
 * @property {string} description 運用概要（`説明`。nullable を空文字に寄せる）
 * @property {boolean} canOrder 発注権限
 * @property {boolean} canMasterUpdate マスタ更新権限
 * @property {boolean} canOperation 運用管理権限
 * @property {boolean} canBranchAll 全店参照権限
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
 * `全店参照権限` は任意項目だが、画面で編集するので常に送る。
 * updatedAt が空のときは `更新日時` をキーごと送らない（照合する相手が無い）。
 *
 * @param {string} role 対象のロールコード
 * @param {{ canOrder: boolean, canMasterUpdate: boolean, canOperation: boolean,
 *   canBranchAll: boolean, updatedAt?: string }} values
 * @returns {Promise<{ role: RolePermission, message: string }>}
 *   role は更新後の行。message はサーバの文言（「〈ロール名〉の権限設定を更新しました。」、
 *   変更が無ければ「変更はありません。」）で、画面はそのまま出す
 */
export async function updateRolePermission(
  role,
  { canOrder, canMasterUpdate, canOperation, canBranchAll, updatedAt = '' },
) {
  const { data } = await apiClient.put(`/masters/permissions/${encodeURIComponent(role)}`, {
    発注権限: toFlag(canOrder),
    マスタ更新権限: toFlag(canMasterUpdate),
    運用管理権限: toFlag(canOperation),
    全店参照権限: toFlag(canBranchAll),
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

/** RolePermissionItem → RolePermission */
function toRolePermission(raw) {
  return {
    id: raw?.ID ?? null,
    role: raw?.['ロールコード'] ?? '',
    roleLabel: raw?.['ロール名'] ?? '',
    description: raw?.['説明'] ?? '',
    // 0 / 1。欠けている項目は「持っていない」と読む
    canOrder: raw?.['発注権限'] === 1,
    canMasterUpdate: raw?.['マスタ更新権限'] === 1,
    canOperation: raw?.['運用管理権限'] === 1,
    canBranchAll: raw?.['全店参照権限'] === 1,
    // 照合はサーバが行うので Date に通さず素の文字列で持つ
    updatedAt: raw?.['更新日時'] ?? '',
  }
}
