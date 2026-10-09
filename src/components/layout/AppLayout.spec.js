import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { trackRouteLoading } from '@/composables/useRouteLoading'
import { noticeBannerResponse } from '@/mocks/fixtures/banner'
import { useBannerStore } from '@/stores/banner'
import AppLayout from './AppLayout.vue'

/*
 * AppHeader（useRoute / setInterval / 市場状況ストア）と AppSidebar（RouterLink）を
 * 実描画するので、AppSidebar.spec.js と同じメモリ履歴の実ルータを差し、Pinia も用意する。
 * ストアは空のまま（ヘッダは取りに行かないので通信は起きず、市場ステータスは「—」になる）。
 *
 * jsdom は scoped CSS を評価しないため「見えない」ことは検証できない。
 * 開閉の判定はメニューボタンの aria-expanded で行う（見え方は E2E の LAY-06 が見る）。
 *
 * 遷移の確定待ち（ALY-05〜07）は、本番と同じく trackRouteLoading をテスト用ルータに差し、
 * /customers/search を解決を手で止められる遅延ルートにして作る。解除条件は useRouteLoading.spec.js が持つ。
 */
const Page = { render: () => h('div') }

/** /customers/search のチャンクを解決する */
let release
/** trackRouteLoading の登録解除（状態はモジュールで 1 つなので、テストごとに必ず外す） */
let stops = []

function createTestRouter() {
  const held = new Promise((resolve) => {
    release = () => resolve(Page)
  })
  const router = createRouter({
    history: createMemoryHistory(),
    // サイドメニューの 15 件を実描画するので、受け皿が無いとルータ警告で埋まる
    routes: [
      { path: '/', component: Page, meta: { title: '注文一覧' } },
      { path: '/customers/search', component: () => held, meta: { title: '顧客検索' } },
      { path: '/:pathMatch(.*)*', component: Page, meta: { title: 'ページが見つかりません' } },
    ],
  })
  stops.push(trackRouteLoading(router))
  return router
}

async function mountLayout() {
  const router = createTestRouter()
  await router.push('/')
  return mount(AppLayout, {
    slots: { default: '<p>画面の中身</p>' },
    global: { plugins: [router] },
  })
}

const toggleButton = (wrapper) => wrapper.find('[data-testid="sidebar-toggle"]')
const isOpen = (wrapper) => toggleButton(wrapper).attributes('aria-expanded') === 'true'
const routeLoading = (wrapper) => wrapper.find('[data-testid="route-loading"]')
const sidebarLink = (wrapper, label) =>
  wrapper.findAll('[data-testid="app-sidebar"] a').find((link) => link.text() === label)

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.stubGlobal('innerWidth', 1280)
})

afterEach(() => {
  stops.forEach((stop) => stop())
  stops = []
  vi.unstubAllGlobals()
})

// シナリオ: docs/unit/components-layout-app-layout.md
describe('AppLayout', () => {
  it('[ALY-01] 広い画面では開いた状態で描画し、slot の中身を表示する', async () => {
    const wrapper = await mountLayout()

    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.find('[data-testid="app-sidebar"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('画面の中身')
  })

  it('[ALY-02] 狭い画面では閉じた状態で描画する', async () => {
    vi.stubGlobal('innerWidth', 900)

    const wrapper = await mountLayout()

    expect(isOpen(wrapper)).toBe(false)
  })

  it('[ALY-03] メニューボタンを click すると閉じた状態に変わる', async () => {
    const wrapper = await mountLayout()

    await toggleButton(wrapper).trigger('click')

    expect(isOpen(wrapper)).toBe(false)
  })

  it('[ALY-04] 閉じた選択は次のマウントでも保たれる', async () => {
    const first = await mountLayout()
    await toggleButton(first).trigger('click')
    first.unmount()

    const second = await mountLayout()

    expect(isOpen(second)).toBe(false)
  })

  it('[ALY-05] 遅延ルートへの遷移中は読み込み中のバーを出し、本文を aria-busy にする', async () => {
    const wrapper = await mountLayout()

    wrapper.vm.$router.push('/customers/search')
    await flushPromises()

    expect(routeLoading(wrapper).exists()).toBe(true)
    expect(routeLoading(wrapper).text()).toContain('画面を読み込んでいます')
    expect(wrapper.find('main').attributes('aria-busy')).toBe('true')
  })

  it('[ALY-06] チャンクが解決するとバーが消え、本文の aria-busy が外れる', async () => {
    const wrapper = await mountLayout()
    const navigation = wrapper.vm.$router.push('/customers/search')
    await flushPromises()

    release()
    await navigation
    await flushPromises()

    expect(routeLoading(wrapper).exists()).toBe(false)
    expect(wrapper.find('main').attributes('aria-busy')).toBeUndefined()
  })

  it('[ALY-07] 遷移中は押した項目をサイドメニューの読み込み中の見た目にする', async () => {
    const wrapper = await mountLayout()

    wrapper.vm.$router.push('/customers/search')
    await flushPromises()

    expect(sidebarLink(wrapper, '顧客検索').classes()).toContain('is-pending')
  })

  it('[ALY-08] 運用バナーをヘッダの後・本文の前に描く', async () => {
    // 起動時の取得（main.js）は済んでいる前提で、ストアにお知らせを直接置く（通信は起こさない）
    useBannerStore().banner = {
      kind: noticeBannerResponse.種別,
      severity: noticeBannerResponse.重要度,
      message: noticeBannerResponse.メッセージ,
      ordersSuspended: noticeBannerResponse.発注停止中,
      suspendedTargets: noticeBannerResponse.停止中の対象,
      suspendedTargetNames: noticeBannerResponse.停止中の対象名,
      announcementVisible: noticeBannerResponse.お知らせ表示中,
      announcementMessage: noticeBannerResponse.お知らせ本文,
    }

    const wrapper = await mountLayout()

    const banner = wrapper.find('[data-testid="operation-banner"]').element
    const header = wrapper.find('header').element
    const main = wrapper.find('main').element
    expect(header.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(header.contains(banner)).toBe(false)
    expect(main.contains(banner)).toBe(false)
  })
})
