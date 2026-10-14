import { describe, expect, it } from 'vitest'
import { HOLIDAY_TYPE } from './apiEnums'
import {
  MARKET_HOLIDAY_EARLY_CLOSE_LABEL,
  MARKET_HOLIDAY_TYPE_DEFAULT,
  formatMarketHolidayEarlyClose,
  isShortTradingDay,
} from './marketHolidayTypes'

/*
 * 純関数のテスト。区分の表示名と選択肢はコードマスタ `海外休場区分` から来る（stores/codes.js）ので、
 * ここは短縮取引日の判定と表示・既定値だけを見る。
 */
const FULL_DAY = HOLIDAY_TYPE.ALL_DAY
const SHORTENED = HOLIDAY_TYPE.SHORTENED

// 未知の値の表現。他の列の空値表現と同じ em dash
const UNKNOWN_LABEL = '—'
// HolidayTypeEnum に無いコード（区分が増えても衝突しないものを選ぶ）
const UNKNOWN_CODE = (() => {
  for (const code of ['9', '8', '7']) {
    if (!Object.values(HOLIDAY_TYPE).includes(code)) return code
  }
  throw new Error('区分に無いコードが見つからなかった')
})()

// シナリオ: docs/unit/utils-market-holiday-types.md
describe('MARKET_HOLIDAY_TYPE_DEFAULT', () => {
  it('[MHT-07] 既定値は終日休場のコード', () => {
    expect(MARKET_HOLIDAY_TYPE_DEFAULT).toBe(FULL_DAY)
  })
})

describe('短縮取引日の判定と表示', () => {
  it('[MHT-09] 短縮取引のコードだけが短縮取引日になる', () => {
    expect(isShortTradingDay(SHORTENED)).toBe(true)
    for (const value of [FULL_DAY, UNKNOWN_CODE, '', undefined, null, 0, 1]) {
      expect(isShortTradingDay(value)).toBe(false)
    }
  })

  it('[MHT-10] 短縮取引日は終了時刻の文言、それ以外は em dash になる', () => {
    expect(formatMarketHolidayEarlyClose(SHORTENED)).toBe(MARKET_HOLIDAY_EARLY_CLOSE_LABEL)
    for (const value of [FULL_DAY, UNKNOWN_CODE, '', undefined, null, 0]) {
      expect(formatMarketHolidayEarlyClose(value)).toBe(UNKNOWN_LABEL)
    }
  })
})
