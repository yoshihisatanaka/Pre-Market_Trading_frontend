import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  incidentBannerResponse,
  noneBannerResponse,
  noticeBannerResponse,
} from '@/mocks/fixtures/banner'
import { useBannerStore } from '@/stores/banner'
import { toBannerDisplay } from '@/utils/operationBanner'
import { BANNER_REFRESH_MS, DISMISSED_STORAGE_KEY, useOperationBanner } from './useOperationBanner'

/*
 * 「取り直しの時計」と「閉じた状態」だけを見る。表示内容の組み立ては utils（OBU）の担当なので、
 * 期待値は toBannerDisplay() の戻り値と突き合わせる。
 *
 * **通信は起こさない**（store に値を直接置き、store.load は差し替えて回数だけ見る）。
 * タブの表裏は document.hidden を差し替え、visibilitychange を送って再現する。
 */

/** fixtures の生の値を Banner モデルに写す（api/banner.js の toBanner() と同じ写し方） */
const toModel = (raw) => ({
  kind: raw.種別,
  severity: raw.重要度,
  message: raw.メッセージ ?? '',
  ordersSuspended: raw.発注停止中,
  suspendedTargets: raw.停止中の対象,
  suspendedTargetNames: raw.停止中の対象名,
  announcementVisible: raw.お知らせ表示中,
  announcementMessage: raw.お知らせ本文 ?? '',
})

const incident = toModel(incidentBannerResponse)
const notice = toModel(noticeBannerResponse)
const none = toModel(noneBannerResponse)

const OTHER_MESSAGE = '10月10日 06:00〜07:00 に計画メンテナンスを予定しています（テスト）。'

let hidden = false

function setHidden(value) {
  hidden = value
}

function sendVisibilityChange(value) {
  setHidden(value)
  document.dispatchEvent(new Event('visibilitychange'))
}

/** composable を setup で呼ぶだけのホストをマウントする */
function mountHost() {
  let banner = null
  const wrapper = mount({
    setup() {
      banner = useOperationBanner()
      return () => h('span', banner.display.value?.message ?? '')
    },
  })
  return { wrapper, display: banner.display, dismiss: banner.dismiss }
}

/** store.load を差し替え、呼ばれた回数を数える */
const spyLoad = (store) => vi.spyOn(store, 'load').mockResolvedValue(null)

let mounted = []

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  sessionStorage.clear()
  setHidden(false)
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
})

afterEach(() => {
  mounted.forEach((wrapper) => wrapper.unmount())
  mounted = []
  // インスタンスに生やしたプロパティを外すと、jsdom 本来のゲッタに戻る
  delete document.hidden
  vi.restoreAllMocks()
  vi.useRealTimers()
  sessionStorage.clear()
})

/** afterEach でアンマウントするホスト（リスナを次のテストに持ち越さない） */
function mountTracked() {
  const host = mountHost()
  mounted.push(host.wrapper)
  return host
}

// シナリオ: docs/unit/composables-use-operation-banner.md
describe('useOperationBanner', () => {
  it('[UOB-01] マウント直後にストアの内容から組んだ表示内容を返す', () => {
    useBannerStore().banner = notice

    const { display } = mountTracked()

    expect(display.value).toEqual(toBannerDisplay(notice))
  })

  it('[UOB-02] 未取得のときは null', () => {
    const { display } = mountTracked()

    expect(display.value).toBeNull()
  })

  it('[UOB-03] 間隔の手前では取り直さない', () => {
    const load = spyLoad(useBannerStore())
    mountTracked()

    vi.advanceTimersByTime(BANNER_REFRESH_MS - 1)

    expect(load).not.toHaveBeenCalled()
  })

  it('[UOB-04] 間隔ごとに取り直す', () => {
    const load = spyLoad(useBannerStore())
    mountTracked()

    vi.advanceTimersByTime(BANNER_REFRESH_MS)
    expect(load).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(BANNER_REFRESH_MS)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('[UOB-05] タブが裏にある間は取り直さない', () => {
    const load = spyLoad(useBannerStore())
    mountTracked()
    setHidden(true)

    vi.advanceTimersByTime(BANNER_REFRESH_MS)

    expect(load).not.toHaveBeenCalled()
  })

  it('[UOB-06] タブが表に戻ったらすぐに取り直す', () => {
    const load = spyLoad(useBannerStore())
    setHidden(true)
    mountTracked()

    sendVisibilityChange(false)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('[UOB-07] タブが裏に回ったときは取り直さない', () => {
    const load = spyLoad(useBannerStore())
    mountTracked()

    sendVisibilityChange(true)

    expect(load).not.toHaveBeenCalled()
  })

  it('[UOB-08] アンマウント後はタイマーもリスナも残らない', () => {
    const load = spyLoad(useBannerStore())
    const { wrapper } = mountHost()

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(BANNER_REFRESH_MS * 2)
    sendVisibilityChange(true)
    sendVisibilityChange(false)

    expect(load).not.toHaveBeenCalled()
  })

  it('[UOB-09] お知らせを閉じると消え、本文を sessionStorage に覚える', async () => {
    useBannerStore().banner = notice
    const { display, dismiss } = mountTracked()

    dismiss()
    await nextTick()

    expect(display.value).toBeNull()
    expect(sessionStorage.getItem(DISMISSED_STORAGE_KEY)).toBe(toBannerDisplay(notice).message)
  })

  it('[UOB-10] 同じ本文を閉じた記憶があれば、マウント直後から出さない', () => {
    sessionStorage.setItem(DISMISSED_STORAGE_KEY, toBannerDisplay(notice).message)
    useBannerStore().banner = notice

    const { display } = mountTracked()

    expect(display.value).toBeNull()
  })

  it('[UOB-11] 閉じた後に本文が変わると再び出す', async () => {
    const store = useBannerStore()
    store.banner = notice
    const { display, dismiss } = mountTracked()
    dismiss()
    await nextTick()
    expect(display.value).toBeNull()

    const changed = { ...notice, message: OTHER_MESSAGE, announcementMessage: OTHER_MESSAGE }
    store.banner = changed
    await nextTick()

    expect(display.value).toEqual(toBannerDisplay(changed))
  })

  it('[UOB-12] 発注停止は閉じられず、記憶もしない', async () => {
    useBannerStore().banner = incident
    const { display, dismiss } = mountTracked()

    dismiss()
    await nextTick()

    expect(display.value).toEqual(toBannerDisplay(incident))
    expect(sessionStorage.getItem(DISMISSED_STORAGE_KEY)).toBeNull()
  })

  it('[UOB-13] 閉じた本文と同じ本文の発注停止が来ても出す', async () => {
    const store = useBannerStore()
    store.banner = notice
    const { display, dismiss } = mountTracked()
    dismiss()
    await nextTick()
    expect(display.value).toBeNull()

    const sameMessageIncident = { ...incident, message: notice.message }
    store.banner = sameMessageIncident
    await nextTick()

    expect(display.value).toEqual(toBannerDisplay(sameMessageIncident))
  })

  it('[UOB-14] sessionStorage が例外を投げても、タブ内では閉じられる', async () => {
    const denied = () => {
      throw new DOMException('denied（テスト）', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)
    useBannerStore().banner = notice

    const { display, dismiss } = mountTracked()
    expect(display.value).toEqual(toBannerDisplay(notice))

    dismiss()
    await nextTick()

    expect(display.value).toBeNull()
  })

  it('[UOB-15] 何も無い状態からお知らせが入ると表示が変わる', async () => {
    const store = useBannerStore()
    store.banner = none
    const { display } = mountTracked()
    expect(display.value).toBeNull()

    store.banner = notice
    await nextTick()

    expect(display.value).toEqual(toBannerDisplay(notice))
  })
})
