import { describe, expect, it } from 'vitest'
import {
  formatCompactMonthDay,
  formatCompactTime,
  formatDateTime,
  formatQuantity,
  formatUsd,
  formatUsdUnit,
} from './format'

/*
 * 表示用の整形。守るのは「空値は '—' でそろえる」ことと「0 を空値として扱わない」ことの 2 点。
 * 相場の 0 と未取得（null）の区別は api 層（src/api/symbols.js）が保っているので、
 * ここで潰すと一覧でその区別が消える。
 *
 * シナリオ: docs/unit/utils-format.md
 */

/** どの関数でも '—' になるべき値 */
const BLANKS = [null, undefined, Number.NaN]

describe('format', () => {
  it('[FMT-01] formatUsd も単位を後置し、通貨記号を前置しない', () => {
    // 2026-09-28 に全画面で単位の後置に揃え、formatUsd は formatUsdUnit の別名になった
    expect(formatUsd(227.16)).toBe('227.16 ドル')
    expect(formatUsd(227.16)).toBe(formatUsdUnit(227.16))
  })

  it('[FMT-02] 0 ドルは空値にしない', () => {
    expect(formatUsd(0)).toBe('0.00 ドル')
  })

  it('[FMT-03] formatUsd の空値は — になる', () => {
    for (const blank of BLANKS) {
      expect(formatUsd(blank)).toBe('—')
    }
  })

  it('[FMT-04] 米ドルを「227.16 ドル」の形で整形する', () => {
    expect(formatUsdUnit(227.16)).toBe('227.16 ドル')
  })

  it('[FMT-05] 小数は 2 桁に揃え、整数部は 3 桁区切りにする', () => {
    expect(formatUsdUnit(419.8)).toBe('419.80 ドル')
    expect(formatUsdUnit(1234567.5)).toBe('1,234,567.50 ドル')
  })

  it('[FMT-06] 0 ドルも単位付きで出す', () => {
    expect(formatUsdUnit(0)).toBe('0.00 ドル')
  })

  it('[FMT-07] formatUsdUnit の空値は — になる', () => {
    for (const blank of BLANKS) {
      expect(formatUsdUnit(blank)).toBe('—')
    }
  })

  it('[FMT-08] 数量を 3 桁区切りで整形し、0 はそのまま出す', () => {
    expect(formatQuantity(43_820_000)).toBe('43,820,000')
    expect(formatQuantity(0)).toBe('0')
  })

  it('[FMT-09] formatQuantity の空値は — になる', () => {
    for (const blank of BLANKS) {
      expect(formatQuantity(blank)).toBe('—')
    }
  })

  it('[FMT-10] ISO8601 を YYYY/MM/DD HH:mm に整形する', () => {
    // タイムゾーン指定の無い文字列は現地時刻として読まれるので、
    // コンテナの TZ が何であっても渡した年月日時分がそのまま出る
    expect(formatDateTime('2026-08-20T09:30:00')).toBe('2026/08/20 09:30')
  })

  it('[FMT-11] 空値と日付にならない文字列は — になる', () => {
    expect(formatDateTime('')).toBe('—')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime()).toBe('—')
    // Invalid Date を画面に出さない
    expect(formatDateTime('not-a-date')).toBe('—')
  })

  it('[FMT-12] YYYYMMDD を MM/DD に整形する', () => {
    expect(formatCompactMonthDay('20260826')).toBe('08/26')
  })

  it('[FMT-13] 8 桁の数字でない日付は受け取った値のまま返す', () => {
    for (const value of ['2026-08-26', '2026082']) {
      expect(formatCompactMonthDay(value)).toBe(value)
    }
  })

  it('[FMT-14] formatCompactMonthDay の空値は — になる', () => {
    for (const blank of ['', null, undefined]) {
      expect(formatCompactMonthDay(blank)).toBe('—')
    }
  })

  it('[FMT-15] 4 つの時刻の書き方をどれも HH:MM に整形する', () => {
    for (const value of ['090100', '0901', '09:01', '09:01:00']) {
      expect(formatCompactTime(value)).toBe('09:01')
    }
  })

  it('[FMT-16] どの形にも当たらない時刻は受け取った値のまま返す', () => {
    for (const value of ['9:01', 'abc']) {
      expect(formatCompactTime(value)).toBe(value)
    }
  })

  it('[FMT-17] formatCompactTime の空値は — になる', () => {
    for (const blank of ['', null, undefined]) {
      expect(formatCompactTime(blank)).toBe('—')
    }
  })

  it('[FMT-18] 区切りの混在した時刻も HH:MM に整形する', () => {
    // 今の実装の挙動を固定する（区切りの有無を前後で揃えることまでは見ていない）
    for (const value of ['09:0100', '0901:00']) {
      expect(formatCompactTime(value)).toBe('09:01')
    }
  })
})
