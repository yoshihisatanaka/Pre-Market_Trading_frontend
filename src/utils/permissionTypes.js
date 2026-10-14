/*
 * 権限マスタ（ロール別権限）の語彙。
 *
 * 権限の項目は「一覧の列」と「編集モーダルの行」の両方に現れる。
 * 片方だけ足したり並びがずれたりすると、一覧で見た内容と編集画面の内容が食い違うので、
 * **どちらもこの 1 箇所から生やす**（views/PermissionListView.vue と
 * components/permissions/PermissionCheckList.vue）。
 *
 * 項目と並びは画面モック（../premarket-order-202609 の 7ee3ad9。2026-10-12）の 8 列に揃える。
 * 実 API（openapi.json の RolePermissionItem）との対応は 3 通りある。
 *   - 発注 / マスタ更新 / 運用・障害管理 … 実 API の 発注権限 / マスタ更新権限 / 運用管理権限。
 *     説明文は PermissionFlags の description から起こした（サーバが実際に何を許すかに合わせる）
 *   - 参照 / 発注（強制） / CSV一括発注 / ユーザ管理 … 実 API に保存先が無い（`proposed: true`）。
 *     フィクスチャに契約提案として載せ（docs/api/requests.md #75 / #76 / #81）、実 API が返さない間は
 *     値が null になって一覧は「—」、編集のチェックは押せない。説明文はモックの文言
 *   - 操作ログ閲覧 … 保存しない（`derived: true`）。マスタ更新か運用・障害管理を許可したロールに
 *     自動で付く（モックの _decorate_role_permission と同じ規則。導出は src/api/permissions.js）
 *
 * 実 API の 全店参照権限 / 預託先参照権限 は画面に出さない（モックの列に無い。
 * 更新の本文に載せなければサーバは現在値を保つ）。
 *
 * 一覧の列見出しとモーダルの見出しは別に持つ（いまは同じ文言）。
 * キーの対応は src/api/permissions.js を参照。
 */

/**
 * @typedef {object} PermissionItem 権限 1 項目の定義
 * @property {string} key アプリ内モデルのキー（RolePermission のプロパティ名）
 * @property {string} columnLabel 一覧の列見出し
 * @property {string} label 編集モーダルの見出し
 * @property {string} description 編集モーダルで見出しの下に添える説明
 * @property {boolean} [proposed] 実 API に保存先が無い（契約提案）。値が null なら未対応
 * @property {boolean} [derived] 保存しない導出値。編集モーダルではチェックを出さない
 */

/** 権限の 8 項目。並びはモックの列順（＝一覧の列順・モーダルの行順） */
export const PERMISSION_ITEMS = [
  {
    key: 'canReference',
    columnLabel: '参照',
    label: '参照',
    description: '顧客・注文・約定・残高・各マスタを参照',
    proposed: true,
  },
  {
    key: 'canOrder',
    columnLabel: '発注',
    label: '発注',
    description: '発注・取消・訂正・Dream状況変更を実行',
  },
  {
    key: 'canForceOrder',
    columnLabel: '発注（強制）',
    label: '発注（強制）',
    description: 'エラー／強制可を理由付きで発注',
    proposed: true,
  },
  {
    key: 'canCsvOrder',
    columnLabel: 'CSV一括発注',
    label: 'CSV一括発注',
    description: 'CSVのアップロード・内容確認・注文確定を実行',
    proposed: true,
  },
  {
    key: 'canMasterUpdate',
    columnLabel: 'マスタ更新',
    label: 'マスタ更新',
    description: '各種マスタの登録・更新・削除・CSV取込を実行',
  },
  {
    key: 'canOperation',
    columnLabel: '運用・障害管理',
    label: '運用・障害管理',
    description: '発注停止・お知らせ・締め・バッチ実行を操作',
  },
  {
    key: 'canActivityLogView',
    columnLabel: '操作ログ閲覧',
    label: '操作ログ閲覧（自動付与）',
    description: 'マスタ更新または運用・障害管理を許可したロールは、操作ログを閲覧できます。',
    derived: true,
  },
  {
    key: 'canUserManagement',
    columnLabel: 'ユーザ管理',
    label: 'ユーザ管理',
    description: 'ユーザの有効／停止・ロール割当・ロール設定を管理',
    proposed: true,
  },
]

/** 保存する項目（編集モーダルでチェックを出す項目） */
export const EDITABLE_PERMISSION_ITEMS = PERMISSION_ITEMS.filter((item) => !item.derived)

/**
 * 「発注」を前提にする権限。モックのサーバ側検証（_validate_role_permissions）と同じ規則で、
 * 文言もモックに合わせる。
 */
const REQUIRES_ORDER = [
  { key: 'canForceOrder', message: '「発注（強制）」を許可するには「発注」も許可してください。' },
  { key: 'canCsvOrder', message: '「CSV一括発注」を許可するには「発注」も許可してください。' },
]

/**
 * 編集中の権限の組み合わせを検証する。
 *
 * 未対応（null）の項目は許可されていないものとして扱う（チェックできないので矛盾も起きない）。
 *
 * @param {Record<string, boolean|null>} values 編集中の値（キーは PERMISSION_ITEMS）
 * @returns {string[]} 不備の文言。無ければ空配列
 */
export function validatePermissions(values) {
  if (values.canOrder) return []
  return REQUIRES_ORDER.filter(({ key }) => values[key] === true).map(({ message }) => message)
}

/**
 * 一覧のセルに出すバッジの見た目と文言。
 *
 * 文言はモックの `.permission-status.allowed` / `.denied` / `.derived`（許可 / 不可 / 閲覧可）に合わせる。
 * 値が null（実 API が返さない契約提案の項目）なら「不可」と誤読させないよう null を返し、
 * 画面はバッジを出さずに「—」を置く。
 *
 * @param {boolean|null} allowed 許可されているか。null は未対応
 * @param {{ derived?: boolean }} [item] 権限の定義。導出値なら許可を「閲覧可」と出す
 * @returns {{ variant: string, label: string }|null} BaseBadge の variant と表示文言。未対応なら null
 */
export function permissionBadge(allowed, item = {}) {
  if (allowed === null || allowed === undefined) return null
  if (!allowed) return { variant: 'gray', label: '不可' }
  return item.derived ? { variant: 'info', label: '閲覧可' } : { variant: 'success', label: '許可' }
}

/** 未対応（実 API が値を返さない）の項目に置く文言 */
export const UNSUPPORTED_LABEL = '—'
