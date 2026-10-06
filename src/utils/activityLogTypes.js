/**
 * 操作ログの区分と表示整形（純関数と定数）。
 * 検索セレクトの選択肢・一覧セルのバッジ・日時と値の整形で共用する。
 *
 * 操作区分（CREATE / UPDATE …）の値は docs/api/openapi.json の `GET /operations/activity-logs` の
 * `operation` クエリと ActivityLogItem の `操作区分` の説明にある 9 種。
 * 仕様では enum になっていない（ただの string）ので、src/utils/apiEnums.js ではなくここに置く。
 * 対象種別の選択肢は API（`/operations/activity-logs/targets`）から引くので、ここには持たない。
 *
 * 画面モック（https://uspreorder-vmbhej3k.manus.space/operations/activity-logs）は「操作区分」を
 * 業務操作 / マスタ更新 / 運用管理 の 3 区分で出し、登録・更新などは「操作内容」と呼ぶ。
 * 実 API の `操作区分` は後者（登録・更新 …）なので、画面では次のように読み替える。
 *   - モックの「操作区分」 … このファイルの **区分（category）**。対象種別から導く
 *   - モックの「操作内容」 … 実 API の `操作区分`（このファイルの operation）
 */

/**
 * 操作内容（実 API の 操作区分）の表示名。詳細ダイアログと、コードマスタが引けないときの一覧の
 * 代替表示で使う。**検索セレクトの選択肢と URL クエリの検査はコードマスタ `操作区分` から
 * 来る**（views/ActivityLogListView.vue）。
 */
export const ACTIVITY_OPERATION_OPTIONS = [
  { value: 'CREATE', label: '登録' },
  { value: 'UPDATE', label: '更新' },
  { value: 'DELETE', label: '削除' },
  { value: 'BATCH', label: '一括処理' },
  { value: 'SUSPEND', label: '停止' },
  { value: 'RESUME', label: '再開' },
  { value: 'SHOW', label: '表示' },
  { value: 'HIDE', label: '非表示' },
  { value: 'VWAP_BULK', label: 'VWAP対象一括更新' },
]

/**
 * 区分（画面モックの「操作区分」）。検索セレクトの選択肢と一覧のバッジで使う。
 *
 * 実 API にこの区分は無い。対象種別ごとに決まるので、画面は区分を対象種別の並び
 * （`target_types` のカンマ区切り）に展開して送る（targetTypesFor）。
 * モックにある「業務操作」（注文の受付・訂正など）は実 API の操作ログに注文の行が無いので
 * 選択肢に出さない（docs/api/requests.md #38）。入ったらここに足す。
 */
export const ACTIVITY_CATEGORY_OPTIONS = [
  { value: 'master', label: 'マスタ更新' },
  { value: 'operation', label: '運用管理' },
]

/**
 * 運用管理に属する対象種別コード。これ以外の対象種別はすべてマスタ更新とみなす
 * （実 API の操作ログは「各マスタの変更履歴を横断したもの」なので、既定をマスタ側に置く）。
 * コードは実 API の `/operations/activity-logs/targets` の値（2026-10-05 実測）。
 */
export const OPERATION_TARGET_TYPES = ['order-suspensions', 'announcements']

/**
 * 並び順（操作日時）。実 API の `sort` の既定は desc なので、既定（新しい順）は空文字で表し
 * URL クエリにも出さない。
 */
export const ACTIVITY_SORT_OPTIONS = [
  { value: '', label: '新しい順' },
  { value: 'asc', label: '古い順' },
]

/**
 * 選択肢に含まれる値かを判定する述語を作る。
 * URL クエリのような外から来る値を検索条件に使う前に通す
 * （手で書き換えられた値を空に落とす。MarketHolidayListView の isMarketHolidayType と同じ用途）。
 */
function memberOf(options) {
  return (value) => options.some((option) => option.value === value)
}

export const isActivitySort = memberOf(ACTIVITY_SORT_OPTIONS)

export const isActivityCategory = memberOf(ACTIVITY_CATEGORY_OPTIONS)

/**
 * 操作内容（実 API の 操作区分）の表示名。
 *
 * @param {string} operation 操作区分（CREATE など）
 * @returns {string} 表示名。未知の値はそのまま返す（バックエンドが区分を増やしても行は読めるように）
 */
export function operationLabel(operation) {
  return ACTIVITY_OPERATION_OPTIONS.find((option) => option.value === operation)?.label ?? operation
}

/**
 * 操作内容に対応する BaseBadge の variant。詳細ダイアログで使う。
 * 登録は緑、更新は青、削除は黄、一括処理・停止や表示などの運用系・未知の値は灰。
 * 削除は赤（error）にしない。失敗を表す色ではなく、正常に記録された操作なので。
 *
 * @param {string} operation 操作区分
 * @returns {string} BaseBadge の variant
 */
export function operationBadgeVariant(operation) {
  if (operation === 'CREATE') return 'success'
  if (operation === 'UPDATE') return 'info'
  if (operation === 'DELETE') return 'warning'
  return 'gray'
}

/**
 * 対象種別から区分を決める。
 *
 * @param {string} targetType 対象種別コード
 * @returns {string} ACTIVITY_CATEGORY_OPTIONS の value（'master' / 'operation'）
 */
export function categoryOf(targetType) {
  return OPERATION_TARGET_TYPES.includes(targetType) ? 'operation' : 'master'
}

/**
 * 区分の表示名。
 *
 * @param {string} category 区分（'master' / 'operation'）
 * @returns {string} 表示名。未知の値はそのまま返す
 */
export function categoryLabel(category) {
  return ACTIVITY_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category
}

/**
 * 区分に対応する BaseBadge の variant。画面モックの色分け（マスタ更新は緑、運用管理は灰）。
 * 業務操作が入ったら青（info）にする（モックの .activity-kind.business）。
 *
 * @param {string} category 区分
 * @returns {string} BaseBadge の variant
 */
export function categoryBadgeVariant(category) {
  if (category === 'master') return 'success'
  if (category === 'operation') return 'gray'
  return 'info'
}

/**
 * 検索条件の 区分 / 対象機能 を、実 API に送る対象種別コードの並びに展開する。
 *
 * 対象機能（対象種別 1 つ）が選ばれていればそれだけを送る（区分より細かい条件なので区分は見ない）。
 * 区分だけなら、運用管理は OPERATION_TARGET_TYPES、マスタ更新は対象種別 API が返す一覧のうち
 * 運用管理でないもの全部。どちらも無ければ空（絞り込まない）。
 *
 * マスタ更新の展開には対象種別の一覧が要る。一覧がまだ無い（取得前・取得失敗）ときは
 * 空を返し、絞り込み無しになる（画面は対象機能の欄の下に取得失敗の理由を出している）。
 *
 * @param {{ category?: string, targetType?: string, targets?: Array<{ code: string }> }} params
 * @returns {string[]} 対象種別コードの並び
 */
export function targetTypesFor({ category = '', targetType = '', targets = [] } = {}) {
  if (targetType) return [targetType]
  if (category === 'operation') return [...OPERATION_TARGET_TYPES]
  if (category === 'master') {
    return targets.map((target) => target.code).filter((code) => categoryOf(code) === 'master')
  }
  return []
}

const activityAt = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * 操作日時を一覧の表示形（`2026/09/16 10:35:00`）に整形する。
 *
 * 監査記録は年をまたいで検索するので年まで出す。同じ列で桁数が変わると読みにくいので常に秒まで出す。
 *
 * @param {string} isoString ISO8601 の日時文字列
 * @returns {string} 整形後の日時。空値・不正値は '—'（他の列の空値表現とそろえる）
 */
export function formatActivityAt(isoString) {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '—'
  return activityAt.format(date)
}

/**
 * 変更前後データ・差分の値を 1 行の文字列にする。
 *
 * レコード JSON の値は型が決まっていない（仕様は additionalProperties: true）ので、
 * 文字列・数値・真偽値はそのまま、入れ子の object / 配列は JSON にして出す。
 *
 * @param {*} value 値
 * @returns {string} 表示用の文字列。null / undefined / 空文字は '—'
 */
export function formatActivityValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
