import { describe, expect, it } from 'vitest'
import {
  CASH_DELIVERY_VALUES,
  DEPOSIT_CATEGORY_VALUES,
  EXECUTION_SCOPE_VALUES,
  FUND_NATURE_VALUES,
  ORDER_CHANNEL_VALUES,
  ORDER_METHOD_VALUES,
  ORDER_TYPE_VALUES,
  SECURITIES_DELIVERY_VALUES,
  SETTLEMENT_CURRENCY_VALUES,
  SIDE_VALUES,
  SOLICITATION_VALUES,
  TRANSACTION_TYPE_VALUES,
} from './apiEnums'
import {
  CASH_DELIVERY_OPTIONS,
  DEPOSIT_CATEGORY_OPTIONS,
  EXECUTION_SCOPE_OPTIONS,
  FUND_NATURE_OPTIONS,
  ORDER_CHANNEL_OPTIONS,
  ORDER_FORM_DEFAULTS,
  ORDER_METHOD_OPTIONS,
  ORDER_TYPE_OPTIONS,
  optionLabel,
  SECURITIES_DELIVERY_OTHER,
  SETTLEMENT_CURRENCY_OPTIONS,
  SIDE_OPTIONS,
  SOLICITATION_OPTIONS,
  TRANSACTION_TYPE_CONSIGNMENT,
  VWAP_OPTIONS,
} from './orderEntryOptions'

/** 画面の選択肢と、その値が属する enum（openapi.json の写し） */
const OPTION_ENUMS = [
  ['SIDE', SIDE_OPTIONS, SIDE_VALUES],
  ['ORDER_TYPE', ORDER_TYPE_OPTIONS, ORDER_TYPE_VALUES],
  ['EXECUTION_SCOPE', EXECUTION_SCOPE_OPTIONS, EXECUTION_SCOPE_VALUES],
  ['SETTLEMENT_CURRENCY', SETTLEMENT_CURRENCY_OPTIONS, SETTLEMENT_CURRENCY_VALUES],
  ['DEPOSIT_CATEGORY', DEPOSIT_CATEGORY_OPTIONS, DEPOSIT_CATEGORY_VALUES],
  ['SOLICITATION', SOLICITATION_OPTIONS, SOLICITATION_VALUES],
  ['ORDER_METHOD', ORDER_METHOD_OPTIONS, ORDER_METHOD_VALUES],
  ['FUND_NATURE', FUND_NATURE_OPTIONS, FUND_NATURE_VALUES],
  ['ORDER_CHANNEL', ORDER_CHANNEL_OPTIONS, ORDER_CHANNEL_VALUES],
  ['CASH_DELIVERY', CASH_DELIVERY_OPTIONS, CASH_DELIVERY_VALUES],
]

/** ORDER_FORM_DEFAULTS のキー → その値を選ぶ選択肢 */
const DEFAULT_OPTIONS = {
  executionScope: EXECUTION_SCOPE_OPTIONS,
  orderType: ORDER_TYPE_OPTIONS,
  settlementCurrency: SETTLEMENT_CURRENCY_OPTIONS,
  depositCategory: DEPOSIT_CATEGORY_OPTIONS,
  solicitation: SOLICITATION_OPTIONS,
  orderMethod: ORDER_METHOD_OPTIONS,
  fundNature: FUND_NATURE_OPTIONS,
  orderChannel: ORDER_CHANNEL_OPTIONS,
  cashDelivery: CASH_DELIVERY_OPTIONS,
  vwap: VWAP_OPTIONS,
}

const valuesOf = (options) => options.map((option) => option.value)

// シナリオ: docs/unit/utils-order-entry-options.md
describe('orderEntryOptions', () => {
  it('[NOP-01] 各選択肢の value が apiEnums の *_VALUES に含まれる', () => {
    for (const [name, options, values] of OPTION_ENUMS) {
      for (const value of valuesOf(options)) {
        expect(values, `${name}: ${value}`).toContain(value)
      }
    }
  })

  it('[NOP-02] 固定値（取引・証券受渡方法）が enum に含まれる', () => {
    expect(TRANSACTION_TYPE_VALUES).toContain(TRANSACTION_TYPE_CONSIGNMENT)
    expect(SECURITIES_DELIVERY_VALUES).toContain(SECURITIES_DELIVERY_OTHER)
  })

  it('[NOP-03] 入力画面の既定値がどれも選択肢に含まれる', () => {
    expect(Object.keys(ORDER_FORM_DEFAULTS).sort()).toEqual(Object.keys(DEFAULT_OPTIONS).sort())
    for (const [key, options] of Object.entries(DEFAULT_OPTIONS)) {
      expect(valuesOf(options), key).toContain(ORDER_FORM_DEFAULTS[key])
    }
  })

  it('[NOP-04] 売買区分は買い = 3（buy）・売り = 1（sell）で、先頭が買い', () => {
    expect(SIDE_OPTIONS).toEqual([
      { value: '3', label: '買い', tone: 'buy' },
      { value: '1', label: '売り', tone: 'sell' },
    ])
  })

  it('[NOP-05] 指成区分は成行 = MO・指値 = LO', () => {
    expect(optionLabel(ORDER_TYPE_OPTIONS, 'MO')).toBe('成行')
    expect(optionLabel(ORDER_TYPE_OPTIONS, 'LO')).toBe('指値')
  })

  it('[NOP-06] 市場区分は時間帯の順に並び、enum の 6 値を過不足なく含む', () => {
    expect(valuesOf(EXECUTION_SCOPE_OPTIONS)).toEqual(['01', '02', '04', '03', '05', '06'])
    expect([...valuesOf(EXECUTION_SCOPE_OPTIONS)].sort()).toEqual([...EXECUTION_SCOPE_VALUES].sort())
  })

  it('[NOP-07] optionLabel は既知の値を表示名に、それ以外を — にする', () => {
    const [first] = SETTLEMENT_CURRENCY_OPTIONS
    expect(optionLabel(SETTLEMENT_CURRENCY_OPTIONS, first.value)).toBe(first.label)
    expect(optionLabel(SETTLEMENT_CURRENCY_OPTIONS, '9')).toBe('—')
    expect(optionLabel(SETTLEMENT_CURRENCY_OPTIONS, '')).toBe('—')
    expect(optionLabel(SETTLEMENT_CURRENCY_OPTIONS, undefined)).toBe('—')
  })
})
