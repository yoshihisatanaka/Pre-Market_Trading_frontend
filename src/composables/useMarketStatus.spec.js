import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import { getMarketStatus } from '@/utils/marketStatus'
import { useMarketStatus } from './useMarketStatus'

/*
 * 市場ステータスの「定期更新と後片付け」だけを見る。
 *
 *   - 初回はマウント直後に値がある（1 分待たせない）
 *   - 60 秒ごとに再判定される（時計を直接読み直しているのではない）
 *   - アンマウントで自分のタイマーだけが止まる
 *
 * セッションの区切り・夏時間・週末は utils/marketStatus（MKS-01〜13）の担当なので
 * ここでは境界値を作り直さず、期待値も getMarketStatus() の戻り値と突き合わせる。
 *
 * シナリオ: docs/unit/composables-use-market-status.md
 */

// 実装が使う更新間隔（モックの updateMarketStatus と同じ 1 分）
const INTERVAL_MS = 60_000

// MKS-03 / MKS-04 の境界（NY 月曜 09:30 で Pre-Market → Regular）の 30 秒手前
const MOUNT_AT = Date.parse('2026-03-02T14:29:30Z')

/** マウント時刻から offsetMs 経過した時点の、正しいステータス */
function statusAt(offsetMs) {
  return getMarketStatus(new Date(MOUNT_AT + offsetMs))
}

/** composable を setup で呼ぶだけのホストをマウントし、ref をそのまま取り出す */
function mountHost() {
  let status = null
  const wrapper = mount({
    setup() {
      status = useMarketStatus()
      return () => h('span', status.value.label)
    },
  })
  return { wrapper, status }
}

describe('useMarketStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(MOUNT_AT)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[UMS-01] マウント直後にその時刻のステータスを返す', () => {
    const { status } = mountHost()

    expect(status.value).toEqual(statusAt(0))
  })

  it('[UMS-02] 間隔に満たない経過では再判定しない', () => {
    const { status } = mountHost()

    // この間に NY 現地は 09:30 を越える（時計を直接読めば値が変わるはずの区間）
    expect(statusAt(INTERVAL_MS - 1)).not.toEqual(statusAt(0))

    vi.advanceTimersByTime(INTERVAL_MS - 1)

    expect(status.value).toEqual(statusAt(0))
  })

  it('[UMS-03] 間隔ぶん経過するとその時点のステータスに変わる', () => {
    const { status } = mountHost()

    vi.advanceTimersByTime(INTERVAL_MS)

    expect(status.value).toEqual(statusAt(INTERVAL_MS))
    expect(status.value).not.toEqual(statusAt(0))
  })

  it('[UMS-04] 間隔ごとに繰り返し再判定される', () => {
    // 1 回目のティックではまだ境界に届かない位置から始める
    vi.setSystemTime(MOUNT_AT - INTERVAL_MS)
    const { status } = mountHost()

    vi.advanceTimersByTime(INTERVAL_MS)
    expect(status.value).toEqual(statusAt(0))

    vi.advanceTimersByTime(INTERVAL_MS)
    expect(status.value).toEqual(statusAt(INTERVAL_MS))
  })

  it('[UMS-05] アンマウントすると更新が止まる', () => {
    const { wrapper, status } = mountHost()

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(INTERVAL_MS)

    expect(status.value).toEqual(statusAt(0))
  })

  it('[UMS-06] 片方をアンマウントしても、残った方は更新され続ける', () => {
    const removed = mountHost()
    const kept = mountHost()

    removed.wrapper.unmount()
    vi.advanceTimersByTime(INTERVAL_MS)

    expect(removed.status.value).toEqual(statusAt(0))
    expect(kept.status.value).toEqual(statusAt(INTERVAL_MS))
  })
})
