import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMarketStatus } from './marketStatus'

/*
 * 純関数のテストの見本。
 * 日付は UTC の ISO 文字列で作るため、実行環境のタイムゾーンに依存しない。
 * 2026 年の夏時間は 3/8 開始・11/1 終了なので、3/2 は EST(UTC-5)、8/3 は EDT(UTC-4)。
 */
afterEach(() => {
  vi.useRealTimers()
})

// シナリオ: docs/unit/utils-market-status.md
describe('getMarketStatus', () => {
  it('[MKS-01] NY 03:59 は休場', () => {
    expect(getMarketStatus(new Date('2026-03-02T08:59:00Z'))).toEqual({
      key: 'closed',
      label: '○ Closed',
    })
  })

  it('[MKS-02] NY 04:00 でプレマーケットが始まる', () => {
    expect(getMarketStatus(new Date('2026-03-02T09:00:00Z'))).toEqual({
      key: 'premarket',
      label: '● Pre-Market',
    })
  })

  it('[MKS-03] NY 09:29 はまだプレマーケット', () => {
    expect(getMarketStatus(new Date('2026-03-02T14:29:00Z')).key).toBe('premarket')
  })

  it('[MKS-04] NY 09:30 で通常取引が始まる', () => {
    expect(getMarketStatus(new Date('2026-03-02T14:30:00Z'))).toEqual({
      key: 'regular',
      label: '● Regular',
    })
  })

  it('[MKS-05] NY 15:59 はまだ通常取引', () => {
    expect(getMarketStatus(new Date('2026-03-02T20:59:00Z')).key).toBe('regular')
  })

  it('[MKS-06] NY 16:00 で時間外取引が始まる', () => {
    expect(getMarketStatus(new Date('2026-03-02T21:00:00Z'))).toEqual({
      key: 'afterhours',
      label: '● After-Hours',
    })
  })

  it('[MKS-07] NY 19:59 はまだ時間外取引', () => {
    expect(getMarketStatus(new Date('2026-03-03T00:59:00Z')).key).toBe('afterhours')
  })

  it('[MKS-08] NY 20:00 で休場に戻る', () => {
    expect(getMarketStatus(new Date('2026-03-03T01:00:00Z')).key).toBe('closed')
  })

  it('[MKS-09] 夏時間の NY 09:30 は通常取引', () => {
    expect(getMarketStatus(new Date('2026-08-03T13:30:00Z')).key).toBe('regular')
  })

  it('[MKS-10] 夏時間の NY 16:30 は時間外取引', () => {
    expect(getMarketStatus(new Date('2026-08-03T20:30:00Z')).key).toBe('afterhours')
  })

  it('[MKS-11] 引数を省略すると現在時刻で判定する', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-02T14:30:00Z'))

    expect(getMarketStatus().key).toBe('regular')
  })
})
