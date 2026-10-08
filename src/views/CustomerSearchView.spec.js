import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { useCodesStore } from '@/stores/codes'
import { CUSTOMER_SEARCH_PAGE_SIZE } from '@/stores/customerSearch'
import { CAUTION_RANKS } from '@/utils/customerCautions'
import CustomerSearchView from './CustomerSearchView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 * 行のクリックの移り先（名前付きルート customer-summary）を解決できるよう、テスト用ルータに同名のルートを置く。
 */
const PATH = '/customers/search'
const LIST_PATH = '*/api/masters/customers'

const PAGE_SIZE = CUSTOMER_SEARCH_PAGE_SIZE
const TOTAL = customers.length

/** 実 API と同じ並び（口座番号の昇順） */
const sorted = [...customers].sort((a, b) => a.口座番号 - b.口座番号)
const firstPage = sorted.slice(0, PAGE_SIZE)
const secondPage = sorted.slice(PAGE_SIZE)
const head = sorted[0]

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const jpyText = (value) => `${value.toLocaleString('ja-JP')} 円`
const usdText = (value) =>
  `${value.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ドル`

const errorHandler = (options) =>
  http.get(LIST_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)
const emptyHandler = () =>
  http.get(LIST_PATH, () =>
    HttpResponse.json({ total: 0, limit: PAGE_SIZE, offset: 0, customers: [] }),
  )

/** 送られた一覧リクエストのクエリを控える（応答は既定ハンドラに任せる） */
function recordQueries() {
  const queries = []
  server.use(
    http.get(LIST_PATH, ({ request }) => {
      queries.push(new URL(request.url).searchParams)
    }),
  )
  return queries
}

const Page = { render: () => h('div') }

async function mountView({ query = {}, withCodes = false } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/customers/:customerId/summary', name: 'customer-summary', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  const pinia = createPinia()
  if (withCodes) {
    setActivePinia(pinia)
    await useCodesStore().load()
  }

  const wrapper = mount(CustomerSearchView, {
    global: { plugins: [pinia, router], stubs: { teleport: true } },
  })
  return { wrapper, router }
}

/** 1 回目でナビゲーションが確定して再取得が始まり、2 回目で応答が反映される */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const countText = (wrapper) => wrapper.find('[data-testid="customer-search-count"]').text()

/** 口座番号（3 列目）で行を特定する */
const cellsFor = (wrapper, accountNumber) =>
  rows(wrapper)
    .find((row) => row.findAll('td')[2].text() === String(accountNumber))
    .findAll('td')

const COLUMN = { age: 4, rank: 5, cashJpy: 7, cashUsd: 8, growthQuota: 9, restriction: 10 }

// シナリオ: docs/unit/views-customer-search-view.md
describe('CustomerSearchView', () => {
  it('[CSW-01] 応答を待つ間はローディングだけを出す', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'customer-search-loading')).toBe(true)
    expect(exists(wrapper, 'customer-search-table')).toBe(false)
    expect(exists(wrapper, 'customer-search-empty')).toBe(false)
    expect(exists(wrapper, 'customer-search-error')).toBe(false)
    expect(exists(wrapper, 'customer-search-count')).toBe(false)
  })

  it('[CSW-02] 開いた時点で条件なしの一覧が出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(Math.min(PAGE_SIZE, TOTAL))
    expect(rows(wrapper).map((row) => row.findAll('td')[2].text())).toEqual(
      firstPage.map((row) => String(row.口座番号)),
    )
  })

  it('[CSW-03] 列は 11 列で、米国株評価額と評価損益の列は無い', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toEqual([
      '部店',
      '扱者',
      '口座番号',
      '顧客名',
      '年齢',
      'コンプラランク',
      '投資方針',
      '預り金（円貨）',
      '預り金（USD）',
      '成長投資枠',
      '取引規制',
    ])
    for (const label of headers(wrapper)) {
      expect(label).not.toContain('米国株')
      expect(label).not.toContain('評価損益')
    }
  })

  it('[CSW-04] 0 件のときは空状態を出し、表は描画しない', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="customer-search-empty"]').text()).toBe(
      '該当する顧客が見つかりませんでした',
    )
    expect(exists(wrapper, 'customer-search-table')).toBe(false)
  })

  it('[CSW-05] 取得に失敗したときは理由と再試行を出す', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="customer-search-error"]')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'customer-search-table')).toBe(false)
    expect(exists(wrapper, 'customer-search-empty')).toBe(false)
  })

  it('[CSW-06] 再試行で読み直すと表が出る', async () => {
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()

    await wrapper.find('[data-testid="customer-search-error"]').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'customer-search-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(Math.min(PAGE_SIZE, TOTAL))
  })

  it('[CSW-07] 説明文と検索カードは 4 状態のいずれでも表示される', async () => {
    for (const handler of [null, emptyHandler(), errorHandler()]) {
      if (handler) server.use(handler)
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'customer-search-description')).toBe(true)
      expect(exists(wrapper, 'customer-search-search')).toBe(true)
    }
  })

  it('[CSW-08] 検索すると画面モックのクエリ名で URL に条件が乗り絞り込まれる', async () => {
    const condition = {
      branch_code: head.部店コード,
      sales_rep_code: head.扱者コード,
      account_number: String(head.口座番号),
      name: head.顧客名,
    }
    const { wrapper, router } = await mountView({ withCodes: true })
    await settle()

    await wrapper
      .find('[data-testid="customer-search-branch-code"]')
      .setValue(condition.branch_code)
    await wrapper
      .find('[data-testid="customer-search-handler-code"]')
      .setValue(condition.sales_rep_code)
    await wrapper
      .find('[data-testid="customer-search-account-number"]')
      .setValue(condition.account_number)
    await wrapper.find('[data-testid="customer-search-customer-name"]').setValue(condition.name)
    await wrapper.find('[data-testid="customer-search-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual(condition)
    expect(rows(wrapper)).toHaveLength(1)
    expect(rows(wrapper)[0].findAll('td')[2].text()).toBe(condition.account_number)
  })

  it('[CSW-09] URL の条件は API のクエリ名に直して送られ、入力欄にも入る', async () => {
    const queries = recordQueries()
    const { wrapper } = await mountView({
      query: {
        branch_code: head.部店コード,
        sales_rep_code: head.扱者コード,
        account_number: String(head.口座番号),
        name: head.顧客名,
      },
      withCodes: true,
    })
    await settle()

    expect(queries.length).toBeGreaterThan(0)
    const sent = queries.at(-1)
    expect(sent.get('branch_code')).toBe(head.部店コード)
    expect(sent.get('handler_code')).toBe(head.扱者コード)
    expect(sent.get('account_no')).toBe(String(head.口座番号))
    expect(sent.get('customer_name')).toBe(head.顧客名)
    for (const name of ['sales_rep_code', 'account_number', 'name']) {
      expect(sent.has(name), name).toBe(false)
    }

    const valueOf = (testid) => wrapper.find(`[data-testid="${testid}"]`).element.value
    expect(valueOf('customer-search-branch-code')).toBe(head.部店コード)
    expect(valueOf('customer-search-handler-code')).toBe(head.扱者コード)
    expect(valueOf('customer-search-account-number')).toBe(String(head.口座番号))
    expect(valueOf('customer-search-customer-name')).toBe(head.顧客名)
  })

  it('[CSW-10] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ query: { branch_code: head.部店コード } })
    await settle()
    expect(Number(countText(wrapper).replace(/\D/g, ''))).toBeLessThan(TOTAL)

    await wrapper.find('[data-testid="customer-search-search-clear"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CSW-11] 行を click すると顧客詳細へ移る', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    const name = wrapper.find(`[data-testid="customer-search-detail-${head.ID}"]`)
    expect(name.text()).toBe(head.顧客名)
    expect(name.element.tagName).not.toBe('A')

    await cellsFor(wrapper, head.口座番号)[2].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe(`/customers/${head.ID}/summary`)
  })

  it('[CSW-12] 要注意のコンプラランクは buy、それ以外は gray のバッジ', async () => {
    const caution = firstPage.filter((row) => CAUTION_RANKS.includes(row.コンプラランク))
    const plain = firstPage.filter(
      (row) => row.コンプラランク && !CAUTION_RANKS.includes(row.コンプラランク),
    )
    expect(caution.length).toBeGreaterThan(0)
    expect(plain.length).toBeGreaterThan(0)

    const { wrapper } = await mountView()
    await settle()

    for (const [expected, list] of [
      ['buy', caution],
      ['gray', plain],
    ]) {
      for (const row of list) {
        const badge = cellsFor(wrapper, row.口座番号)[COLUMN.rank].find('.badge')
        expect(badge.attributes('data-variant'), String(row.口座番号)).toBe(expected)
        expect(badge.text()).toBe(row.コンプラランク)
      }
    }
  })

  it('[CSW-13] 全取引停止の行だけ取引規制をバッジで出す', async () => {
    const suspended = firstPage.find((row) => row.取引停止区分_全取引 === 1)
    const normal = firstPage.find((row) => row.取引停止区分_全取引 === 0)
    expect(suspended).toBeTruthy()
    expect(normal).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    const suspendedCell = cellsFor(wrapper, suspended.口座番号)[COLUMN.restriction]
    expect(suspendedCell.find('.badge').attributes('data-variant')).toBe('buy')
    expect(suspendedCell.text()).toBe('全取引停止')

    const normalCell = cellsFor(wrapper, normal.口座番号)[COLUMN.restriction]
    expect(normalCell.find('.badge').exists()).toBe(false)
    expect(normalCell.text()).toBe('-')
  })

  it('[CSW-14] 年齢は 歳 を付け、年齢の無い法人は — を出す', async () => {
    const person = firstPage.find((row) => row.年齢)
    const corporate = firstPage.find((row) => !row.年齢)
    expect(person).toBeTruthy()
    expect(corporate).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    expect(cellsFor(wrapper, person.口座番号)[COLUMN.age].text()).toBe(`${person.年齢}歳`)
    expect(cellsFor(wrapper, corporate.口座番号)[COLUMN.age].text()).toBe('—')
  })

  it('[CSW-15] 金額は単位を後置し、null は —、0 は 0 円', async () => {
    const filled = firstPage.find(
      (row) => row.円貨預り金 > 0 && row.外貨預り金 > 0 && row.NISA買付可能額_当年 > 0,
    )
    const zeroJpy = firstPage.find((row) => row.円貨預り金 === 0)
    const noUsd = firstPage.find((row) => row.外貨預り金 === null)
    const noQuota = firstPage.find((row) => row.NISA買付可能額_当年 === null)
    for (const row of [filled, zeroJpy, noUsd, noQuota]) expect(row).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    const cells = cellsFor(wrapper, filled.口座番号)
    expect(cells[COLUMN.cashJpy].text()).toBe(jpyText(filled.円貨預り金))
    expect(cells[COLUMN.cashUsd].text()).toBe(usdText(filled.外貨預り金))
    expect(cells[COLUMN.growthQuota].text()).toBe(jpyText(filled.NISA買付可能額_当年))
    expect(cellsFor(wrapper, zeroJpy.口座番号)[COLUMN.cashJpy].text()).toBe('0 円')
    expect(cellsFor(wrapper, noUsd.口座番号)[COLUMN.cashUsd].text()).toBe('—')
    expect(cellsFor(wrapper, noQuota.口座番号)[COLUMN.growthQuota].text()).toBe('—')
  })

  it('[CSW-16] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
    expect(secondPage.length).toBeGreaterThan(0)
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="pagination-page"][data-page="2"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query.offset).toBe(String(PAGE_SIZE))
    expect(rows(wrapper)).toHaveLength(secondPage.length)
    expect(rows(wrapper)[0].findAll('td')[2].text()).toBe(String(secondPage[0].口座番号))
  })
})
