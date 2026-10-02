import { SPECIFIC_DEPOSIT } from './apiEnums'
import { DEPOSIT_CATEGORY, SIDE } from './orderEntryOptions'

/*
 * 新規注文（/orders/new）へ顧客・銘柄を引き継ぐ URL クエリ。
 * 顧客詳細（タブの「注文入力」・「新規注文」・預りの「買い」「売り」）が組み立て、
 * 新規注文の画面（views/OrderEntryView.vue）が読んで入力欄の初期値にする。
 *
 * クエリ名は URL 上の契約で、バックエンドには送らない（送るのは src/api/orderEntry.js）。
 *   branch_code    … 部店コード
 *   account_number … 口座番号（数字だけ）
 *   ticker         … ティッカー（大文字）
 *   side           … 'buy' / 'sell'（注文の売買区分のコードではなく向きの名前で持つ。URL を読んで分かるように）
 *   deposit        … 預り区分（注文の 預り売買区分 のコード。'0' 特定 / '1' 一般 / '6' 成長投資枠）
 *
 * 引き継ぐのは入力欄の初期値だけ。数量は渡さない（モックは売りのとき売却可能数量を入れるが、
 * `GET /holdings` は売却可能数量を返さず、保有数量を入れると注文中の売りと二重になる）。
 * 読めない値（手で書き換えられた URL）は空に落とし、入力欄は既定のままにする。
 */

const SIDES_BY_NAME = Object.freeze({ buy: SIDE.BUY, sell: SIDE.SELL })
const SIDE_NAMES = Object.freeze({ [SIDE.BUY]: 'buy', [SIDE.SELL]: 'sell' })
const DEPOSIT_VALUES = Object.values(DEPOSIT_CATEGORY)

/**
 * 預りの特定預り区分 → 注文の預り売買区分。向きが逆なので読み替える
 * （src/api/holdings.js の冒頭。0 / 1 の向きは docs/api/requests.md #24 で確認中）。
 * NISA（旧）・継続管理勘定は注文の預り区分に対応する値が無いので ''（既定のまま）。
 *
 * @param {string} specificDeposit Holding の specificDeposit
 * @returns {string} DEPOSIT_CATEGORY の値か ''
 */
export function toDepositCategory(specificDeposit) {
  switch (specificDeposit) {
    case SPECIFIC_DEPOSIT.SPECIFIC:
      return DEPOSIT_CATEGORY.SPECIFIC
    case SPECIFIC_DEPOSIT.NON_SPECIFIC:
      return DEPOSIT_CATEGORY.GENERAL
    case SPECIFIC_DEPOSIT.GROWTH_QUOTA:
      return DEPOSIT_CATEGORY.GROWTH
    default:
      return ''
  }
}

/**
 * 引き継ぐ値 → URL クエリ。空の値はクエリに載せない。
 *
 * @param {{
 *   branchCode?: string,
 *   accountNumber?: string,
 *   ticker?: string,
 *   side?: string,
 *   depositCategory?: string,
 * }} [values] side は売買区分のコード（SIDE の値）
 * @returns {Record<string, string>}
 */
export function buildOrderEntryQuery({
  branchCode = '',
  accountNumber = '',
  ticker = '',
  side = '',
  depositCategory = '',
} = {}) {
  const entries = [
    ['branch_code', branchCode],
    ['account_number', accountNumber],
    ['ticker', ticker],
    ['side', SIDE_NAMES[side] ?? ''],
    ['deposit', depositCategory],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value))
}

/**
 * 預りの 1 明細から「買い」「売り」の引き継ぎを組み立てる。
 *
 * 成長投資枠の明細の「買い」は預り区分を引き継がない（買付に成長投資枠は選べない。
 * utils/orderEntryForm.js の growthOnBuy）。特定で始め、変えるかは入力する人が決める。
 *
 * @param {{ branchCode: string, accountNumber: string }} customer
 * @param {{ ticker: string, symbolCode: string, specificDeposit: string }} holding src/api/holdings.js の Holding
 * @param {string} side SIDE.BUY / SIDE.SELL
 * @returns {Record<string, string>} buildOrderEntryQuery の結果
 */
export function holdingOrderQuery(customer, holding, side) {
  const depositCategory = toDepositCategory(holding.specificDeposit)
  return buildOrderEntryQuery({
    branchCode: customer.branchCode,
    accountNumber: customer.accountNumber,
    // 新規注文の銘柄欄はティッカーで引く。ティッカーが無い銘柄は銘柄欄を空のまま渡す
    ticker: holding.ticker,
    side,
    depositCategory:
      side === SIDE.BUY && depositCategory === DEPOSIT_CATEGORY.GROWTH ? '' : depositCategory,
  })
}

/**
 * URL クエリ → 入力欄の初期値。読めない値は ''。
 *
 * @param {Record<string, unknown>} query vue-router の route.query
 * @returns {{
 *   branchCode: string,
 *   accountNumber: string,
 *   ticker: string,
 *   side: string,
 *   depositCategory: string,
 * }} side は売買区分のコード（SIDE の値）
 */
export function parseOrderEntryQuery(query = {}) {
  const text = (name) => (typeof query[name] === 'string' ? query[name].trim() : '')
  const accountNumber = text('account_number')
  const deposit = text('deposit')

  return {
    branchCode: text('branch_code'),
    accountNumber: /^\d+$/.test(accountNumber) ? accountNumber : '',
    ticker: text('ticker').toUpperCase(),
    side: SIDES_BY_NAME[text('side')] ?? '',
    depositCategory: DEPOSIT_VALUES.includes(deposit) ? deposit : '',
  }
}
