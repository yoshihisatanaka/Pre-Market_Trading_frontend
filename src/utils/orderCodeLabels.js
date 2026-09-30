import { formatUsdUnit } from './format'

/*
 * 注文の区分コード → 画面に出す名前。CSV一括注文のプレビューと受付完了の表が使う。
 *
 * コードの体系は openapi.json の *Enum（値の写しは utils/apiEnums.js）だが、**名前は仕様に無い**。
 * 名前はバックエンドのコードマスタ（app/config/codes.json）にあり、`GET /orders/csv-spec` の
 * allowed_values が同じものを返す。ここはその写しで、src/mocks/fixtures/orderCsv.js の
 * allowed_values と一致することを単体テストが確かめる（どちらかだけ直すとテストが落ちる）。
 *
 * 売買（買 / 売）はアプリ内の向き（'buy' / 'sell'）で引く。コードではない。
 */

/** 売買の向き（src/api/ が SideEnum から直したもの）→ 名前 */
export const SIDE_LABELS = Object.freeze({ buy: '買', sell: '売' })

/** 指成区分（OrderTypeEnum） */
export const ORDER_TYPE_LABELS = Object.freeze({ LO: '指値', MO: '成行' })

/** 決済通貨区分（SettlementCurrencyEnum） */
export const SETTLEMENT_CURRENCY_LABELS = Object.freeze({ 0: '円決', 1: '外決' })

/** 預り売買区分（DepositCategoryEnum） */
export const DEPOSIT_CATEGORY_LABELS = Object.freeze({
  0: '特定',
  1: '非特定',
  4: 'NISA',
  6: '成長投資枠',
  8: '継続管理勘定',
})

/** 取引（TransactionTypeEnum） */
export const TRANSACTION_TYPE_LABELS = Object.freeze({ 100: '委託', 300: '店頭', 900: '募集' })

/**
 * 発注範囲（ExecutionScopeEnum）。画面の列名は「市場区分」。
 * キーが '01' のように 0 で始まるので、整数キーとして並べ替えられないよう引用符で書く。
 */
export const EXECUTION_SCOPE_LABELS = Object.freeze({
  '01': 'プレ',
  '02': 'プレ＋レギュラー',
  '03': 'レギュラー',
  '04': 'プレ＋レギュラー＋アフター',
  '05': 'レギュラー＋アフター',
  '06': 'アフター',
})

/**
 * コードを名前にする。表に無いコードはそのまま返す（CSV に書かれた値を隠さない）。空なら '—'。
 *
 * @param {Readonly<Record<string, string>>} labels 上の表のどれか
 * @param {string} code 区分コード
 */
export function codeLabel(labels, code) {
  if (!code) return '—'
  return Object.hasOwn(labels, code) ? labels[code] : code
}

/**
 * 価格の欄。成行は「成行」、指値は「指値 150.00 ドル」（画面モックの `指値 x`）。
 * 指成区分が読めなければ '—'。
 *
 * @param {{ orderType: string, limitPrice: number|null }} order
 */
export function orderPriceLabel(order) {
  if (order.orderType === 'MO') return ORDER_TYPE_LABELS.MO
  if (order.orderType === 'LO') return `${ORDER_TYPE_LABELS.LO} ${formatUsdUnit(order.limitPrice)}`
  return '—'
}
