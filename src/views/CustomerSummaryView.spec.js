import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { noOperationOperator } from '@/mocks/fixtures/currentOperator'
import { customers } from '@/mocks/fixtures/customers'
import { holdings } from '@/mocks/fixtures/holdings'
import { DEPOSIT_CATEGORY } from '@/utils/orderEntryOptions'
import CustomerDetailView from './CustomerDetailView.vue'
import CustomerSummaryView from './CustomerSummaryView.vue'

/*
 * 画面テスト（顧客詳細の外株預りタブ）。枠（CustomerDetailView）ごと /customers/:id/summary から
 * マウントし、実際の Pinia ストア + vue-router + MSW(node) を通す。
 * 預りの 4 状態・CA の警告・「買い」「売り」の引き継ぎ・発注権限での出し分けを検証する。
 */
const CUSTOMER = '*/api/masters/customers/:id'
const HOLDINGS = '*/api/holdings'
const AUTH_ME = '*/api/auth/me'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const customerOf = (id) => customers.find((row) => row.ID === id)
const holdingsOf = (customer) => holdings.filter((row) => row.口座番号 === customer.口座番号)

const FIRST = customerOf(1)
const FIRST_HOLDINGS = holdingsOf(FIRST)
const FIRST_KEY = { branch_code: FIRST.部店コード, account_number: String(FIRST.口座番号) }
const NO_HOLDINGS = customerOf(3)
const NO_CA = customerOf(6)
const CA_TICKERS = FIRST_HOLDINGS.filter((row) => row.CA).map((row) => row.ティッカー)

const Page = { render: () => h('div') }
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
          { path: 'summary', name: 'customer-summary', component: CustomerSummaryView },
          { path: 'orders', name: 'customer-orders', component: Page },
          { path: 'order-entry', name: 'customer-order-entry', component: Page },
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
const rows = (wrapper) =>
  wrapper.findAll('[data-testid="customer-holdings-table"] [data-testid="data-table-row"]')
const tickers = (wrapper) => rows(wrapper).map((row) => row.find('td').text())
const rowOf = (wrapper, ticker) => rows(wrapper).find((row) => row.find('td').text() === ticker)

/** リンクの href → { path, query }（クエリの並びに依存しない） */
function linkOf(element) {
  const url = new URL(element.attributes('href'), 'http://localhost')
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) }
}

const holdingsError = () =>
  http.get(HOLDINGS, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))

// シナリオ: docs/unit/views-customer-summary-view.md
describe('CustomerSummaryView', () => {
  it('[CSM-01] 預りの取得中はローディングだけが出て件数も出ない', async () => {
    const release = gate(HOLDINGS)
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    expect(exists(wrapper, 'customer-holdings-loading')).toBe(true)
    expect(exists(wrapper, 'customer-holdings-table')).toBe(false)
    expect(exists(wrapper, 'customer-holdings-empty')).toBe(false)
    expect(exists(wrapper, 'customer-holdings-error')).toBe(false)
    expect(exists(wrapper, 'customer-holdings-count')).toBe(false)

    release()
    await settle()
  })

  it('[CSM-02] 預りが 500 のときはエラーと再試行が出て、顧客カードは出る', async () => {
    server.use(holdingsError())
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    const error = wrapper.find('[data-testid="customer-holdings-error"]')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'customer-holdings-table')).toBe(false)
    expect(exists(wrapper, 'customer-info-bar')).toBe(true)
  })

  it('[CSM-03] 再試行は預りだけを読み直す', async () => {
    server.use(holdingsError())
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    server.resetHandlers()
    const customerRequests = []
    server.use(
      http.get(CUSTOMER, ({ request }) => {
        customerRequests.push(request.url)
        return undefined
      }),
    )
    await wrapper.find('[data-testid="customer-holdings-error"] button').trigger('click')
    await settle()

    expect(exists(wrapper, 'customer-holdings-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(FIRST_HOLDINGS.length)
    expect(customerRequests).toEqual([])
  })

  it('[CSM-04] 保有なしの顧客は「保有外株なし」', async () => {
    expect(holdingsOf(NO_HOLDINGS)).toHaveLength(0)
    const { wrapper } = await mountView(`/customers/${NO_HOLDINGS.ID}/summary`)
    await settle()

    expect(wrapper.find('[data-testid="customer-holdings-empty"]').text()).toBe('保有外株なし')
    expect(exists(wrapper, 'customer-holdings-table')).toBe(false)
    expect(exists(wrapper, 'customer-holdings-ca-warning')).toBe(false)
  })

  it('[CSM-05] 件数・行の並び・評価の時点が出る', async () => {
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    expect(wrapper.find('[data-testid="customer-holdings-count"]').text()).toBe(
      `${FIRST_HOLDINGS.length} 銘柄`,
    )
    expect(tickers(wrapper)).toEqual(FIRST_HOLDINGS.map((row) => row.ティッカー))
    expect(wrapper.find('[data-testid="customer-holdings-as-of"]').text()).toMatch(/時点$/)
  })

  it('[CSM-06] CA 発生中の銘柄があると警告が出て、印は CA の行にだけ付く', async () => {
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    expect(CA_TICKERS.length).toBeGreaterThan(0)
    expect(exists(wrapper, 'customer-holdings-ca-warning')).toBe(true)
    const marked = rows(wrapper)
      .filter((row) => row.find('[data-testid="customer-holdings-ca-mark"]').exists())
      .map((row) => row.find('td').text())
    expect(marked).toEqual(CA_TICKERS)
  })

  it('[CSM-07] 特定預りの「買い」は顧客・銘柄・買い・特定を引き継ぐ', async () => {
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    const buy = rowOf(wrapper, 'AAPL').find('[data-testid="customer-holdings-buy"]')
    expect(linkOf(buy)).toEqual({
      path: '/customers/1/order-entry',
      query: { ...FIRST_KEY, ticker: 'AAPL', side: 'buy', deposit: DEPOSIT_CATEGORY.SPECIFIC },
    })
  })

  it('[CSM-08] 成長投資枠の「買い」は預り区分を載せず、「売り」は成長投資枠を載せる', async () => {
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    const row = rowOf(wrapper, 'NVDA')
    expect(linkOf(row.find('[data-testid="customer-holdings-buy"]')).query).toEqual({
      ...FIRST_KEY,
      ticker: 'NVDA',
      side: 'buy',
    })
    expect(linkOf(row.find('[data-testid="customer-holdings-sell"]')).query).toEqual({
      ...FIRST_KEY,
      ticker: 'NVDA',
      side: 'sell',
      deposit: DEPOSIT_CATEGORY.GROWTH,
    })
  })

  it('[CSM-09] 売却不可の行の「売り」は押せない button', async () => {
    const prohibited = FIRST_HOLDINGS.find((holding) => holding.売却不可区分 === 1)
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    const row = rowOf(wrapper, prohibited.ティッカー)
    const sell = row.find('[data-testid="customer-holdings-sell"]')
    expect(sell.element.tagName).toBe('BUTTON')
    expect(sell.attributes('disabled')).toBeDefined()
    expect(sell.attributes('href')).toBeUndefined()
    expect(row.find('[data-testid="customer-holdings-buy"]').element.tagName).toBe('A')
  })

  it('[CSM-10] 発注権限が無ければ「閲覧のみ」で発注の導線を出さない', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json(noOperationOperator)))
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    expect(wrapper.findAll('[data-testid="customer-holdings-view-only"]')).toHaveLength(
      FIRST_HOLDINGS.length,
    )
    expect(exists(wrapper, 'customer-holdings-buy')).toBe(false)
    expect(exists(wrapper, 'customer-holdings-sell')).toBe(false)
    expect(exists(wrapper, 'customer-holdings-new-order')).toBe(false)
  })

  it('[CSM-11] 見出しの「新規注文」は顧客の部店と口座番号を引き継ぐ', async () => {
    const { wrapper } = await mountView('/customers/1/summary')
    await settle()

    expect(linkOf(wrapper.find('[data-testid="customer-holdings-new-order"]'))).toEqual({
      path: '/customers/1/order-entry',
      query: FIRST_KEY,
    })
  })

  it('[CSM-12] CA の無い顧客は警告も印も出ない', async () => {
    const noCaHoldings = holdingsOf(NO_CA)
    expect(noCaHoldings.length).toBeGreaterThan(0)
    expect(noCaHoldings.some((row) => row.CA)).toBe(false)

    const { wrapper } = await mountView(`/customers/${NO_CA.ID}/summary`)
    await settle()

    expect(rows(wrapper)).toHaveLength(noCaHoldings.length)
    expect(exists(wrapper, 'customer-holdings-ca-warning')).toBe(false)
    expect(exists(wrapper, 'customer-holdings-ca-mark')).toBe(false)
  })
})
