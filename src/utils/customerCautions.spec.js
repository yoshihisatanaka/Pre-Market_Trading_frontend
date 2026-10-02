import { describe, expect, it } from 'vitest'
import { CAUTION_RANKS, ELDERLY_AGE, isCautionRank, isElderly, parseAge } from './customerCautions'

// シナリオ: docs/unit/utils-customer-cautions.md
describe('utils/customerCautions', () => {
  it('[CCA-01] 要注意のランクと高齢者の年齢は画面モックの規則どおり', () => {
    expect(CAUTION_RANKS).toEqual(['A', 'B', 'Y', 'Z'])
    expect(ELDERLY_AGE).toBe(85)
    expect(Object.isFrozen(CAUTION_RANKS)).toBe(true)
  })

  it('[CCA-02] parseAge は数字だけの年齢を数値にする', () => {
    expect(parseAge('75')).toBe(75)
    expect(parseAge(' 85 ')).toBe(85)
    expect(parseAge(85)).toBe(85)
  })

  it('[CCA-03] parseAge は読めない年齢を null にする', () => {
    for (const value of ['', null, undefined, '85歳', '8.5', '-1', 'abc']) {
      expect(parseAge(value), String(value)).toBeNull()
    }
  })

  it('[CCA-04] isElderly は ELDERLY_AGE 以上を高齢者とする', () => {
    expect(isElderly(String(ELDERLY_AGE))).toBe(true)
    expect(isElderly(String(ELDERLY_AGE - 1))).toBe(false)
    expect(isElderly(String(ELDERLY_AGE + 1))).toBe(true)
  })

  it('[CCA-05] isElderly は年齢の無い顧客（法人など）を高齢者としない', () => {
    for (const value of ['', null, 'abc']) {
      expect(isElderly(value), String(value)).toBe(false)
    }
  })

  it('[CCA-06] isCautionRank は要注意のランクで true', () => {
    for (const rank of CAUTION_RANKS) {
      expect(isCautionRank(rank), rank).toBe(true)
    }
  })

  it('[CCA-07] isCautionRank はそれ以外で false', () => {
    for (const rank of ['C', 'a', '', null, undefined]) {
      expect(isCautionRank(rank), String(rank)).toBe(false)
    }
  })
})
