import { describe, expect, it } from 'vitest'
import { formatSignedJpyUnit, formatSignedPercent, profitLossTone } from './profitLoss'

/** 負号（U+2212）。ハイフンより幅がある */
const MINUS = '−'

// シナリオ: docs/unit/utils-profit-loss.md
describe('utils/profitLoss', () => {
  it('[PFL-01] 円は符号付きで単位を付ける', () => {
    expect(formatSignedJpyUnit(407400)).toBe('+407,400 円')
    expect(formatSignedJpyUnit(-151500)).toBe(`${MINUS}151,500 円`)
    expect(formatSignedJpyUnit(0)).toBe('0 円')
  })

  it('[PFL-02] 負号は U+2212 でハイフンではない', () => {
    for (const text of [formatSignedJpyUnit(-1), formatSignedPercent(-1)]) {
      expect(text.startsWith(MINUS), text).toBe(true)
      expect(text.includes('-'), text).toBe(false)
    }
  })

  it('[PFL-03] 値なしは —', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      expect(formatSignedJpyUnit(value), String(value)).toBe('—')
      expect(formatSignedPercent(value), String(value)).toBe('—')
    }
  })

  it('[PFL-04] 率は小数第 2 位まで固定して符号を付ける', () => {
    expect(formatSignedPercent(13.58)).toBe('+13.58%')
    expect(formatSignedPercent(-4.59)).toBe(`${MINUS}4.59%`)
    expect(formatSignedPercent(0)).toBe('0.00%')
    expect(formatSignedPercent(5)).toBe('+5.00%')
    expect(formatSignedPercent(1234.5)).toBe('+1,234.50%')
  })

  it('[PFL-05] 色分けは正が profit、負が loss、0 と値なしは付けない', () => {
    expect(profitLossTone(1)).toBe('profit')
    expect(profitLossTone(-1)).toBe('loss')
    expect(profitLossTone(0)).toBe('')
    expect(profitLossTone(null)).toBe('')
    expect(profitLossTone(Number.NaN)).toBe('')
  })
})
