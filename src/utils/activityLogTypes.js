/**
 * 操作ログの区分と表示整形（純関数と定数）。
 * 検索セレクトの選択肢・一覧セルのバッジ・日時と値の整形で共用する。
 *
 * 操作区分の値は docs/api/openapi.json の `GET /operations/activity-logs` の `operation` クエリと
 * ActivityLogItem の `操作区分` の説明にある CREATE / UPDATE / DELETE / BATCH。
 * 仕様では enum になっていない（ただの string）ので、src/utils/apiEnums.js ではなくここに置く。
 * 対象種別の選択肢は API（`/operations/activity-logs/targets`）から引くので、ここには持たない。
 */

/**
 * 操作区分の表示名。一覧のバッジと詳細ダイアログで使う。表示名は画面の言葉に訳したもの。
 * **検索セレクトの選択肢と URL クエリの検査はコードマスタ `操作区分`（依頼中の契約提案）から来る**
 * （views/ActivityLogListView.vue）
 */
export const ACTIVITY_OPERATION_OPTIONS = [
  { value: 'CREATE', label: '登録' },
  { value: 'UPDATE', label: '更新' },
  { value: 'DELETE', label: '削除' },
  { value: 'BATCH', label: '一括処理' },
]

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

/**
 * 操作区分の表示名。
 *
 * @param {string} operation 操作区分（CREATE など）
 * @returns {string} 表示名。未知の値はそのまま返す（バックエンドが区分を増やしても行は読めるように）
 */
export function operationLabel(operation) {
  return ACTIVITY_OPERATION_OPTIONS.find((option) => option.value === operation)?.label ?? operation
}

/**
 * 操作区分に対応する BaseBadge の variant。
 * 登録は緑、更新は青、削除は黄、一括処理と未知の値は灰。
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
