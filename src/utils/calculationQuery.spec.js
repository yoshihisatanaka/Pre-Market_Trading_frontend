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
  ...overrides,
})

const EMPTY = { symbol: '', side: '', specificDeposit: '' }

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

  it('[CQY-03] 預りの明細はティッカー・売り・特定預り区分をそのまま渡す', () => {
    for (const specificDeposit of [
      SPECIFIC_DEPOSIT.SPECIFIC,
      SPECIFIC_DEPOSIT.GROWTH_QUOTA,
      SPECIFIC_DEPOSIT.NON_SPECIFIC,
    ]) {
      expect(holdingCalculationQuery(holdingOf({ specificDeposit })), specificDeposit).toEqual({
        symbol: 'AAPL',
        side: 'sell',
        specific_deposit: specificDeposit,
      })
    }
  })

  it('[CQY-04] ティッカーが無ければ銘柄コード、NISA（旧）は預り区分を載せない', () => {
    expect(holdingCalculationQuery(holdingOf({ ticker: '' }))).toEqual({
      symbol: 'A0001',
      side: 'sell',
      specific_deposit: SPECIFIC_DEPOSIT.SPECIFIC,
    })
    expect(holdingCalculationQuery(holdingOf({ specificDeposit: SPECIFIC_DEPOSIT.NISA }))).toEqual({
      symbol: 'AAPL',
      side: 'sell',
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
    }
    expect(parseCalculationQuery(buildCalculationQuery(values))).toEqual(values)
  })
})
