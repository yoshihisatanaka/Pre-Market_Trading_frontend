import { describe, expect, it } from 'vitest'
import { SPECIFIC_DEPOSIT } from './apiEnums'
import { DEPOSIT_CATEGORY, SIDE } from './orderEntryOptions'
import {
  buildOrderEntryQuery,
  holdingOrderQuery,
  parseOrderEntryQuery,
  toDepositCategory,
} from './orderEntryQuery'

const CUSTOMER = { branchCode: '123', accountNumber: '1230001' }
const holding = (overrides = {}) => ({
  ticker: 'AAPL',
  symbolCode: 'US0378331005',
  specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC,
  ...overrides,
})

const EMPTY = { branchCode: '', accountNumber: '', ticker: '', side: '', depositCategory: '' }

// シナリオ: docs/unit/utils-order-entry-query.md
describe('utils/orderEntryQuery', () => {
  it('[OEQ-01] 特定預り区分を注文の預り売買区分に読み替える', () => {
    expect(toDepositCategory(SPECIFIC_DEPOSIT.SPECIFIC)).toBe(DEPOSIT_CATEGORY.SPECIFIC)
    expect(toDepositCategory(SPECIFIC_DEPOSIT.NON_SPECIFIC)).toBe(DEPOSIT_CATEGORY.GENERAL)
    expect(toDepositCategory(SPECIFIC_DEPOSIT.GROWTH_QUOTA)).toBe(DEPOSIT_CATEGORY.GROWTH)
  })

  it('[OEQ-02] 対応する預り売買区分の無い値は空にする', () => {
    for (const value of [
      SPECIFIC_DEPOSIT.NISA,
      SPECIFIC_DEPOSIT.CONTINUING_ACCOUNT,
      '',
      '9',
      undefined,
    ]) {
      expect(toDepositCategory(value), String(value)).toBe('')
    }
  })

  it('[OEQ-03] 全項目をクエリにし、売買は向きの名前で載せる', () => {
    const values = {
      branchCode: '123',
      accountNumber: '1230001',
      ticker: 'AAPL',
      depositCategory: DEPOSIT_CATEGORY.GENERAL,
    }

    expect(buildOrderEntryQuery({ ...values, side: SIDE.BUY })).toEqual({
      branch_code: values.branchCode,
      account_number: values.accountNumber,
      ticker: values.ticker,
      side: 'buy',
      deposit: values.depositCategory,
    })
    expect(buildOrderEntryQuery({ ...values, side: SIDE.SELL }).side).toBe('sell')
  })

  it('[OEQ-04] 空の値はキーごと載せない', () => {
    expect(buildOrderEntryQuery()).toEqual({})
    expect(
      buildOrderEntryQuery({
        branchCode: '',
        accountNumber: '',
        ticker: '',
        side: '',
        depositCategory: '',
      }),
    ).toEqual({})
    expect(buildOrderEntryQuery({ branchCode: '123', side: '9' })).toEqual({ branch_code: '123' })
  })

  it('[OEQ-05] 預りの明細から顧客・銘柄・売買・預り区分を引き継ぐ', () => {
    const row = holding()

    for (const [side, name] of [
      [SIDE.SELL, 'sell'],
      [SIDE.BUY, 'buy'],
    ]) {
      expect(holdingOrderQuery(CUSTOMER, row, side)).toEqual({
        branch_code: CUSTOMER.branchCode,
        account_number: CUSTOMER.accountNumber,
        ticker: row.ticker,
        side: name,
        deposit: DEPOSIT_CATEGORY.SPECIFIC,
      })
    }
  })

  it('[OEQ-06] 成長投資枠の明細の買いは預り区分を引き継がない', () => {
    const row = holding({ specificDeposit: SPECIFIC_DEPOSIT.GROWTH_QUOTA })

    expect(holdingOrderQuery(CUSTOMER, row, SIDE.BUY)).not.toHaveProperty('deposit')
    expect(holdingOrderQuery(CUSTOMER, row, SIDE.SELL).deposit).toBe(DEPOSIT_CATEGORY.GROWTH)
  })

  it('[OEQ-07] ティッカーや対応する預り区分が無ければ載せない', () => {
    const query = holdingOrderQuery(
      CUSTOMER,
      holding({ ticker: '', specificDeposit: SPECIFIC_DEPOSIT.NISA }),
      SIDE.SELL,
    )

    expect(query).toEqual({
      branch_code: CUSTOMER.branchCode,
      account_number: CUSTOMER.accountNumber,
      side: 'sell',
    })
  })

  it('[OEQ-08] 正しいクエリを入力欄の初期値に読む', () => {
    expect(
      parseOrderEntryQuery({
        branch_code: ' 123 ',
        account_number: '1230001',
        ticker: ' aapl ',
        side: 'sell',
        deposit: DEPOSIT_CATEGORY.GROWTH,
      }),
    ).toEqual({
      branchCode: '123',
      accountNumber: '1230001',
      ticker: 'AAPL',
      side: SIDE.SELL,
      depositCategory: DEPOSIT_CATEGORY.GROWTH,
    })
    expect(parseOrderEntryQuery({ side: 'buy' }).side).toBe(SIDE.BUY)
  })

  it('[OEQ-09] 読めない値は空に落とす', () => {
    expect(
      parseOrderEntryQuery({
        account_number: '12a',
        side: 'hold',
        deposit: SPECIFIC_DEPOSIT.NISA,
        ticker: ['a', 'b'],
        branch_code: ['123'],
      }),
    ).toEqual(EMPTY)
    expect(parseOrderEntryQuery()).toEqual(EMPTY)
  })

  it('[OEQ-10] 組み立てたクエリを読むと同じ値に戻る', () => {
    const values = {
      branchCode: '123',
      accountNumber: '1230001',
      ticker: 'MSFT',
      side: SIDE.SELL,
      depositCategory: DEPOSIT_CATEGORY.GENERAL,
    }

    expect(parseOrderEntryQuery(buildOrderEntryQuery(values))).toEqual(values)
  })
})
