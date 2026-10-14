import { CALCULATION_DEPOSIT_CODES } from './calculationOptions'
import { SIDE } from './orderEntryOptions'

/*
 * 仮計算（顧客詳細の仮計算タブ /customers/:customerId/calculations）へ銘柄・売買・預り区分・数量・単価を引き継ぐ URL クエリ。
 * 外株預り・預り検索の行の「仮計算」が組み立て、仮計算の画面（views/CustomerCalculationView.vue）が読んで
 * 入力欄の初期値にする。顧客はパスの customerId で指すので、クエリには載せない。
 *
 * クエリ名は URL 上の契約で、バックエンドには送らない。
 *   symbol           … 銘柄コード／ティッカー（ティッカーが無い銘柄は銘柄コード）
 *   side             … 'buy' / 'sell'（新規注文の引き継ぎ utils/orderEntryQuery.js と同じ名前）
 *   specific_deposit … 特定預り区分のコード（'1' 特定 / '0' 一般 / '6' 成長投資枠）。預りの明細と同じ向きで、
 *                      新規注文の deposit（預り売買区分。0 / 1 が逆）とは別物なので名前を分ける
 *   quantity         … 数量の初期値（1 株以上・9 桁以内の整数）。預りから売りで入るときの売却可能数量
 *   unit_price       … 単価（USD）の初期値（0 より大きい数。整数 7 桁・小数 8 桁以内）。預りの現在値（前日終値）
 *
 * 数量・単価の初期値はモックの calculations.py（_default_input）と同じ:
 *   単価は預りの現在値、数量は預りから「売り」で入ったときだけ売却可能数量。
 *   預りに値が無ければ載せず、仮計算の画面が銘柄マスタの前日終値で補う（単価）か空のままにする（数量）。
 * 為替はクエリに載せない（為替マスタの現在レートを画面側で引く）。
 * 読めない値（手で書き換えられた URL）は空に落とし、入力欄は既定のままにする。
 */

const SIDES_BY_NAME = Object.freeze({ buy: SIDE.BUY, sell: SIDE.SELL })
const SIDE_NAMES = Object.freeze({ [SIDE.BUY]: 'buy', [SIDE.SELL]: 'sell' })
const DEPOSIT_VALUES = CALCULATION_DEPOSIT_CODES

/** 数量の形（utils/calculationForm.js の検証と同じ。1 株以上・9 桁以内の整数） */
const QUANTITY_PATTERN = /^\d{1,9}$/
/** 単価の形（同じく整数 7 桁・小数 8 桁以内） */
const UNIT_PRICE_PATTERN = /^\d{1,7}(\.\d{1,8})?$/

/** 数量として載せられる文字列。それ以外は '' */
function quantityText(value) {
  const text = value === null || value === undefined ? '' : String(value).trim()
  return QUANTITY_PATTERN.test(text) && Number(text) >= 1 ? text : ''
}

/** 単価として載せられる文字列。それ以外は '' */
function unitPriceText(value) {
  const text = value === null || value === undefined ? '' : String(value).trim()
  return UNIT_PRICE_PATTERN.test(text) && Number(text) > 0 ? text : ''
}

/**
 * 引き継ぐ値 → URL クエリ。空の値と仮計算で選べない預り区分、形の合わない数量・単価はクエリに載せない。
 *
 * @param {{ symbol?: string, side?: string, specificDeposit?: string,
 *   quantity?: number|string|null, unitPrice?: number|string|null }} [values]
 *   side は売買区分のコード（SIDE の値）、specificDeposit は特定預り区分のコード。
 *   quantity / unitPrice は数値でも文字列でもよい（String() で載せる）
 * @returns {Record<string, string>}
 */
export function buildCalculationQuery({
  symbol = '',
  side = '',
  specificDeposit = '',
  quantity = null,
  unitPrice = null,
} = {}) {
  const entries = [
    ['symbol', symbol],
    ['side', SIDE_NAMES[side] ?? ''],
    ['specific_deposit', DEPOSIT_VALUES.includes(specificDeposit) ? specificDeposit : ''],
    ['quantity', quantityText(quantity)],
    ['unit_price', unitPriceText(unitPrice)],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value))
}

/**
 * 預りの 1 明細から「仮計算」の引き継ぎを組み立てる。売却の概算として、売りと明細の預り区分を渡す（モックと同じ）。
 * 数量は売却可能数量、単価は明細の現在値（前日終値）。どちらも値が無ければ載せない。
 *
 * @param {{ ticker: string, symbolCode: string, specificDeposit: string,
 *   sellableQuantity?: number|null, referencePrice?: number|null }} holding src/api/holdings.js の Holding
 * @returns {Record<string, string>} buildCalculationQuery の結果
 */
export function holdingCalculationQuery(holding) {
  return buildCalculationQuery({
    symbol: holding.ticker || holding.symbolCode,
    side: SIDE.SELL,
    specificDeposit: holding.specificDeposit,
    quantity: holding.sellableQuantity ?? null,
    unitPrice: holding.referencePrice ?? null,
  })
}

/**
 * URL クエリ → 入力欄の初期値。読めない値は ''。
 *
 * @param {Record<string, unknown>} query vue-router の route.query
 * @returns {{ symbol: string, side: string, specificDeposit: string, quantity: string, unitPrice: string }}
 *   side は売買区分のコード（SIDE の値）。quantity / unitPrice は入力欄にそのまま入れる文字列
 */
export function parseCalculationQuery(query = {}) {
  const text = (name) => (typeof query[name] === 'string' ? query[name].trim() : '')
  const specificDeposit = text('specific_deposit')

  return {
    symbol: text('symbol').toUpperCase(),
    side: SIDES_BY_NAME[text('side')] ?? '',
    specificDeposit: DEPOSIT_VALUES.includes(specificDeposit) ? specificDeposit : '',
    quantity: quantityText(text('quantity')),
    unitPrice: unitPriceText(text('unit_price')),
  }
}
