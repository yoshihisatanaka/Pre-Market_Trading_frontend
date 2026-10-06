import { CALCULATION_DEPOSIT_OPTIONS } from './calculationOptions'
import { SIDE } from './orderEntryOptions'

/*
 * 仮計算（顧客詳細の仮計算タブ /customers/:customerId/calculations）へ銘柄・売買・預り区分を引き継ぐ URL クエリ。
 * 外株預り・預り検索の行の「仮計算」が組み立て、仮計算の画面（views/CustomerCalculationView.vue）が読んで
 * 入力欄の初期値にする。顧客はパスの customerId で指すので、クエリには載せない。
 *
 * クエリ名は URL 上の契約で、バックエンドには送らない。
 *   symbol           … 銘柄コード／ティッカー（ティッカーが無い銘柄は銘柄コード）
 *   side             … 'buy' / 'sell'（新規注文の引き継ぎ utils/orderEntryQuery.js と同じ名前）
 *   specific_deposit … 特定預り区分のコード（'1' 特定 / '0' 一般 / '6' 成長投資枠）。預りの明細と同じ向きで、
 *                      新規注文の deposit（預り売買区分。0 / 1 が逆）とは別物なので名前を分ける
 *
 * 引き継ぐのは入力欄の初期値だけ。数量は渡さない（新規注文と同じく、`GET /holdings` は売却可能数量を返さない）。
 * 読めない値（手で書き換えられた URL）は空に落とし、入力欄は既定のままにする。
 */

const SIDES_BY_NAME = Object.freeze({ buy: SIDE.BUY, sell: SIDE.SELL })
const SIDE_NAMES = Object.freeze({ [SIDE.BUY]: 'buy', [SIDE.SELL]: 'sell' })
const DEPOSIT_VALUES = CALCULATION_DEPOSIT_OPTIONS.map((option) => option.value)

/**
 * 引き継ぐ値 → URL クエリ。空の値と仮計算で選べない預り区分はクエリに載せない。
 *
 * @param {{ symbol?: string, side?: string, specificDeposit?: string }} [values]
 *   side は売買区分のコード（SIDE の値）、specificDeposit は特定預り区分のコード
 * @returns {Record<string, string>}
 */
export function buildCalculationQuery({ symbol = '', side = '', specificDeposit = '' } = {}) {
  const entries = [
    ['symbol', symbol],
    ['side', SIDE_NAMES[side] ?? ''],
    ['specific_deposit', DEPOSIT_VALUES.includes(specificDeposit) ? specificDeposit : ''],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value))
}

/**
 * 預りの 1 明細から「仮計算」の引き継ぎを組み立てる。売却の概算として、売りと明細の預り区分を渡す（モックと同じ）。
 *
 * @param {{ ticker: string, symbolCode: string, specificDeposit: string }} holding src/api/holdings.js の Holding
 * @returns {Record<string, string>} buildCalculationQuery の結果
 */
export function holdingCalculationQuery(holding) {
  return buildCalculationQuery({
    symbol: holding.ticker || holding.symbolCode,
    side: SIDE.SELL,
    specificDeposit: holding.specificDeposit,
  })
}

/**
 * URL クエリ → 入力欄の初期値。読めない値は ''。
 *
 * @param {Record<string, unknown>} query vue-router の route.query
 * @returns {{ symbol: string, side: string, specificDeposit: string }} side は売買区分のコード（SIDE の値）
 */
export function parseCalculationQuery(query = {}) {
  const text = (name) => (typeof query[name] === 'string' ? query[name].trim() : '')
  const specificDeposit = text('specific_deposit')

  return {
    symbol: text('symbol').toUpperCase(),
    side: SIDES_BY_NAME[text('side')] ?? '',
    specificDeposit: DEPOSIT_VALUES.includes(specificDeposit) ? specificDeposit : '',
  }
}
