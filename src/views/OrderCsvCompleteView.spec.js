import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  BULK_ORDER_FIRST_ID,
  ORDER_CSV_CASH_SHORT_QUANTITY,
  bulkOrderCreateResponse,
  orderCsvCashShortForcedWarning,
  orderCsvColumnNames,
  orderCsvSampleOrders,
  orderCsvTemplateText,
} from '@/mocks/fixtures/orderCsv'
import { useOrderCsvStore } from '@/stores/orderCsv'
import { formatQuantity } from '@/utils/format'
import OrderCsvCompleteView from './OrderCsvCompleteView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、一括受付の結果の表示と
 * 取込み・Dream登録状況への導線を検証する。前提はストアの事前検証 → 一括受付で作ってからマウントする。
 */
const BULK_PATH = '*/api/orders/bulk-create'

/*
 * 事前検証は multipart。jsdom の FormData は MSW(node) を通らないので、テストの間だけ
 * Node（undici）の FormData に差し替え、File も Node の実装にする（src/api/stalledOrders.spec.js と同じ）。
 */
let NodeFormData = null

beforeAll(async () => {
  const response = new Response('', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  NodeFormData = (await response.formData()).constructor
})

beforeEach(() => {
  vi.stubGlobal('FormData', NodeFormData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const csvFile = (text) => new NodeFile([text], 'orders.csv', { type: 'text/csv' })
const templateFile = () => csvFile(orderCsvTemplateText)

/** 買付余力不足になる注文（MSW の仮規則。買いで数量が ORDER_CSV_CASH_SHORT_QUANTITY 以上） */
const cashShortOrder = { ...orderCsvSampleOrders[0], 数量: ORDER_CSV_CASH_SHORT_QUANTITY }

/** 正常の行と、強制で救える行（買付余力不足）だけの CSV */
const forceableFile = () =>
  csvFile(
    [
      orderCsvColumnNames.join(','),
      ...[orderCsvSampleOrders[0], cashShortOrder].map((order) =>
        orderCsvColumnNames.map((name) => (order[name] == null ? '' : String(order[name]))).join(','),
      ),
    ].join('\r\n') + '\r\n',
  )

/**
 * 救える行を強制にして受け付けた前提を作る。
 * @returns {Promise<{ pinia: import('pinia').Pinia, forcedRowNumber: number }>}
 */
async function prepareForced() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useOrderCsvStore(pinia)
  await store.validateFile(forceableFile())
  const forceable = store.validation.rows.find((row) => row.forceable)
  store.setForced(forceable, true)
  await store.submitOrders()
  return { pinia, forcedRowNumber: forceable.rowNumber }
}

const Page = { render: () => h('div') }

/**
 * ストアに前提を作る。accept: false なら受付まで進めない（completion が無い）。
 * @returns {Promise<{ pinia: import('pinia').Pinia, store: ReturnType<typeof useOrderCsvStore> }>}
 */
async function prepare({ accept = true } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useOrderCsvStore(pinia)
  if (accept) {
    await store.validateFile(templateFile())
    await store.submitOrders()
  }
  return { pinia, store }
}

async function mountView(pinia) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/orders/csv/upload', name: 'order-csv-upload', component: Page },
      { path: '/orders/csv/complete', name: 'order-csv-complete', component: Page },
      { path: '/orders/dream-status', name: 'dream-status-list', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ name: 'order-csv-complete' })

  const wrapper = mount(OrderCsvCompleteView, {
    global: {
      plugins: [pinia, router],
      stubs: { teleport: true },
    },
  })
  await flushPromises()
  return { wrapper, router }
}

const byTestid = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => byTestid(wrapper, testid).exists()
const table = (wrapper) => byTestid(wrapper, 'order-csv-complete-table')
const rows = (wrapper) => table(wrapper).findAll('[data-testid="data-table-row"]')
const headers = (wrapper) => table(wrapper).findAll('th').map((th) => th.text())
/** 行の中の、見出しが label の列のセル */
const cell = (wrapper, row, label) => row.findAll('td')[headers(wrapper).indexOf(label)]

// シナリオ: docs/unit/views-order-csv-complete-view.md
describe('OrderCsvCompleteView', () => {
  it('[OCC-01] 受付結果が無いと空状態だけを出す', async () => {
    const { pinia } = await prepare({ accept: false })
    const { wrapper } = await mountView(pinia)

    expect(exists(wrapper, 'order-csv-complete-empty')).toBe(true)
    expect(exists(wrapper, 'order-csv-complete-table')).toBe(false)
    expect(exists(wrapper, 'order-csv-complete-total')).toBe(false)
  })

  it('[OCC-02] 空状態の「CSV取込みへ」で取込みへ移る', async () => {
    const { pinia } = await prepare({ accept: false })
    const { wrapper, router } = await mountView(pinia)

    await byTestid(wrapper, 'order-csv-complete-to-upload').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('order-csv-upload')
  })

  it('[OCC-03] 受付件数と Dream登録待ちの件数・完了の文言・受け付けた行を出す', async () => {
    const { pinia } = await prepare()
    const { wrapper } = await mountView(pinia)
    const total = formatQuantity(bulkOrderCreateResponse.total_orders)

    expect(byTestid(wrapper, 'order-csv-complete-total').text()).toContain(total)
    expect(byTestid(wrapper, 'order-csv-complete-pending').text()).toContain(total)
    expect(exists(wrapper, 'order-csv-complete-message')).toBe(true)
    expect(rows(wrapper)).toHaveLength(orderCsvSampleOrders.length)
  })

  it('[OCC-04] 注文ID は # の後に採番が続く', async () => {
    const { pinia } = await prepare()
    const { wrapper } = await mountView(pinia)

    rows(wrapper).forEach((row, index) => {
      expect(cell(wrapper, row, '注文ID').text()).toBe(`#${BULK_ORDER_FIRST_ID + index}`)
    })
  })

  it('[OCC-05] 採番が返らなかった行は注文ID が — になる', async () => {
    server.use(
      http.post(BULK_PATH, () =>
        HttpResponse.json({
          ...bulkOrderCreateResponse,
          order_ids: [BULK_ORDER_FIRST_ID],
        }),
      ),
    )
    const { pinia } = await prepare()
    const { wrapper } = await mountView(pinia)
    // 前提: 採番より行が多い
    expect(orderCsvSampleOrders.length).toBeGreaterThan(1)

    const ids = rows(wrapper).map((row) => cell(wrapper, row, '注文ID').text())
    expect(ids).toEqual(
      orderCsvSampleOrders.map((_, index) => (index === 0 ? `#${BULK_ORDER_FIRST_ID}` : '—')),
    )
  })

  it('[OCC-06] どの行も Dream登録待ち・次回定点RPA登録になる', async () => {
    const { pinia } = await prepare()
    const { wrapper } = await mountView(pinia)

    for (const row of rows(wrapper)) {
      expect(cell(wrapper, row, '受付状況').text()).toBe('Dream登録待ち')
      expect(cell(wrapper, row, '登録予定').text()).toBe('次回定点RPA登録')
    }
  })

  it('[OCC-07] 「続けてCSV取込み」で結果を消して取込みへ移る', async () => {
    const { pinia, store } = await prepare()
    const { wrapper, router } = await mountView(pinia)

    await byTestid(wrapper, 'order-csv-complete-continue').trigger('click')
    await flushPromises()

    expect(store.completion).toBeNull()
    expect(router.currentRoute.value.name).toBe('order-csv-upload')
  })

  it('[OCC-08] 「Dream登録状況へ」で Dream登録状況へ移る', async () => {
    const { pinia } = await prepare()
    const { wrapper, router } = await mountView(pinia)

    await byTestid(wrapper, 'order-csv-complete-dream-status').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('dream-status-list')
  })

  it('[OCC-09] 強制で受け付けた行の警告を CSV の行番号付きで出す', async () => {
    const { pinia, forcedRowNumber } = await prepareForced()
    const { wrapper } = await mountView(pinia)

    expect(exists(wrapper, 'order-csv-complete-warnings')).toBe(true)
    const items = wrapper.findAll('[data-testid="order-csv-complete-warning"]')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain(`${forcedRowNumber}行目：`)
    expect(items[0].text()).toContain(orderCsvCashShortForcedWarning(cashShortOrder.数量))
  })

  it('[OCC-10] 行番号の無い警告は「行目：」を付けずに出す', async () => {
    const MESSAGE = '大口取引の確認が必要です'
    server.use(
      http.post(BULK_PATH, () =>
        HttpResponse.json({ ...bulkOrderCreateResponse, warnings: [MESSAGE] }),
      ),
    )
    const { pinia } = await prepare()
    const { wrapper } = await mountView(pinia)

    const items = wrapper.findAll('[data-testid="order-csv-complete-warning"]')
    expect(items).toHaveLength(1)
    expect(items[0].text().trim()).toBe(MESSAGE)
    expect(items[0].text()).not.toContain('行目：')
  })

  it('[OCC-11] 警告が無ければ警告の帯は出ない', async () => {
    const { pinia, store } = await prepare()
    // 前提: 既定モックの受付は警告を返さない
    expect(store.completion.warnings).toEqual([])
    const { wrapper } = await mountView(pinia)

    expect(exists(wrapper, 'order-csv-complete-warnings')).toBe(false)
  })
})
