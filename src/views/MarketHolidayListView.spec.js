import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { marketHolidays } from '@/mocks/fixtures/marketHolidays'
import { MARKET_HOLIDAYS_PAGE_SIZE } from '@/stores/marketHolidays'
import MarketHolidayListView from './MarketHolidayListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 */
const PATH = '/masters/market-holidays'

// 期待値はフィクスチャと表示件数から導く（56 / 50 を直接書かない）
const PAGE_SIZE = MARKET_HOLIDAYS_PAGE_SIZE
const TOTAL = marketHolidays.length
const firstPage = marketHolidays.slice(0, PAGE_SIZE)
const secondPage = marketHolidays.slice(PAGE_SIZE, PAGE_SIZE * 2)

// 絞り込みはフィクスチャ先頭の年をそのまま使う（年もハードコードしない）
const YEAR = marketHolidays[0].date.slice(0, 4)
const DATE_FROM = `${YEAR}-01-01`
const DATE_TO = `${YEAR}-12-31`
const inYear = marketHolidays.filter((holiday) => holiday.date.startsWith(YEAR))

// 登録に使う「フィクスチャに無い日付」もフィクスチャから導く（既存日付と衝突したら別日になる）
const existingDates = new Set(marketHolidays.map((holiday) => holiday.date))
const NEW_DATE = (() => {
  for (let day = 1; day <= 28; day += 1) {
    const date = `${YEAR}-06-${String(day).padStart(2, '0')}`
    if (!existingDates.has(date)) return date
  }
  throw new Error('フィクスチャに無い日付が見つからなかった')
})()
const NEW_REASON = 'テスト休場日'

// 既定ハンドラは日付が重複すると 409 を返すので、既存日付をそのまま重複の再現に使う
const DUPLICATE_DATE = marketHolidays[0].date
const DUPLICATE_MESSAGE = 'その日付の海外休場日はすでに登録されています。'

const Page = { render: () => h('div') }

async function mountView(query = {}) {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する。
  // この画面が見るのは route.query だけ（見出しは AppHeader が meta.title から出す）
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  // mount 前に遷移を済ませておけば router.isReady() を待たなくてよい
  await router.push({ path: PATH, query })

  const wrapper = mount(MarketHolidayListView, {
    global: {
      plugins: [createPinia(), router],
      // teleport を stub して、ヘッダへ差し込むボタンを wrapper 内に描画させる
      stubs: { teleport: true },
    },
  })
  return { wrapper, router }
}

/**
 * 操作 → router.push → queryKey の watch → 再取得 → 再描画 までを待つ。
 * 1 回目でナビゲーションが確定して再取得が始まり、2 回目で応答が反映される。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
}

const rows = (wrapper) => wrapper.findAll('[data-testid="data-table-row"]')
const rangeText = (wrapper) => wrapper.find('[data-testid="pagination-range"]').text()
const countText = (wrapper) => wrapper.find('[data-testid="market-holidays-count"]').text()
const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const addDateInput = (wrapper) => wrapper.find('[data-testid="market-holidays-add-date"]')
const addReasonInput = (wrapper) => wrapper.find('[data-testid="market-holidays-add-reason"]')
const fillAdd = async (wrapper, date, reason) => {
  await addDateInput(wrapper).setValue(date)
  await addReasonInput(wrapper).setValue(reason)
}
// FormField はエラー文の id を入力欄の aria-describedby に渡すので、そこから項目単位で引く
// （role="alert" で絞ると、同じ aria-describedby に並ぶ hint を拾わない）
const fieldError = (wrapper, input) => {
  const ids = (input.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((el) => el.exists())
  return found ? found.text() : ''
}
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)

const errorHandler = (options) =>
  http.get(
    '*/api/market-holidays',
    () => HttpResponse.json({ message: 'サーバーでエラーが発生しました。' }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get('*/api/market-holidays', () => HttpResponse.json({ items: [], total: 0 }), options)

// シナリオ: docs/unit/views-market-holiday-list-view.md
describe('MarketHolidayListView', () => {
  it('[MHL-01] 取得中はローディングを表示する', async () => {
    // watch(immediate) は setup 中に同期で走るので、最初の描画が既にローディング状態
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'market-holidays-loading')).toBe(true)
    expect(exists(wrapper, 'market-holidays-table')).toBe(false)
  })

  it('[MHL-02] 取得成功時は 1 ページ目と件数・ページャーを表示する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'market-holidays-loading')).toBe(false)
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 1–${PAGE_SIZE} 件`)

    const firstRow = rows(wrapper)[0].text()
    expect(firstRow).toContain(firstPage[0].date)
    expect(firstRow).toContain(firstPage[0].reason)
  })

  it('[MHL-03] API がエラーを返したときはメッセージと再試行ボタンを表示する', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="market-holidays-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('サーバーでエラーが発生しました。')
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'market-holidays-table')).toBe(false)
  })

  it('[MHL-04] 休場日が 0 件のときは空状態を表示する', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'market-holidays-empty')).toBe(true)
    expect(exists(wrapper, 'market-holidays-table')).toBe(false)
    expect(exists(wrapper, 'market-holidays-pagination')).toBe(false)
  })

  it('[MHL-05] エラーのときも検索フォームは表示され続ける', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'market-holidays-error')).toBe(true)
    expect(exists(wrapper, 'market-holidays-search')).toBe(true)
    expect(exists(wrapper, 'market-holidays-date-from')).toBe(true)
  })

  it('[MHL-06] offset 付きの URL で開くとそのページを復元する', async () => {
    const { wrapper } = await mountView({ offset: String(PAGE_SIZE) })
    await settle()

    expect(rows(wrapper)).toHaveLength(secondPage.length)
    expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`)
  })

  it('[MHL-07] 表示件数の倍数でない offset は 1 ページ目に丸める', async () => {
    const { wrapper } = await mountView({ offset: '7' })
    await settle()

    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 1–${PAGE_SIZE} 件`)
  })

  it('[MHL-08] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ offset: String(PAGE_SIZE) })
    expect(rows(wrapper)).toHaveLength(secondPage.length)
    expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`)
  })

  it('[MHL-09] 日付を入れて検索すると URL に条件が乗り絞り込まれる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="market-holidays-date-from"]').setValue(DATE_FROM)
    await wrapper.find('[data-testid="market-holidays-date-to"]').setValue(DATE_TO)
    await wrapper.find('[data-testid="market-holidays-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ date_from: DATE_FROM, date_to: DATE_TO })
    expect(rows(wrapper)).toHaveLength(inYear.length)
    expect(countText(wrapper)).toBe(`${inYear.length} 件`)
  })

  it('[MHL-10] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ date_from: DATE_FROM, date_to: DATE_TO })
    await settle()
    expect(rows(wrapper)).toHaveLength(inYear.length)

    await wrapper.find('[data-testid="market-holidays-search-clear"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(rows(wrapper)).toHaveLength(firstPage.length)
  })

  it('[MHL-11] URL の日付条件が入力欄に反映される', async () => {
    const { wrapper } = await mountView({ date_from: DATE_FROM, date_to: DATE_TO })
    await settle()

    expect(wrapper.find('[data-testid="market-holidays-date-from"]').element.value).toBe(DATE_FROM)
    expect(wrapper.find('[data-testid="market-holidays-date-to"]').element.value).toBe(DATE_TO)
  })

  it('[MHL-12] 再読み込みは URL を変えずに取り直す', async () => {
    // 2回目は既定ハンドラ（フィクスチャ全件）に戻る
    server.use(emptyHandler({ once: true }))
    const { wrapper, router } = await mountView()
    await settle()
    expect(exists(wrapper, 'market-holidays-empty')).toBe(true)

    // reload は router を経由しないのでナビゲーション待ちは要らない
    await wrapper.find('[data-testid="market-holidays-reload"]').trigger('click')
    await flushPromises()

    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[MHL-13] 「新規追加」で空の追加モーダルが開く', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'market-holidays-add-form')).toBe(false)

    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')

    expect(exists(wrapper, 'market-holidays-add-form')).toBe(true)
    expect(addDateInput(wrapper).element.value).toBe('')
    expect(addReasonInput(wrapper).element.value).toBe('')
  })

  it('[MHL-14] 未入力で「追加」を押すと項目ごとのエラーが出てモーダルは閉じない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')

    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    await settle()

    expect(exists(wrapper, 'market-holidays-add-form')).toBe(true)
    expect(fieldError(wrapper, addDateInput(wrapper))).toBe('日付を入力してください。')
    expect(fieldError(wrapper, addReasonInput(wrapper))).toBe('休場理由を入力してください。')
    // API を呼んでいないので一覧の件数は動かない
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(exists(wrapper, 'market-holidays-created')).toBe(false)
  })

  it('[MHL-15] 追加が成功するとモーダルが閉じ成功メッセージと増えた件数が出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')

    await fillAdd(wrapper, NEW_DATE, NEW_REASON)
    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    // POST → 一覧の再取得 → 再描画 の 2 往復を待つ
    await settle()
    await settle()

    expect(exists(wrapper, 'market-holidays-add-form')).toBe(false)
    const created = wrapper.find('[data-testid="market-holidays-created"]')
    expect(created.exists()).toBe(true)
    expect(created.text()).toContain(NEW_DATE)
    expect(countText(wrapper)).toBe(`${TOTAL + 1} 件`)
  })

  it('[MHL-16] 日付が重複したときはモーダル内にエラーが出て成功メッセージは出ない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')

    await fillAdd(wrapper, DUPLICATE_DATE, NEW_REASON)
    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    await settle()

    expect(exists(wrapper, 'market-holidays-add-form')).toBe(true)
    expect(wrapper.find('[data-testid="market-holidays-add-error"]').text()).toContain(
      DUPLICATE_MESSAGE,
    )
    // サーバの拒否は項目のエラーには混ぜない
    expect(fieldError(wrapper, addDateInput(wrapper))).toBe('')
    expect(exists(wrapper, 'market-holidays-created')).toBe(false)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[MHL-17] 失敗後に開き直すとエラーと入力が持ち込まれない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')
    await fillAdd(wrapper, DUPLICATE_DATE, NEW_REASON)
    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    await settle()
    expect(exists(wrapper, 'market-holidays-add-error')).toBe(true)

    await wrapper.find('[data-testid="market-holidays-add-cancel"]').trigger('click')
    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')

    expect(exists(wrapper, 'market-holidays-add-error')).toBe(false)
    expect(addDateInput(wrapper).element.value).toBe('')
    expect(addReasonInput(wrapper).element.value).toBe('')
  })
})
