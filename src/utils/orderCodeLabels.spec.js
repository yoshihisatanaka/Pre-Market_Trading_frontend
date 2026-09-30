import { describe, expect, it } from 'vitest'
import { orderCsvColumns } from '@/mocks/fixtures/orderCsv'
import { formatUsdUnit } from './format'
import {
  DEPOSIT_CATEGORY_LABELS,
  EXECUTION_SCOPE_LABELS,
  ORDER_TYPE_LABELS,
  SETTLEMENT_CURRENCY_LABELS,
  SIDE_LABELS,
  TRANSACTION_TYPE_LABELS,
  codeLabel,
  orderPriceLabel,
} from './orderCodeLabels'

/*
 * 区分コード → 名前の表は `GET /orders/csv-spec` の allowed_values の写し。
 * 期待値はフィクスチャ（バックエンドのコードマスタの写し）の列から導き、名前を直接書かない。
 */

/** フィクスチャの列の allowed_values を { code: label } にする */
function allowedOf(name) {
  const column = orderCsvColumns.find((item) => item.name === name)
  return Object.fromEntries(column.allowed_values.map(({ code, label }) => [code, label]))
}

const SIDE_NAMES = allowedOf('売買区分')
const ORDER_TYPE_NAMES = allowedOf('指成区分')
const TRANSACTION_TYPES = allowedOf('取引')
const [FIRST_TRANSACTION_CODE] = Object.keys(TRANSACTION_TYPES)

// シナリオ: docs/unit/utils-order-code-labels.md
describe('utils/orderCodeLabels', () => {
  it('[OCL-01] 決済通貨区分の表がフィクスチャの allowed_values と一致する', () => {
    expect({ ...SETTLEMENT_CURRENCY_LABELS }).toEqual(allowedOf('決済通貨区分'))
  })

  it('[OCL-02] 預り売買区分の表がフィクスチャの allowed_values と一致する', () => {
    expect({ ...DEPOSIT_CATEGORY_LABELS }).toEqual(allowedOf('預り売買区分'))
  })

  it('[OCL-03] 取引の表がフィクスチャの allowed_values と一致する', () => {
    expect({ ...TRANSACTION_TYPE_LABELS }).toEqual(TRANSACTION_TYPES)
  })

  it('[OCL-04] 発注範囲の表がフィクスチャの allowed_values と一致する', () => {
    const expected = allowedOf('発注範囲')

    expect({ ...EXECUTION_SCOPE_LABELS }).toEqual(expected)
    // 0 始まりのキーが整数キーに化けていない
    expect(Object.keys(EXECUTION_SCOPE_LABELS).sort()).toEqual(Object.keys(expected).sort())
  })

  it('[OCL-05] 指成区分の表がフィクスチャの allowed_values と一致する', () => {
    expect({ ...ORDER_TYPE_LABELS }).toEqual(ORDER_TYPE_NAMES)
  })

  it('[OCL-06] 買・売の名前が売買区分の 3 / 1 の名前と一致する', () => {
    expect({ ...SIDE_LABELS }).toEqual({ buy: SIDE_NAMES['3'], sell: SIDE_NAMES['1'] })
  })

  it('[OCL-07] 表にあるコードは名前になる', () => {
    expect(codeLabel(TRANSACTION_TYPE_LABELS, FIRST_TRANSACTION_CODE)).toBe(
      TRANSACTION_TYPES[FIRST_TRANSACTION_CODE],
    )
  })

  it('[OCL-08] 表に無いコードはそのまま返す', () => {
    const unknown = 'ZZZ'
    expect(Object.hasOwn(TRANSACTION_TYPES, unknown)).toBe(false)

    expect(codeLabel(TRANSACTION_TYPE_LABELS, unknown)).toBe(unknown)
  })

  it('[OCL-09] 空のコードは — になる', () => {
    for (const blank of ['', null, undefined]) {
      expect(codeLabel(TRANSACTION_TYPE_LABELS, blank)).toBe('—')
    }
  })

  it('[OCL-10] 継承したキーは名前にならず、そのまま返す', () => {
    for (const key of ['toString', 'constructor']) {
      expect(codeLabel(TRANSACTION_TYPE_LABELS, key)).toBe(key)
    }
  })

  it('[OCL-11] 成行は指値単価があっても成行とだけ出す', () => {
    for (const limitPrice of [150, null]) {
      expect(orderPriceLabel({ orderType: 'MO', limitPrice })).toBe(ORDER_TYPE_NAMES.MO)
    }
  })

  it('[OCL-12] 指値は名前の後に単価を続ける', () => {
    const limitPrice = 155.5

    expect(orderPriceLabel({ orderType: 'LO', limitPrice })).toBe(
      `${ORDER_TYPE_NAMES.LO} ${formatUsdUnit(limitPrice)}`,
    )
  })

  it('[OCL-13] 指値で単価が無いときは「指値 —」になる', () => {
    // 今の実装の挙動を固定する（NG 行の表示。意図の確認は報告に回した）
    expect(orderPriceLabel({ orderType: 'LO', limitPrice: null })).toBe(`${ORDER_TYPE_NAMES.LO} —`)
  })

  it('[OCL-14] 知らない指成区分と空の指成区分は — になる', () => {
    for (const orderType of ['XX', '']) {
      expect(orderPriceLabel({ orderType, limitPrice: 150 })).toBe('—')
    }
  })
})
