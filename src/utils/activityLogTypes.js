/**
 * 操作ログの区分と表示整形（純関数と定数）。
 * 検索セレクトの選択肢・一覧セルのバッジ・日時の整形で共用する。
 *
 * **ここに並ぶ区分は実 API には存在しない。** docs/api/openapi.json の
 * `GET /operations/activity-logs` が返す ActivityLogItem が持つのは
 * 対象種別 / 履歴ID / 対象ID / 対象キー / 操作区分(CREATE,UPDATE,DELETE,BATCH) /
 * 操作者(コードのみ) / 操作日時 / 変更前後データ / 差分 / 変更項目 だけで、
 * 画面モックが出している「操作区分（業務操作・マスタ更新・運用管理）」「実行者区分」
 * 「対象機能」「操作内容」「結果」に当たる項目が無い。
 *
 * 今回は画面モック
 * （https://uspreorder-vmbhej3k.manus.space/operations/activity-logs）の見た目を正として
 * 実装しているので、これらはモックのセレクトの写し。**API と繋ぎ込むときに、
 * 列とクエリの対応を仕様側と決め直す必要がある。**
 * 値と表示名が同じものは、そのままモックの option の value を写している。
 */

/** 操作区分。一覧 2 列目のバッジと検索セレクトで使う */
export const ACTIVITY_CATEGORY_OPTIONS = [
  { value: '業務操作', label: '業務操作' },
  { value: 'マスタ更新', label: 'マスタ更新' },
  { value: '運用管理', label: '運用管理' },
]

/** 対象機能。一覧 4 列目の上段と検索セレクトで使う */
export const ACTIVITY_FEATURE_OPTIONS = [
  { value: '残高マスタ', label: '残高マスタ' },
  { value: '注文', label: '注文' },
  { value: '為替マスタ', label: '為替マスタ' },
]

/** 操作内容。一覧 4 列目の下段と検索セレクトで使う */
export const ACTIVITY_ACTION_OPTIONS = [
  { value: '残高マスタ', label: '残高マスタ' },
  { value: '注文受付', label: '注文受付' },
  { value: '注文訂正', label: '注文訂正' },
  { value: '為替レートを更新', label: '為替レートを更新' },
]

/**
 * 実行者区分。value（sales / management）だけ英字なのはモックの option に合わせたもの。
 * 1 つの value が複数の役割（営業員 と IFA）をまとめるので、表示名と 1 対 1 にならない。
 * どの役割がどちらに属するかはモックのサーバ側の都合なので、絞り込みはモック
 * （src/mocks/handlers/index.js）が ACTOR_GROUP_ROLES で判定する。
 */
export const ACTIVITY_ACTOR_GROUP_OPTIONS = [
  { value: 'sales', label: '営業員・IFA' },
  { value: 'management', label: '管理者・管理責任者' },
]

/** 結果 */
export const ACTIVITY_RESULT_OPTIONS = [
  { value: '成功', label: '成功' },
  { value: '失敗', label: '失敗' },
]

/**
 * 操作者。モックのセレクトのハードコードをそのまま写している。
 *
 * 本来はユーザマスタ（もしくはコードマスタ）から引くもので、フロントに固定で持つ値ではない。
 * 操作ログの画面が先に出来ただけなので、選択肢の出所が決まったら
 * CustomerListView の部店・扱者と同じく useCodesStore 経由に差し替える。
 */
export const ACTIVITY_ACTOR_OPTIONS = [
  { value: '001', label: '001 山田 太郎' },
  { value: '002', label: '002 鈴木 花子' },
  { value: '003', label: '003 佐藤 一郎' },
  { value: '005', label: '005 高橋 管理' },
  { value: '006', label: '006 伊藤 責任者' },
  { value: '111', label: '111 システム' },
  { value: '222', label: '222 システム' },
]

/**
 * 選択肢に含まれる値かを判定する述語を作る。
 * URL クエリのような外から来る値を検索条件に使う前に通す
 * （手で書き換えられた値を空に落とす。MarketHolidayListView の isMarketHolidayType と同じ用途）。
 */
function memberOf(options) {
  return (value) => options.some((option) => option.value === value)
}

export const isActivityActor = memberOf(ACTIVITY_ACTOR_OPTIONS)
export const isActivityCategory = memberOf(ACTIVITY_CATEGORY_OPTIONS)
export const isActivityFeature = memberOf(ACTIVITY_FEATURE_OPTIONS)
export const isActivityAction = memberOf(ACTIVITY_ACTION_OPTIONS)
export const isActivityActorGroup = memberOf(ACTIVITY_ACTOR_GROUP_OPTIONS)
export const isActivityResult = memberOf(ACTIVITY_RESULT_OPTIONS)

/**
 * 操作区分に対応する BaseBadge の variant。
 * 色はモックの `.activity-kind.business`（青） / `.master`（緑） / `.operation`（灰）に対応する。
 *
 * @param {string} category 操作区分
 * @returns {string} BaseBadge の variant
 */
export function categoryBadgeVariant(category) {
  if (category === '業務操作') return 'info'
  if (category === 'マスタ更新') return 'success'
  return 'gray'
}

/**
 * 結果に対応する BaseBadge の variant。
 * 成功は緑、失敗は赤。赤は売買区分の `buy` ではなく `error` を使う（意味が違う）。
 *
 * @param {string} result 結果
 * @returns {string} BaseBadge の variant
 */
export function resultBadgeVariant(result) {
  return result === '失敗' ? 'error' : 'success'
}

const activityAt = new Intl.DateTimeFormat('ja-JP', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * 操作日時を一覧の表示形（`09/16 10:35:00`）に整形する。
 *
 * モックは行によって秒の有無が揺れている（注文の行は `09/16 10:35:00`、マスタ更新の行は
 * `08/27 09:10`）が、同じ列で桁数が変わると読みにくいので常に秒まで出す。
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
