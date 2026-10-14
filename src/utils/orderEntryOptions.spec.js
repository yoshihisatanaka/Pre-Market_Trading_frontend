import { describe, expect, it } from 'vitest'
import openapi from '../../docs/api/openapi.json'
import { codeName, codeMasters } from '@/mocks/fixtures/codes'
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
  DEPOSIT_CATEGORY_CODES,
  ORDER_CHANNEL_CODES,
  ORDER_ENTRY_EXECUTION_SCOPE_CODES,
  ORDER_ENTRY_EXECUTION_SCOPE_EXTRAS,
  ORDER_FORM_DEFAULTS,
  ORDER_METHOD_CODES,
  ORDER_PERSON_MAX_LENGTH,
  ORDER_TYPE_CODES,
  SECURITIES_DELIVERY_DEFAULT,
  SIDE_CODES,
  SIDE_EXTRAS,
  TRANSACTION_TYPE_CONSIGNMENT,
  decorateOptions,
} from './orderEntryOptions'

/** 送る本文のスキーマ（既定値と文字数の出どころ） */
const ORDER_REQUEST = openapi.components.schemas.OrderRequest

/** コードマスタのカテゴリのコード（並びはコード順。フィクスチャは実 API の写し） */
const codesOf = (name) => Object.keys(codeMasters[name]).sort()

/** stores/codes.js の pickOptions と同じ組み立てを、フィクスチャから行う */
const pick = (name, codes) => codes.map((code) => ({ value: code, label: codeName(name, code) }))

/**
 * 画面の選択肢のコード列と、その値が属する enum（openapi.json の写し）とコードマスタのカテゴリ。
 * 並びも絞り込みもコードマスタのままのもの（決済通貨・勧誘・資金性格）は、カテゴリのコード全体を突き合わせる。
 */
const OPTION_ENUMS = [
  ['売買区分', SIDE_CODES, SIDE_VALUES],
  ['指成区分', ORDER_TYPE_CODES, ORDER_TYPE_VALUES],
  ['発注範囲', ORDER_ENTRY_EXECUTION_SCOPE_CODES, EXECUTION_SCOPE_VALUES],
  ['決済通貨区分', codesOf('決済通貨区分'), SETTLEMENT_CURRENCY_VALUES],
  ['預り売買区分', DEPOSIT_CATEGORY_CODES, DEPOSIT_CATEGORY_VALUES],
  ['勧誘区分', codesOf('勧誘区分'), SOLICITATION_VALUES],
  ['受注方法', ORDER_METHOD_CODES, ORDER_METHOD_VALUES],
  ['資金性格', codesOf('資金性格'), FUND_NATURE_VALUES],
  ['注文チャネル', ORDER_CHANNEL_CODES, ORDER_CHANNEL_VALUES],
]

/** ORDER_FORM_DEFAULTS のキー → その値を選ぶ選択肢のコード列（預り売買区分は未選択で始めるので含めない） */
const DEFAULT_CODES = {
  // 既定の注文区分は入力欄で選べる（フェーズ 1 の）値でなければならない
  executionScope: ORDER_ENTRY_EXECUTION_SCOPE_CODES.filter(
    (code) => !ORDER_ENTRY_EXECUTION_SCOPE_EXTRAS[code]?.disabled,
  ),
  orderType: ORDER_TYPE_CODES,
  settlementCurrency: codesOf('決済通貨区分'),
  solicitation: codesOf('勧誘区分'),
  orderMethod: ORDER_METHOD_CODES,
  fundNature: codesOf('資金性格'),
  orderChannel: ORDER_CHANNEL_CODES,
  vwap: codesOf('VWAP区分'),
}

// シナリオ: docs/unit/utils-order-entry-options.md
describe('orderEntryOptions', () => {
  it('[NOP-01] 各選択肢のコードが apiEnums の *_VALUES に含まれ、コードマスタに名称がある', () => {
    for (const [name, codes, values] of OPTION_ENUMS) {
      for (const code of codes) {
        expect(values, `${name}: ${code}`).toContain(code)
        expect(codeName(name, code), `${name}: ${code}`).toBeTruthy()
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
    expect(Object.keys(defaults).sort()).toEqual(Object.keys(DEFAULT_CODES).sort())
    for (const [key, codes] of Object.entries(DEFAULT_CODES)) {
      expect(codes, key).toContain(ORDER_FORM_DEFAULTS[key])
    }
  })

  it('[NOP-10] 既定値は画面モックの初期値（指値・外決・勧誘あり・電話他・余裕資金等・営業店・通常）', () => {
    const labels = {
      orderType: codeName('指成区分', ORDER_FORM_DEFAULTS.orderType),
      settlementCurrency: codeName('決済通貨区分', ORDER_FORM_DEFAULTS.settlementCurrency),
      solicitation: codeName('勧誘区分', ORDER_FORM_DEFAULTS.solicitation),
      orderMethod: codeName('受注方法', ORDER_FORM_DEFAULTS.orderMethod),
      fundNature: codeName('資金性格', ORDER_FORM_DEFAULTS.fundNature),
      orderChannel: codeName('注文チャネル', ORDER_FORM_DEFAULTS.orderChannel),
      vwap: codeName('VWAP区分', ORDER_FORM_DEFAULTS.vwap),
    }

    expect(labels).toEqual({
      orderType: '指値',
      settlementCurrency: '外決',
      solicitation: '勧誘あり',
      orderMethod: '電話他',
      fundNature: '余裕資金等',
      orderChannel: '営業店',
      vwap: '通常',
    })
    // 金銭受渡方法は欄が無く、既定値にも持たない（送るときに CASH_DELIVERY_DEFAULT を入れる）
    expect(ORDER_FORM_DEFAULTS).not.toHaveProperty('cashDelivery')
  })

  it('[NOP-04] 売買区分は買 = 3（buy）・売 = 1（sell）で、先頭が買', () => {
    expect(decorateOptions(pick('売買区分', SIDE_CODES), SIDE_EXTRAS)).toEqual([
      { value: '3', label: '買', tone: 'buy' },
      { value: '1', label: '売', tone: 'sell' },
    ])
  })

  it('[NOP-05] 指成区分は成行 = MO → 指値 = LO の順', () => {
    expect(pick('指成区分', ORDER_TYPE_CODES)).toEqual([
      { value: 'MO', label: '成行' },
      { value: 'LO', label: '指値' },
    ])
  })

  it('[NOP-09] 入力欄の注文区分は 02 / 03 を Ph.1 で選べ、04 / 06 を Ph.2 として選べなくする', () => {
    expect(
      decorateOptions(
        pick('発注範囲', ORDER_ENTRY_EXECUTION_SCOPE_CODES),
        ORDER_ENTRY_EXECUTION_SCOPE_EXTRAS,
      ),
    ).toEqual([
      { value: '02', label: 'プレ＋レギュラー', group: 'Ph.1（受付対象）' },
      { value: '03', label: 'レギュラー', group: 'Ph.1（受付対象）' },
      {
        value: '04',
        label: 'プレ＋レギュラー＋アフター（Ph.2予定）',
        group: 'Ph.2（将来対応）',
        disabled: true,
      },
      { value: '06', label: 'アフター（Ph.2予定）', group: 'Ph.2（将来対応）', disabled: true },
    ])
  })

  it('[NOP-07] decorateOptions は飾りの無いコードをそのまま通し、元の選択肢を書き換えない', () => {
    const options = [
      { value: '1', label: 'A' },
      { value: '2', label: 'B' },
    ]

    expect(decorateOptions(options, { 2: { disabled: true, labelSuffix: '（注）' } })).toEqual([
      { value: '1', label: 'A' },
      { value: '2', label: 'B（注）', disabled: true },
    ])
    expect(options[1]).toEqual({ value: '2', label: 'B' })
  })
})
