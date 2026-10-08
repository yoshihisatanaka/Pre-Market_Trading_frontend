import { describe, expect, it } from 'vitest'
import {
  DEPOSIT_CATEGORY,
  ORDER_FORM_DEFAULTS,
  ORDER_PERSON_MAX_LENGTH,
  ORDER_TYPE,
  SECURITIES_DELIVERY_DEFAULT,
  SIDE,
  VWAP,
} from './orderEntryOptions'
import {
  buildEstimateReadback,
  buildExpiryOptions,
  buildOrderInput,
  buildOrderReadback,
  createOrderForm,
  defaultOrderPerson,
  estimateOrderAmount,
  EXPIRY_OPTION_COUNT,
  formatLimitPrice,
  formatOrderDateInput,
  formatOrderTimeInput,
  formatQuantityInput,
  hasOrderFormErrors,
  parseQuantity,
  resolveOrderDate,
  validateOrderForm,
} from './orderEntryForm'

/*
 * 新規注文フォームの純関数。日付はすべて引数で固定する（基準日 2026-09-29 火曜）。
 * 検証の文言はモック原文（validators/order_validator.py）が仕様で、ファイル内の MESSAGES は
 * 公開されていないため、ここでは文言そのものを期待値に書く。
 */
const TODAY = new Date(2026, 8, 29)
const NOW = new Date(2026, 8, 29, 10, 30)

const MESSAGES = {
  branchRequired: '部店コードを入力してください。',
  accountRequired: '口座番号を入力してください。',
  accountNumeric: '口座番号を数値で入力してください。',
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

/** 受注者（最大文字数ちょうどの社員コード） */
const ORDER_PERSON = 'T'.padEnd(ORDER_PERSON_MAX_LENGTH, '0')

/** 照会で見つかった銘柄（src/api/symbols.js の Symbol のうち使う項目） */
const SYMBOL = {
  symbolCode: 'S001',
  ticker: 'AAPL',
  name: 'アップル',
  nameEn: 'Apple Inc.',
  vwapTarget: '1',
  previousClose: 227.16,
}

/** すべて埋まったフォーム（買い・成行・1,000 株・当日中） */
function validForm(overrides = {}) {
  return {
    ...createOrderForm({
      now: NOW,
      orderPerson: ORDER_PERSON,
      branchCode: '123',
      accountNumber: '1230004',
    }),
    ticker: 'AAPL',
    side: SIDE.BUY,
    quantity: '1,000',
    expiryDate: '2026-09-29',
    ...overrides,
  }
}

const validate = (form, context = {}) =>
  validateOrderForm(form, { symbol: SYMBOL, today: TODAY, ...context })

/** 今日から days 日前の 'MM/DD' */
function monthDayBefore(days) {
  const date = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - days)
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

// シナリオ: docs/unit/utils-order-entry-form.md
describe('orderEntryForm', () => {
  it('[NOF-01] formatQuantityInput は全角を半角に、数字以外を落とし、3 桁区切りにする', () => {
    expect(formatQuantityInput('1234567')).toBe('1,234,567')
    expect(formatQuantityInput('１２３４')).toBe('1,234')
    expect(formatQuantityInput('a1b2c3')).toBe('123')
    expect(formatQuantityInput('1,234x')).toBe('1,234')
    expect(formatQuantityInput('007')).toBe('7')
    expect(formatQuantityInput('0')).toBe('0')
    expect(formatQuantityInput('')).toBe('')
  })

  it('[NOF-02] formatOrderDateInput は数字 4 桁までを MM/DD にする', () => {
    expect(formatOrderDateInput('0929')).toBe('09/29')
    expect(formatOrderDateInput('09')).toBe('09')
    expect(formatOrderDateInput('092')).toBe('09/2')
    expect(formatOrderDateInput('０９２９９')).toBe('09/29')
    expect(formatOrderDateInput('09/29')).toBe('09/29')
  })

  it('[NOF-03] formatOrderTimeInput は数字 4 桁までを HH:MM にする', () => {
    expect(formatOrderTimeInput('1125')).toBe('11:25')
    expect(formatOrderTimeInput('11:25')).toBe('11:25')
    expect(formatOrderTimeInput('1a1')).toBe('11')
  })

  it('[NOF-04] parseQuantity は正の整数だけを数値にする', () => {
    expect(parseQuantity('1,000')).toBe(1000)
    for (const value of ['0', '', '1.5', 'abc', null]) {
      expect(parseQuantity(value), String(value)).toBeNull()
    }
  })

  it('[NOF-05] resolveOrderDate は 7 日前までを受け、8 日前と未来日を弾く', () => {
    expect(resolveOrderDate('09/29', TODAY)).toEqual({ date: '2026-09-29' })
    expect(resolveOrderDate(monthDayBefore(7), TODAY)).toEqual({ date: '2026-09-22' })
    expect(resolveOrderDate(monthDayBefore(8), TODAY)).toEqual({ error: MESSAGES.orderDateTooOld })
    expect(resolveOrderDate('09/30', TODAY)).toEqual({ error: MESSAGES.orderDateFuture })
  })

  it('[NOF-06] 年をまたいだ直後は前年に倒し、7 日を超えるなら未到来日にする', () => {
    const newYear = new Date(2027, 0, 2)
    expect(resolveOrderDate('12/30', newYear)).toEqual({ date: '2026-12-30' })
    expect(resolveOrderDate('01/03', newYear)).toEqual({ error: MESSAGES.orderDateFuture })
  })

  it('[NOF-07] 実在しない日付と形の違う入力を弾く', () => {
    expect(resolveOrderDate('02/30', TODAY)).toEqual({ error: MESSAGES.orderDateInvalid })
    expect(resolveOrderDate('13/01', TODAY)).toEqual({ error: MESSAGES.orderDateInvalid })
    for (const text of ['9/29', '0929', '']) {
      expect(resolveOrderDate(text, TODAY), text).toEqual({ error: MESSAGES.orderDateFormat })
    }
  })

  it('[NOF-08] すべて埋まったフォームは不備なし', () => {
    const errors = validate(validForm())
    expect(Object.values(errors).every((message) => message === '')).toBe(true)
    expect(hasOrderFormErrors(errors)).toBe(false)
  })

  it('[NOF-09] 開いた直後のフォームは必須の文言がそろう', () => {
    const errors = validate(createOrderForm({ now: NOW }), { symbol: null })
    expect(errors).toEqual({
      branchCode: MESSAGES.branchRequired,
      accountNumber: MESSAGES.accountRequired,
      ticker: MESSAGES.tickerRequired,
      side: MESSAGES.sideRequired,
      quantity: MESSAGES.quantityRequired,
      limitPrice: '',
      expiryDate: MESSAGES.expiryRequired,
      depositCategory: '',
      vwap: '',
      orderDate: '',
      orderTime: '',
      orderPerson: MESSAGES.orderPersonRequired,
    })
    expect(hasOrderFormErrors(errors)).toBe(true)
  })

  it('[NOF-10] 口座番号・数量・受注時刻の形の不備', () => {
    const errors = validate(validForm({ accountNumber: '12a', quantity: '0', orderTime: '24:00' }))
    expect(errors.accountNumber).toBe(MESSAGES.accountNumeric)
    expect(errors.quantity).toBe(MESSAGES.quantityInteger)
    expect(errors.orderTime).toBe(MESSAGES.orderTimeFormat)
  })

  it('[NOF-11] 指値価格の不備は指値のときだけ見る', () => {
    const limitError = (limitPrice, orderType = ORDER_TYPE.LIMIT) =>
      validate(validForm({ orderType, limitPrice })).limitPrice

    expect(limitError('')).toBe(MESSAGES.limitPriceRequired)
    expect(limitError('abc')).toBe(MESSAGES.limitPriceNumeric)
    expect(limitError('0')).toBe(MESSAGES.limitPricePositive)
    expect(limitError('1.23456')).toBe(MESSAGES.limitPriceScale)
    expect(limitError('200.1234')).toBe('')
    expect(limitError('abc', ORDER_TYPE.MARKET)).toBe('')
  })

  it('[NOF-12] 買い × 成長投資枠だけを弾く', () => {
    const growth = { depositCategory: DEPOSIT_CATEGORY.GROWTH }
    expect(validate(validForm({ ...growth, side: SIDE.BUY })).depositCategory).toBe(
      MESSAGES.growthOnBuy,
    )
    expect(validate(validForm({ ...growth, side: SIDE.SELL })).depositCategory).toBe('')
  })

  it('[NOF-13] VWAP は対象外の銘柄のときだけ弾き、銘柄が無ければ銘柄の不備だけを出す', () => {
    const form = validForm({ vwap: VWAP.VWAP })
    expect(validate(form, { symbol: { ...SYMBOL, vwapTarget: '0' } }).vwap).toBe(
      MESSAGES.vwapNotTarget,
    )
    expect(validate(form, { symbol: SYMBOL }).vwap).toBe('')

    const withoutSymbol = validate(form, { symbol: null })
    expect(withoutSymbol.vwap).toBe('')
    expect(withoutSymbol.ticker).toBe(MESSAGES.tickerNotFound)
  })

  it('[NOF-14] 照会に失敗したときは「見つかりません」と言わない', () => {
    const errors = validate(validForm(), { symbol: null, symbolLookupFailed: true })
    expect(errors.ticker).toBe(MESSAGES.tickerLookupFailed)
  })

  it('[NOF-30] 受注者は前後の空白を落として数え、最大文字数を超えると弾く', () => {
    const personError = (orderPerson) => validate(validForm({ orderPerson })).orderPerson
    const tooLong = 'X'.repeat(ORDER_PERSON_MAX_LENGTH + 1)

    expect(personError(ORDER_PERSON)).toBe('')
    expect(personError(`  ${ORDER_PERSON}  `)).toBe('')
    expect(personError(tooLong)).toBe(MESSAGES.orderPersonTooLong)
    expect(personError('   ')).toBe(MESSAGES.orderPersonRequired)
  })

  it('[NOF-31] defaultOrderPerson は最大文字数以内の社員コードだけを初期値にする', () => {
    const tooLong = 'X'.repeat(ORDER_PERSON_MAX_LENGTH + 1)

    expect(defaultOrderPerson(ORDER_PERSON)).toBe(ORDER_PERSON)
    expect(defaultOrderPerson(` ${ORDER_PERSON} `)).toBe(ORDER_PERSON)
    expect(defaultOrderPerson(tooLong)).toBe('')
    expect(defaultOrderPerson(null)).toBe('')
    expect(defaultOrderPerson(undefined)).toBe('')
  })

  it('[NOF-15] buildOrderInput は銘柄マスタのコードと固定値を入れ、成行の単価は null', () => {
    const form = validForm({
      branchCode: ' 123 ',
      accountNumber: ' 1230004 ',
      orderPerson: ` ${ORDER_PERSON} `,
    })
    const input = buildOrderInput(form, { symbol: SYMBOL, today: TODAY, createdBy: 'creator' })

    expect(input).toMatchObject({
      branchCode: '123',
      accountNumber: '1230004',
      symbolCode: SYMBOL.symbolCode,
      side: SIDE.BUY,
      quantity: 1000,
      orderType: ORDER_TYPE.MARKET,
      limitPrice: null,
      expiryDate: '2026-09-29',
      securitiesDelivery: SECURITIES_DELIVERY_DEFAULT,
      transactionType: '100',
      vwap: false,
      forced: false,
      orderDate: '2026-09-29',
      orderTime: '10:30',
      orderPerson: ORDER_PERSON,
      createdBy: 'creator',
    })
    expect(input.symbolCode).not.toBe(form.ticker)
  })

  it('[NOF-16] 指値・VWAP・強制区分はそのまま型を変えて載る', () => {
    const form = validForm({
      orderType: ORDER_TYPE.LIMIT,
      limitPrice: '200.5',
      vwap: VWAP.VWAP,
      forced: true,
    })
    const input = buildOrderInput(form, { symbol: SYMBOL, today: TODAY, createdBy: 'creator' })

    expect(input.limitPrice).toBe(200.5)
    expect(input.vwap).toBe(true)
    expect(input.forced).toBe(true)
    expect(input.createdBy).toBe('creator')
  })

  it('[NOF-17] 期間指定は土日を除いた 15 営業日で、先頭が当日中', () => {
    const options = buildExpiryOptions({ today: TODAY })

    expect(options).toHaveLength(EXPIRY_OPTION_COUNT)
    expect(options[0]).toEqual({ value: '2026-09-29', label: '当日中（9/29）' })
    expect(options[1]).toEqual({ value: '2026-09-30', label: '1営業日後（9/30）' })
    expect(options.at(-1)).toEqual({
      value: '2026-10-19',
      label: `${EXPIRY_OPTION_COUNT - 1}営業日後（10/19）`,
    })
    for (const { value } of options) {
      const weekday = new Date(`${value}T00:00:00`).getDay()
      expect([0, 6], value).not.toContain(weekday)
    }
  })

  it('[NOF-18] closedDates の日は並ばない', () => {
    const options = buildExpiryOptions({ today: TODAY, closedDates: ['2026-09-30'] })
    expect(options.map((option) => option.value)).not.toContain('2026-09-30')
    expect(options[1]).toEqual({ value: '2026-10-01', label: '1営業日後（10/1）' })
  })

  it('[NOF-19] 今日が休日なら最初の営業日が当日中', () => {
    const options = buildExpiryOptions({ today: new Date(2026, 9, 3) })
    expect(options[0]).toEqual({ value: '2026-10-05', label: '当日中（10/5）' })
  })

  it('[NOF-20] createOrderForm は開いた日時と引き継ぎの顧客を入れ、売買区分は未選択', () => {
    const form = createOrderForm({
      now: new Date(2026, 8, 29, 9, 5),
      branchCode: '123',
      accountNumber: '1230001',
    })

    expect(form).toMatchObject({
      ...ORDER_FORM_DEFAULTS,
      branchCode: '123',
      accountNumber: '1230001',
      orderDate: '09/29',
      orderTime: '09:05',
      side: '',
      ticker: '',
      quantity: '',
      expiryDate: '',
      forced: false,
    })
  })

  it('[NOF-28] createOrderForm は預りから銘柄・売買・預り区分を引き継ぎ、預り区分は既定より優先する', () => {
    // 既定と違う値でないと「優先される」ことを確かめられない
    expect(DEPOSIT_CATEGORY.GENERAL).not.toBe(ORDER_FORM_DEFAULTS.depositCategory)

    const form = createOrderForm({
      now: new Date(2026, 8, 29, 9, 5),
      ticker: 'AAPL',
      side: SIDE.SELL,
      depositCategory: DEPOSIT_CATEGORY.GENERAL,
    })

    expect(form).toMatchObject({
      ...ORDER_FORM_DEFAULTS,
      ticker: 'AAPL',
      side: SIDE.SELL,
      depositCategory: DEPOSIT_CATEGORY.GENERAL,
    })
  })

  it('[NOF-29] 引き継ぐ預り区分が空なら既定のまま', () => {
    const form = createOrderForm({ now: new Date(2026, 8, 29, 9, 5), depositCategory: '' })

    expect(form.depositCategory).toBe(ORDER_FORM_DEFAULTS.depositCategory)
  })

  it('[NOF-32] createOrderForm は引き継いだ数量を入力欄と同じ 3 桁区切りにする', () => {
    const now = new Date(2026, 8, 29, 9, 5)

    expect(createOrderForm({ now, quantity: '1500' }).quantity).toBe('1,500')
    expect(createOrderForm({ now }).quantity).toBe('')
  })

  it('[NOF-21] 概算は外貨を小数第 2 位、円貨を円未満で四捨五入する', () => {
    expect(estimateOrderAmount({ quantity: 7, unitPrice: 1.2345, fxRate: 150.25 })).toEqual({
      usd: 8.64,
      jpy: 1298,
    })
    expect(estimateOrderAmount({ quantity: 7, unitPrice: 1.2355, fxRate: 150.25 })).toEqual({
      usd: 8.65,
      jpy: 1300,
    })
  })

  it('[NOF-22] 求められない概算は null', () => {
    expect(estimateOrderAmount({ quantity: 7, unitPrice: 1.2345, fxRate: null })).toEqual({
      usd: 8.64,
      jpy: null,
    })
    expect(estimateOrderAmount({ quantity: null, unitPrice: 1.2345, fxRate: 150.25 })).toEqual({
      usd: null,
      jpy: null,
    })
    expect(estimateOrderAmount({ quantity: 7, unitPrice: 0, fxRate: 150.25 })).toEqual({
      usd: null,
      jpy: null,
    })
  })

  it('[NOF-23] formatLimitPrice は小数第 4 位までのドル表記', () => {
    expect(formatLimitPrice(200)).toBe('200.0000 ドル')
    expect(formatLimitPrice(1234.5)).toBe('1,234.5000 ドル')
    expect(formatLimitPrice(null)).toBe('—')
    expect(formatLimitPrice(Number.NaN)).toBe('—')
  })

  it('[NOF-24] 買い・成行の読み上げ', () => {
    const readback = buildOrderReadback(validForm(), {
      customer: { customerName: '山田 太郎' },
      symbol: SYMBOL,
      expiryOptions: buildExpiryOptions({ today: TODAY }),
    })

    expect(readback).toEqual({
      tone: 'buy',
      tradeLabel: '買注文',
      customerName: '山田 太郎',
      branchAccount: '123 / 1230004',
      ticker: 'AAPL',
      symbolName: SYMBOL.nameEn,
      side: '買（委託）',
      price: '成行',
      quantity: '1,000 株',
      marketExpiry: 'レギュラー ／ 当日中（9/29）',
      vwap: '通常',
      settlementCurrency: '円決',
      depositCategory: '特定',
      cashDelivery: '当社',
      orderDateTime: '09/29 10:30',
      orderPerson: ORDER_PERSON,
      solicitationMethod: '勧誘あり ／ 電話他',
      fundChannel: '余裕資金 ／ 営業店',
    })
  })

  it('[NOF-25] 売り・指値の読み上げと、顧客なしの顧客名', () => {
    const form = validForm({ side: SIDE.SELL, orderType: ORDER_TYPE.LIMIT, limitPrice: '200' })
    const readback = buildOrderReadback(form, {
      customer: null,
      symbol: SYMBOL,
      expiryOptions: buildExpiryOptions({ today: TODAY }),
    })

    expect(readback.tone).toBe('sell')
    expect(readback.tradeLabel).toBe('売注文')
    expect(readback.side).toBe('売（委託）')
    expect(readback.price).toBe('指値 200.0000 ドル')
    expect(readback.customerName).toBe('—')
  })

  it('[NOF-26] 成行の概算は前日終値 × 数量と為替から出す', () => {
    const estimate = buildEstimateReadback({
      form: validForm({ quantity: '10' }),
      symbol: SYMBOL,
      fxRate: 150.25,
    })

    // 10 × 227.16 = 2,271.60 ドル、× 150.25 = 341,307.9 → 341,308 円
    expect(estimate).toEqual({
      usd: '2,271.60 ドル',
      jpy: '341,308 円',
      note: '参考価格（前日終値） × 数量 ／ USD/JPY 150.25',
    })
  })

  it('[NOF-27] 為替を読み込み中は円貨と為替を … にする', () => {
    const estimate = buildEstimateReadback({
      form: validForm({ quantity: '10', orderType: ORDER_TYPE.LIMIT, limitPrice: '200' }),
      symbol: SYMBOL,
      fxRate: null,
      fxLoading: true,
    })

    expect(estimate).toEqual({
      usd: '2,000.00 ドル',
      jpy: '…',
      note: '指値価格 × 数量 ／ USD/JPY …',
    })
  })
})
