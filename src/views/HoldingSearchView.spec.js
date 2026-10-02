import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { SPECIFIC_DEPOSIT_NAMES } from '@/mocks/fixtures/codes'
import { noOperationOperator } from '@/mocks/fixtures/currentOperator'
import { customers } from '@/mocks/fixtures/customers'
import { holdings } from '@/mocks/fixtures/holdings'
import { useCodesStore } from '@/stores/codes'
import { HOLDING_SEARCH_PAGE_SIZE } from '@/stores/holdingSearch'
import { DEPOSIT_CATEGORY } from '@/utils/orderEntryOptions'
import HoldingSearchView from './HoldingSearchView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 検索前の案内・4 状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 * 顧客名・買い / 売りの行き先（名前付きルート customer-summary / order-new）を解決できるよう、
 * テスト用ルータに同名のルートを置く。
 */
const PATH = '/customers/holdings'
const HOLDINGS = '*/api/holdings'
const CUSTOMERS = '*/api/masters/customers'
const AUTH_ME = '*/api/auth/me'

const PAGE_SIZE = HOLDING_SEARCH_PAGE_SIZE
const TOTAL = holdings.length
/** 旧仕様（検索前の案内があった頃）の「条件なしで検索した」印。いまは filters に無く無視される */
const LEGACY_SUBMITTED = { submitted: '1' }

/** /codes の 特定預り区分（SPECIFIC_DEPOSIT_NAMES）に無いコード */
const UNKNOWN_DEPOSIT = '9'

/** ハンドラはフィクスチャの順のまま返す */
const firstPage = holdings.slice(0, PAGE_SIZE)
const secondPage = holdings.slice(PAGE_SIZE)
const head = holdings[0]
const headCustomer = customers.find(
  (row) => row.口座番号 === head.口座番号 && row.部店コード === head.部店コード,
)

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const errorHandler = (path, options) =>
  http.get(path, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)
const emptyHoldings = () =>
  http.get(HOLDINGS, () =>
    HttpResponse.json({ total: 0, limit: PAGE_SIZE, offset: 0, holdings: [] }),
  )

/** 送られたリクエストのクエリを控える（応答は既定ハンドラに任せる） */
function recordQueries(path) {
  const queries = []
  server.use(
    http.get(path, ({ request }) => {
      queries.push(new URL(request.url).searchParams)
    }),
  )
  return queries
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

const Page = { render: () => h('div') }

async function mountView({ query = {}, withCodes = false } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/customers/:customerId/summary', name: 'customer-summary', component: Page },
      { path: '/orders/new', name: 'order-new', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  const pinia = createPinia()
  if (withCodes) {
    setActivePinia(pinia)
    await useCodesStore().load()
  }

  const wrapper = mount(HoldingSearchView, {
    global: { plugins: [pinia, router], stubs: { teleport: true } },
  })
  return { wrapper, router }
}

/** 1 回目でナビゲーションが確定して再取得が始まり、2 回目で応答が反映される */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const find = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`)
const exists = (wrapper, testid) => find(wrapper, testid).exists()
const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const countText = (wrapper) => find(wrapper, 'holding-search-count').text()

const COLUMN = {
  account: 1,
  specificDeposit: 6,
  quantity: 7,
  referencePrice: 8,
  referenceFxRate: 9,
  valuation: 10,
  profitLoss: 11,
  corporateAction: 12,
}

const accountNumbers = (wrapper) =>
  rows(wrapper).map((row) => row.findAll('td')[COLUMN.account].text())

const decimal2 = (value) =>
  value.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const jpyText = (value) => `${value.toLocaleString('ja-JP')} 円`

/** リンクの href → { path, query }（クエリの並びに依存しない） */
function linkOf(element) {
  const url = new URL(element.attributes('href'), 'http://localhost')
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) }
}

/** 既定の検索結果のうち、条件に合う最初の明細の行 */
function rowWhere(wrapper, predicate) {
  const index = firstPage.findIndex(predicate)
  expect(index).toBeGreaterThanOrEqual(0)
  return { row: rows(wrapper)[index], holding: firstPage[index] }
}

async function submit(wrapper) {
  await find(wrapper, 'holding-search-search').trigger('submit')
  await settle()
}

// シナリオ: docs/unit/views-holding-search-view.md
describe('HoldingSearchView', () => {
  it('[HSV-01] 開いた時点で案内は出ず、条件なしの一覧と検索カードが出る', async () => {
    const queries = recordQueries(HOLDINGS)
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'holding-search-prompt')).toBe(false)
    expect(exists(wrapper, 'holding-search-search')).toBe(true)
    expect(exists(wrapper, 'holding-search-table')).toBe(true)
    expect(queries).toHaveLength(1)
    expect([...queries[0].keys()].sort()).toEqual(['limit', 'offset'])
  })

  it('[HSV-02] 応答を待つ間はローディングだけを出す', async () => {
    const release = gate(HOLDINGS)
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'holding-search-loading')).toBe(true)
    for (const testid of [
      'holding-search-table',
      'holding-search-empty',
      'holding-search-error',
      'holding-search-count',
    ]) {
      expect(exists(wrapper, testid), testid).toBe(false)
    }

    release()
    await settle()
  })

  it('[HSV-03] 検索済みなら件数と 1 ページぶんの行が出る', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(Math.min(PAGE_SIZE, TOTAL))
    expect(accountNumbers(wrapper)[0]).toBe(String(head.口座番号))
  })

  it('[HSV-04] 取得に失敗したときは理由と再試行を出し、再試行で表が出る', async () => {
    server.use(errorHandler(HOLDINGS, { once: true }))
    const { wrapper } = await mountView()
    await settle()

    const error = find(wrapper, 'holding-search-error')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'holding-search-table')).toBe(false)
    expect(exists(wrapper, 'holding-search-empty')).toBe(false)

    await error.find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'holding-search-error')).toBe(false)
    expect(exists(wrapper, 'holding-search-table')).toBe(true)
    expect(rows(wrapper)).toHaveLength(Math.min(PAGE_SIZE, TOTAL))
  })

  it('[HSV-05] 0 件のときは空状態を出し、表は描画しない', async () => {
    server.use(emptyHoldings())
    const { wrapper } = await mountView()
    await settle()

    expect(find(wrapper, 'holding-search-empty').text()).toBe('該当する預りはありません')
    expect(exists(wrapper, 'holding-search-table')).toBe(false)
  })

  it('[HSV-06] 見出しは 14 列で、「仮計算」はどこにも無い', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toEqual([
      '部店',
      '口座番号',
      '顧客名',
      'ティッカー',
      '銘柄コード',
      '銘柄名',
      '預り区分',
      '数量',
      '参考単価（USD）',
      '参考為替（USD/JPY）',
      '取得金額／評価額（円）',
      '評価損益／評価損益率',
      'CA',
      '操作',
    ])
    expect(wrapper.text()).not.toContain('仮計算')
  })

  it('[HSV-07] 条件なしで「検索」を押しても URL は空のままで、引き直さない', async () => {
    const { wrapper, router } = await mountView()
    await settle()
    const queries = recordQueries(HOLDINGS)

    await submit(wrapper)

    expect(router.currentRoute.value.query).toEqual({})
    expect(queries).toHaveLength(0)
    expect(rows(wrapper)).toHaveLength(Math.min(PAGE_SIZE, TOTAL))
  })

  it('[HSV-08] 6 条件で検索すると URL は画面の名前、API へは API の名前で送られる', async () => {
    const condition = {
      branch_code: head.部店コード,
      account_number: String(head.口座番号),
      customer_name: head.顧客名.split(' ')[0],
      symbol: head.ティッカー,
      stock_name: head.銘柄名,
      specific_deposit: head.預り売買区分,
    }
    const expected = holdings.filter(
      (row) =>
        row.部店コード === condition.branch_code &&
        String(row.口座番号) === condition.account_number &&
        (row.顧客名.includes(condition.customer_name) ||
          row.顧客名カナ.includes(condition.customer_name)) &&
        (row.ティッカー === condition.symbol || row.銘柄コード === condition.symbol) &&
        row.銘柄名.includes(condition.stock_name) &&
        row.預り売買区分 === condition.specific_deposit,
    )
    expect(expected.length).toBeGreaterThan(0)

    const { wrapper, router } = await mountView({ withCodes: true })
    await settle()
    const queries = recordQueries(HOLDINGS)

    await find(wrapper, 'holding-search-branch-code').setValue(condition.branch_code)
    await find(wrapper, 'holding-search-account-number').setValue(condition.account_number)
    await find(wrapper, 'holding-search-customer-name').setValue(condition.customer_name)
    await find(wrapper, 'holding-search-symbol').setValue(condition.symbol)
    await find(wrapper, 'holding-search-symbol-name').setValue(condition.stock_name)
    await find(wrapper, 'holding-search-specific-deposit').setValue(condition.specific_deposit)
    await submit(wrapper)

    expect(router.currentRoute.value.query).toEqual(condition)

    expect(queries).toHaveLength(1)
    const sent = queries[0]
    expect(sent.get('branch_code')).toBe(condition.branch_code)
    expect(sent.get('account_no')).toBe(condition.account_number)
    expect(sent.get('customer_name')).toBe(condition.customer_name)
    expect(sent.get('symbol')).toBe(condition.symbol)
    expect(sent.get('symbol_name')).toBe(condition.stock_name)
    expect(sent.get('specific_deposit')).toBe(condition.specific_deposit)
    for (const name of ['account_number', 'stock_name']) {
      expect(sent.has(name), name).toBe(false)
    }

    expect(rows(wrapper)).toHaveLength(expected.length)
  })

  it('[HSV-09] URL の条件で絞り込み、入力欄にも入る', async () => {
    const branchCode = head.部店コード
    const customerName = head.顧客名.split(' ')[0]
    const expected = holdings.filter(
      (row) =>
        row.部店コード === branchCode &&
        (row.顧客名.includes(customerName) || row.顧客名カナ.includes(customerName)),
    )
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(TOTAL)

    const { wrapper } = await mountView({
      query: { branch_code: branchCode, customer_name: customerName },
      withCodes: true,
    })
    await settle()

    expect(countText(wrapper)).toContain(String(expected.length))
    expect(accountNumbers(wrapper)).toEqual(
      expected.slice(0, PAGE_SIZE).map((row) => String(row.口座番号)),
    )
    expect(find(wrapper, 'holding-search-branch-code').element.value).toBe(branchCode)
    expect(find(wrapper, 'holding-search-customer-name').element.value).toBe(customerName)
  })

  it('[HSV-10] 未知の預り区分コードは条件なしに落とし、全件を出す', async () => {
    const queries = recordQueries(HOLDINGS)
    const { wrapper } = await mountView({
      query: { specific_deposit: UNKNOWN_DEPOSIT },
      withCodes: true,
    })
    await settle()

    expect(exists(wrapper, 'holding-search-error')).toBe(false)
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.at(-1).has('specific_deposit')).toBe(false)

    const select = find(wrapper, 'holding-search-specific-deposit')
    // 選択肢が読み込まれていないと全コードが未知扱いになり、このシナリオは意味を失う
    expect(UNKNOWN_DEPOSIT in SPECIFIC_DEPOSIT_NAMES).toBe(false)
    expect(select.findAll('option').length).toBeGreaterThan(1)
    expect(select.element.value).toBe('')
    expect(select.element.selectedOptions[0].text).toBe('-- 全区分 --')
  })

  it('[HSV-11] クリアで URL クエリが空になり、全件の一覧に戻る', async () => {
    const { wrapper, router } = await mountView({ query: { branch_code: head.部店コード } })
    await settle()
    expect(Number(countText(wrapper).replace(/\D/g, ''))).toBeLessThan(TOTAL)

    await find(wrapper, 'holding-search-search-clear').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(Math.min(PAGE_SIZE, TOTAL))
  })

  it('[HSV-12] 2 ページ目を押すと URL に offset だけが乗り、残りの行が出る', async () => {
    expect(secondPage.length).toBeGreaterThan(0)
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="pagination-page"][data-page="2"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ offset: String(PAGE_SIZE) })
    expect(rows(wrapper)).toHaveLength(TOTAL - PAGE_SIZE)
    expect(accountNumbers(wrapper)[0]).toBe(String(secondPage[0].口座番号))
  })

  it('[HSV-13] 数量・参考単価・参考為替・金額・預り区分・CA の書式', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(head.CA).toBeNull()
    const cells = rows(wrapper)[0].findAll('td')
    expect(cells[COLUMN.quantity].text()).toBe(`${head.数量.toLocaleString('ja-JP')}株`)
    expect(cells[COLUMN.referencePrice].text()).toBe(
      `${decimal2(head.評価額_USD / head.数量)} ドル`,
    )
    expect(cells[COLUMN.referenceFxRate].text()).toBe(decimal2(head.評価額_JPY / head.評価額_USD))
    const valuation = cells[COLUMN.valuation].findAll('span').map((span) => span.text())
    expect(valuation).toEqual([jpyText(head.取得金額), jpyText(head.評価額_JPY)])
    expect(cells[COLUMN.specificDeposit].text()).toBe(head.預り売買区分名)
    expect(cells[COLUMN.corporateAction].text()).toBe('—')

    const { row, holding } = rowWhere(wrapper, (item) => item.CA)
    expect(row.findAll('td')[COLUMN.corporateAction].text()).toBe(holding.CA)
  })

  it('[HSV-14] 評価益は + と is-profit、評価損は − と is-loss、損益 0 は色なし', async () => {
    const { wrapper } = await mountView()
    await settle()

    const cellOf = (predicate) => {
      const { row } = rowWhere(wrapper, predicate)
      return row.findAll('td')[COLUMN.profitLoss].find('.is-profit-loss')
    }

    const profit = cellOf((item) => item.評価損益 > 0)
    expect(profit.text().startsWith('+')).toBe(true)
    expect(profit.classes()).toContain('is-profit')
    expect(profit.classes()).not.toContain('is-loss')

    const loss = cellOf((item) => item.評価損益 < 0)
    expect(loss.text().startsWith('−')).toBe(true)
    expect(loss.classes()).toContain('is-loss')
    expect(loss.classes()).not.toContain('is-profit')

    const zero = cellOf((item) => item.評価損益 === 0)
    expect(zero.classes()).not.toContain('is-profit')
    expect(zero.classes()).not.toContain('is-loss')
  })

  it('[HSV-15] 顧客名を押すと顧客マスタを引き、その顧客の顧客詳細へ移る', async () => {
    expect(headCustomer).toBeTruthy()
    const queries = recordQueries(CUSTOMERS)
    const { wrapper, router } = await mountView()
    await settle()

    await rows(wrapper)[0].find('[data-testid="holding-search-customer-link"]').trigger('click')
    await settle()

    expect(queries).toHaveLength(1)
    expect(queries[0].get('branch_code')).toBe(head.部店コード)
    expect(queries[0].get('account_no')).toBe(String(head.口座番号))
    expect(router.currentRoute.value.name).toBe('customer-summary')
    expect(router.currentRoute.value.params.customerId).toBe(String(headCustomer.ID))
  })

  it('[HSV-16] 顧客マスタが 500 のときは理由の帯を出し、ルートは変わらない', async () => {
    server.use(errorHandler(CUSTOMERS))
    const { wrapper, router } = await mountView()
    await settle()

    await rows(wrapper)[0].find('[data-testid="holding-search-customer-link"]').trigger('click')
    await settle()

    const band = find(wrapper, 'holding-search-customer-error')
    expect(band.text()).toContain('顧客詳細を開けませんでした。')
    expect(band.text()).toContain(ERROR_MESSAGE)
    expect(router.currentRoute.value.path).toBe(PATH)
    expect(router.currentRoute.value.query).toEqual({})
    expect(rows(wrapper)).toHaveLength(Math.min(PAGE_SIZE, TOTAL))
  })

  it('[HSV-17] 顧客マスタに居ないときは口座番号入りの理由を出し、ルートは変わらない', async () => {
    server.use(
      http.get(CUSTOMERS, () =>
        HttpResponse.json({ total: 0, limit: 10, offset: 0, customers: [] }),
      ),
    )
    const { wrapper, router } = await mountView()
    await settle()

    await rows(wrapper)[0].find('[data-testid="holding-search-customer-link"]').trigger('click')
    await settle()

    expect(find(wrapper, 'holding-search-customer-error').text()).toContain(
      `口座番号 ${head.口座番号} の顧客が顧客マスタに見つかりません。`,
    )
    expect(router.currentRoute.value.path).toBe(PATH)
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[HSV-18] 顧客を引けなかった帯は検索し直すと消える', async () => {
    server.use(errorHandler(CUSTOMERS))
    const { wrapper } = await mountView()
    await settle()
    await rows(wrapper)[0].find('[data-testid="holding-search-customer-link"]').trigger('click')
    await settle()
    expect(exists(wrapper, 'holding-search-customer-error')).toBe(true)

    await find(wrapper, 'holding-search-customer-name').setValue(head.顧客名.split(' ')[0])
    await submit(wrapper)

    expect(exists(wrapper, 'holding-search-customer-error')).toBe(false)
  })

  it('[HSV-19] 顧客を引いているあいだは顧客名のボタンがすべて押せない', async () => {
    const release = gate(CUSTOMERS)
    const { wrapper } = await mountView()
    await settle()

    await rows(wrapper)[0].find('[data-testid="holding-search-customer-link"]').trigger('click')

    const links = wrapper.findAll('[data-testid="holding-search-customer-link"]')
    expect(links.length).toBe(rows(wrapper).length)
    for (const link of links) {
      expect(link.attributes('disabled')).toBeDefined()
    }

    release()
    await settle()
  })

  it('[HSV-20] 「買い」「売り」は顧客・銘柄・売買・預り区分を新規注文へ引き継ぐ', async () => {
    expect(head.預り売買区分).toBe('1')
    const { wrapper } = await mountView()
    await settle()

    const row = rows(wrapper)[0]
    const base = {
      branch_code: head.部店コード,
      account_number: String(head.口座番号),
      ticker: head.ティッカー,
      deposit: DEPOSIT_CATEGORY.SPECIFIC,
    }
    expect(linkOf(row.find('[data-testid="holding-search-buy"]'))).toEqual({
      path: '/orders/new',
      query: { ...base, side: 'buy' },
    })
    expect(linkOf(row.find('[data-testid="holding-search-sell"]'))).toEqual({
      path: '/orders/new',
      query: { ...base, side: 'sell' },
    })
  })

  it('[HSV-21] 売却不可の明細の「売り」は押せない button で、買いはリンクのまま', async () => {
    const { wrapper } = await mountView()
    await settle()

    const { row } = rowWhere(wrapper, (item) => item.売却不可区分 === 1)
    const sell = row.find('[data-testid="holding-search-sell"]')
    expect(sell.element.tagName).toBe('BUTTON')
    expect(sell.attributes('disabled')).toBeDefined()
    expect(sell.attributes('href')).toBeUndefined()
    expect(sell.attributes('title')).toBe('現在売却できません。')
    expect(row.find('[data-testid="holding-search-buy"]').element.tagName).toBe('A')
  })

  it('[HSV-22] 発注権限が無ければ全行「閲覧のみ」で、買い・売りは出ない', async () => {
    server.use(http.get(AUTH_ME, () => HttpResponse.json(noOperationOperator)))
    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper).length).toBeGreaterThan(0)
    expect(wrapper.findAll('[data-testid="holding-search-view-only"]')).toHaveLength(
      rows(wrapper).length,
    )
    expect(exists(wrapper, 'holding-search-buy')).toBe(false)
    expect(exists(wrapper, 'holding-search-sell')).toBe(false)
  })

  it('[HSV-23] 権限が決まるまでは操作列に何も出さない', async () => {
    const release = gate(AUTH_ME)
    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper).length).toBeGreaterThan(0)
    expect(exists(wrapper, 'holding-search-view-only')).toBe(false)
    expect(exists(wrapper, 'holding-search-buy')).toBe(false)
    expect(exists(wrapper, 'holding-search-sell')).toBe(false)

    release()
    await settle()
  })

  it('[HSV-24] 旧仕様の submitted=1 は無視され、全件の一覧が出る', async () => {
    const queries = recordQueries(HOLDINGS)
    const { wrapper } = await mountView({ query: LEGACY_SUBMITTED })
    await settle()

    expect(exists(wrapper, 'holding-search-error')).toBe(false)
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.at(-1).has('submitted')).toBe(false)
  })

  it('[HSV-25] 預り区分の選択肢は /codes の 特定預り区分 がコード順に並ぶ', async () => {
    const expected = Object.entries(SPECIFIC_DEPOSIT_NAMES)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
    expect(expected.length).toBeGreaterThan(0)

    const { wrapper } = await mountView({ withCodes: true })
    await settle()

    const options = find(wrapper, 'holding-search-specific-deposit')
      .findAll('option')
      .map((option) => ({ value: option.element.value, label: option.text() }))
    expect(options[0]).toEqual({ value: '', label: '-- 全区分 --' })
    expect(options.slice(1)).toEqual(expected)
  })
})
