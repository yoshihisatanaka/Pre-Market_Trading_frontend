import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  incidentBannerResponse,
  noneBannerResponse,
  noticeBannerResponse,
} from '@/mocks/fixtures/banner'
import { useBannerStore } from '@/stores/banner'
import AppOperationBanner from './AppOperationBanner.vue'

/*
 * 「ストアの応答 → 帯の描画 → 閉じる操作」の結線を見る。
 * 応答は MSW の server.use() で fixtures/banner.js の 3 種を返し、起動時の取得（main.js）に当たる
 * store.load() を済ませてからマウントする。文言の組み立ては utils（OBU）、時計と閉じた記憶の細部は
 * composable（UOB）の担当なので、ここでは描画の有無・testid・role・文言だけを見る。
 * 配色は jsdom で評価できないので role と data-kind で見分ける。
 */
const BANNER_PATH = '*/api/operations/banner'

const respondWith = (body) => server.use(http.get(BANNER_PATH, () => HttpResponse.json(body)))
const respondError = () =>
  server.use(
    http.get(BANNER_PATH, () =>
      HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }),
    ),
  )

let mounted = []

/** 応答を取得してからマウントする（load を呼ばなければ「未取得」のまま） */
async function mountBanner({ load = true } = {}) {
  const store = useBannerStore()
  if (load) await store.load()
  const wrapper = mount(AppOperationBanner)
  mounted.push(wrapper)
  return { wrapper, store }
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const banner = (wrapper) => find(wrapper, 'operation-banner')

beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
})

afterEach(() => {
  // 定期の取り直しのタイマーを次のテストに持ち越さない
  mounted.forEach((wrapper) => wrapper.unmount())
  mounted = []
  sessionStorage.clear()
})

// シナリオ: docs/unit/components-layout-app-operation-banner.md
describe('AppOperationBanner', () => {
  it('[AOB-01] 発注停止中は閉じられない警告の帯に本文と停止対象を出す', async () => {
    respondWith(incidentBannerResponse)
    const { wrapper } = await mountBanner()

    expect(banner(wrapper).exists()).toBe(true)
    expect(banner(wrapper).attributes('data-kind')).toBe('INCIDENT')
    expect(banner(wrapper).attributes('role')).toBe('alert')
    expect(find(wrapper, 'operation-banner-label').text()).toBe('発注停止中')
    expect(find(wrapper, 'operation-banner-message').text()).toBe(incidentBannerResponse.メッセージ)
    expect(find(wrapper, 'operation-banner-targets').text()).toBe(
      `停止対象: ${incidentBannerResponse.停止中の対象名.join('、')}`,
    )
    expect(find(wrapper, 'operation-banner-dismiss').exists()).toBe(false)
  })

  it('[AOB-02] お知らせは閉じられる案内の帯に本文を出し、停止対象は出さない', async () => {
    respondWith(noticeBannerResponse)
    const { wrapper } = await mountBanner()

    expect(banner(wrapper).attributes('data-kind')).toBe('NOTICE')
    expect(banner(wrapper).attributes('role')).toBe('status')
    expect(find(wrapper, 'operation-banner-label').text()).toBe('お知らせ')
    expect(find(wrapper, 'operation-banner-message').text()).toBe(noticeBannerResponse.メッセージ)
    expect(find(wrapper, 'operation-banner-targets').exists()).toBe(false)
    expect(find(wrapper, 'operation-banner-dismiss').attributes('aria-label')).toBe(
      'お知らせを閉じる',
    )
  })

  it('[AOB-03] 何も無いときは帯を描かない', async () => {
    respondWith(noneBannerResponse)
    const { wrapper } = await mountBanner()

    expect(banner(wrapper).exists()).toBe(false)
  })

  it('[AOB-04] まだ取得していないときは帯を描かない', async () => {
    const { wrapper } = await mountBanner({ load: false })

    expect(banner(wrapper).exists()).toBe(false)
  })

  it('[AOB-05] 取得に失敗したときは帯を描かない', async () => {
    respondError()
    const { wrapper, store } = await mountBanner()

    expect(store.error).not.toBeNull()
    expect(banner(wrapper).exists()).toBe(false)
  })

  it('[AOB-06] 「お知らせを閉じる」で帯が消える', async () => {
    respondWith(noticeBannerResponse)
    const { wrapper } = await mountBanner()

    await find(wrapper, 'operation-banner-dismiss').trigger('click')

    expect(banner(wrapper).exists()).toBe(false)
  })

  it('[AOB-07] 本文の改行をそのまま持ち、前後に空白を付けない', async () => {
    const message = `${noticeBannerResponse.メッセージ}\n2 行目の案内（テスト）`
    respondWith({ ...noticeBannerResponse, メッセージ: message, お知らせ本文: message })
    const { wrapper } = await mountBanner()

    // text() は前後を trim するので、要素の生の文字列で見る
    expect(find(wrapper, 'operation-banner-message').element.textContent).toBe(message)
  })

  it('[AOB-08] 取り直しに失敗しても直前のお知らせが出たまま', async () => {
    respondWith(noticeBannerResponse)
    const { wrapper, store } = await mountBanner()
    expect(banner(wrapper).exists()).toBe(true)

    server.resetHandlers()
    respondError()
    await store.load()
    await wrapper.vm.$nextTick()

    expect(store.error).not.toBeNull()
    expect(banner(wrapper).attributes('data-kind')).toBe('NOTICE')
    expect(find(wrapper, 'operation-banner-message').text()).toBe(noticeBannerResponse.メッセージ)
  })
})
