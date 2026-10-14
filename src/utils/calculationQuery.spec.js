import { describe, expect, it } from 'vitest'
import { SPECIFIC_DEPOSIT } from './apiEnums'
import {
  buildCalculationQuery,
  holdingCalculationQuery,
  parseCalculationQuery,
} from './calculationQuery'
import { SIDE } from './orderEntryOptions'

/** src/api/holdings.js の Holding のうち、引き継ぎに使う項目だけ */
const holdingOf = (overrides = {}) => ({
  ticker: 'AAPL',
  symbolCode: 'A0001',
  specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC,
  sellableQuantity: 80,
  referencePrice: 227.16,
  ...overrides,
})

/** 既定の明細（AAPL 特定）が載せる数量・単価 */
const HOLDING_DEFAULTS = { quantity: '80', unit_price: '227.16' }

const EMPTY = { symbol: '', side: '', specificDeposit: '', quantity: '', unitPrice: '' }

// シナリオ: docs/unit/utils-calculation-query.md
describe('calculationQuery', () => {
  it('[CQY-01] 全項目を URL の名前で載せ、売買は buy / sell にする', () => {
    const values = { symbol: 'AAPL', specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC }

    expect(buildCalculationQuery({ ...values, side: SIDE.BUY })).toEqual({
      symbol: 'AAPL',
      side: 'buy',
      specific_deposit: SPECIFIC_DEPOSIT.SPECIFIC,
    })
    expect(buildCalculationQuery({ ...values, side: SIDE.SELL }).side).toBe('sell')
  })

  it('[CQY-02] 空の値・読めない値はキーごと載らない', () => {
    expect(buildCalculationQuery()).toEqual({})
    expect(buildCalculationQuery({ symbol: '', side: '', specificDeposit: '' })).toEqual({})
    expect(buildCalculationQuery({ symbol: 'AAPL', side: '9' })).toEqual({ symbol: 'AAPL' })
    expect(
      buildCalculationQuery({ symbol: 'AAPL', specificDeposit: SPECIFIC_DEPOSIT.NISA }),
    ).toEqual({ symbol: 'AAPL' })
  })

  it('[CQY-03] 預りの明細はティッカー・売り・特定預り区分・売却可能数量・現在値を渡す', () => {
    for (const specificDeposit of [
      SPECIFIC_DEPOSIT.SPECIFIC,
      SPECIFIC_DEPOSIT.GROWTH_QUOTA,
      SPECIFIC_DEPOSIT.NON_SPECIFIC,
    ]) {
      expect(holdingCalculationQuery(holdingOf({ specificDeposit })), specificDeposit).toEqual({
        symbol: 'AAPL',
        side: 'sell',
        specific_deposit: specificDeposit,
        ...HOLDING_DEFAULTS,
      })
    }
  })

  it('[CQY-04] ティッカーが無ければ銘柄コード、NISA（旧）は預り区分を載せない', () => {
    expect(holdingCalculationQuery(holdingOf({ ticker: '' }))).toEqual({
      symbol: 'A0001',
      side: 'sell',
      specific_deposit: SPECIFIC_DEPOSIT.SPECIFIC,
      ...HOLDING_DEFAULTS,
    })
    expect(holdingCalculationQuery(holdingOf({ specificDeposit: SPECIFIC_DEPOSIT.NISA }))).toEqual({
      symbol: 'AAPL',
      side: 'sell',
      ...HOLDING_DEFAULTS,
    })
  })

  it('[CQY-05] 正しいクエリは空白を落とし、銘柄は大文字、売買はコードで読む', () => {
    expect(
      parseCalculationQuery({
        symbol: ' aapl ',
        side: 'sell',
        specific_deposit: ` ${SPECIFIC_DEPOSIT.GROWTH_QUOTA}`,
      }),
    ).toEqual({
      ...EMPTY,
      symbol: 'AAPL',
      side: SIDE.SELL,
      specificDeposit: SPECIFIC_DEPOSIT.GROWTH_QUOTA,
    })
    expect(parseCalculationQuery({ side: 'buy' }).side).toBe(SIDE.BUY)
  })

  it('[CQY-06] 読めない値はすべて空に落とす', () => {
    expect(
      parseCalculationQuery({
        symbol: ['a', 'b'],
        side: 'hold',
        specific_deposit: SPECIFIC_DEPOSIT.NISA,
      }),
    ).toEqual(EMPTY)
    expect(parseCalculationQuery()).toEqual(EMPTY)
  })

  it('[CQY-07] 組み立てたクエリを読むと元の値に戻る', () => {
    const values = {
      symbol: 'NVDA',
      side: SIDE.SELL,
      specificDeposit: SPECIFIC_DEPOSIT.NON_SPECIFIC,
      quantity: '200',
      unitPrice: '127.25',
    }
    expect(parseCalculationQuery(buildCalculationQuery(values))).toEqual(values)
  })

  it('[CQY-08] 数量・単価は数値でも文字列でも文字列で載り、形に合わない値は載らない', () => {
    expect(buildCalculationQuery({ quantity: 80, unitPrice: 227.16 })).toEqual(HOLDING_DEFAULTS)
    expect(buildCalculationQuery({ quantity: ' 10 ', unitPrice: '1.5' })).toEqual({
      quantity: '10',
      unit_price: '1.5',
    })

    for (const quantity of [0, -1, 1.5, 'abc', null, '1234567890']) {
      expect(buildCalculationQuery({ symbol: 'AAPL', quantity }), String(quantity)).toEqual({
        symbol: 'AAPL',
      })
    }
    for (const unitPrice of [0, -1, 'abc', null, '12345678', '1.123456789']) {
      expect(buildCalculationQuery({ symbol: 'AAPL', unitPrice }), String(unitPrice)).toEqual({
        symbol: 'AAPL',
      })
    }
  })

  it('[CQY-09] 売却可能株数・前日終値の無い明細は数量・単価を載せない（0 株も載せない）', () => {
    const withoutDefaults = { symbol: 'AAPL', side: 'sell', specific_deposit: SPECIFIC_DEPOSIT.SPECIFIC }

    expect(
      holdingCalculationQuery(holdingOf({ sellableQuantity: null, referencePrice: null })),
    ).toEqual(withoutDefaults)
    expect(holdingCalculationQuery(holdingOf({ sellableQuantity: 0 }))).toEqual({
      ...withoutDefaults,
      unit_price: '227.16',
    })
  })

  it('[CQY-10] 数量・単価は入力欄と同じ形だけ読み、読めない値は空', () => {
    expect(parseCalculationQuery({ quantity: ' 80 ', unit_price: '227.16' })).toEqual({
      ...EMPTY,
      quantity: '80',
      unitPrice: '227.16',
    })

    for (const quantity of ['0', '1.5', '1234567890', 'abc']) {
      expect(parseCalculationQuery({ symbol: 'AAPL', quantity }), quantity).toEqual({
        ...EMPTY,
        symbol: 'AAPL',
      })
    }
    for (const unitPrice of ['0', '-1', '12345678', '1.123456789', ['1', '2']]) {
      expect(parseCalculationQuery({ symbol: 'AAPL', unit_price: unitPrice }), String(unitPrice)).toEqual(
        { ...EMPTY, symbol: 'AAPL' },
      )
    }
  })
})
