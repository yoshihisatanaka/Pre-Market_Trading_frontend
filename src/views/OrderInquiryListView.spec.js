import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { noOperationOperator } from '@/mocks/fixtures/currentOperator'
import { codeEntries } from '@/mocks/fixtures/codes'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { useCodesStore } from '@/stores/codes'
import OrderInquiryListView from './OrderInquiryListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分け・「URL クエリが正」の単方向フロー・発注権限での出し分け・
 * 訂正 / 取消画面への遷移を検証する。
 */
const PATH = '/orders/inquiry'
const ORDERS = '*/api/orders'
const AUTH_ME = '*/api/auth/me'

const rootOf = (row) => String(row.元注文ID ?? row.ID)
/** 行の集合を元注文ごとにまとめたときの id（サーバの既定の並び = ID の降順で最初に現れた順） */
const groupIds = (rows) => [...new Set([...rows].sort((a, b) => b.ID - a.ID).map(rootOf))]

const TOTAL = orderInquiryRows.length
const ALL_GROUPS = groupIds(orderInquiryRows)
const BRANCH = '123'
const inBranch = orderInquiryRows.filter((row) => row.部店 === BRANCH)
const WORKING = orderInquiryRows.filter((row) => row.処理状況 === '003')

// 訂正履歴を持つ元注文（#30）。訂正・取消は最新の版に対して行う
const AMENDED_ROOT = '30'
const AMENDED_LATEST = String(
  Math.max(
    ...orderInquiryRows
      .filter((row) => rootOf(row) === AMENDED_ROOT && row.注文種別 !== 'SLICE_CHILD')
      .map((row) => row.ID),
  ),
)

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const Page = { render: () => h('div') }

async function mountView(query = {}) {
  // 実 router/index.js は createWebHistory 固定なので、テスト用に最小定義する
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, name: 'order-inquiry', component: Page },
      { path: '/customers/search', name: 'customer-search', component: Page },
      { path: '/orders/:orderId(\\d+)/amend', name: 'order-amend', component: Page },
      { path: '/orders/:orderId(\\d+)/cancel', name: 'order-cancel', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  // App.vue はコードマスタを読み終えてから画面を描く。それに合わせて先に読んでおく
  const pinia = createPinia()
  await useCodesStore(pinia).load()

  const wrapper = mount(OrderInquiryListView, {
    global: {
      plugins: [pinia, router],
      // teleport を stub して、ヘッダへ差し込む操作を wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/** 操作 → router.push → 再取得 → 再描画 までを待つ */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const rows = (wrapper) => wrapper.findAll('[data-testid="order-inquiry-row"]')
const rowIds = (wrapper) =>
  rows(wrapper).map((row) => row.find('td').text().match(/#(\d+)/)[1])
const rowOf = (wrapper, id) => rows(wrapper).find((row) => row.find('td').text().includes(`#${id}`))
const countText = (wrapper) => wrapper.find('[data-testid="order-inquiry-count"]').text()

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

const errorHandler = () =>
  http.get(ORDERS, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))

// シナリオ: docs/unit/views-order-inquiry-list-view.md
describe('OrderInquiryListView', () => {
  it('[OIV-01] 取得中はローディングだけが出て件数も出ない', async () => {
    const release = gate(ORDERS)
    const { wrapper } = await mountView()
    await flushPromises()

    expect(exists(wrapper, 'order-inquiry-loading')).toBe(true)
    expect(exists(wrapper, 'order-inquiry-table')).toBe(false)
    expect(exists(wrapper, 'order-inquiry-empty')).toBe(false)
    expect(exists(wrapper, 'order-inquiry-error')).toBe(false)
    expect(exists(wrapper, 'order-inquiry-count')).toBe(false)

    release()
    await settle()
  })

  it('[OIV-02] 500 のときはエラーの理由と再試行が出て表は出ない', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="order-inquiry-error"]')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'order-inquiry-table')).toBe(false)
  })

  it('[OIV-03] 0 件のときは空の表示が出て表は出ない', async () => {
    server.use(http.get(ORDERS, () => HttpResponse.json({ orders: [], total: 0 })))
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="order-inquiry-empty"]').text()).toBe(
      '注文が見つかりませんでした',
    )
    expect(exists(wrapper, 'order-inquiry-table')).toBe(false)
  })

  it('[OIV-04] 既定モックでは件数と元注文ごとの行が出て 1 行目は #35', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(rowIds(wrapper)).toEqual(ALL_GROUPS)
    expect(rowIds(wrapper)[0]).toBe('35')
  })

  it('[OIV-05] 再試行で一覧が出る', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    server.resetHandlers()
    await wrapper.find('[data-testid="order-inquiry-error"] button').trigger('click')
    await settle()

    expect(exists(wrapper, 'order-inquiry-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(ALL_GROUPS.length)
  })

  it('[OIV-06] 部店コードで検索すると URL に乗りその条件で再取得される', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="order-inquiry-branch-code"]').setValue(BRANCH)
    await wrapper.find('[data-testid="order-inquiry-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ branch_code: BRANCH })
    expect(rowIds(wrapper)).toEqual(groupIds(inBranch))
    expect(rows(wrapper)).toHaveLength(2)
  })

  it('[OIV-07] ?status=003 は選択（注文中）に復元され status=003 で絞り込まれる', async () => {
    const seen = recordListQueries()
    const { wrapper } = await mountView({ status: '003' })
    await settle()

    const select = wrapper.find('[data-testid="order-inquiry-status"]')
    expect(select.element.value).toBe('003')
    expect(select.find('option:checked').text()).toBe('注文中')
    expect(seen.at(-1).get('status')).toBe('003')
    expect(rowIds(wrapper)).toEqual(groupIds(WORKING))
    expect(countText(wrapper)).toBe(`${WORKING.length} 件`)
  })

  it('[OIV-08] クリアで URL クエリと入力欄が空になる', async () => {
    const { wrapper, router } = await mountView({ branch_code: BRANCH })
    await settle()
    expect(wrapper.find('[data-testid="order-inquiry-branch-code"]').element.value).toBe(BRANCH)

    await wrapper.find('[data-testid="order-inquiry-search-clear"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('[data-testid="order-inquiry-branch-code"]').element.value).toBe('')
  })

  it('[OIV-09] 発注権限があれば「新規注文」が出て押すと顧客検索へ移る', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    expect(exists(wrapper, 'order-inquiry-no-permission')).toBe(false)
    await wrapper.find('[data-testid="order-inquiry-new-order"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.path).toBe('/customers/search')
  })

  it('[OIV-10] 「訂正」は最新の版の注文 ID で訂正画面へ移る', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await rowOf(wrapper, AMENDED_ROOT).find('[data-testid="order-inquiry-amend"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.name).toBe('order-amend')
    expect(router.currentRoute.value.params.orderId).toBe(AMENDED_LATEST)
    expect(AMENDED_LATEST).toBe('36')
  })

  it('[OIV-11] 選択肢に無い status は条件なしとして扱う', async () => {
    const seen = recordListQueries()
    const { wrapper } = await mountView({ status: '不明な値' })
    await settle()

    expect(wrapper.find('[data-testid="order-inquiry-status"]').element.value).toBe('')
    expect(seen.at(-1).has('status')).toBe(false)
    expect(rowIds(wrapper)).toEqual(ALL_GROUPS)
  })

  it('[OIV-12] 発注権限が無ければ「発注権限なし」と「閲覧のみ」になる', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json(noOperationOperator)))
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="order-inquiry-no-permission"]').text()).toBe('発注権限なし')
    expect(exists(wrapper, 'order-inquiry-new-order')).toBe(false)
    expect(wrapper.findAll('[data-testid="order-inquiry-view-only"]')).toHaveLength(
      ALL_GROUPS.length,
    )
    expect(exists(wrapper, 'order-inquiry-amend')).toBe(false)
    expect(exists(wrapper, 'order-inquiry-cancel')).toBe(false)
  })

  it('[OIV-13] /auth/me を読み終えるまではヘッダに権限の表示を出さない', async () => {
    const release = gate(AUTH_ME)
    const { wrapper } = await mountView()
    await settle()
    expect(rows(wrapper)).toHaveLength(ALL_GROUPS.length)

    expect(exists(wrapper, 'order-inquiry-new-order')).toBe(false)
    expect(exists(wrapper, 'order-inquiry-no-permission')).toBe(false)

    release()
    await settle()
    expect(exists(wrapper, 'order-inquiry-new-order')).toBe(true)
  })

  it('[OIV-14] 「取消」は最新の版の注文 ID で取消画面へ移る', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await rowOf(wrapper, AMENDED_ROOT).find('[data-testid="order-inquiry-cancel"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.name).toBe('order-cancel')
    expect(router.currentRoute.value.params.orderId).toBe(AMENDED_LATEST)
  })

  it('[OIV-15] 出来状況の選択肢はコードマスタ 注文照会出来状況 から来る', async () => {
    const { wrapper } = await mountView()
    await settle()

    const options = wrapper
      .findAll('[data-testid="order-inquiry-status"] option')
      .map((option) => ({ value: option.element.value, label: option.text() }))
    expect(options).toEqual([
      { value: '', label: '-- 全て --' },
      ...codeEntries('注文照会出来状況').map(({ code, label }) => ({ value: code, label })),
    ])
  })
})
