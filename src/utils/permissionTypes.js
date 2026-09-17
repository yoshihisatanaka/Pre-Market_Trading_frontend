/*
 * 権限マスタ（ロール別権限）の語彙。
 *
 * 権限の 5 項目は「一覧の列」と「編集モーダルの行」の両方に現れる。
 * 片方だけ足したり並びがずれたりすると、一覧で見た内容と編集画面の内容が食い違うので、
 * **どちらもこの 1 箇所から生やす**（views/PermissionListView.vue と
 * components/permissions/PermissionCheckList.vue）。
 *
 * 文言は画面モック（https://uspreorder-vmbhej3k.manus.space/masters/permissions）から採った。
 * 一覧の列見出しとモーダルの見出しは**わざと違う**（モックがそうなっている）ので、
 * columnLabel と label を別に持つ。
 *
 * 実 API はまだ無い。キーの対応は src/api/permissions.js を参照。
 */

/**
 * @typedef {object} PermissionItem 権限 1 項目の定義
 * @property {string} key アプリ内モデルのキー（RolePermission のプロパティ名）
 * @property {string} columnLabel 一覧の列見出し
 * @property {string} label 編集モーダルの見出し
 * @property {string} description 編集モーダルで見出しの下に添える説明
 */

/** 権限の 5 項目。並びはモックの列順（＝モーダルの行順）と同じ */
export const PERMISSION_ITEMS = [
  {
    key: 'canOrder',
    columnLabel: '発注権限',
    label: '発注権限',
    description: '注文入力・確定・CSV一括注文を実行',
  },
  {
    key: 'canMasterUpdate',
    columnLabel: 'マスタ更新権限',
    label: 'マスタ更新権限',
    description: '各種マスタと残高マスタを更新',
  },
  {
    key: 'canOrderStop',
    columnLabel: '運用制御権限',
    label: '運用制御権限',
    description: '障害管理のIB送信・注文入力の制御を切替',
  },
  {
    key: 'canActivityLogView',
    columnLabel: '操作ログ閲覧',
    label: '操作ログ閲覧権限',
    description: '業務操作・マスタ更新・運用管理の操作ログを閲覧',
  },
  {
    key: 'canAdminFunction',
    columnLabel: '管理者機能',
    label: '管理者機能権限',
    description: '管理者向けの業務機能を利用',
  },
]

/**
 * 一覧のセルに出すバッジの見た目と文言。
 *
 * モックが描いているのは許可（緑）だけだが、CSS には不可（灰）の定義もある。
 * **「不可」という文言はモックに無く、モックの `.permission-status.denied` から起こした推定。**
 * 実データで不許可の行が出てくるときに、正しい言い回しを確認すること。
 *
 * @param {boolean} allowed 許可されているか
 * @returns {{ variant: string, label: string }} BaseBadge の variant と表示文言
 */
export function permissionBadge(allowed) {
  return allowed ? { variant: 'success', label: '許可' } : { variant: 'gray', label: '不可' }
}
