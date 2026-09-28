import { beforeEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { noOperationOperator } from '@/mocks/fixtures/currentOperator'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import AppSidebar from './AppSidebar.vue'
import { navItems, navSections } from './navigation'

/*
 * ルータに依存する部品のテストの見本。
 * RouterLink を stub せず実ルータ（メモリ履歴）を差すことで、
 * 現在ページの判定（aria-current）と遷移まで通しで検証できる。
 *
 * 権限の要る区分（運用管理）は /auth/me の結果で出し分けるので、Pinia を用意し、
 * 既定では操作者の読み込み（既定モックは全権限あり）を済ませてからマウントする。
 */
const Page = { render: () => h('div') }
const AUTH_ME = '*/api/auth/me'

const OPERATION_SECTION = navSections.find((s) => s.requiredPermission === 'operation')
const otherSections = navSections.filter((s) => s !== OPERATION_SECTION)
const otherItems = otherSections.flatMap((s) => s.items)

beforeEach(() => {
  setActivePinia(createPinia())
})

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page, meta: { title: '注文一覧' } },
      { path: '/:pathMatch(.*)*', component: Page, meta: { title: 'ページが見つかりません' } },
    ],
  })
}

async function mountAt(path, props = {}, { loadOperator = true } = {}) {
  if (loadOperator) await useCurrentOperatorStore().ensureLoaded()
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

  it('[ASB-07] 運用管理権限の無い利用者には運用管理の区分を出さない', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json(noOperationOperator)))
    const { wrapper } = await mountAt('/')

    expect(wrapper.findAll('h2').map((el) => el.text())).toEqual(otherSections.map((s) => s.label))
    expect(wrapper.findAll('a').map((link) => link.attributes('href'))).toEqual(
      otherItems.map((item) => item.to),
    )
  })

  it('[ASB-08] /auth/me の応答前は運用管理の区分を出さない', async () => {
    // 応答を握ったまま読み込みを始め、応答前の状態でマウントする
    let release
    const opened = new Promise((resolve) => {
      release = resolve
    })
    server.use(
      http.get(AUTH_ME, async () => {
        await opened
        return HttpResponse.json(noOperationOperator)
      }),
    )
    const loading = useCurrentOperatorStore().ensureLoaded()
    const { wrapper } = await mountAt('/', {}, { loadOperator: false })

    expect(wrapper.findAll('h2').map((el) => el.text())).not.toContain(OPERATION_SECTION.label)
    expect(wrapper.findAll('a')).toHaveLength(otherItems.length)

    release()
    await loading
  })

  it('[ASB-09] /auth/me が 500 なら運用管理の区分を出さない', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    const { wrapper } = await mountAt('/')

    expect(wrapper.findAll('h2').map((el) => el.text())).not.toContain(OPERATION_SECTION.label)
    expect(wrapper.findAll('a')).toHaveLength(otherItems.length)
  })
})
