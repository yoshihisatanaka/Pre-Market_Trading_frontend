import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { holdings } from '@/mocks/fixtures/holdings'
import { formatJpyUnit } from '@/utils/format'
import { formatSignedJpyUnit } from '@/utils/profitLoss'
import CustomerDetailView from './CustomerDetailView.vue'

/*
 * 画面テスト（顧客詳細の枠）。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 顧客の 4 状態・顧客カード・タブ・子ルートの描画を検証する。
 * 子ルートの中身は別の spec が見るので、ここでは目印だけの部品に差し替える。
 */
const CUSTOMER = '*/api/masters/customers/:id'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const customerOf = (id) => customers.find((row) => row.ID === id)
const FIRST = customerOf(1)
const SECOND = customerOf(2)
const firstHoldings = holdings.filter((row) => row.口座番号 === FIRST.口座番号)
const sum = (values) => values.reduce((total, value) => total + value, 0)

const Page = { render: () => h('div') }
const Child = (testid) => ({ render: () => h('div', { 'data-testid': testid }) })
const Root = { render: () => h(RouterView) }

async function mountView(path) {
  // 実 router/index.js は createWebHistory 固定なので、テスト用に同じ形の最小定義を作る
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers/search', name: 'customer-search', component: Page },
      {
        path: '/customers/:customerId(\\d+)',
        component: CustomerDetailView,
        children: [
          {
            path: '',
            name: 'customer-detail',
            redirect: (to) => ({ name: 'customer-summary', params: to.params }),
          },
          { path: 'summary', name: 'customer-summary', component: Child('child-summary') },
          { path: 'orders', name: 'customer-orders', component: Child('child-orders') },
          {
            path: 'order-entry',
            name: 'customer-order-entry',
            component: Child('child-order-entry'),
          },
          {
            path: 'calculations',
            name: 'customer-calculations',
            component: Child('child-calculations'),
          },
        ],
      },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(path)

  const wrapper = mount(Root, {
    global: {
      plugins: [createPinia(), router],
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/** 顧客 → 預り の 2 段の読み込みと再描画までを待つ */
async function settle() {
  for (let i = 0; i < 4; i += 1) await flushPromises()
}

/** 指定のパスの応答を握る。解放すると既定のハンドラに流れる */
function gate(path) {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.get(path, async () => {
      await wait
      return undefined
    }),
  )
  return release
}

const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const text = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).text()
const href = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).attributes('href')

const errorHandler = () =>
  http.get(CUSTOMER, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))

// シナリオ: docs/unit/views-customer-detail-view.md
describe('CustomerDetailView', () => {
  it('[CDV-01] 顧客の取得中はローディングだけが出る', async () => {
    const release = gate(CUSTOMER)
    const { wrapper } = await mountView('/customers/1/summary')
    await flushPromises()

    expect(exists(wrapper, 'customer-detail-loading')).toBe(true)
    expect(exists(wrapper, 'customer-info-bar')).toBe(false)
    expect(exists(wrapper, 'customer-detail-tabs')).toBe(false)
    expect(exists(wrapper, 'customer-detail-not-found')).toBe(false)
    expect(exists(wrapper, 'customer-detail-error')).toBe(false)

    release()
    await settle()
  })

  it('[CDV-02] 404 は「見つからない」と顧客検索へ戻るリンクを出す', async () => {
    const { wrapper } = await mountView('/customers/9999/summary')
    await settle()

    expect(exists(wrapper, 'customer-detail-not-found')).toBe(true)
    expect(href(wrapper, 'customer-detail-back-to-search')).toBe('/customers/search')
    expect(exists(wrapper, 'customer-detail-error')).toBe(false)
    expect(exists(wrapper, 'customer-info-bar')).toBe(false)
  })

  it('[CDV-03] 500 はエラーの理由と再試行を出す', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    expect(text(wrapper, 'customer-detail-error')).toContain(ERROR_MESSAGE)
    expect(text(wrapper, 'customer-detail-retry')).toBe('再試行')
    expect(exists(wrapper, 'customer-info-bar')).toBe(false)
    expect(exists(wrapper, 'customer-detail-not-found')).toBe(false)
  })

  it('[CDV-04] 再試行で顧客カードが出る', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    server.resetHandlers()
    await wrapper.find('[data-testid="customer-detail-retry"]').trigger('click')
    await settle()

    expect(exists(wrapper, 'customer-detail-error')).toBe(false)
    expect(exists(wrapper, 'customer-info-bar')).toBe(true)
  })

  it('[CDV-05] 顧客カードに部店・口座番号・顧客名とタブ 4 つが出る', async () => {
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    expect(text(wrapper, 'customer-info-branch')).toBe(FIRST.部店コード)
    expect(text(wrapper, 'customer-info-account')).toBe(String(FIRST.口座番号))
    expect(text(wrapper, 'customer-info-name')).toBe(FIRST.顧客名)
    expect(wrapper.findAll('[data-testid="customer-detail-tabs"] a').map((a) => a.text())).toEqual([
      '外株預り',
      '注文入力',
      '注文照会',
      '仮計算',
    ])
  })

  it('[CDV-06] 子ルートは顧客を読み終えてから描く', async () => {
    const release = gate(CUSTOMER)
    const { wrapper } = await mountView('/customers/1/summary')
    await flushPromises()
    expect(exists(wrapper, 'child-summary')).toBe(false)

    release()
    await settle()
    expect(exists(wrapper, 'child-summary')).toBe(true)
  })

  it('[CDV-07] タブのリンク先（注文入力は顧客の部店と口座番号を引き継ぐ）', async () => {
    const { wrapper, router } = await mountView('/customers/1/summary')
    await settle()

    expect(href(wrapper, 'customer-detail-tab-summary')).toBe('/customers/1/summary')
    expect(href(wrapper, 'customer-detail-tab-orders')).toBe('/customers/1/orders')
    expect(href(wrapper, 'customer-detail-tab-calculations')).toBe('/customers/1/calculations')
    expect(href(wrapper, 'customer-detail-tab-order-entry')).toBe(
      router.resolve({
        path: '/customers/1/order-entry',
        query: { branch_code: FIRST.部店コード, account_number: String(FIRST.口座番号) },
      }).href,
    )
  })

  it('[CDV-08] 開いたタブだけが選択中になる', async () => {
    const isActive = (wrapper, key) =>
      wrapper.find(`[data-testid="customer-detail-tab-${key}"]`).classes('is-active')

    const summary = await mountView('/customers/1/summary')
    await settle()
    expect(isActive(summary.wrapper, 'summary')).toBe(true)
    expect(isActive(summary.wrapper, 'orders')).toBe(false)
    expect(isActive(summary.wrapper, 'order-entry')).toBe(false)

    const orders = await mountView('/customers/1/orders')
    await settle()
    expect(isActive(orders.wrapper, 'summary')).toBe(false)
    expect(isActive(orders.wrapper, 'orders')).toBe(true)
    expect(isActive(orders.wrapper, 'order-entry')).toBe(false)
    expect(isActive(orders.wrapper, 'calculations')).toBe(false)

    const orderEntry = await mountView('/customers/1/order-entry')
    await settle()
    expect(isActive(orderEntry.wrapper, 'summary')).toBe(false)
    expect(isActive(orderEntry.wrapper, 'orders')).toBe(false)
    expect(isActive(orderEntry.wrapper, 'order-entry')).toBe(true)
    expect(exists(orderEntry.wrapper, 'customer-info-bar')).toBe(true)
    expect(exists(orderEntry.wrapper, 'child-order-entry')).toBe(true)

    const calculations = await mountView('/customers/1/calculations')
    await settle()
    expect(isActive(calculations.wrapper, 'summary')).toBe(false)
    expect(isActive(calculations.wrapper, 'orders')).toBe(false)
    expect(isActive(calculations.wrapper, 'calculations')).toBe(true)
    expect(exists(calculations.wrapper, 'child-calculations')).toBe(true)
  })

  it('[CDV-09] 米国株評価額と評価損益は預りの合計', async () => {
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    expect(firstHoldings.length).toBeGreaterThan(0)
    expect(text(wrapper, 'customer-info-valuation')).toBe(
      formatJpyUnit(sum(firstHoldings.map((row) => row.評価額_JPY))),
    )
    expect(text(wrapper, 'customer-info-profit-loss')).toBe(
      formatSignedJpyUnit(sum(firstHoldings.map((row) => row.評価損益))),
    )
  })

  it('[CDV-10] URL の customerId が変わると読み直す', async () => {
    const { wrapper, router } = await mountView('/customers/1/summary')
    await settle()
    expect(text(wrapper, 'customer-info-name')).toBe(FIRST.顧客名)

    await router.push('/customers/2/summary')
    await settle()

    expect(SECOND.顧客名).not.toBe(FIRST.顧客名)
    expect(text(wrapper, 'customer-info-name')).toBe(SECOND.顧客名)
  })

  it('[CDV-11] /customers/1 は外株預りタブへ回す', async () => {
    const { wrapper, router } = await mountView('/customers/1')
    await settle()

    expect(router.currentRoute.value.name).toBe('customer-summary')
    expect(router.currentRoute.value.path).toBe('/customers/1/summary')
    expect(wrapper.find('[data-testid="customer-detail-tab-summary"]').classes('is-active')).toBe(
      true,
    )
  })
})
