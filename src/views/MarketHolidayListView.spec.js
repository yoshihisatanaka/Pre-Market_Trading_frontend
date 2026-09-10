import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { canceledMarketHolidays, marketHolidays } from '@/mocks/fixtures/marketHolidays'
import { MARKET_HOLIDAYS_PAGE_SIZE } from '@/stores/marketHolidays'
import {
  MARKET_HOLIDAY_TYPE_DEFAULT,
  MARKET_HOLIDAY_TYPE_OPTIONS,
  formatMarketHolidayType,
} from '@/utils/marketHolidayTypes'
import MarketHolidayListView from './MarketHolidayListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 */
const PATH = '/masters/market-holidays'

/*
 * フィクスチャはバックエンドの生の形（日本語キー / 休場日は YYYYMMDD の integer）なので、
 * 期待値を作るときはここで 'YYYY-MM-DD' に直す。
 */
const toIsoDate = (holidayDate) => {
  const digits = String(holidayDate)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
const toId = (holiday) => String(holiday.休場日)

// 期待値はフィクスチャと表示件数から導く（56 / 50 を直接書かない）
const PAGE_SIZE = MARKET_HOLIDAYS_PAGE_SIZE
const TOTAL = marketHolidays.length
// フィクスチャは実 API と同じ休場日の降順なので、この並びがそのまま 1 ページ目になる
const firstPage = marketHolidays.slice(0, PAGE_SIZE)
const secondPage = marketHolidays.slice(PAGE_SIZE, PAGE_SIZE * 2)

// 表示件数の倍数でない offset（丸めを廃止したので、この位置から表示件数分が出る）
const ODD_OFFSET = 7
const oddPage = marketHolidays.slice(ODD_OFFSET, ODD_OFFSET + PAGE_SIZE)

// 絞り込みはフィクスチャ先頭の年をそのまま使う（年もハードコードしない）
const YEAR = String(marketHolidays[0].休場日).slice(0, 4)
const DATE_FROM = `${YEAR}-01-01`
const DATE_TO = `${YEAR}-12-31`
const inYear = marketHolidays.filter((holiday) => String(holiday.休場日).startsWith(YEAR))

// 登録に使う「フィクスチャに無い日付」もフィクスチャから導く（既存日付と衝突したら別日になる）
const existingDates = new Set(marketHolidays.map((holiday) => toIsoDate(holiday.休場日)))
const NEW_DATE = (() => {
  for (let day = 1; day <= 28; day += 1) {
    const date = `${YEAR}-06-${String(day).padStart(2, '0')}`
    if (!existingDates.has(date)) return date
  }
  throw new Error('フィクスチャに無い日付が見つからなかった')
})()
const NEW_REASON = 'テスト休場日'

/*
 * 休場区分。コードと表示名は選択肢の定義から引き、件数はフィクスチャを数えて出す
 * （「短縮取引が 7 件」といった内訳を直接書かない）。
 */
const SHORTENED = MARKET_HOLIDAY_TYPE_OPTIONS[1]
const shortenedHolidays = marketHolidays.filter((holiday) => holiday.休場区分 === SHORTENED.value)
// 選択肢に無いコード（?holiday_type=9 のような外から来た値の再現用）
const UNKNOWN_TYPE = (() => {
  for (const code of ['9', '8', '7']) {
    if (!MARKET_HOLIDAY_TYPE_OPTIONS.some((option) => option.value === code)) return code
  }
  throw new Error('選択肢に無いコードが見つからなかった')
})()

// 既定ハンドラの事前検証は既存の日付を弾くので、既存日付をそのまま重複の再現に使う
const DUPLICATE_DATE = toIsoDate(marketHolidays[0].休場日)
const DUPLICATE_MESSAGE = `休場日 ${marketHolidays[0].休場日} は既に登録されています`

// 取消済み（論理削除）の日付。事前検証が「再有効化になる」と警告を返す
const CANCELED_DATE = toIsoDate(canceledMarketHolidays[0].休場日)
const REACTIVATION_WARNING = 'この日付は以前登録され削除されています。再度有効にします'

// 削除の対象もフィクスチャから導く（id / 日付を直接書かない）
const DELETE_TARGET = marketHolidays[0]
const DELETE_TARGET_ID = toId(DELETE_TARGET)
const DELETE_TARGET_DATE = toIsoDate(DELETE_TARGET.休場日)
const NOT_FOUND_MESSAGE = `指定された海外休場日が存在しません: ${DELETE_TARGET_ID}`

/*
 * 「最終ページが 1 件だけ」を作るための絞り込み。
 * 一覧は降順なので、末尾から数えて PAGE_SIZE + 1 件目までを範囲にすると
 * 2 ページ目がちょうど 1 件になる。
 */
const LAST_PAGE_TARGET = marketHolidays[PAGE_SIZE]
const LAST_PAGE_FROM = toIsoDate(LAST_PAGE_TARGET.休場日)
const LAST_PAGE_TO = toIsoDate(marketHolidays[0].休場日)

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
const addTypeSelect = (wrapper) => wrapper.find('[data-testid="market-holidays-add-holiday-type"]')
const searchTypeSelect = (wrapper) => wrapper.find('[data-testid="market-holidays-holiday-type"]')
// 一覧の休場区分セル（行ごとに 1 つ）
const typeCells = (wrapper) =>
  rows(wrapper).map((row) => row.find('.market-holiday-list__type').text())
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const openAddModal = async (wrapper) => {
  await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')
}
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
    '*/api/holidays',
    () => HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get(
    '*/api/holidays',
    () => HttpResponse.json({ total: 0, limit: PAGE_SIZE, offset: 0, holidays: [] }),
    options,
  )
const deleteNotFoundHandler = () =>
  http.delete('*/api/holidays/:holidayDate', () =>
    HttpResponse.json({ detail: NOT_FOUND_MESSAGE }, { status: 404 }),
  )

const deleteButton = (wrapper, id) => wrapper.find(`[data-testid="market-holidays-delete-${id}"]`)
// 削除確認モーダルは表の行と同じ日付を出すので、dialog に絞ってから本文を読む
const deleteDialog = (wrapper) => wrapper.find('[role="dialog"][aria-label="削除確認"]')
const openDelete = async (wrapper, id) => {
  await deleteButton(wrapper, id).trigger('click')
}
const confirmDelete = async (wrapper) => {
  await wrapper.find('[data-testid="market-holidays-delete-submit"]').trigger('click')
}

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
    expect(firstRow).toContain(toIsoDate(firstPage[0].休場日))
    expect(firstRow).toContain(firstPage[0].休場理由)
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

  it('[MHL-07] 表示件数の倍数でない offset は丸めずその位置から表示する', async () => {
    const { wrapper } = await mountView({ offset: String(ODD_OFFSET) })
    await settle()

    // 端数の位置から表示件数分（ここでは残り全件）を出す。1 ページ目には戻さない
    expect(rows(wrapper)).toHaveLength(oddPage.length)
    expect(rows(wrapper)[0].text()).toContain(toIsoDate(oddPage[0].休場日))
    // ページャーの件数ラベルは offset ではなく現在ページ（= 1 ページ目）から導かれるため、
    // 実際に見えている行（8 件目以降）とは一致しない。これは許容する仕様
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
    expect(exists(wrapper, 'market-holidays-notice')).toBe(false)
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
    const created = wrapper.find('[data-testid="market-holidays-notice"]')
    expect(created.exists()).toBe(true)
    expect(created.text()).toContain(NEW_DATE)
    expect(countText(wrapper)).toBe(`${TOTAL + 1} 件`)
  })

  it('[MHL-16] 日付が重複したときはモーダル内に事前検証の理由が出て成功メッセージは出ない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')

    await fillAdd(wrapper, DUPLICATE_DATE, NEW_REASON)
    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    await settle()

    expect(exists(wrapper, 'market-holidays-add-form')).toBe(true)
    expect(wrapper.find('[data-testid="market-holidays-add-validation-error"]').text()).toContain(
      DUPLICATE_MESSAGE,
    )
    // 事前検証の不合格は通信エラーではないので、サーバ障害の枠には出さない
    expect(exists(wrapper, 'market-holidays-add-error')).toBe(false)
    // サーバの拒否は項目のエラーにも混ぜない
    expect(fieldError(wrapper, addDateInput(wrapper))).toBe('')
    expect(exists(wrapper, 'market-holidays-notice')).toBe(false)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[MHL-17] 失敗後に開き直すとエラーと入力が持ち込まれない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')
    await fillAdd(wrapper, DUPLICATE_DATE, NEW_REASON)
    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    await settle()
    expect(exists(wrapper, 'market-holidays-add-validation-error')).toBe(true)

    await wrapper.find('[data-testid="market-holidays-add-cancel"]').trigger('click')
    await wrapper.find('[data-testid="market-holidays-add"]').trigger('click')

    expect(exists(wrapper, 'market-holidays-add-validation-error')).toBe(false)
    expect(addDateInput(wrapper).element.value).toBe('')
    expect(addReasonInput(wrapper).element.value).toBe('')
  })

  it('[MHL-18] 行の「削除」で対象の日付を示す確認モーダルが開く', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(deleteDialog(wrapper).exists()).toBe(false)

    await openDelete(wrapper, DELETE_TARGET_ID)

    expect(deleteDialog(wrapper).exists()).toBe(true)
    expect(deleteDialog(wrapper).text()).toContain(DELETE_TARGET_DATE)
  })

  it('[MHL-19] 「キャンセル」で確認モーダルが閉じ件数は変わらない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openDelete(wrapper, DELETE_TARGET_ID)

    await wrapper.find('[data-testid="market-holidays-delete-cancel"]').trigger('click')
    await settle()

    expect(deleteDialog(wrapper).exists()).toBe(false)
    // API を呼んでいないので一覧の件数も行数も動かない
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(exists(wrapper, 'market-holidays-notice')).toBe(false)
  })

  it('[MHL-20] 削除が成功するとモーダルが閉じ成功メッセージと減った件数が出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openDelete(wrapper, DELETE_TARGET_ID)

    await confirmDelete(wrapper)
    // DELETE → 一覧の再取得 → 再描画 の 2 往復を待つ
    await settle()
    await settle()

    expect(deleteDialog(wrapper).exists()).toBe(false)
    const notice = wrapper.find('[data-testid="market-holidays-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain(DELETE_TARGET_DATE)
    expect(countText(wrapper)).toBe(`${TOTAL - 1} 件`)
    expect(deleteButton(wrapper, DELETE_TARGET_ID).exists()).toBe(false)
  })

  it('[MHL-21] 削除が 404 のときモーダル内にエラーが出て成功メッセージは出ない', async () => {
    server.use(deleteNotFoundHandler())
    const { wrapper } = await mountView()
    await settle()
    await openDelete(wrapper, DELETE_TARGET_ID)

    await confirmDelete(wrapper)
    await settle()

    expect(deleteDialog(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-testid="market-holidays-delete-error"]').text()).toContain(
      NOT_FOUND_MESSAGE,
    )
    expect(exists(wrapper, 'market-holidays-notice')).toBe(false)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[MHL-22] 最終ページの最後の 1 件を消すと 1 ページ前に戻る', async () => {
    const { wrapper, router } = await mountView({
      date_from: LAST_PAGE_FROM,
      date_to: LAST_PAGE_TO,
      offset: String(PAGE_SIZE),
    })
    await settle()
    expect(rows(wrapper)).toHaveLength(1)

    await openDelete(wrapper, toId(LAST_PAGE_TARGET))
    await confirmDelete(wrapper)
    // DELETE → 再取得 → 0 件を見て 1 ページ戻る → 再取得 の分だけ待つ
    await settle()
    await settle()
    await settle()

    // offset だけが消え、絞り込み条件は残る
    expect(router.currentRoute.value.query).toEqual({
      date_from: LAST_PAGE_FROM,
      date_to: LAST_PAGE_TO,
    })
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
    expect(countText(wrapper)).toBe(`${PAGE_SIZE} 件`)
  })

  it('[MHL-23] 一覧に休場区分の列が出てコードではなく表示名が入る', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toContain('休場区分')
    // 期待値はフィクスチャの生の値を変換して作る（表示名を並べ書きしない）
    expect(typeCells(wrapper)).toEqual(
      firstPage.map((holiday) => formatMarketHolidayType(holiday.休場区分)),
    )
    // 生のコードがそのまま出ていないこと
    expect(typeCells(wrapper)).not.toContain(SHORTENED.value)
  })

  it('[MHL-24] 休場区分を選んで検索すると URL に条件が乗り絞り込まれる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await searchTypeSelect(wrapper).setValue(SHORTENED.value)
    await wrapper.find('[data-testid="market-holidays-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ holiday_type: SHORTENED.value })
    expect(rows(wrapper)).toHaveLength(shortenedHolidays.length)
    expect(countText(wrapper)).toBe(`${shortenedHolidays.length} 件`)
    expect(new Set(typeCells(wrapper))).toEqual(new Set([SHORTENED.label]))
  })

  it('[MHL-25] URL の休場区分がセレクトと一覧に復元される', async () => {
    const { wrapper } = await mountView({ holiday_type: SHORTENED.value })
    await settle()

    expect(searchTypeSelect(wrapper).element.value).toBe(SHORTENED.value)
    expect(rows(wrapper)).toHaveLength(shortenedHolidays.length)
    expect(countText(wrapper)).toBe(`${shortenedHolidays.length} 件`)
  })

  it('[MHL-26] 選択肢に無い休場区分は条件なしとして扱う', async () => {
    const { wrapper } = await mountView({ holiday_type: UNKNOWN_TYPE })
    await settle()

    expect(searchTypeSelect(wrapper).element.value).toBe('')
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[MHL-27] 追加モーダルの休場区分は既定値で開き、開き直すとリセットされる', async () => {
    const { wrapper } = await mountView()
    await settle()

    await openAddModal(wrapper)
    expect(addTypeSelect(wrapper).element.value).toBe(MARKET_HOLIDAY_TYPE_DEFAULT)

    await addTypeSelect(wrapper).setValue(SHORTENED.value)
    await wrapper.find('[data-testid="market-holidays-add-cancel"]').trigger('click')
    await openAddModal(wrapper)

    expect(addTypeSelect(wrapper).element.value).toBe(MARKET_HOLIDAY_TYPE_DEFAULT)
  })

  it('[MHL-28] 休場区分を選んで追加するとその区分で登録される', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, NEW_DATE, NEW_REASON)
    await addTypeSelect(wrapper).setValue(SHORTENED.value)
    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    // POST → 一覧の再取得 → 再描画 の 2 往復を待つ
    await settle()
    await settle()

    expect(exists(wrapper, 'market-holidays-add-form')).toBe(false)
    expect(wrapper.find('[data-testid="market-holidays-notice"]').text()).toContain(NEW_DATE)
    expect(countText(wrapper)).toBe(`${TOTAL + 1} 件`)

    // 選んだ区分で絞り込むと、増えた 1 件が含まれる
    await searchTypeSelect(wrapper).setValue(SHORTENED.value)
    await wrapper.find('[data-testid="market-holidays-search"]').trigger('submit')
    await settle()

    expect(rows(wrapper)).toHaveLength(shortenedHolidays.length + 1)
    expect(rows(wrapper).map((row) => row.text())).toContainEqual(expect.stringContaining(NEW_DATE))
  })

  it('[MHL-29] 取消済みの日付を追加すると警告が出てモーダルは開いたままになる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, CANCELED_DATE, NEW_REASON)
    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    await settle()

    expect(exists(wrapper, 'market-holidays-add-form')).toBe(true)
    expect(wrapper.find('[data-testid="market-holidays-add-validation-warning"]').text()).toContain(
      REACTIVATION_WARNING,
    )
    // 警告はエラーではないので、理由の枠にも障害の枠にも出さない
    expect(exists(wrapper, 'market-holidays-add-validation-error')).toBe(false)
    expect(exists(wrapper, 'market-holidays-add-error')).toBe(false)
    // まだ登録していない
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(exists(wrapper, 'market-holidays-notice')).toBe(false)
    // 押し直せば進められることが分かる文言になっている
    expect(wrapper.find('[data-testid="market-holidays-add-submit"]').text()).toBe('続行')
  })

  it('[MHL-30] 警告のあと「続行」を押すと登録され成功メッセージが出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, CANCELED_DATE, NEW_REASON)
    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    await settle()

    await wrapper.find('[data-testid="market-holidays-add-submit"]').trigger('click')
    // POST → 一覧の再取得 → 再描画 の 2 往復を待つ
    await settle()
    await settle()

    expect(exists(wrapper, 'market-holidays-add-form')).toBe(false)
    expect(wrapper.find('[data-testid="market-holidays-notice"]').text()).toContain(CANCELED_DATE)
    // 取消済みの行が有効に戻るので、一覧の件数は 1 件増える
    expect(countText(wrapper)).toBe(`${TOTAL + 1} 件`)
  })
})
