import { formatJpyUnit, formatQuantity, formatUsdUnit } from './format'
import {
  CASH_DELIVERY_OPTIONS,
  DEPOSIT_CATEGORY,
  DEPOSIT_CATEGORY_OPTIONS,
  EXECUTION_SCOPE_OPTIONS,
  FUND_NATURE_OPTIONS,
  ORDER_CHANNEL_OPTIONS,
  ORDER_FORM_DEFAULTS,
  ORDER_METHOD_OPTIONS,
  ORDER_TYPE,
  optionLabel,
  ORDER_PERSON_MAX_LENGTH,
  SECURITIES_DELIVERY_DEFAULT,
  SETTLEMENT_CURRENCY_OPTIONS,
  SIDE,
  SIDE_SHORT_LABELS,
  SOLICITATION_OPTIONS,
  TRANSACTION_TYPE_CONSIGNMENT,
  VWAP,
  VWAP_OPTIONS,
} from './orderEntryOptions'

/*
 * 新規注文（外株注文入力）のフォームの純関数。入力値の整形・画面での検証・送る値の組み立て・
 * 期間指定の選択肢・概算金額をここに置き、画面（views/OrderEntryView.vue）は状態だけを持つ。
 *
 * 検証の文言はモックリポジトリの validators/order_validator.py の原文。画面で止められるもの
 * （必須・形式・画面の組み合わせ）だけをここで見て、残り（銘柄の売買規制・残高・余力・
 * 受注不可日・CA 日など）は POST /orders/validate に任せる。
 *
 * 日付はすべて端末のローカル日付で扱う（営業店の端末は日本時間）。アプリ内の日付は 'YYYY-MM-DD'、
 * 時刻は 'HH:MM'。API の YYYYMMDD への変換は src/api/orderEntry.js が行う。
 */

/** 期間指定の選択肢の数。当日中 + 14 営業日（モックの「有効期限は営業日ベースで14日間まで」） */
export const EXPIRY_OPTION_COUNT = 15

/**
 * 期間指定を作るために先読みする日数。受注不可日・休場日もこの範囲で取る。
 * 15 営業日は土日だけなら 3 週間で足りる。休日が続いても欠けないよう余裕を持たせる。
 */
export const CALENDAR_LOOKAHEAD_DAYS = 45

/** 受注日に入れられる過去の日数（モック「受注日が7日間以前の注文は入力できません。」） */
const ORDER_DATE_MAX_PAST_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

const MESSAGES = {
  branchRequired: '部店コードを入力してください。',
  accountRequired: '口座番号を入力してください。',
  accountNumeric: '口座番号を数値で入力してください。',
  // 欄はティッカーでも銘柄コードでも引けるが、文言はモック（order_validator.py）と同じく「ティッカー」と呼ぶ
  tickerRequired: 'ティッカーを入力してください。',
  tickerNotFound: 'ティッカーが見つかりません。取扱銘柄を確認してください。',
  tickerLookupFailed: 'ティッカーを照会できませんでした。時間をおいて再度お試しください。',
  sideRequired: '売買区分を選択してください。',
  quantityRequired: '注文数量を入力してください。',
  quantityInteger: '注文数量を整数で入力してください。',
  limitPriceRequired: '指値価格を入力してください。',
  limitPriceNumeric: '指値を正しい数値で入力してください。',
  limitPricePositive: '指値価格は0より大きい数値を入力してください。',
  limitPriceScale: '指値には、「小数点第４位以内」で入力してください。',
  expiryRequired: '期間指定を選択してください。',
  growthOnBuy: '買付時に「成長投資枠」を選択することはできません。',
  vwapNotTarget: 'この銘柄は現在、VWAP対象外です。通常注文で入力してください。',
  orderDateFormat: '受注日は数値4桁（mmdd）で入力してください。',
  orderDateInvalid: '受注日の日付が不正です。',
  orderDateFuture: '受注日に未到来日を設定することはできません。',
  orderDateTooOld: '受注日が7日間以前の注文は入力できません。',
  orderTimeFormat: '受注時刻は数値4桁（hhnn）で入力してください。',
  orderPersonRequired: '受注者を入力してください。',
  orderPersonTooLong: `受注者は${ORDER_PERSON_MAX_LENGTH}文字以内で入力してください。`,
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Date → 'YYYY-MM-DD'（ローカル日付） */
export function toIsoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 時刻を落とした日付（ローカルの 0 時） */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** 日付に日数を足す（時刻は落とす） */
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** from から to までの日数（どちらも 0 時の Date） */
function daysBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

/**
 * 入力画面の初期値。
 *
 * 受注日・受注時刻は開いた時点の日時、受注者はログイン中の社員コード（モックの初期表示）。
 * 期間指定は選択肢が決まってから画面が先頭（当日中）を入れるので、ここでは空。
 *
 * @param {{
 *   now?: Date, orderPerson?: string, branchCode?: string, accountNumber?: string,
 *   ticker?: string, side?: string, depositCategory?: string, quantity?: string,
 * }} [options]
 *   branchCode / accountNumber は「同じ顧客で新規注文」で引き継ぐときに渡す。
 *   ticker / side / depositCategory / quantity は顧客詳細・預り検索の預りの「買い」「売り」から
 *   引き継ぐときに渡す（utils/orderEntryQuery.js の parseOrderEntryQuery の結果。quantity は売りの
 *   売却可能株数）。空なら既定のまま
 */
export function createOrderForm({
  now = new Date(),
  orderPerson = '',
  branchCode = '',
  accountNumber = '',
  ticker = '',
  side = '',
  depositCategory = '',
  quantity = '',
} = {}) {
  return {
    branchCode,
    accountNumber,
    ticker,
    // 売買区分は既定を持たない（モックも未選択から始まる。押し間違いを防ぐため）
    side,
    // 入力欄と同じ 3 桁区切りにする
    quantity: formatQuantityInput(quantity),
    limitPrice: '',
    expiryDate: '',
    orderDate: `${pad2(now.getMonth() + 1)}/${pad2(now.getDate())}`,
    orderTime: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    orderPerson,
    forced: false,
    ...ORDER_FORM_DEFAULTS,
    // 引き継いだ預り区分は既定より優先する
    ...(depositCategory ? { depositCategory } : {}),
  }
}

/** 全角の数字を半角にする（IME が有効なまま数字を打つ運用が多い） */
function toHalfWidthDigits(value) {
  return String(value ?? '').replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  )
}

/**
 * 注文数量の入力を整形する（全角数字は半角にし、数字以外を落とし、3 桁ごとにカンマを入れる）。
 * 先頭の 0 は落とす（'007' → '7'）。0 だけは残し、検証で弾く。
 */
export function formatQuantityInput(value) {
  const digits = toHalfWidthDigits(value)
    .replace(/[^0-9]/g, '')
    .replace(/^0+(?=\d)/, '')
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 受注日の入力を 'MM/DD' に整形する（数字 4 桁まで。3 桁目の前に / を入れる） */
export function formatOrderDateInput(value) {
  return withSeparator(value, '/')
}

/** 受注時刻の入力を 'HH:MM' に整形する */
export function formatOrderTimeInput(value) {
  return withSeparator(value, ':')
}

function withSeparator(value, separator) {
  const digits = toHalfWidthDigits(value)
    .replace(/[^0-9]/g, '')
    .slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}${separator}${digits.slice(2)}` : digits
}

/**
 * 注文数量の入力（カンマ入り）を数値にする。
 *
 * @returns {number|null} 正の整数でなければ null
 */
export function parseQuantity(value) {
  const text = String(value ?? '').replace(/,/g, '')
  if (!/^\d+$/.test(text)) return null
  const quantity = Number(text)
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null
}

/**
 * 受注日の入力（'MM/DD'）を日付にする。
 *
 * 年は入力に無いので今年とみなす。ただし年をまたいだ直後（1/2 に 12/30 を入れる）は
 * 今年だと未来日になるので、前年として 7 日以内に収まるならそちらを採る。
 *
 * @param {string} text 'MM/DD'
 * @param {Date} today
 * @returns {{ date: string } | { error: string }} date は 'YYYY-MM-DD'
 */
export function resolveOrderDate(text, today) {
  const match = /^(\d{2})\/(\d{2})$/.exec(text ?? '')
  if (!match) return { error: MESSAGES.orderDateFormat }

  const month = Number(match[1])
  const day = Number(match[2])
  const base = startOfDay(today)
  const inYear = (year) => {
    const date = new Date(year, month - 1, day)
    return date.getMonth() === month - 1 && date.getDate() === day ? date : null
  }

  let date = inYear(base.getFullYear())
  if (!date) return { error: MESSAGES.orderDateInvalid }

  if (date > base) {
    const previous = inYear(base.getFullYear() - 1)
    if (!previous || daysBetween(previous, base) > ORDER_DATE_MAX_PAST_DAYS) {
      return { error: MESSAGES.orderDateFuture }
    }
    date = previous
  }
  if (daysBetween(date, base) > ORDER_DATE_MAX_PAST_DAYS) return { error: MESSAGES.orderDateTooOld }

  return { date: toIsoDate(date) }
}

/** 受注時刻が 'HH:MM'（00:00〜23:59）か */
function isOrderTime(text) {
  const match = /^(\d{2}):(\d{2})$/.exec(text ?? '')
  return Boolean(match) && Number(match[1]) < 24 && Number(match[2]) < 60
}

/** 指値の入力の不備（無ければ ''） */
function limitPriceError(text) {
  const value = String(text ?? '').trim()
  if (!value) return MESSAGES.limitPriceRequired
  if (!/^\d+(\.\d+)?$/.test(value)) return MESSAGES.limitPriceNumeric
  if (Number(value) <= 0) return MESSAGES.limitPricePositive
  if ((value.split('.')[1] ?? '').length > 4) return MESSAGES.limitPriceScale
  return ''
}

/** 注文数量の入力の不備（無ければ ''） */
function quantityError(text) {
  if (!String(text ?? '').trim()) return MESSAGES.quantityRequired
  return parseQuantity(text) === null ? MESSAGES.quantityInteger : ''
}

/** 口座番号の入力の不備（無ければ ''） */
function accountNumberError(text) {
  const value = String(text ?? '').trim()
  if (!value) return MESSAGES.accountRequired
  return /^\d+$/.test(value) ? '' : MESSAGES.accountNumeric
}

/**
 * ティッカーの照会結果から出す不備（無ければ ''）。
 * 照会に失敗したときは「見つからない」と言わない（銘柄が無いのか通信が落ちたのか区別させる）。
 */
function tickerError(text, { symbol, symbolLookupFailed }) {
  if (!String(text ?? '').trim()) return MESSAGES.tickerRequired
  if (symbolLookupFailed) return MESSAGES.tickerLookupFailed
  return symbol ? '' : MESSAGES.tickerNotFound
}

/**
 * 画面で止められる不備を項目ごとに返す（FormField の error に渡す）。
 *
 * @param {ReturnType<typeof createOrderForm>} form
 * @param {{ symbol: { vwapTarget: string } | null, symbolLookupFailed?: boolean, today: Date }} context
 *   symbol はティッカーの照会で見つかった銘柄（見つからなければ null）
 * @returns {Record<string, string>} キーは form の項目名。不備の無い項目は ''
 */
export function validateOrderForm(form, { symbol, symbolLookupFailed = false, today }) {
  const orderDate = resolveOrderDate(form.orderDate, today)
  const isBuy = form.side === SIDE.BUY

  return {
    branchCode: form.branchCode.trim() ? '' : MESSAGES.branchRequired,
    accountNumber: accountNumberError(form.accountNumber),
    ticker: tickerError(form.ticker, { symbol, symbolLookupFailed }),
    side: form.side ? '' : MESSAGES.sideRequired,
    quantity: quantityError(form.quantity),
    limitPrice: form.orderType === ORDER_TYPE.LIMIT ? limitPriceError(form.limitPrice) : '',
    expiryDate: form.expiryDate ? '' : MESSAGES.expiryRequired,
    depositCategory:
      isBuy && form.depositCategory === DEPOSIT_CATEGORY.GROWTH ? MESSAGES.growthOnBuy : '',
    // 銘柄が引けていないときは銘柄の不備だけを出す（VWAP 対象かは判らない）
    vwap:
      form.vwap === VWAP.VWAP && symbol && symbol.vwapTarget !== '1' ? MESSAGES.vwapNotTarget : '',
    orderDate: orderDate.error ?? '',
    orderTime: isOrderTime(form.orderTime) ? '' : MESSAGES.orderTimeFormat,
    orderPerson: orderPersonError(form.orderPerson),
  }
}

/** 受注者の入力の不備（無ければ ''）。サーバは 1〜4 文字を受ける（OrderRequest.受注者） */
function orderPersonError(text) {
  const value = String(text ?? '').trim()
  if (!value) return MESSAGES.orderPersonRequired
  return value.length > ORDER_PERSON_MAX_LENGTH ? MESSAGES.orderPersonTooLong : ''
}

/**
 * 受注者の初期値。ログイン中の社員コードが受注者に入る長さ（4 文字以内）のときだけ使う。
 * 長いコードを入れておくと、開いた直後から検証で止まる値を既定にしてしまうので空にして入力させる。
 */
export function defaultOrderPerson(operatorCode) {
  const code = String(operatorCode ?? '').trim()
  return code.length <= ORDER_PERSON_MAX_LENGTH ? code : ''
}

/** validateOrderForm の結果に不備が 1 つでもあるか */
export function hasOrderFormErrors(errors) {
  return Object.values(errors).some(Boolean)
}

/**
 * 送る注文（src/api/orderEntry.js の OrderInput）を組み立てる。
 * validateOrderForm を通ったフォームにだけ使う（数量・日付は変換できる前提）。
 *
 * 画面に欄の無い 取引（委託）と 証券受渡方法（当社保管）はここで固定値を入れる。
 *
 * @param {ReturnType<typeof createOrderForm>} form
 * @param {{ symbol: { symbolCode: string }, today: Date, createdBy: string }} context
 */
export function buildOrderInput(form, { symbol, today, createdBy }) {
  const isLimit = form.orderType === ORDER_TYPE.LIMIT

  return {
    branchCode: form.branchCode.trim(),
    accountNumber: form.accountNumber.trim(),
    // 送るのはティッカーではなく銘柄マスタのコード（OrderRequest.銘柄コード は m_銘柄情報 のコード）
    symbolCode: symbol.symbolCode,
    side: form.side,
    quantity: parseQuantity(form.quantity),
    orderType: form.orderType,
    limitPrice: isLimit ? Number(form.limitPrice) : null,
    executionScope: form.executionScope,
    expiryDate: form.expiryDate,
    settlementCurrency: form.settlementCurrency,
    depositCategory: form.depositCategory,
    securitiesDelivery: SECURITIES_DELIVERY_DEFAULT,
    transactionType: TRANSACTION_TYPE_CONSIGNMENT,
    solicitation: form.solicitation,
    orderMethod: form.orderMethod,
    fundNature: form.fundNature,
    orderChannel: form.orderChannel,
    cashDelivery: form.cashDelivery,
    vwap: form.vwap === VWAP.VWAP,
    orderDate: resolveOrderDate(form.orderDate, today).date,
    orderTime: form.orderTime,
    orderPerson: form.orderPerson.trim(),
    forced: form.forced,
    createdBy,
  }
}

/**
 * 期間指定の選択肢。今日から先の営業日を EXPIRY_OPTION_COUNT 件並べる。
 *
 * 営業日は「土日・受注不可日・海外休場日（終日休場）を除いた日」（モックの order_validator.py と同じ。
 * 短縮取引の日は除かない）。今日が休日なら、最初の営業日が「当日中」になる。
 * CALENDAR_LOOKAHEAD_DAYS より先は休日が判らないので並べない（件数が足りなくても打ち切る）。
 *
 * @param {{ today: Date, closedDates?: string[] }} params closedDates は 'YYYY-MM-DD'
 * @returns {{ value: string, label: string }[]} value は 'YYYY-MM-DD'。label は「当日中（9/29）」「1営業日後（9/30）」
 */
export function buildExpiryOptions({ today, closedDates = [] }) {
  const closed = new Set(closedDates)
  const options = []

  for (
    let offset = 0;
    options.length < EXPIRY_OPTION_COUNT && offset <= CALENDAR_LOOKAHEAD_DAYS;
    offset += 1
  ) {
    const date = addDays(today, offset)
    const weekday = date.getDay()
    if (weekday === 0 || weekday === 6 || closed.has(toIsoDate(date))) continue

    const monthDay = `${date.getMonth() + 1}/${date.getDate()}`
    const index = options.length
    options.push({
      value: toIsoDate(date),
      label: index === 0 ? `当日中（${monthDay}）` : `${index}営業日後（${monthDay}）`,
    })
  }
  return options
}

/**
 * 概算に使う単価。指値ならその価格、成行なら銘柄マスタの前日終値（時価を返す API は無い）。
 *
 * @returns {{ price: number|null, source: string }} source は確認画面の注記に出す名前
 */
export function resolveEstimatePrice(form, symbol) {
  if (form.orderType === ORDER_TYPE.LIMIT) {
    const price = Number(form.limitPrice)
    return { price: Number.isFinite(price) && price > 0 ? price : null, source: '指値価格' }
  }
  return { price: symbol?.previousClose ?? null, source: '参考価格（前日終値）' }
}

/**
 * 概算金額（手数料・税金等を含まない）。モックの order_estimate と同じ式。
 *   外貨 = 数量 × 単価（小数第 2 位で四捨五入）
 *   円貨 = 外貨 × 為替（円未満を四捨五入）
 *
 * @param {{ quantity: number|null, unitPrice: number|null, fxRate: number|null }} params
 * @returns {{ usd: number|null, jpy: number|null }} 求められない値は null
 */
export function estimateOrderAmount({ quantity, unitPrice, fxRate }) {
  if (!(quantity > 0) || !(unitPrice > 0)) return { usd: null, jpy: null }

  const usd = Math.round(quantity * unitPrice * 100) / 100
  return { usd, jpy: fxRate > 0 ? Math.round(usd * fxRate) : null }
}

const limitPriceFormat = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

/**
 * 指値単価を「200.0000 ドル」の形にする（指値は小数第 4 位まで入るので、formatUsdUnit の 2 桁では足りない）。
 * 金額の表記の約束（数字 + 半角スペース + 単位）は src/utils/format.js と同じ。
 */
export function formatLimitPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${limitPriceFormat.format(value)} ドル`
}

/**
 * 確認・完了の読み上げ（components/orders/OrderReadback.vue）に出す文字列を組む。
 * 並びと区切り（「／」）はモックの _order_readback.html のとおり。
 *
 * 市場／期限の期限は選択肢の表示名（「当日中（9/29）」）で出す。モックは MMDD の生値を出していたが、
 * 入力画面で選んだ文言と同じもので読み上げたほうが突き合わせやすい。
 *
 * @param {ReturnType<typeof createOrderForm>} form
 * @param {{ customer: object|null, symbol: object|null, expiryOptions: { value: string, label: string }[] }} context
 */
export function buildOrderReadback(form, { customer, symbol, expiryOptions }) {
  const side = SIDE_SHORT_LABELS[form.side] ?? '—'
  const expiry = expiryOptions.find((option) => option.value === form.expiryDate)

  return {
    // 売買の色（'buy' / 'sell'）。帯と「売買」の値を塗る
    tone: form.side === SIDE.BUY ? 'buy' : 'sell',
    tradeLabel: `${side}注文`,
    customerName: customer?.customerName || '—',
    branchAccount: `${form.branchCode} / ${form.accountNumber}`,
    ticker: symbol?.ticker || form.ticker,
    // 銘柄名はティッカーの照会と同じ英字名（無ければ和名）
    symbolName: symbol?.nameEn || symbol?.name || '',
    side: `${side}（委託）`,
    price:
      form.orderType === ORDER_TYPE.LIMIT
        ? `指値 ${formatLimitPrice(Number(form.limitPrice))}`
        : '成行',
    quantity: `${formatQuantity(parseQuantity(form.quantity))} 株`,
    marketExpiry: `${optionLabel(EXECUTION_SCOPE_OPTIONS, form.executionScope)} ／ ${expiry?.label ?? '—'}`,
    vwap: optionLabel(VWAP_OPTIONS, form.vwap),
    settlementCurrency: optionLabel(SETTLEMENT_CURRENCY_OPTIONS, form.settlementCurrency),
    depositCategory: optionLabel(DEPOSIT_CATEGORY_OPTIONS, form.depositCategory),
    cashDelivery: optionLabel(CASH_DELIVERY_OPTIONS, form.cashDelivery),
    orderDateTime: `${form.orderDate} ${form.orderTime}`,
    orderPerson: form.orderPerson || '—',
    solicitationMethod: `${optionLabel(SOLICITATION_OPTIONS, form.solicitation)} ／ ${optionLabel(ORDER_METHOD_OPTIONS, form.orderMethod)}`,
    fundChannel: `${optionLabel(FUND_NATURE_OPTIONS, form.fundNature)} ／ ${optionLabel(ORDER_CHANNEL_OPTIONS, form.orderChannel)}`,
  }
}

const fxRateFormat = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * 概算金額の表示（外貨・円貨・注記）。為替を読んでいる間は金額を出さない。
 *
 * @param {{ form: ReturnType<typeof createOrderForm>, symbol: object|null, fxRate: number|null, fxLoading?: boolean }} params
 * @returns {{ usd: string, jpy: string, note: string }}
 */
export function buildEstimateReadback({ form, symbol, fxRate, fxLoading = false }) {
  const { price, source } = resolveEstimatePrice(form, symbol)
  const { usd, jpy } = estimateOrderAmount({
    quantity: parseQuantity(form.quantity),
    unitPrice: price,
    fxRate,
  })
  const rate = fxRate > 0 ? fxRateFormat.format(fxRate) : '—'

  return {
    usd: formatUsdUnit(usd),
    jpy: fxLoading ? '…' : formatJpyUnit(jpy),
    note: `${source} × 数量 ／ USD/JPY ${fxLoading ? '…' : rate}`,
  }
}
