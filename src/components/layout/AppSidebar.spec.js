import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import { navItems, navSections } from './navigation'

/*
 * ルータに依存する部品のテストの見本。
 * RouterLink を stub せず実ルータ（メモリ履歴）を差すことで、
 * 現在ページの判定（aria-current）と遷移まで通しで検証できる。
 */
const Page = { render: () => h('div') }

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page, meta: { title: '注文一覧' } },
      { path: '/:pathMatch(.*)*', component: Page, meta: { title: 'ページが見つかりません' } },
    ],
  })
}

async function mountAt(path) {
  const router = createTestRouter()
  // mount 前に遷移を済ませておけば router.isReady() を待つ必要がない
  await router.push(path)
  const wrapper = mount(AppSidebar, { global: { plugins: [router] } })
  return { wrapper, router }
}

const currentPageLabels = (wrapper) =>
  wrapper
    .findAll('a')
    .filter((link) => link.attributes('aria-current') === 'page')
    .map((link) => link.text())

// シナリオ: docs/unit/components-layout-app-sidebar.md
describe('AppSidebar', () => {
  it('[ASB-01] システム名とセクション見出し、定義順のリンクを描画する', async () => {
    const { wrapper } = await mountAt('/')

    expect(wrapper.text()).toContain('米株発注システム')
    expect(wrapper.findAll('h2').map((el) => el.text())).toEqual(navSections.map((s) => s.label))

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
})
