/*
 * 権限マスタ（ロール別権限）の語彙。
 *
 * 権限の 4 項目は「一覧の列」と「編集モーダルの行」の両方に現れる。
 * 片方だけ足したり並びがずれたりすると、一覧で見た内容と編集画面の内容が食い違うので、
 * **どちらもこの 1 箇所から生やす**（views/PermissionListView.vue と
 * components/permissions/PermissionCheckList.vue）。
 *
 * 項目は openapi.json の RolePermissionItem の 4 権限（発注 / マスタ更新 / 運用管理 / 全店参照）。
 * 説明文は PermissionFlags の description から起こした。
 * 画面モック（https://uspreorder-vmbhej3k.manus.space/masters/permissions）にあった
 * 「操作ログ閲覧」「管理者機能」は仕様に無いので載せていない（docs/api/requests.md #4）。
 *
 * 一覧の列見出しとモーダルの見出しは別に持つ（モックがそうなっていた名残。いまは同じ文言）。
 * キーの対応は src/api/permissions.js を参照。
 */

/**
 * @typedef {object} PermissionItem 権限 1 項目の定義
 * @property {string} key アプリ内モデルのキー（RolePermission のプロパティ名）
 * @property {string} columnLabel 一覧の列見出し
 * @property {string} label 編集モーダルの見出し
 * @property {string} description 編集モーダルで見出しの下に添える説明
 */

/** 権限の 4 項目。並びは仕様の項目順（＝一覧の列順・モーダルの行順） */
export const PERMISSION_ITEMS = [
  {
    key: 'canOrder',
    columnLabel: '発注権限',
    label: '発注権限',
    description: '発注・取消・訂正・Dream状況変更を実行',
  },
  {
    key: 'canMasterUpdate',
    columnLabel: 'マスタ更新権限',
    label: 'マスタ更新権限',
    description: '各種マスタの登録・更新・削除・CSV取込を実行',
  },
  {
    key: 'canOperation',
    columnLabel: '運用管理権限',
    label: '運用管理権限',
    description: '発注停止・お知らせ・締め・バッチ実行を操作',
  },
  {
    key: 'canBranchAll',
    columnLabel: '全店参照権限',
    label: '全店参照権限',
    description: '全部店のデータを照会（外すと自部店のデータのみ）',
  },
]

/**
 * 一覧のセルに出すバッジの見た目と文言。
 *
 * 文言はモックの `.permission-status.allowed` / `.denied`（許可 / 不可）に合わせる。
 *
 * @param {boolean} allowed 許可されているか
 * @returns {{ variant: string, label: string }} BaseBadge の variant と表示文言
 */
export function permissionBadge(allowed) {
  return allowed ? { variant: 'success', label: '許可' } : { variant: 'gray', label: '不可' }
}
