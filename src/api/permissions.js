import { apiClient } from './client'

/**
 * 権限マスタ（GET /masters/permissions）。
 *
 * **バックエンドのレスポンス形を知ってよいのはこの層だけ。**
 * ここで camelCase のアプリ内モデルに変換してから外へ返す。
 *
 * **実 API にこのエンドポイントは存在しない。** docs/api/openapi.json に権限・ロールを
 * 扱うパスは 1 本も無く、いまは src/mocks/handlers/index.js のモックが応えている。
 * 形は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/permissions）が
 * 編集モーダルへ渡している JSON をそのまま写した**暫定の契約**で、
 * 他のマスタのような日本語キーではなく snake_case なのもそのため
 * （実 API が出てきたら、そのときの形に合わせてこの変換を書き直す）。
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
