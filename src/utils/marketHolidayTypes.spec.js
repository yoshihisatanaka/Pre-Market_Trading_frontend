import { describe, expect, it } from 'vitest'
import {
  MARKET_HOLIDAY_TYPE_DEFAULT,
  MARKET_HOLIDAY_TYPE_OPTIONS,
  formatMarketHolidayType,
  isMarketHolidayType,
} from './marketHolidayTypes'

/*
 * 純関数のテスト。
 * 期待する表示名は選択肢の定義から引く（「終日休場」などを直接書かない）。
 * 選択肢が増えても、コードと表示名の対応そのものを検証し続けられるようにするため。
 */
const FULL_DAY = MARKET_HOLIDAY_TYPE_OPTIONS[0]
const SHORTENED = MARKET_HOLIDAY_TYPE_OPTIONS[1]

// 未知の値の表現。他の列の空値表現と同じ em dash
const UNKNOWN_LABEL = '—'
// 選択肢に無いコード（選択肢が増えても衝突しないものを選ぶ）
const UNKNOWN_CODE = (() => {
  for (const code of ['9', '8', '7']) {
    if (!MARKET_HOLIDAY_TYPE_OPTIONS.some((option) => option.value === code)) return code
  }
  throw new Error('選択肢に無いコードが見つからなかった')
})()

// シナリオ: docs/unit/utils-market-holiday-types.md
describe('formatMarketHolidayType', () => {
  it('[MHT-01] 終日休場のコードを表示名に変換する', () => {
    expect(formatMarketHolidayType(FULL_DAY.value)).toBe(FULL_DAY.label)
  })

  it('[MHT-02] 短縮取引のコードを表示名に変換する', () => {
    expect(formatMarketHolidayType(SHORTENED.value)).toBe(SHORTENED.label)
  })

  it('[MHT-03] 選択肢に無いコードは em dash になる', () => {
    expect(formatMarketHolidayType(UNKNOWN_CODE)).toBe(UNKNOWN_LABEL)
  })

  it('[MHT-04] 空値や型違いも em dash になる', () => {
    // 実 API が値を返さない / 別の型で返す場合でも列が壊れないことを保証する
    for (const value of ['', undefined, null, 0]) {
      expect(formatMarketHolidayType(value)).toBe(UNKNOWN_LABEL)
    }
  })
})

describe('isMarketHolidayType', () => {
  it('[MHT-05] 選択肢に定義された全コードを受け付ける', () => {
    for (const option of MARKET_HOLIDAY_TYPE_OPTIONS) {
      expect(isMarketHolidayType(option.value)).toBe(true)
    }
  })

  it('[MHT-06] 選択肢に無い値・空値・型違いは受け付けない', () => {
    // URL クエリ由来の値をそのまま検索条件にしないための番人
    for (const value of [UNKNOWN_CODE, '', undefined, null, 0]) {
      expect(isMarketHolidayType(value)).toBe(false)
    }
  })
})

describe('MARKET_HOLIDAY_TYPE_DEFAULT', () => {
  it('[MHT-07] 既定値は選択肢の先頭のコードで、判定も通る', () => {
    expect(MARKET_HOLIDAY_TYPE_DEFAULT).toBe(FULL_DAY.value)
    expect(isMarketHolidayType(MARKET_HOLIDAY_TYPE_DEFAULT)).toBe(true)
  })
})
