/**
 * CA種別（コーポレートアクションの種別。純関数と定数）。
 *
 * バックエンドの `m_CA.CA種別` は varchar(3) のコード値で、
 * docs/api/openapi.json の CATypeEnum（string の enum）と同じ 12 種をここに持つ。
 * 表示名は OpenAPI に載っていないため、バックエンドの対応表（app/config/codes.json の「CA種別」）
 * から写した。**コードを増やすときは両方を突き合わせる**（enum だけ増えても名前は出ない）。
 * ここは値と名前が並んで読めることを優先して値を直に書く。コードの集合が
 * src/utils/apiEnums.js の CA_TYPE_VALUES と一致することは CAT-01 が固定する。
 *
 * 実 API は表示名も `CA種別名` として返すが、検索セレクトの選択肢はデータが 1 件も無くても
 * 出せる必要があるので、対応表はフロントにも持つ（海外休場区分と同じ考えかた）。
 * 一覧セルは実 API の `CA種別名` を優先し、欠けているときだけここで補う。
 *
 * 数値ではなく文字列で扱うのは、実 API の値がゼロ埋めされた文字列であることに合わせるため。
 *
 * @see src/utils/marketHolidayTypes.js 同じ形をした海外休場区分
 */

/** 選択肢。BaseSelect の options にそのまま渡せる形にしておく（並びはコード順） */
export const CA_TYPE_OPTIONS = [
  { value: '110', label: '現金配当' },
  { value: '112', label: '株式配当' },
  { value: '120', label: '株式分割' },
  { value: '121', label: '無償増資' },
  { value: '122', label: '有償増資' },
  { value: '123', label: '子会社割当' },
  { value: '125', label: 'ワラント割当' },
  { value: '130', label: '会社清算交付金' },
  { value: '131', label: '合併交付金' },
  { value: '140', label: '株式併合' },
  { value: '142', label: '合併交付株' },
  { value: '220', label: '通常償還' },
]

/**
 * CA種別コードを表示名に変換する。
 *
 * @param {string} value CA種別コード（'110' など）
 * @returns {string} 表示名。未知の値・空値・未設定は '—'（他の列の空値表現とそろえる）
 */
export function formatCaType(value) {
  const option = CA_TYPE_OPTIONS.find((candidate) => candidate.value === value)
  return option ? option.label : '—'
}

/**
 * CA種別コードとして受け付けられる値かを判定する。
 * URL クエリのような外から来る値を検索条件に使う前に通す。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCaType(value) {
  return CA_TYPE_OPTIONS.some((candidate) => candidate.value === value)
}
