import { describe, expect, it } from 'vitest'
import { EXECUTION_SCOPE_VALUES } from '@/utils/apiEnums'
import { formatUsdUnit } from '@/utils/format'
import {
  MARKET_SCOPE_OPTIONS,
  ORDER_TYPE_OPTIONS,
  marketScopeLabel,
  orderPriceLabel,
  orderStatusLabel,
} from './orderTypes'

// シナリオ: docs/unit/utils-order-types.md
describe('utils/orderTypes', () => {
  it('[ORT-01] 市場区分の選択肢は ExecutionScopeEnum と同じコードが同じ順に並ぶ', () => {
    expect(MARKET_SCOPE_OPTIONS.map((option) => option.value)).toEqual([...EXECUTION_SCOPE_VALUES])
  })

  it('[ORT-02] 市場区分のコードは選択肢の名前になる', () => {
    for (const option of MARKET_SCOPE_OPTIONS) {
      expect(marketScopeLabel(option.value)).toBe(option.label)
    }
    expect(marketScopeLabel('04')).toBe('プレ＋レギュラー＋アフター')
  })

  it('[ORT-03] 知らない市場区分はコードのまま、空値は「—」', () => {
    expect(marketScopeLabel('99')).toBe('99')
    expect(marketScopeLabel('')).toBe('—')
    expect(marketScopeLabel(null)).toBe('—')
    expect(marketScopeLabel(undefined)).toBe('—')
  })

  it('[ORT-04] 処理状況のコードは名前になる', () => {
    expect(orderStatusLabel('003')).toBe('注文中')
    expect(orderStatusLabel('141')).toBe('訂正中断')
    expect(orderStatusLabel('101')).toBe('Dream発注失敗')
    expect(orderStatusLabel('040')).toBe('訂正待ち')
  })

  it('[ORT-05] 知らない処理状況はコードのまま、空値は「—」', () => {
    expect(orderStatusLabel('999')).toBe('999')
    expect(orderStatusLabel('')).toBe('—')
    expect(orderStatusLabel(null)).toBe('—')
  })

  it('[ORT-06] 価格は成行・指値（単価付き）・不明の 3 通りで出る', () => {
    expect(orderPriceLabel('MO', 410)).toBe('成行')
    expect(orderPriceLabel('LO', 410)).toBe(`指値 ${formatUsdUnit(410)}`)
    expect(orderPriceLabel('LO', 410)).toBe('指値 410.00 ドル')
    expect(orderPriceLabel('', 410)).toBe('—')
  })

  it('[ORT-07] 指成区分の選択肢は成行 → 指値の順', () => {
    expect(ORDER_TYPE_OPTIONS).toEqual([
      { value: 'MO', label: '成行' },
      { value: 'LO', label: '指値' },
    ])
  })
})
