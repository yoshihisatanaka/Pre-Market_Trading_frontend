import { beforeEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { supervisorOperator } from '@/mocks/fixtures/currentOperator'
import { useCurrentOperatorStore } from '@/stores/currentOperator'
import AppSidebar from './AppSidebar.vue'
import { navItems, navSections } from './navigation'

/*
 * ルータに依存する部品のテストの見本。
 * RouterLink を stub せず実ルータ（メモリ履歴）を差すことで、
 * 現在ページの判定（aria-current）と遷移まで通しで検証できる。
 *
 * 権限の要る区分（navigation.js の requiredPermission。マスタメンテ = master、運用管理 = operation）は
 * /auth/me の結果で出し分けるので、Pinia を用意し、既定では操作者の読み込み
 * （既定モックは全権限あり）を済ませてからマウントする。
 * 期待値は navigation.js の定義から導く（区分名やリンク数を直接書かない）。
 */
const Page = { render: () => h('div') }
const AUTH_ME = '*/api/auth/me'

const MASTER_SECTION = navSections.find((s) => s.requiredPermission === 'master')
const OPERATION_SECTION = navSections.find((s) => s.requiredPermission === 'operation')
/** 権限の要らない区分だけ（未取得・取得失敗のときに残るもの） */
const PUBLIC_SECTIONS = navSections.filter((s) => !s.requiredPermission)

/** 1 つの権限だけを外した操作者（ほかの区分への影響が無いことを切り分けるため） */
const operatorWithout = (permission) => ({
  ...supervisorOperator,
  権限: { ...supervisorOperator.権限, [permission]: false },
})

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

/**
 * @param {string} path
 * @param {object} [props]
 * @param {{ loadOperator?: boolean }} [options] loadOperator が false なら操作者を読み込まずにマウントする
 */
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

const headings = (wrapper) => wrapper.findAll('h2').map((el) => el.text())
const hrefs = (wrapper) => wrapper.findAll('a').map((link) => link.attributes('href'))

/** 指定の区分だけが並んでいること（見出しもリンクも定義順） */
function expectSections(wrapper, sections) {
  expect(headings(wrapper)).toEqual(sections.map((s) => s.label))
  expect(hrefs(wrapper)).toEqual(sections.flatMap((s) => s.items).map((item) => item.to))
}

// シナリオ: docs/unit/components-layout-app-sidebar.md
describe('AppSidebar', () => {
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

  it('[ASB-07] 運用管理権限の無い利用者には運用管理の区分を出さない', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json(operatorWithout('operation'))))
    const { wrapper } = await mountAt('/')

    // マスタメンテは master 権限で出るので残る
    expectSections(wrapper, navSections.filter((s) => s !== OPERATION_SECTION))
  })

  it('[ASB-08] /auth/me の応答前は権限の要る区分を出さない', async () => {
    // 応答を握ったまま読み込みを始め、応答前の状態でマウントする
    let release
    const opened = new Promise((resolve) => {
      release = resolve
    })
    server.use(
      http.get(AUTH_ME, async () => {
        await opened
        return HttpResponse.json(supervisorOperator)
      }),
    )
    const loading = useCurrentOperatorStore().ensureLoaded()
    const { wrapper } = await mountAt('/', {}, { loadOperator: false })

    // 未取得は権限なし。運用管理もマスタメンテも出さない
    expectSections(wrapper, PUBLIC_SECTIONS)

    release()
    await loading
  })

  it('[ASB-09] /auth/me が 500 なら権限の要る区分を出さない', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    const { wrapper } = await mountAt('/')

    expect(useCurrentOperatorStore().error).toBeTruthy()
    expectSections(wrapper, PUBLIC_SECTIONS)
  })

  it('[ASB-10] マスタ権限の無い利用者にはマスタメンテを見出しごと出さない', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json(operatorWithout('master'))))
    const { wrapper } = await mountAt('/')

    // 運用管理は operation 権限で出るので残る
    expectSections(wrapper, navSections.filter((s) => s !== MASTER_SECTION))
  })

  it('[ASB-11] 操作者の読み込みが終わると権限の要る区分が現れる', async () => {
    const { wrapper } = await mountAt('/', {}, { loadOperator: false })
    expectSections(wrapper, PUBLIC_SECTIONS)

    await useCurrentOperatorStore().ensureLoaded()
    await flushPromises()

    expectSections(wrapper, navSections)
  })
})
