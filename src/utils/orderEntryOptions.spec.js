import { describe, expect, it } from 'vitest'
import openapi from '../../docs/api/openapi.json'
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
  CASH_DELIVERY_DEFAULT,
  DEPOSIT_CATEGORY_OPTIONS,
  EXECUTION_SCOPE_OPTIONS,
  FUND_NATURE_OPTIONS,
  ORDER_CHANNEL_OPTIONS,
  ORDER_ENTRY_EXECUTION_SCOPE_OPTIONS,
  ORDER_FORM_DEFAULTS,
  ORDER_METHOD_OPTIONS,
  ORDER_TYPE_OPTIONS,
  optionLabel,
  ORDER_PERSON_MAX_LENGTH,
  SECURITIES_DELIVERY_DEFAULT,
  SETTLEMENT_CURRENCY_OPTIONS,
  SIDE_OPTIONS,
  SOLICITATION_OPTIONS,
  TRANSACTION_TYPE_CONSIGNMENT,
  VWAP_OPTIONS,
} from './orderEntryOptions'

/** 送る本文のスキーマ（既定値と文字数の出どころ） */
const ORDER_REQUEST = openapi.components.schemas.OrderRequest

/** 画面の選択肢と、その値が属する enum（openapi.json の写し） */
const OPTION_ENUMS = [
  ['SIDE', SIDE_OPTIONS, SIDE_VALUES],
  ['ORDER_TYPE', ORDER_TYPE_OPTIONS, ORDER_TYPE_VALUES],
  ['EXECUTION_SCOPE', EXECUTION_SCOPE_OPTIONS, EXECUTION_SCOPE_VALUES],
  ['ORDER_ENTRY_EXECUTION_SCOPE', ORDER_ENTRY_EXECUTION_SCOPE_OPTIONS, EXECUTION_SCOPE_VALUES],
  ['SETTLEMENT_CURRENCY', SETTLEMENT_CURRENCY_OPTIONS, SETTLEMENT_CURRENCY_VALUES],
  ['DEPOSIT_CATEGORY', DEPOSIT_CATEGORY_OPTIONS, DEPOSIT_CATEGORY_VALUES],
  ['SOLICITATION', SOLICITATION_OPTIONS, SOLICITATION_VALUES],
  ['ORDER_METHOD', ORDER_METHOD_OPTIONS, ORDER_METHOD_VALUES],
  ['FUND_NATURE', FUND_NATURE_OPTIONS, FUND_NATURE_VALUES],
  ['ORDER_CHANNEL', ORDER_CHANNEL_OPTIONS, ORDER_CHANNEL_VALUES],
]

/** ORDER_FORM_DEFAULTS のキー → その値を選ぶ選択肢（預り売買区分は未選択で始めるので含めない） */
const DEFAULT_OPTIONS = {
  // 既定の注文区分は入力欄に出す（フェーズ 1 で選べる）値でなければならない
  executionScope: ORDER_ENTRY_EXECUTION_SCOPE_OPTIONS.filter((option) => !option.disabled),
  orderType: ORDER_TYPE_OPTIONS,
  settlementCurrency: SETTLEMENT_CURRENCY_OPTIONS,
  solicitation: SOLICITATION_OPTIONS,
  orderMethod: ORDER_METHOD_OPTIONS,
  fundNature: FUND_NATURE_OPTIONS,
  orderChannel: ORDER_CHANNEL_OPTIONS,
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

  it('[NOP-02] 固定値（取引・証券受渡方法・金銭受渡方法）が enum に含まれ、証券受渡方法は OrderRequest の既定値', () => {
    expect(TRANSACTION_TYPE_VALUES).toContain(TRANSACTION_TYPE_CONSIGNMENT)
    expect(SECURITIES_DELIVERY_VALUES).toContain(SECURITIES_DELIVERY_DEFAULT)
    expect(SECURITIES_DELIVERY_DEFAULT).toBe(ORDER_REQUEST.properties.証券受渡方法.default)
    // 金銭受渡方法は当社固定（画面モックの 2026-09-30 版）
    expect(CASH_DELIVERY_VALUES).toContain(CASH_DELIVERY_DEFAULT)
    expect(CASH_DELIVERY_DEFAULT).toBe('000')
  })

  it('[NOP-08] 受注者の最大文字数が OrderRequest.受注者 の maxLength と一致する', () => {
    expect(ORDER_PERSON_MAX_LENGTH).toBe(ORDER_REQUEST.properties.受注者.maxLength)
  })

  it('[NOP-03] 入力画面の既定値がどれも選択肢に含まれる（預り売買区分だけは未選択）', () => {
    const { depositCategory, ...defaults } = ORDER_FORM_DEFAULTS
    expect(depositCategory).toBe('')
    expect(Object.keys(defaults).sort()).toEqual(Object.keys(DEFAULT_OPTIONS).sort())
    for (const [key, options] of Object.entries(DEFAULT_OPTIONS)) {
      expect(valuesOf(options), key).toContain(ORDER_FORM_DEFAULTS[key])
    }
  })

  it('[NOP-10] 既定値は画面モックの初期値（指値・外決・勧誘あり・電話他・余裕資金・営業店・通常）', () => {
    const labels = {
      orderType: optionLabel(ORDER_TYPE_OPTIONS, ORDER_FORM_DEFAULTS.orderType),
      settlementCurrency: optionLabel(
        SETTLEMENT_CURRENCY_OPTIONS,
        ORDER_FORM_DEFAULTS.settlementCurrency,
      ),
      solicitation: optionLabel(SOLICITATION_OPTIONS, ORDER_FORM_DEFAULTS.solicitation),
      orderMethod: optionLabel(ORDER_METHOD_OPTIONS, ORDER_FORM_DEFAULTS.orderMethod),
      fundNature: optionLabel(FUND_NATURE_OPTIONS, ORDER_FORM_DEFAULTS.fundNature),
      orderChannel: optionLabel(ORDER_CHANNEL_OPTIONS, ORDER_FORM_DEFAULTS.orderChannel),
      vwap: optionLabel(VWAP_OPTIONS, ORDER_FORM_DEFAULTS.vwap),
    }

    expect(labels).toEqual({
      orderType: '指値',
      settlementCurrency: '外決',
      solicitation: '勧誘あり',
      orderMethod: '電話他',
      fundNature: '余裕資金',
      orderChannel: '営業店',
      vwap: '通常',
    })
    // 金銭受渡方法は欄が無く、既定値にも持たない（送るときに CASH_DELIVERY_DEFAULT を入れる）
    expect(ORDER_FORM_DEFAULTS).not.toHaveProperty('cashDelivery')
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

  it('[NOP-06] 市場区分は時間帯の順に並び、enum の 4 値を過不足なく含む', () => {
    expect(valuesOf(EXECUTION_SCOPE_OPTIONS)).toEqual(['02', '04', '03', '06'])
    expect([...valuesOf(EXECUTION_SCOPE_OPTIONS)].sort()).toEqual([...EXECUTION_SCOPE_VALUES].sort())
  })

  it('[NOP-09] 入力欄の注文区分は 02 / 03 を Ph.1 で選べ、04 / 06 を Ph.2 として選べなくする', () => {
    expect(ORDER_ENTRY_EXECUTION_SCOPE_OPTIONS).toEqual([
      { value: '02', label: 'プレ＋レギュラー', group: 'Ph.1（受付対象）' },
      { value: '03', label: 'レギュラー', group: 'Ph.1（受付対象）' },
      {
        value: '04',
        label: 'プレ＋レギュラー＋アフター（Ph.2予定）',
        group: 'Ph.2（将来対応）',
        disabled: true,
      },
      {
        value: '06',
        label: 'アフター（時間内限り）（Ph.2予定）',
        group: 'Ph.2（将来対応）',
        disabled: true,
      },
    ])
  })

  it('[NOP-07] optionLabel は既知の値を表示名に、それ以外を — にする', () => {
    const [first] = SETTLEMENT_CURRENCY_OPTIONS
    expect(optionLabel(SETTLEMENT_CURRENCY_OPTIONS, first.value)).toBe(first.label)
    expect(optionLabel(SETTLEMENT_CURRENCY_OPTIONS, '9')).toBe('—')
    expect(optionLabel(SETTLEMENT_CURRENCY_OPTIONS, '')).toBe('—')
    expect(optionLabel(SETTLEMENT_CURRENCY_OPTIONS, undefined)).toBe('—')
  })
})
