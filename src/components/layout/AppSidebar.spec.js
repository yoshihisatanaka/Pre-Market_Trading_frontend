import { beforeEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { salesOperator } from '@/mocks/fixtures/currentOperator'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import AppSidebar from './AppSidebar.vue'
import { navItems, navSections } from './navigation'

/*
 * ルータに依存する部品のテストの見本。
 * RouterLink を stub せず実ルータ（メモリ履歴）を差すことで、
 * 現在ページの判定（aria-current）と遷移まで通しで検証できる。
 *
 * 区分の出し分けはログイン中の操作者（stores/currentOperator）で決まるので、
 * 既定では /auth/me の既定モック（管理責任者 = 全権限あり）を読み込んでからマウントする。
 */
const Page = { render: () => h('div') }

// 期待値は navigation.js の定義から導く（区分名やリンク数を直接書かない）
const MASTER_SECTION = navSections.find((section) => section.permission === 'master')
const OPEN_SECTIONS = navSections.filter((section) => !section.permission)
const OPEN_ITEMS = OPEN_SECTIONS.flatMap((section) => section.items)

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page, meta: { title: '注文一覧' } },
      { path: '/:pathMatch(.*)*', component: Page, meta: { title: 'ページが見つかりません' } },
    ],
  })
}

/**
 * @param {string} path
 * @param {object} [props]
 * @param {{ loadOperator?: boolean }} [options] loadOperator が false なら操作者を読み込まずにマウントする
 */
async function mountAt(path, props = {}, { loadOperator = true } = {}) {
  if (loadOperator) await useCurrentOperatorStore().load()

  const router = createTestRouter()
  // mount 前に遷移を済ませておけば router.isReady() を待つ必要がない
  await router.push(path)
  const wrapper = mount(AppSidebar, { props, global: { plugins: [router] } })
  return { wrapper, router }
}

const currentPageLabels = (wrapper) =>
  wrapper
    .findAll('a')
    .filter((link) => link.attributes('aria-current') === 'page')
    .map((link) => link.text())

const headings = (wrapper) => wrapper.findAll('h2').map((el) => el.text())
const linkLabels = (wrapper) => wrapper.findAll('a').map((link) => link.text())

/** マスタメンテの見出しと配下のリンクが 1 つも出ていないこと */
function expectMasterSectionHidden(wrapper) {
  expect(headings(wrapper)).not.toContain(MASTER_SECTION.label)
  for (const item of MASTER_SECTION.items) {
    expect(linkLabels(wrapper)).not.toContain(item.label)
  }
  // ほかの区分は影響を受けない
  expect(headings(wrapper)).toEqual(OPEN_SECTIONS.map((section) => section.label))
  expect(linkLabels(wrapper)).toEqual(OPEN_ITEMS.map((item) => item.label))
}

// シナリオ: docs/unit/components-layout-app-sidebar.md
describe('AppSidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[ASB-01] システム名とセクション見出し、定義順のリンクを描画する', async () => {
    const { wrapper } = await mountAt('/')

    expect(wrapper.text()).toContain('米株発注システム')
    expect(headings(wrapper)).toEqual(navSections.map((s) => s.label))

    const links = wrapper.findAll('a')
    expect(links).toHaveLength(navItems.length)
    expect(links.map((link) => link.text())).toEqual(navItems.map((item) => item.label))
    expect(links.map((link) => link.attributes('href'))).toEqual(navItems.map((item) => item.to))
  })

  it('[ASB-02] メニューに無いルートではどのリンクも現在ページにならない', async () => {
    const { wrapper } = await mountAt('/')

    expect(currentPageLabels(wrapper)).toEqual([])
  })

  it('[ASB-03] 現在のルートに一致するリンクだけが現在ページになる', async () => {
    const { wrapper } = await mountAt('/customers/search')

    expect(currentPageLabels(wrapper)).toEqual(['顧客検索'])
  })

  it('[ASB-04] リンクを click するとそのパスへ遷移する', async () => {
    const { wrapper, router } = await mountAt('/')

    const link = wrapper.findAll('a').find((el) => el.text() === '顧客検索')
    await link.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/customers/search')
  })

  it('[ASB-05] open を省略すると展開状態で描画する', async () => {
    const { wrapper } = await mountAt('/')

    const aside = wrapper.find('[data-testid="app-sidebar"]')
    expect(aside.classes()).not.toContain('is-collapsed')
    // inert は値ではなく有無で見る（'' と 'true' のどちらになるかは環境差がある）
    expect(aside.attributes('inert')).toBeUndefined()
  })

  it('[ASB-06] open が false だと折りたたみ、中のリンクを操作対象から外す', async () => {
    const { wrapper } = await mountAt('/', { open: false })

    const aside = wrapper.find('[data-testid="app-sidebar"]')
    expect(aside.classes()).toContain('is-collapsed')
    expect(aside.attributes('inert')).toBeDefined()
  })

  it('[ASB-07] マスタ権限の無い操作者にはマスタメンテを見出しごと出さない', async () => {
    // フィクスチャの前提（master なし）が崩れたら、このシナリオは意味を失う
    expect(salesOperator.権限.master).toBe(false)
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(salesOperator)))

    const { wrapper } = await mountAt('/')

    expectMasterSectionHidden(wrapper)
  })

  it('[ASB-08] 操作者が未取得のあいだはマスタメンテを出さない', async () => {
    const { wrapper } = await mountAt('/', {}, { loadOperator: false })

    expectMasterSectionHidden(wrapper)
  })

  it('[ASB-09] 操作者の取得に失敗したらマスタメンテを出さない', async () => {
    server.use(
      http.get('*/api/auth/me', () =>
        HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }),
      ),
    )

    const { wrapper } = await mountAt('/')

    expect(useCurrentOperatorStore().error).toBeTruthy()
    expectMasterSectionHidden(wrapper)
  })

  it('[ASB-10] 操作者の読み込みが終わるとマスタメンテが現れる', async () => {
    const { wrapper } = await mountAt('/', {}, { loadOperator: false })
    expect(headings(wrapper)).not.toContain(MASTER_SECTION.label)

    await useCurrentOperatorStore().load()
    await flushPromises()

    expect(headings(wrapper)).toEqual(navSections.map((s) => s.label))
    expect(linkLabels(wrapper)).toEqual(navItems.map((item) => item.label))
  })
})
