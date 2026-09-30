import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  buildEstimateReadback,
  buildExpiryOptions,
  buildOrderReadback,
  createOrderForm,
} from '@/utils/orderEntryForm'
import { SIDE } from '@/utils/orderEntryOptions'
import OrderReadback from './OrderReadback.vue'

/*
 * 部品のテスト。組み立て済みの文字列（buildOrderReadback / buildEstimateReadback の戻り値）を
 * そのまま所定の欄に出すことだけを見る。組み立ての中身は utils/orderEntryForm.spec.js が見る。
 */
const NOW = new Date(2026, 8, 29, 10, 30)
const SYMBOL = { symbolCode: 'S001', ticker: 'AAPL', nameEn: 'Apple Inc.', previousClose: 227.16 }

function form(overrides = {}) {
  return {
    ...createOrderForm({ now: NOW, orderPerson: 'test-user', branchCode: '123', accountNumber: '1230004' }),
    ticker: 'AAPL',
    side: SIDE.BUY,
    quantity: '10',
    expiryDate: '2026-09-29',
    ...overrides,
  }
}

function readbackOf(values, symbol = SYMBOL) {
  return buildOrderReadback(values, {
    customer: { customerName: '高橋 みどり' },
    symbol,
    expiryOptions: buildExpiryOptions({ today: NOW }),
  })
}

const estimateOf = (values, fxRate = 150.25) =>
  buildEstimateReadback({ form: values, symbol: SYMBOL, fxRate })

function mountReadback(readback, estimate = estimateOf(form())) {
  return mount(OrderReadback, { props: { readback, estimate } })
}

const text = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).text()

/** 欄の testid → readback のキー */
const FIELDS = {
  'order-readback-customer': 'customerName',
  'order-readback-account': 'branchAccount',
  'order-readback-side': 'side',
  'order-readback-price': 'price',
  'order-readback-quantity': 'quantity',
  'order-readback-market-expiry': 'marketExpiry',
  'order-readback-vwap': 'vwap',
  'order-readback-settlement-currency': 'settlementCurrency',
  'order-readback-deposit-category': 'depositCategory',
  'order-readback-cash-delivery': 'cashDelivery',
  'order-readback-order-datetime': 'orderDateTime',
  'order-readback-order-person': 'orderPerson',
  'order-readback-solicitation': 'solicitationMethod',
  'order-readback-fund-channel': 'fundChannel',
}

// シナリオ: docs/unit/components-orders-order-readback.md
describe('OrderReadback', () => {
  it('[NRB-01] 読み上げの文字列をそれぞれの欄に出す', () => {
    const readback = readbackOf(form())
    const wrapper = mountReadback(readback)

    for (const [testid, key] of Object.entries(FIELDS)) {
      expect(text(wrapper, testid), testid).toBe(readback[key])
    }
    const symbol = wrapper.find('[data-testid="order-readback-symbol"]')
    expect(symbol.text()).toContain(readback.ticker)
    expect(symbol.find('small').text()).toBe(readback.symbolName)
  })

  it('[NRB-02] 売買の色が読み上げ全体に付く', () => {
    const buy = mountReadback(readbackOf(form()))
    expect(buy.find('[data-testid="order-readback"]').classes()).toContain('is-buy')

    const sell = mountReadback(readbackOf(form({ side: SIDE.SELL })))
    expect(sell.find('[data-testid="order-readback"]').classes()).toContain('is-sell')
  })

  it('[NRB-03] 銘柄名が空ならティッカーだけを出す', () => {
    const readback = readbackOf(form(), { ...SYMBOL, nameEn: '', name: '' })
    const wrapper = mountReadback(readback)

    const symbol = wrapper.find('[data-testid="order-readback-symbol"]')
    expect(symbol.text()).toBe(readback.ticker)
    expect(symbol.find('small').exists()).toBe(false)
  })

  it('[NRB-04] 概算金額と注記をそのまま出す', () => {
    const values = form()
    const estimate = estimateOf(values, null)
    const wrapper = mountReadback(readbackOf(values), estimate)

    expect(text(wrapper, 'order-readback-estimate-usd')).toBe(estimate.usd)
    expect(text(wrapper, 'order-readback-estimate-jpy')).toBe(estimate.jpy)
    expect(estimate.jpy).toBe('—')
    const note = text(wrapper, 'order-readback-estimate-note')
    expect(note).toContain(estimate.note)
    expect(note).toContain('手数料・税金等を含みません。')
  })
})
