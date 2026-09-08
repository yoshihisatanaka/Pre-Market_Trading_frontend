import { describe, expect, it } from 'vitest'
import { toOffset } from './queryParams'

/*
 * 純関数のテスト。
 * toOffset() は表示件数を知らない（丸めをしない）ので、値は素の数値で書いてよい。
 */

// シナリオ: docs/unit/utils-query-params.md
describe('toOffset', () => {
  it('[QRY-01] 表示件数の倍数の文字列を数値にする', () => {
    expect(toOffset('50')).toBe(50)
  })

  it('[QRY-02] 表示件数の倍数でない値も丸めずそのまま通す', () => {
    // 端数の offset はユーザ判断として許容する（その位置から表示件数分を表示する）
    expect(toOffset('7')).toBe(7)
  })

  it('[QRY-03] 0 は 0 のまま', () => {
    expect(toOffset('0')).toBe(0)
  })

  it('[QRY-04] 負の値は 0 になる', () => {
    expect(toOffset('-10')).toBe(0)
  })

  it('[QRY-05] 数字でない文字列や空文字は 0 になる', () => {
    for (const value of ['abc', '', ' ', '--']) {
      expect(toOffset(value)).toBe(0)
    }
  })

  it('[QRY-06] 文字列でない値は 0 になる', () => {
    // route.query の値は未指定なら undefined、?offset=1&offset=2 なら配列になる
    for (const value of [undefined, null, 50, ['50'], {}, true]) {
      expect(toOffset(value)).toBe(0)
    }
  })

  it('[QRY-07] 数字で始まる混在値は先頭の整数部を採る', () => {
    expect(toOffset('7.9')).toBe(7)
    expect(toOffset('12abc')).toBe(12)
  })

  it('[QRY-08] 総件数を超える大きな値もそのまま通す', () => {
    // 上限に収めるのは表示側（BasePagination）の責務で、ここでは切り詰めない
    expect(toOffset('999999')).toBe(999999)
  })
})
