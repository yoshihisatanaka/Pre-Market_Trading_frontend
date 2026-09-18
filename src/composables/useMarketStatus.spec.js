import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { toMarketDisplay } from '@/utils/marketStatus'
import { useMarketStatusStore } from '@/stores/marketStatus'
import { useMarketStatus } from './useMarketStatus'

/*
 * 「2 本のタイマーと後片付け」だけを見る。
 *
 *   - 初回はマウント直後に値がある（1 分待たせない）
 *   - 60 秒ごとに現在セッションを判定し直す（時計を直接読み直しているのではない）
 *   - 5 分ごとにサーバへ取り直しに行く
 *   - アンマウントで自分のタイマーだけが止まる
 *
 * セッションの境界・休場・取得失敗の見え方は utils/marketStatus（MKS-14〜27）の担当なので
 * ここでは作り直さず、期待値も toMarketDisplay() の戻り値と突き合わせる。
 * **通信は起こさない**（store に値を直接置き、再取得は store.load を差し替えて確かめる）。
 *
 * シナリオ: docs/unit/composables-use-market-status.md
 */

const TICK_MS = 60_000
const RELOAD_MS = 300_000

/** レギュラーの終了（JST 翌 06:00）の 30 秒手前。ティックの有無を値の差で見分けられる */
const MOUNT_AT = Date.parse('2026-03-03T05:59:30+09:00')

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

/** マウント時刻から offsetMs 経過した時点の、正しい表示内容 */
function displayAt(offsetMs, status = regularDay) {
  return toMarketDisplay(status, MOUNT_AT + offsetMs)
}

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

    expect(market.value).toEqual(displayAt(0))
    expect(market.value.key).toBe('regular')
  })

  it('[UMS-02] 間隔に満たない経過では再判定しない', () => {
    const { market } = mountHost()

    // この間にレギュラーの終了を越える（時計を直接読めば値が変わるはずの区間）
    expect(displayAt(TICK_MS - 1)).not.toEqual(displayAt(0))

    vi.advanceTimersByTime(TICK_MS - 1)

    expect(market.value).toEqual(displayAt(0))
  })

  it('[UMS-03] 間隔ぶん経過するとその時点の表示内容に変わる', () => {
    const { market } = mountHost()

    vi.advanceTimersByTime(TICK_MS)

    expect(market.value).toEqual(displayAt(TICK_MS))
    expect(market.value.key).toBe('afterhours')
  })

  it('[UMS-04] 間隔ごとに繰り返し再判定される', () => {
    // 1 回目のティックではまだ境界に届かない位置から始める
    vi.setSystemTime(MOUNT_AT - TICK_MS)
    const { market } = mountHost()

    vi.advanceTimersByTime(TICK_MS)
    expect(market.value).toEqual(displayAt(0))

    vi.advanceTimersByTime(TICK_MS)
    expect(market.value).toEqual(displayAt(TICK_MS))
  })

  it('[UMS-05] アンマウントすると 2 本とも止まる', () => {
    const { wrapper, market } = mountHost()

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(RELOAD_MS)

    expect(market.value).toEqual(displayAt(0))
  })

  it('[UMS-06] 片方をアンマウントしても、残った方は更新され続ける', () => {
    const removed = mountHost()
    const kept = mountHost()

    removed.wrapper.unmount()
    vi.advanceTimersByTime(TICK_MS)

    expect(removed.market.value).toEqual(displayAt(0))
    expect(kept.market.value).toEqual(displayAt(TICK_MS))
  })

  it('[UMS-07] 5 分ごとに取り直し、その結果が表示に反映される', async () => {
    const store = useMarketStatusStore()
    const load = vi.spyOn(store, 'load').mockImplementation(() => {
      store.status = closedDay
      return Promise.resolve(closedDay)
    })
    const { market } = mountHost()

    vi.advanceTimersByTime(TICK_MS)
    expect(load).not.toHaveBeenCalled()

    vi.advanceTimersByTime(RELOAD_MS - TICK_MS)
    await nextTick()

    expect(load).toHaveBeenCalledTimes(1)
    expect(market.value.label).toBe('○ Closed')
    expect(market.value.note).toBe('休場（感謝祭）')
  })
})
