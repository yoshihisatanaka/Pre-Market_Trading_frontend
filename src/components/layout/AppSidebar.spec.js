import { beforeEach, describe, expect, it, vi } from 'vitest'
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
/** サイドメニューの件数（注文エラー / Dream登録エラー）を引く 2 本 */
const ORDERS = '*/api/orders'
const DREAM_STATUS = '*/api/orders/dream-status'

/** 件数を出す項目（navigation.js の badge 付き）と、出さない項目 */
const BADGE_ITEMS = navItems.filter((item) => item.badge)
const PLAIN_ITEMS = navItems.filter((item) => !item.badge)

/**
 * 2 本の件数 API が返す total を差し替える。呼ばれた回数を数えて返す
 * @param {{ orderErrors: number, dreamErrors: number }} totals
 */
function respondCounts({ orderErrors, dreamErrors }) {
  const calls = { orderErrors: 0, dreamErrors: 0 }
  server.use(
    http.get(ORDERS, () => {
      calls.orderErrors += 1
      return HttpResponse.json({ orders: [], total: orderErrors })
    }),
    http.get(DREAM_STATUS, () => {
      calls.dreamErrors += 1
      return HttpResponse.json({ orders: [], total: dreamErrors })
    }),
  )
  return calls
}

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
  // 件数が載るとリンクの text() が揺れる。既定は 0 件（数字を出さない）にして ASB-01〜20 を決定的にする
  respondCounts({ orderErrors: 0, dreamErrors: 0 })
})

/**
 * @param {import('vue-router').RouteRecordRaw[]} [routes] 受け皿より前に置く追加ルート（先読みの検証で遅延ルートを足す）
 */
function createTestRouter(routes = []) {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page, meta: { title: '注文一覧' } },
      ...routes,
      { path: '/:pathMatch(.*)*', component: Page, meta: { title: 'ページが見つかりません' } },
    ],
  })
}

/**
 * @param {string} path
 * @param {object} [props]
 * @param {{ loadOperator?: boolean, routes?: import('vue-router').RouteRecordRaw[] }} [options]
 *   loadOperator が false なら操作者を読み込まずにマウントする。routes は createTestRouter に渡す追加ルート
 */
async function mountAt(path, props = {}, { loadOperator = true, routes = [] } = {}) {
  if (loadOperator) await useCurrentOperatorStore().ensureLoaded()
  const router = createTestRouter(routes)
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

const linkByLabel = (wrapper, label) =>
  wrapper.findAll('a').find((link) => link.text() === label)
/** 読み込み中の見た目になっているリンクのラベル */
const pendingLabels = (wrapper) =>
  wrapper
    .findAll('a')
    .filter((link) => link.classes().includes('is-pending'))
    .map((link) => link.text())
/** 回転マークを持つリンクのラベル */
const spinnerLabels = (wrapper) =>
  wrapper
    .findAll('a')
    .filter((link) => link.find('.base-spinner').exists())
    .map((link) => link.text())

const linkTo = (wrapper, item) => wrapper.find(`a[href="${item.to}"]`)
const badgeOf = (wrapper, item) => wrapper.find(`[data-testid="sidebar-badge-${item.badge.key}"]`)
/** 件数の数字を持つリンクの行き先 */
const badgedHrefs = (wrapper) =>
  wrapper
    .findAll('a')
    .filter((link) => link.find('[data-testid^="sidebar-badge-"]').exists())
    .map((link) => link.attributes('href'))
/**
 * リンク名の近似。jsdom は accessible name を計算しないので、読み上げから外れる子
 * （aria-hidden / hidden）を除いた文字列で見る
 */
function accessibleText(link) {
  const clone = link.element.cloneNode(true)
  clone.querySelectorAll('[aria-hidden="true"], [hidden]').forEach((el) => el.remove())
  return clone.textContent.trim()
}

const headings = (wrapper) => wrapper.findAll('h2').map((el) => el.text())
const hrefs = (wrapper) => wrapper.findAll('a').map((link) => link.attributes('href'))

const sectionToggle = (wrapper, label) =>
  wrapper.findAll('h2 button').find((button) => button.text() === label)
const isExpanded = (wrapper, label) =>
  sectionToggle(wrapper, label).attributes('aria-expanded') === 'true'
/*
 * 配下リンクの表示は、見出しボタンの aria-controls が指す入れ物の display（v-show）で見る。
 * isVisible() は jsdom の getComputedStyle を辿るが、一度開いて閉じ直した後の display: none を拾わなかった。
 */
const linksShown = (wrapper, label) => {
  const id = sectionToggle(wrapper, label).attributes('aria-controls')
  return wrapper.find(`[id="${id}"]`).element.style.display !== 'none'
}

/** 区分ラベル → 開いているか（見出しボタンの aria-expanded と、配下リンクの表示が一致することも見る） */
function openState(wrapper) {
  return Object.fromEntries(
    navSections.map((section) => {
      const expanded = isExpanded(wrapper, section.label)
      expect(linksShown(wrapper, section.label)).toBe(expanded)
      return [section.label, expanded]
    }),
  )
}

/** navigation.js の defaultOpen から導いた初期の開閉 */
const DEFAULT_OPEN = Object.fromEntries(
  navSections.map((section) => [section.label, section.defaultOpen !== false]),
)

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

  it('[ASB-12] 顧客と注文は開き、マスタメンテと運用管理は閉じた状態で始まる', async () => {
    // 既定値が要件どおりであること自体も確かめる（defaultOpen の付け外しで黙って変わらないように）
    expect(DEFAULT_OPEN).toEqual({
      顧客: true,
      '注文・照会': true,
      マスタメンテ: false,
      運用管理: false,
    })

    const { wrapper } = await mountAt('/')

    expect(openState(wrapper)).toEqual(DEFAULT_OPEN)
  })

  it('[ASB-13] 閉じた区分の見出しを click すると開き、もう一度 click すると閉じる', async () => {
    const { wrapper } = await mountAt('/')

    await sectionToggle(wrapper, MASTER_SECTION.label).trigger('click')
    expect(openState(wrapper)).toEqual({ ...DEFAULT_OPEN, [MASTER_SECTION.label]: true })

    await sectionToggle(wrapper, MASTER_SECTION.label).trigger('click')
    expect(openState(wrapper)).toEqual(DEFAULT_OPEN)
  })

  it('[ASB-14] 開いた区分の見出しを click すると閉じる', async () => {
    const { wrapper } = await mountAt('/')

    await sectionToggle(wrapper, '顧客').trigger('click')

    expect(openState(wrapper)).toEqual({ ...DEFAULT_OPEN, 顧客: false })
  })

  it('[ASB-15] 現在のページを含む区分は既定で閉じる区分でも開いて始まる', async () => {
    const { wrapper } = await mountAt('/masters/symbols')

    expect(openState(wrapper)).toEqual({ ...DEFAULT_OPEN, [MASTER_SECTION.label]: true })
    expect(currentPageLabels(wrapper)).toEqual(['銘柄マスタ'])
  })

  it('[ASB-16] 閉じた区分の配下のページへ遷移するとその区分が開く', async () => {
    const { wrapper, router } = await mountAt('/')

    await router.push('/operations/incidents/1')
    await flushPromises()

    expect(openState(wrapper)).toEqual({ ...DEFAULT_OPEN, [OPERATION_SECTION.label]: true })
  })

  it('[ASB-17] pendingPath に一致する項目だけを読み込み中の見た目にし、読み上げ対象外の回転マークを付ける', async () => {
    const { wrapper } = await mountAt('/', { pendingPath: '/customers/search' })

    expect(pendingLabels(wrapper)).toEqual(['顧客検索'])
    expect(spinnerLabels(wrapper)).toEqual(['顧客検索'])

    const link = linkByLabel(wrapper, '顧客検索')
    expect(link.find('.base-spinner').attributes('aria-hidden')).toBe('true')
    // 回転マークがリンク名を汚さない（読み上げは AppLayout のバーに任せる）
    expect(link.text()).toBe('顧客検索')
  })

  it('[ASB-18] pendingPath を省略するとどの項目も読み込み中の見た目にならない', async () => {
    const { wrapper } = await mountAt('/')

    expect(pendingLabels(wrapper)).toEqual([])
    expect(spinnerLabels(wrapper)).toEqual([])
  })

  it('[ASB-19] 項目にマウスを載せる / フォーカスすると行き先のチャンクを先読みし、遷移はしない', async () => {
    const loader = vi.fn(() => Promise.resolve(Page))
    const loader2 = vi.fn(() => Promise.resolve(Page))
    const { wrapper, router } = await mountAt(
      '/',
      {},
      {
        routes: [
          { path: '/customers/search', component: loader },
          { path: '/orders/inquiry', component: loader2 },
        ],
      },
    )

    await linkByLabel(wrapper, '顧客検索').trigger('pointerenter')
    await linkByLabel(wrapper, '注文照会').trigger('focus')

    expect(loader).toHaveBeenCalledTimes(1)
    expect(loader2).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('[ASB-20] 先読み済みの項目にもう一度マウスを載せても取り直さない', async () => {
    const loader = vi.fn(() => Promise.resolve(Page))
    const { wrapper } = await mountAt(
      '/',
      {},
      { routes: [{ path: '/customers/search', component: loader }] },
    )

    await linkByLabel(wrapper, '顧客検索').trigger('pointerenter')
    await flushPromises()
    await linkByLabel(wrapper, '顧客検索').trigger('pointerenter')

    expect(loader).toHaveBeenCalledTimes(1)
  })

  // 件数は前提として置く値（項目ごとに違う数にして取り違えを見分ける）
  const TOTALS = { orderErrors: 3, dreamErrors: 5 }

  it('[ASB-21] 件数が 1 以上の項目にだけその件数の数字を出す', async () => {
    respondCounts(TOTALS)
    const { wrapper } = await mountAt('/')
    await flushPromises()

    // badge 付きの項目が navigation.js に無いと、このシナリオは意味を失う
    expect(BADGE_ITEMS.map((item) => item.badge.key).sort()).toEqual(Object.keys(TOTALS).sort())
    expect(badgedHrefs(wrapper)).toEqual(BADGE_ITEMS.map((item) => item.to))
    for (const item of BADGE_ITEMS) {
      // 数字はその項目のリンクの中に出る
      const badge = linkTo(wrapper, item).find(`[data-testid="sidebar-badge-${item.badge.key}"]`)
      expect(badge.text()).toBe(String(TOTALS[item.badge.key]))
    }
    for (const item of PLAIN_ITEMS) {
      expect(linkTo(wrapper, item).attributes('aria-describedby'), item.to).toBeUndefined()
    }
  })

  it('[ASB-22] 数字は読み上げから外し、リンク名はラベルのまま件数の文を aria-describedby で添える', async () => {
    respondCounts(TOTALS)
    const { wrapper } = await mountAt('/')
    await flushPromises()

    for (const item of BADGE_ITEMS) {
      const link = linkTo(wrapper, item)
      const count = TOTALS[item.badge.key]

      expect(badgeOf(wrapper, item).attributes('aria-hidden')).toBe('true')
      expect(accessibleText(link)).toBe(item.label)
      // 隠れた要素も数える名前の計算（Playwright の includeHidden）でもラベルのままになるよう、名前を明示する
      expect(link.attributes('aria-label')).toBe(item.label)

      const describedBy = link.attributes('aria-describedby')
      expect(describedBy).toBeTruthy()
      const description = wrapper.find(`[id="${describedBy}"]`)
      expect(description.exists()).toBe(true)
      expect(description.attributes('hidden')).toBeDefined()
      expect(description.text()).toBe(`${item.badge.label} ${count} 件`)
    }
  })

  it('[ASB-23] 件数が 0 なら数字も aria-describedby も出さない', async () => {
    respondCounts({ orderErrors: 0, dreamErrors: 0 })
    const { wrapper } = await mountAt('/')
    await flushPromises()

    expect(badgedHrefs(wrapper)).toEqual([])
    for (const item of navItems) {
      expect(linkTo(wrapper, item).attributes('aria-describedby'), item.to).toBeUndefined()
      expect(linkTo(wrapper, item).attributes('aria-label'), item.to).toBeUndefined()
      expect(accessibleText(linkTo(wrapper, item))).toBe(item.label)
    }
  })

  it('[ASB-24] 件数 API が 500 なら数字も aria-describedby も出さない', async () => {
    const fail = () => HttpResponse.json({ detail: 'x' }, { status: 500 })
    server.use(http.get(ORDERS, fail), http.get(DREAM_STATUS, fail))
    const { wrapper } = await mountAt('/')
    await flushPromises()

    expect(badgedHrefs(wrapper)).toEqual([])
    for (const item of navItems) {
      expect(linkTo(wrapper, item).attributes('aria-describedby'), item.to).toBeUndefined()
    }
  })

  it('[ASB-25] path が変わると件数を取り直し、クエリだけの変化では取り直さない', async () => {
    const calls = respondCounts(TOTALS)
    const { router } = await mountAt('/')
    await flushPromises()
    expect(calls).toEqual({ orderErrors: 1, dreamErrors: 1 })

    await router.push('/customers/search')
    await flushPromises()
    expect(calls).toEqual({ orderErrors: 2, dreamErrors: 2 })

    await router.push('/customers/search?page=2')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/customers/search?page=2')
    expect(calls).toEqual({ orderErrors: 2, dreamErrors: 2 })
  })
})
