import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { noOperationOperator } from '@/mocks/fixtures/currentOperator'
import { customers } from '@/mocks/fixtures/customers'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { useCodesStore } from '@/stores/codes'
import CustomerDetailView from './CustomerDetailView.vue'
import CustomerOrdersView from './CustomerOrdersView.vue'

/*
 * 画面テスト（顧客詳細の注文照会タブ）。枠（CustomerDetailView）ごと /customers/:id/orders から
 * マウントし、実際の Pinia ストア + vue-router + MSW(node) を通す。
 * 一覧の 4 状態・顧客の部店と口座番号の固定・URL クエリの扱い・発注権限・訂正 / 取消への遷移を検証する。
 */
const ORDERS = '*/api/orders'
const AUTH_ME = '*/api/auth/me'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const PATH = '/customers/1/orders'

const CUSTOMER = customers.find((row) => row.ID === 1)
const BRANCH = CUSTOMER.部店コード
const ACCOUNT = String(CUSTOMER.口座番号)

const rootOf = (row) => String(row.元注文ID ?? row.ID)
/** 行の集合を元注文ごとにまとめたときの id（サーバの既定の並び = ID の降順で最初に現れた順） */
const groupIds = (rows) => [...new Set([...rows].sort((a, b) => b.ID - a.ID).map(rootOf))]

const CUSTOMER_ROWS = orderInquiryRows.filter((row) => String(row.口座番号) === ACCOUNT)
const CUSTOMER_GROUPS = groupIds(CUSTOMER_ROWS)

// 訂正履歴を持つ元注文と、その最新の版
const AMENDED_ROOT = String(CUSTOMER_ROWS.find((row) => row.元注文ID !== null).元注文ID)
const AMENDED_LATEST = String(
  Math.max(...CUSTOMER_ROWS.filter((row) => rootOf(row) === AMENDED_ROOT).map((row) => row.ID)),
)

const Page = { render: () => h('div') }
const Root = { render: () => h(RouterView) }

async function mountView(query = {}) {
  // 実 router/index.js は createWebHistory 固定なので、テスト用に同じ形の最小定義を作る
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers/search', name: 'customer-search', component: Page },
      {
        path: '/customers/:customerId(\\d+)',
        component: CustomerDetailView,
        children: [
          { path: 'summary', name: 'customer-summary', component: Page },
          { path: 'orders', name: 'customer-orders', component: CustomerOrdersView },
          { path: 'order-entry', name: 'customer-order-entry', component: Page },
        ],
      },
      { path: '/orders/:orderId(\\d+)/amend', name: 'order-amend', component: Page },
      { path: '/orders/:orderId(\\d+)/cancel', name: 'order-cancel', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  // App.vue はコードマスタを読み終えてから画面を描く。それに合わせて先に読んでおく
  const pinia = createPinia()
  await useCodesStore(pinia).load()

  const wrapper = mount(Root, {
    global: {
      plugins: [pinia, router],
      // teleport を stub して、ヘッダへ差し込む操作を wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/** 顧客 → 預り・注文 の読み込みと再描画までを待つ */
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

/** 一覧の GET に届いたクエリを記録する（応答は既定のハンドラに任せる） */
function recordListQueries() {
  const seen = []
  server.use(
    http.get(ORDERS, ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return undefined
    }),
  )
  return seen
}

const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const rows = (wrapper) => wrapper.findAll('[data-testid="order-inquiry-row"]')
const rowIds = (wrapper) =>
  rows(wrapper).map(
    (row) =>
      row
        .find('td')
        .text()
        .match(/#(\d+)/)[1],
  )
const rowOf = (wrapper, id) => rows(wrapper).find((row) => row.find('td').text().includes(`#${id}`))

/** 顧客の部店と口座番号が載っているか */
function expectCustomerKey(params) {
  expect(params.get('branch_code')).toBe(BRANCH)
  expect(params.get('account_no')).toBe(ACCOUNT)
}

const errorHandler = () =>
  http.get(ORDERS, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))

// シナリオ: docs/unit/views-customer-orders-view.md
describe('CustomerOrdersView', () => {
  it('[COV-01] 取得中はローディングだけが出て件数も出ない', async () => {
    const release = gate(ORDERS)
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'customer-orders-loading')).toBe(true)
    expect(exists(wrapper, 'customer-orders-table')).toBe(false)
    expect(exists(wrapper, 'customer-orders-empty')).toBe(false)
    expect(exists(wrapper, 'customer-orders-error')).toBe(false)
    expect(exists(wrapper, 'customer-orders-count')).toBe(false)

    release()
    await settle()
  })

  it('[COV-02] 500 のときはエラーの理由と再試行が出て表は出ない', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="customer-orders-error"]')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'customer-orders-table')).toBe(false)
  })

  it('[COV-03] 再試行で一覧が出る', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    server.resetHandlers()
    await wrapper.find('[data-testid="customer-orders-error"] button').trigger('click')
    await settle()

    expect(exists(wrapper, 'customer-orders-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(CUSTOMER_GROUPS.length)
  })

  it('[COV-04] 絞り込みなしの 0 件は「この顧客の注文はありません」', async () => {
    server.use(http.get(ORDERS, () => HttpResponse.json({ orders: [], total: 0 })))
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="customer-orders-empty"]').text()).toBe(
      'この顧客の注文はありません',
    )
    expect(exists(wrapper, 'customer-orders-table')).toBe(false)
  })

  it('[COV-05] 絞り込みありの 0 件は「条件に一致する注文が見つかりませんでした」', async () => {
    const symbol = 'ZZZZ'
    expect(CUSTOMER_ROWS.some((row) => row.Ticker.includes(symbol))).toBe(false)
    const { wrapper } = await mountView({ symbol })
    await settle()

    expect(wrapper.find('[data-testid="customer-orders-empty"]').text()).toBe(
      '条件に一致する注文が見つかりませんでした',
    )
  })

  it('[COV-06] 顧客の部店と口座番号で読み、その顧客の注文だけが並ぶ', async () => {
    const seen = recordListQueries()
    const { wrapper } = await mountView()
    await settle()

    expectCustomerKey(seen.at(-1))
    expect(CUSTOMER_GROUPS.length).toBeGreaterThan(0)
    expect(rowIds(wrapper)).toEqual(CUSTOMER_GROUPS)
  })

  it('[COV-07] 表に部店・口座番号・顧客名の列が無い', async () => {
    const { wrapper } = await mountView()
    await settle()

    const headers = wrapper
      .findAll('[data-testid="customer-orders-table"] th')
      .map((th) => th.text())
    expect(headers.length).toBeGreaterThan(0)
    expect(headers).not.toContain('部店')
    expect(headers).not.toContain('口座番号')
    expect(headers).not.toContain('顧客名')
  })

  it('[COV-08] 銘柄コードで検索すると URL には symbol だけが載り、読み込みには顧客が載る', async () => {
    const symbol = CUSTOMER_ROWS[0].Ticker
    const seen = recordListQueries()
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="customer-orders-symbol"]').setValue(symbol)
    await wrapper.find('[data-testid="customer-orders-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ symbol })
    expect(seen.at(-1).get('symbol')).toBe(symbol)
    expectCustomerKey(seen.at(-1))
  })

  it('[COV-09] ?status=003 は「注文中」に復元され、顧客と一緒に送られる', async () => {
    const seen = recordListQueries()
    const { wrapper } = await mountView({ status: '003' })
    await settle()

    const select = wrapper.find('[data-testid="customer-orders-status"]')
    expect(select.element.value).toBe('003')
    expect(select.find('option:checked').text()).toBe('注文中')
    expect(seen.at(-1).get('status')).toBe('003')
    expectCustomerKey(seen.at(-1))
  })

  it('[COV-10] 選択肢に無い status は条件なしとして扱う', async () => {
    const seen = recordListQueries()
    const { wrapper } = await mountView({ status: '不明な値' })
    await settle()

    expect(wrapper.find('[data-testid="customer-orders-status"]').element.value).toBe('')
    expect(seen.at(-1).has('status')).toBe(false)
    expect(rowIds(wrapper)).toEqual(CUSTOMER_GROUPS)
  })

  it('[COV-11] 「新規注文」は顧客の部店と口座番号を引き継いで注文入力タブへ移る', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="customer-orders-new-order"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.path).toBe(`/customers/${CUSTOMER.ID}/order-entry`)
    expect(router.currentRoute.value.query).toEqual({
      branch_code: BRANCH,
      account_number: ACCOUNT,
    })
  })

  it('[COV-12] 発注権限が無ければ「新規注文」と訂正・取消を出さず「閲覧のみ」', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json(noOperationOperator)))
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'customer-orders-new-order')).toBe(false)
    expect(wrapper.findAll('[data-testid="order-inquiry-view-only"]')).toHaveLength(
      CUSTOMER_GROUPS.length,
    )
    expect(exists(wrapper, 'order-inquiry-amend')).toBe(false)
    expect(exists(wrapper, 'order-inquiry-cancel')).toBe(false)
  })

  it('[COV-13] 「訂正」は最新の版の注文 ID で訂正画面へ移る', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await rowOf(wrapper, AMENDED_ROOT).find('[data-testid="order-inquiry-amend"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.name).toBe('order-amend')
    expect(router.currentRoute.value.params.orderId).toBe(AMENDED_LATEST)
    expect(AMENDED_LATEST).not.toBe(AMENDED_ROOT)
  })

  it('[COV-14] 「取消」は最新の版の注文 ID で取消画面へ移る', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await rowOf(wrapper, AMENDED_ROOT).find('[data-testid="order-inquiry-cancel"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.name).toBe('order-cancel')
    expect(router.currentRoute.value.params.orderId).toBe(AMENDED_LATEST)
  })
})
