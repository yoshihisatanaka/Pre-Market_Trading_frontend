import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { toMarketDisplay } from '@/utils/marketStatus'
import { useMarketStatusStore } from '@/stores/marketStatus'
import { useMarketStatus } from './useMarketStatus'

/*
 * 「境界タイマーと後片付け」だけを見る。
 *
 *   - 初回はマウント直後に値がある
 *   - sessions の境界に達したら判定し直す（時計を直接読み直しているのではない）
 *   - サーバへは取り直しに行かない（通信は main.js の起動時 1 回だけ）
 *   - アンマウントで自分のタイマーだけが止まる
 *
 * セッションの境界・休場・取得失敗の見え方は utils/marketStatus（MKS-14〜30）の担当なので
 * ここでは作り直さず、期待値も toMarketDisplay() の戻り値と突き合わせる。
 * **通信は起こさない**（store に値を直接置く）。
 *
 * UMS-07（5 分ごとの再取得）は再取得をやめたので削除した。番号は振り直していない。
 *
 * シナリオ: docs/unit/composables-use-market-status.md
 */

const PRE_END = Date.parse('2026-03-02T23:30:00+09:00')
const REGULAR_END = Date.parse('2026-03-03T06:00:00+09:00')
const AFTER_END = Date.parse('2026-03-03T10:00:00+09:00')

/** レギュラーの終了（JST 翌 06:00）の 30 秒手前。境界の前後を値の差で見分けられる */
const MOUNT_AT = REGULAR_END - 30_000
const TO_BOUNDARY = REGULAR_END - MOUNT_AT

const session = (code, name, startJst, endJst) => ({
  code,
  name,
  nameEn: code,
  hoursJst: '',
  hoursEt: '',
  startJst,
  endJst,
  current: false,
})

const regularDay = {
  baseDate: '2026-03-02',
  nowJst: '',
  nowEt: '',
  dst: false,
  extendedPre: false,
  closed: false,
  closedReason: '',
  shortened: false,
  shortenedReason: '',
  session: 'REGULAR',
  sessionName: 'レギュラー',
  sessionNameEn: 'Regular',
  sessions: [
    session('PRE', 'プレ', '2026-03-02T18:00:00+09:00', '2026-03-02T23:30:00+09:00'),
    session('REGULAR', 'レギュラー', '2026-03-02T23:30:00+09:00', '2026-03-03T06:00:00+09:00'),
    session('AFTER', 'アフター', '2026-03-03T06:00:00+09:00', '2026-03-03T10:00:00+09:00'),
  ],
}

const closedDay = {
  ...regularDay,
  baseDate: '2026-11-26',
  closed: true,
  closedReason: '感謝祭',
  session: 'CLOSED',
  sessions: [],
}

/** 絶対時刻 ms 時点の、正しい表示内容 */
const displayAt = (ms, status = regularDay) => toMarketDisplay(status, ms)

/** composable を setup で呼ぶだけのホストをマウントし、computed をそのまま取り出す */
function mountHost() {
  let market = null
  const wrapper = mount({
    setup() {
      market = useMarketStatus()
      return () => h('span', market.value.label)
    },
  })
  return { wrapper, market }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(MOUNT_AT)
  // 起動時の取得は main.js が済ませている前提（この composable は取りに行かない）
  useMarketStatusStore().status = regularDay
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useMarketStatus', () => {
  it('[UMS-01] マウント直後にその時刻の表示内容を返す', () => {
    const { market } = mountHost()

    expect(market.value).toEqual(displayAt(MOUNT_AT))
    expect(market.value.key).toBe('regular')
  })

  it('[UMS-02] 境界の手前では再判定しない', () => {
    const { market } = mountHost()

    vi.advanceTimersByTime(TO_BOUNDARY - 1)

    expect(market.value).toEqual(displayAt(MOUNT_AT))
  })

  it('[UMS-03] 境界ちょうどでその時点の表示内容に変わる', () => {
    const { market } = mountHost()

    vi.advanceTimersByTime(TO_BOUNDARY)

    expect(market.value).toEqual(displayAt(REGULAR_END))
    expect(market.value.key).toBe('afterhours')
  })

  it('[UMS-04] 境界ごとに繰り返し切り替わる', () => {
    const start = PRE_END - 60_000
    vi.setSystemTime(start)
    const { market } = mountHost()
    expect(market.value.key).toBe('premarket')

    vi.advanceTimersByTime(PRE_END - start)
    expect(market.value.key).toBe('regular')

    vi.advanceTimersByTime(REGULAR_END - PRE_END)
    expect(market.value.key).toBe('afterhours')

    vi.advanceTimersByTime(AFTER_END - REGULAR_END)
    expect(market.value).toEqual(displayAt(AFTER_END))
    expect(market.value.key).toBe('closed')
  })

  it('[UMS-05] アンマウントするとタイマーが止まる', () => {
    const { wrapper, market } = mountHost()

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(TO_BOUNDARY)

    expect(market.value).toEqual(displayAt(MOUNT_AT))
  })

  it('[UMS-06] 片方をアンマウントしても、残った方は更新される', () => {
    const removed = mountHost()
    const kept = mountHost()

    removed.wrapper.unmount()
    vi.advanceTimersByTime(TO_BOUNDARY)

    expect(removed.market.value).toEqual(displayAt(MOUNT_AT))
    expect(kept.market.value).toEqual(displayAt(REGULAR_END))
  })

  it('[UMS-08] 時間が経ってもサーバへ取り直しに行かない', () => {
    const store = useMarketStatusStore()
    const load = vi.spyOn(store, 'load').mockResolvedValue(null)
    mountHost()

    vi.advanceTimersByTime(24 * 60 * 60 * 1000)

    expect(load).not.toHaveBeenCalled()
  })

  it('[UMS-09] 最後の境界を過ぎるとタイマーが残らない', () => {
    const { market } = mountHost()

    vi.advanceTimersByTime(AFTER_END - MOUNT_AT)

    expect(vi.getTimerCount()).toBe(0)
    expect(market.value.key).toBe('closed')
  })

  it('[UMS-10] あとから status が入ると境界の予約が始まる', async () => {
    const store = useMarketStatusStore()
    store.status = null
    const { market } = mountHost()
    expect(market.value.key).toBe('unknown')
    expect(vi.getTimerCount()).toBe(0)

    store.status = regularDay
    await nextTick()

    expect(market.value).toEqual(displayAt(MOUNT_AT))
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(TO_BOUNDARY)
    expect(market.value.key).toBe('afterhours')
  })

  it('[UMS-11] 休場の日はタイマーを予約しない', () => {
    useMarketStatusStore().status = closedDay
    const { market } = mountHost()

    expect(vi.getTimerCount()).toBe(0)
    expect(market.value).toEqual(displayAt(MOUNT_AT, closedDay))
  })
})
