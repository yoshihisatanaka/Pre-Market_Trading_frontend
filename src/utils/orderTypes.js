/**
 * 注文の区分（発注範囲・処理状況）のコードと名前（純関数と定数）。
 *
 * 名前は OpenAPI に載っていないため、バックエンドのコードマスタ（app/config/codes.json の
 * 「発注範囲」「処理状況」）から写した。一覧のセルと注文詳細の表示に使う写しで、入力欄の選択肢は
 * コードマスタ（GET /codes。stores/codes.js）から引く。
 * **コードを増やすときは両方を突き合わせる。** 発注範囲のコードの集合が
 * src/utils/apiEnums.js の EXECUTION_SCOPE_VALUES と一致することは spec が固定する。
 *
 * 一覧（GET /orders）はサーバが出来状況の表示名（表示状況名）を付けて返すので、処理状況の
 * 名前を使うのは、その名前が来ない注文詳細（GET /orders/{order_id}）を読む画面だけ。
 *
 * 数値ではなく文字列で扱うのは、実 API の値がゼロ埋めされた文字列であることに合わせるため。
 */
import { formatUsdUnit } from '@/utils/format'

/** 発注範囲（画面の「市場区分」）の選択肢。BaseSelect の options にそのまま渡せる形（コード順） */
export const MARKET_SCOPE_OPTIONS = [
  // '01'（プレ）と '05'（レギュラー＋アフター）は 2026-10-02 の取り込みで enum から外れた
  { value: '02', label: 'プレ＋レギュラー' },
  { value: '03', label: 'レギュラー' },
  { value: '04', label: 'プレ＋レギュラー＋アフター' },
  { value: '06', label: 'アフター' },
]

/*
 * 訂正画面の市場区分のボタン（BaseSegmentedControl の options）。表示名はコードマスタ `発注範囲` から引き
 * （views/OrderAmendView.vue）、ここは並びと注記・押せるかだけを持つ。並びは画面モック
 * （order_amend.html）のとおり。フェーズ 1 で受け付けるのは 02 / 03 だけで、アフターを含む 04 / 06 は
 * 「Ph.2予定」を添えて**見せるが押せない**（業務回答 2026-10-08。docs/api/requests.md #50 ②。
 * 新規注文の注文区分と同じ扱い）。フェーズ 2 でアフターに対応したら disabled と note を外す。
 */
const PHASE2_NOTE = '（Ph.2予定）'

export const AMEND_MARKET_SCOPE_CODES = ['02', '03', '04', '06']

/** utils/orderEntryOptions.js の decorateOptions に渡す */
export const AMEND_MARKET_SCOPE_EXTRAS = Object.freeze({
  '04': { note: PHASE2_NOTE, disabled: true },
  '06': { note: PHASE2_NOTE, disabled: true },
})

/*
 * 処理状況の名前。コードマスタの並び（000 から順に、失敗・訂正系が後ろ）のまま写してある。
 * object で書くと '000' のようなキーの並びは保たれる（整数に見えるキーではないため）。
 */
const ORDER_STATUS_NAMES = {
  '000': '未発注',
  '002': 'IB発注中',
  '003': '注文中',
  '004': 'VWAP集計済み',
  '010': '一部出来',
  '011': '全部出来',
  '020': '不出来',
  '030': '未取消',
  '031': 'IB取消中',
  '032': 'IB取消済',
  '033': 'Dream取消中',
  '034': '取消済',
  101: 'Dream発注失敗',
  103: 'IB発注失敗',
  '040': '訂正待ち',
  131: 'IB取消失敗',
  133: 'Dream取消失敗',
  141: '訂正中断',
}

/**
 * 発注範囲のコードを名前に変換する。
 *
 * @param {string} value 発注範囲コード（'01' など）
 * @returns {string} 名前。知らないコードはコードのまま返し（黙って消さない）、空値は '—'
 */
export function marketScopeLabel(value) {
  if (!value) return '—'
  return MARKET_SCOPE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

/**
 * 注文の価格を 1 語で出す。成行は「成行」、指値は「指値 410.00 ドル」。
 *
 * @param {string} orderType 指成区分（'LO' / 'MO'）
 * @param {number|null} limitPrice 指値単価（USD）
 * @returns {string} 知らない指成区分は '—'
 */
export function orderPriceLabel(orderType, limitPrice) {
  if (orderType === 'MO') return '成行'
  if (orderType === 'LO') return `指値 ${formatUsdUnit(limitPrice)}`
  return '—'
}

/**
 * 処理状況のコードを名前に変換する。
 *
 * @param {string} value 処理状況コード（'003' など）
 * @returns {string} 名前。知らないコードはコードのまま返し、空値は '—'
 */
export function orderStatusLabel(value) {
  if (!value) return '—'
  return ORDER_STATUS_NAMES[value] ?? value
}
