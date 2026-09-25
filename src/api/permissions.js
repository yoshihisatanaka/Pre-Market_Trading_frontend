import { apiClient } from './client'

/**
 * 権限マスタ（GET /masters/permissions）。
 *
 * **バックエンドのレスポンス形を知ってよいのはこの層だけ。**
 * ここで camelCase のアプリ内モデルに変換してから外へ返す。
 *
 * **パスは 2026-09-18 の取り込みで仕様に入ったが、形が違う。** 仕様は `RolePermissionListResponse`
 * （`roles[]` = `RolePermissionItem`。日本語キー・`発注権限` / `マスタ更新権限` / `運用管理権限` /
 * `全店参照権限`）で、`PUT /masters/permissions/{role_code}` と `/history` もある。
 * この層はまだ画面モック（https://uspreorder-vmbhej3k.manus.space/masters/permissions）が
 * 編集モーダルへ渡している JSON を写した**暫定の契約**（英語キー・5 権限）のままで、
 * src/mocks/handlers/permissions.js のモックだけが応える。どちらの権限体系を正とするかは
 * docs/api/requests.md #4 で確認中で、決まったらこの変換と fixture を仕様の形に書き直す
 * （契約テストの `KNOWN_GAPS` に食い違いとして載せてある）。
 *
 * 更新（PUT）はまだ用意していない。いまの画面は保存しても通信しない。
 */

/**
 * @typedef {object} RolePermission ロール 1 件の権限（アプリ内モデル）
 * @property {string} role ロールコード（ifa / sales / manager / supervisor）。一覧の行キー
 * @property {string} roleLabel ロール名（IFA / 営業員 / 管理者 / 管理責任者）
 * @property {string} description 運用概要
 * @property {boolean} canOrder 発注権限
 * @property {boolean} canMasterUpdate マスタ更新権限
 * @property {boolean} canOrderStop 運用制御権限
 * @property {boolean} canActivityLogView 操作ログ閲覧権限
 * @property {boolean} canAdminFunction 管理者機能権限
 */

/**
 * ロール別の権限を取得する。
 *
 * canEdit は「いまの利用者が権限マスタを変更できるか」。モックでは管理責任者だけが true で、
 * それ以外は一覧の「操作」列ごと消える。認証が入るまではサーバの応答が唯一の決め手になる。
 *
 * @returns {Promise<{ roles: RolePermission[], canEdit: boolean }>} 並びはサーバが決める
 */
export async function fetchPermissions() {
  const { data } = await apiClient.get('/masters/permissions')

  return {
    roles: (data.roles ?? []).map(toRolePermission),
    // 応答が欠けているときは編集できない側に倒す（誤って操作列を出さない）
    canEdit: data.editable ?? false,
  }
}

/** レスポンスの 1 件 → RolePermission */
function toRolePermission(raw) {
  return {
    role: raw?.role ?? '',
    roleLabel: raw?.role_label ?? '',
    description: raw?.description ?? '',
    // 権限は真偽値。欠けている項目は「持っていない」と読む
    canOrder: Boolean(raw?.can_order),
    canMasterUpdate: Boolean(raw?.can_master_update),
    canOrderStop: Boolean(raw?.can_order_stop),
    canActivityLogView: Boolean(raw?.can_activity_log_view),
    canAdminFunction: Boolean(raw?.can_admin_function),
  }
}
