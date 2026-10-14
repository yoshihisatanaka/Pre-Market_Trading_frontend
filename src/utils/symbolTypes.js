/**
 * 銘柄マスタの区分（純関数と定数）。
 *
 * `規制情報`（取引可否）・`注文ルート`（預託先区分）・`VWAP対象区分` の 3 つを持つ。
 * 実 API は表示名も `規制情報名` / `注文ルート名` / `VWAP対象区分名` として返す。一覧セルは実 API の名称を
 * 優先し、欠けているときだけ補う。
 *
 * 規制情報と預託先区分は、選べる値と名称の取得先がコードマスタに無い（docs/api/requests.md #69 / #70）ので
 * 対応表をここに持つ。VWAP対象区分は名称をコードマスタ `VWAP対象区分` から引き、ここは並びだけを持つ。
 *
 * 値は数値ではなく文字列で扱う。実 API の値がゼロ埋めされた文字列であることに合わせるため。
 *
 * **注意: `規制情報` のコード値は未確定。** docs/api/openapi.json の SymbolItem は
 * 「取引可否・規制情報コード」とだけ書いてあり enum が無い（注文ルートと VWAP対象区分は
 * description に 0 / 1 の意味が書かれている）。ここの 0:取引可 / 1:取引不可 は
 * 画面モックの「取引可 / 取引不可」に合わせた**仮置き**で、バックエンドの対応表
 * （`GET /codes` か app/config/codes.json）が確認できたらこの定数だけ差し替える。
 */

/** 取引可否（規制情報）。値は仮置き（上のコメント参照） */
export const REGULATION_OPTIONS = [
  { value: '0', label: '取引可' },
  { value: '1', label: '取引不可' },
]

/*
 * 預託先区分と VWAP対象区分の**並びはコード順ではなく画面モックの順**（IB → みずほ / 対象 → 非対象）。
 * docs/api/requests.md #42 の回答で、この順に固定すると決まった（`GET /codes` の形は変わらない）。
 * 新規追加の初期値は各定数の先頭（IB / 対象）で、並びを変えると初期値も一緒に変わる
 * （src/views/SymbolListView.vue の emptyForm）。
 */

/** 預託先区分（注文ルート）。SymbolItem.注文ルート の description（0:みずほ, 1:IB）に準拠 */
export const ORDER_ROUTE_OPTIONS = [
  { value: '1', label: 'IB証券' },
  { value: '0', label: 'みずほ証券' },
]

/**
 * VWAP対象区分のコードの並び（対象 → 非対象）。先頭が新規追加の初期値。
 * **表示名はコードマスタ `VWAP対象区分` から引く**（views/SymbolListView.vue / components/symbol/SymbolFormFields.vue）。
 * 画面モックの文言は「対象外」だが、コードマスタの名称（非対象）を正とする（docs/api/requests.md の #69 の節）。
 */
export const VWAP_TARGET_CODES = ['1', '0']

/**
 * 取引可否（規制情報）コードを表示名に変換する。
 *
 * @param {string} value 規制情報コード（'0' / '1'）
 * @returns {string} 表示名。未知の値・空値・未設定は '—'（他の列の空値表現とそろえる）
 */
export function formatRegulation(value) {
  return labelOf(REGULATION_OPTIONS, value)
}

/**
 * 預託先区分（注文ルート）コードを表示名に変換する。
 *
 * @param {string} value 注文ルートコード（'0' / '1'）
 * @returns {string} 表示名。未知の値・空値・未設定は '—'
 */
export function formatOrderRoute(value) {
  return labelOf(ORDER_ROUTE_OPTIONS, value)
}

/**
 * 取引可否（規制情報）コードとして受け付けられる値かを判定する。
 * URL クエリのような外から来る値を検索条件に使う前に通す。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRegulation(value) {
  return hasValue(REGULATION_OPTIONS, value)
}

/**
 * 預託先区分（注文ルート）コードとして受け付けられる値かを判定する。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isOrderRoute(value) {
  return hasValue(ORDER_ROUTE_OPTIONS, value)
}

function labelOf(options, value) {
  const option = options.find((candidate) => candidate.value === value)
  return option ? option.label : '—'
}

function hasValue(options, value) {
  return options.some((candidate) => candidate.value === value)
}
