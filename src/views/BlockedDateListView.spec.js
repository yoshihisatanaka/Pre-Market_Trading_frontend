import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { blockedDates } from '@/mocks/fixtures/blockedDates'
import { BLOCKED_DATES_PAGE_SIZE } from '@/stores/blockedDates'
import BlockedDateListView from './BlockedDateListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 */
const PATH = '/masters/blocked-dates'

// 期待値はフィクスチャと表示件数から導く（件数を直接書かない）
const PAGE_SIZE = BLOCKED_DATES_PAGE_SIZE
const TOTAL = blockedDates.length
const firstPage = blockedDates.slice(0, PAGE_SIZE)
const secondPage = blockedDates.slice(PAGE_SIZE, PAGE_SIZE * 2)

// 表示件数の倍数でない offset（丸めを廃止したので、この位置から表示件数分が出る）
const ODD_OFFSET = 7
const oddPage = blockedDates.slice(ODD_OFFSET, ODD_OFFSET + PAGE_SIZE)

// 絞り込みはフィクスチャ先頭の年をそのまま使う（年もハードコードしない）
const YEAR = blockedDates[0].date.slice(0, 4)
const DATE_FROM = `${YEAR}-01-01`
const DATE_TO = `${YEAR}-12-31`
const inYear = blockedDates.filter((blocked) => blocked.date.startsWith(YEAR))

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

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

  const wrapper = mount(BlockedDateListView, {
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
const countText = (wrapper) => wrapper.find('[data-testid="blocked-dates-count"]').text()
const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)

const errorHandler = (options) =>
  http.get(
    '*/api/blocked-dates',
    () => HttpResponse.json({ message: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get('*/api/blocked-dates', () => HttpResponse.json({ items: [], total: 0 }), options)

// シナリオ: docs/unit/views-blocked-date-list-view.md
describe('BlockedDateListView', () => {
  it('[BDL-01] 取得中はローディングを表示する', async () => {
    // watch(immediate) は setup 中に同期で走るので、最初の描画が既にローディング状態
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'blocked-dates-loading')).toBe(true)
    expect(exists(wrapper, 'blocked-dates-table')).toBe(false)
  })

  it('[BDL-02] 取得成功時は 1 ページ目と件数・ページャーを表示する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'blocked-dates-loading')).toBe(false)
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 1–${PAGE_SIZE} 件`)

    const firstRow = rows(wrapper)[0].text()
    expect(firstRow).toContain(firstPage[0].date)
    expect(firstRow).toContain(firstPage[0].reason)
  })

  it('[BDL-03] API がエラーを返したときはメッセージと再試行ボタンを表示する', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="blocked-dates-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'blocked-dates-table')).toBe(false)
  })

  it('[BDL-04] 受注不可日が 0 件のときは空状態を表示する', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'blocked-dates-empty')).toBe(true)
    expect(exists(wrapper, 'blocked-dates-table')).toBe(false)
    expect(exists(wrapper, 'blocked-dates-pagination')).toBe(false)
  })

  it('[BDL-05] エラーのときも検索フォームは表示され続ける', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'blocked-dates-error')).toBe(true)
    expect(exists(wrapper, 'blocked-dates-search')).toBe(true)
    expect(exists(wrapper, 'blocked-dates-date-from')).toBe(true)
    expect(exists(wrapper, 'blocked-dates-date-to')).toBe(true)
  })

  it('[BDL-06] offset 付きの URL で開くとそのページを復元する', async () => {
    const { wrapper } = await mountView({ offset: String(PAGE_SIZE) })
    await settle()

    expect(rows(wrapper)).toHaveLength(secondPage.length)
    expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`)
  })

  it('[BDL-07] 表示件数の倍数でない offset は丸めずその位置から表示する', async () => {
    const { wrapper } = await mountView({ offset: String(ODD_OFFSET) })
    await settle()

    // 端数の位置から表示件数分（ここでは残り全件）を出す。1 ページ目には戻さない
    expect(rows(wrapper)).toHaveLength(oddPage.length)
    expect(rows(wrapper)[0].text()).toContain(oddPage[0].date)
    // ページャーの件数ラベルは offset ではなく現在ページ（= 1 ページ目）から導かれるため、
    // 実際に見えている行とは一致しない。これは許容する仕様
    expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 1–${PAGE_SIZE} 件`)
  })

  it('[BDL-08] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ offset: String(PAGE_SIZE) })
    expect(rows(wrapper)).toHaveLength(secondPage.length)
    expect(rangeText(wrapper)).toBe(`${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`)
  })

  it('[BDL-09] 日付を入れて検索すると URL に条件が乗り絞り込まれる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="blocked-dates-date-from"]').setValue(DATE_FROM)
    await wrapper.find('[data-testid="blocked-dates-date-to"]').setValue(DATE_TO)
    await wrapper.find('[data-testid="blocked-dates-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ date_from: DATE_FROM, date_to: DATE_TO })
    expect(rows(wrapper)).toHaveLength(inYear.length)
    expect(countText(wrapper)).toBe(`${inYear.length} 件`)
  })

  it('[BDL-10] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ date_from: DATE_FROM, date_to: DATE_TO })
    await settle()
    expect(rows(wrapper)).toHaveLength(inYear.length)

    await wrapper.find('[data-testid="blocked-dates-search-clear"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[BDL-11] URL の日付条件が入力欄に反映される', async () => {
    const { wrapper } = await mountView({ date_from: DATE_FROM, date_to: DATE_TO })
    await settle()

    expect(wrapper.find('[data-testid="blocked-dates-date-from"]').element.value).toBe(DATE_FROM)
    expect(wrapper.find('[data-testid="blocked-dates-date-to"]').element.value).toBe(DATE_TO)
  })

  it('[BDL-12] 再読み込みは URL を変えずに取り直す', async () => {
    // 2回目は既定ハンドラ（フィクスチャ全件）に戻る
    server.use(emptyHandler({ once: true }))
    const { wrapper, router } = await mountView()
    await settle()
    expect(exists(wrapper, 'blocked-dates-empty')).toBe(true)

    // reload は router を経由しないのでナビゲーション待ちは要らない
    await wrapper.find('[data-testid="blocked-dates-reload"]').trigger('click')
    await flushPromises()

    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[BDL-13] 説明バナーは 4 状態のいずれでも表示される', async () => {
    // ローディング中
    const loadingView = await mountView()
    expect(exists(loadingView.wrapper, 'blocked-dates-loading')).toBe(true)
    expect(exists(loadingView.wrapper, 'blocked-dates-description')).toBe(true)

    // データあり
    await settle()
    expect(rows(loadingView.wrapper)).toHaveLength(firstPage.length)
    expect(exists(loadingView.wrapper, 'blocked-dates-description')).toBe(true)

    // エラー
    server.use(errorHandler({ once: true }))
    const errorView = await mountView()
    await settle()
    expect(exists(errorView.wrapper, 'blocked-dates-error')).toBe(true)
    expect(exists(errorView.wrapper, 'blocked-dates-description')).toBe(true)

    // 空
    server.use(emptyHandler({ once: true }))
    const emptyView = await mountView()
    await settle()
    expect(exists(emptyView.wrapper, 'blocked-dates-empty')).toBe(true)
    expect(exists(emptyView.wrapper, 'blocked-dates-description')).toBe(true)
  })

  it('[BDL-14] 表に日付 / 対象市場 / 理由が出て行の内容がフィクスチャと一致する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toEqual(['日付', '対象市場', '理由'])

    // 期待値はフィクスチャの値そのものから作る（表示文言を並べ書きしない）
    const cellTexts = rows(wrapper).map((row) => row.findAll('td').map((td) => td.text()))
    expect(cellTexts).toEqual(
      firstPage.map((blocked) => [blocked.date, blocked.market, blocked.reason]),
    )
  })
})
