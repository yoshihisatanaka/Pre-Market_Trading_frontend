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

// 登録に使う「フィクスチャに無い日付」もフィクスチャから導く（既存日付と衝突したら別日になる）
const existingDates = new Set(blockedDates.map((blocked) => blocked.date))
const NEW_DATE = (() => {
  for (let day = 1; day <= 28; day += 1) {
    const date = `${YEAR}-06-${String(day).padStart(2, '0')}`
    if (!existingDates.has(date)) return date
  }
  throw new Error('フィクスチャに無い日付が見つからなかった')
})()
const NEW_REASON = 'テスト受注不可日'

// 既定の事前検証は既存の日付を重複として弾くので、フィクスチャ先頭の日付をそのまま使う
const DUPLICATE_DATE = blockedDates[0].date

// 事前検証ハンドラが返す文言（src/mocks/handlers/index.js と共有する定数）
const DUPLICATE_MESSAGE = 'その日付の受注不可日はすでに登録されています。'
const INVALID_DATE_MESSAGE = '日付は YYYY-MM-DD 形式で入力してください。'

// 複数の理由が並ぶ表示を確かめるための応答。既定ハンドラは日付の不正と重複を排他で返すため、
// 「2 件同時」は差し替えで作る
const MULTI_MESSAGES = [INVALID_DATE_MESSAGE, DUPLICATE_MESSAGE]

// 削除の対象もフィクスチャから導く（id / 日付を直接書かない）
const DELETE_TARGET = blockedDates[0]
const NOT_FOUND_MESSAGE = '対象の受注不可日が見つかりません。'

/*
 * 「最終ページが 1 件だけ」を作るための絞り込み。
 * 先頭から PAGE_SIZE + 1 件目までを範囲にすると 2 ページ目がちょうど 1 件になる。
 */
const LAST_PAGE_FROM = blockedDates[0].date
const LAST_PAGE_TO = blockedDates[PAGE_SIZE].date
const LAST_PAGE_TARGET = blockedDates[PAGE_SIZE]

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

// 事前検証は HTTP 200 で valid / errors を返す契約なので、不合格も 200 で作る
const validateInvalidHandler = (errors) =>
  http.post('*/api/blocked-dates/validate', () =>
    HttpResponse.json({ valid: false, errors, warnings: [], details: null }),
  )
const validateErrorHandler = () =>
  http.post('*/api/blocked-dates/validate', () =>
    HttpResponse.json({ message: ERROR_MESSAGE }, { status: 500 }),
  )
const deleteNotFoundHandler = () =>
  http.delete('*/api/blocked-dates/:id', () =>
    HttpResponse.json({ message: NOT_FOUND_MESSAGE, code: 'not_found' }, { status: 404 }),
  )

const deleteButton = (wrapper, id) => wrapper.find(`[data-testid="blocked-dates-delete-${id}"]`)
// 削除確認モーダルは表の行と同じ日付を出すので、dialog に絞ってから本文を読む
const deleteDialog = (wrapper) => wrapper.find('[role="dialog"][aria-label="削除確認"]')
const openDelete = async (wrapper, id) => {
  await deleteButton(wrapper, id).trigger('click')
}
const confirmDelete = async (wrapper) => {
  await wrapper.find('[data-testid="blocked-dates-delete-submit"]').trigger('click')
}

const addDateInput = (wrapper) => wrapper.find('[data-testid="blocked-dates-add-date"]')
const addReasonInput = (wrapper) => wrapper.find('[data-testid="blocked-dates-add-reason"]')
const addSubmit = (wrapper) => wrapper.find('[data-testid="blocked-dates-add-submit"]')
const addCancel = (wrapper) => wrapper.find('[data-testid="blocked-dates-add-cancel"]')
const openAddModal = async (wrapper) => {
  await wrapper.find('[data-testid="blocked-dates-add"]').trigger('click')
}
const fillAdd = async (wrapper, date, reason) => {
  await addDateInput(wrapper).setValue(date)
  await addReasonInput(wrapper).setValue(reason)
}
// 事前検証の理由は箇条書きで出るので、行ごとのテキストで取り出す
const validationMessages = (wrapper) =>
  wrapper
    .findAll('[data-testid="blocked-dates-add-validation-error"] li')
    .map((item) => item.text())
// FormField はエラー文の id を入力欄の aria-describedby に渡すので、そこから項目単位で引く
// （role="alert" で絞ると、同じ aria-describedby に並ぶ hint を拾わない）
const fieldError = (wrapper, input) => {
  const ids = (input.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((el) => el.exists())
  return found ? found.text() : ''
}

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

  it('[BDL-14] 表に日付 / 対象市場 / 理由と操作列が出て行の内容がフィクスチャと一致する', async () => {
    const { wrapper } = await mountView()
    await settle()

    // 行ごとの削除ボタンを置く操作列が末尾に付く。見出しは画面モックに合わせて空
    expect(headers(wrapper)).toEqual(['日付', '対象市場', '理由', ''])

    // 期待値はフィクスチャの値そのものから作る（表示文言を並べ書きしない）。
    // 操作列はボタンなので、データの 3 列だけを突き合わせる
    const cellTexts = rows(wrapper).map((row) =>
      row
        .findAll('td')
        .slice(0, 3)
        .map((td) => td.text()),
    )
    expect(cellTexts).toEqual(
      firstPage.map((blocked) => [blocked.date, blocked.market, blocked.reason]),
    )

    // 操作列には行ごとの削除ボタンが出る
    expect(firstPage.every((blocked) => deleteButton(wrapper, blocked.id).exists())).toBe(true)
  })

  it('[BDL-15] 「新規追加」で空の追加モーダルが開く', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'blocked-dates-add-form')).toBe(false)

    await openAddModal(wrapper)

    expect(exists(wrapper, 'blocked-dates-add-form')).toBe(true)
    expect(addDateInput(wrapper).element.value).toBe('')
    expect(addReasonInput(wrapper).element.value).toBe('')
  })

  it('[BDL-16] 未入力で「追加」を押すと項目ごとのエラーが出て API を呼ばない', async () => {
    let validateCalls = 0
    let createCalls = 0
    server.use(
      http.post('*/api/blocked-dates/validate', () => {
        validateCalls += 1
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
      http.post('*/api/blocked-dates', () => {
        createCalls += 1
        return HttpResponse.json(
          { id: 'unexpected', date: '', market: '', reason: '' },
          { status: 201 },
        )
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await addSubmit(wrapper).trigger('click')
    await settle()

    expect(exists(wrapper, 'blocked-dates-add-form')).toBe(true)
    expect(fieldError(wrapper, addDateInput(wrapper))).toBe('日付を入力してください。')
    expect(fieldError(wrapper, addReasonInput(wrapper))).toBe('理由を入力してください。')
    // 無駄な往復をしない（事前検証も登録も呼ばない）
    expect(validateCalls).toBe(0)
    expect(createCalls).toBe(0)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(exists(wrapper, 'blocked-dates-notice')).toBe(false)
  })

  it('[BDL-17] 追加が成功するとモーダルが閉じ成功メッセージと増えた件数が出る', async () => {
    const { wrapper, router } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, NEW_DATE, NEW_REASON)
    await addSubmit(wrapper).trigger('click')
    // 事前検証 → 登録 → 一覧の再取得 → 再描画 の往復を待つ
    await settle()
    await settle()
    await settle()

    expect(exists(wrapper, 'blocked-dates-add-form')).toBe(false)
    const notice = wrapper.find('[data-testid="blocked-dates-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain(NEW_DATE)
    expect(countText(wrapper)).toBe(`${TOTAL + 1} 件`)
    // 追加では URL を変えない
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[BDL-18] 事前検証で弾かれるとモーダル内に理由が出て件数は変わらない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, DUPLICATE_DATE, NEW_REASON)
    await addSubmit(wrapper).trigger('click')
    await settle()
    await settle()

    expect(exists(wrapper, 'blocked-dates-add-form')).toBe(true)
    expect(validationMessages(wrapper)).toEqual([DUPLICATE_MESSAGE])
    // サーバの拒否は項目のエラーにも通信障害用の表示にも混ぜない
    expect(fieldError(wrapper, addDateInput(wrapper))).toBe('')
    expect(exists(wrapper, 'blocked-dates-add-error')).toBe(false)
    expect(exists(wrapper, 'blocked-dates-notice')).toBe(false)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[BDL-19] 事前検証の理由が複数あるとその件数だけ箇条書きで並ぶ', async () => {
    server.use(validateInvalidHandler(MULTI_MESSAGES))
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, NEW_DATE, NEW_REASON)
    await addSubmit(wrapper).trigger('click')
    await settle()
    await settle()

    expect(validationMessages(wrapper)).toEqual(MULTI_MESSAGES)
  })

  it('[BDL-20] 事前検証がサーバエラーのときは通信障害用のエラーが出る', async () => {
    server.use(validateErrorHandler())
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, NEW_DATE, NEW_REASON)
    await addSubmit(wrapper).trigger('click')
    await settle()
    await settle()

    expect(exists(wrapper, 'blocked-dates-add-form')).toBe(true)
    expect(wrapper.find('[data-testid="blocked-dates-add-error"]').text()).toContain(ERROR_MESSAGE)
    // 事前検証の不合格ではないので箇条書きは出さない
    expect(exists(wrapper, 'blocked-dates-add-validation-error')).toBe(false)
    expect(exists(wrapper, 'blocked-dates-notice')).toBe(false)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[BDL-21] 事前検証で弾かれた後に開き直すと理由と入力が持ち込まれない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, DUPLICATE_DATE, NEW_REASON)
    await addSubmit(wrapper).trigger('click')
    await settle()
    await settle()
    expect(exists(wrapper, 'blocked-dates-add-validation-error')).toBe(true)

    await addCancel(wrapper).trigger('click')
    await openAddModal(wrapper)

    expect(exists(wrapper, 'blocked-dates-add-validation-error')).toBe(false)
    expect(addDateInput(wrapper).element.value).toBe('')
    expect(addReasonInput(wrapper).element.value).toBe('')
  })

  it('[BDL-22] 登録中は「追加中…」になり追加もキャンセルも押せない', async () => {
    // 事前検証の応答を握って、登録中の表示を確かめられるようにする
    let releaseValidate
    const validateGate = new Promise((resolve) => {
      releaseValidate = resolve
    })
    server.use(
      http.post('*/api/blocked-dates/validate', async () => {
        await validateGate
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, NEW_DATE, NEW_REASON)

    await addSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(addSubmit(wrapper).text()).toBe('追加中…')
    expect(addSubmit(wrapper).attributes('disabled')).toBeDefined()
    expect(addCancel(wrapper).attributes('disabled')).toBeDefined()
    // 閉じさせない（結果の行き先が無くなるため）
    await addCancel(wrapper).trigger('click')
    expect(exists(wrapper, 'blocked-dates-add-form')).toBe(true)

    releaseValidate()
    await settle()
    await settle()
    await settle()

    expect(exists(wrapper, 'blocked-dates-add-form')).toBe(false)
  })

  it('[BDL-23] 行の「削除」で対象の日付を示す確認モーダルが開く', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(deleteDialog(wrapper).exists()).toBe(false)

    await openDelete(wrapper, DELETE_TARGET.id)

    expect(deleteDialog(wrapper).exists()).toBe(true)
    expect(deleteDialog(wrapper).text()).toContain(DELETE_TARGET.date)
  })

  it('[BDL-24] 「キャンセル」で確認モーダルが閉じ件数は変わらない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openDelete(wrapper, DELETE_TARGET.id)

    await wrapper.find('[data-testid="blocked-dates-delete-cancel"]').trigger('click')
    await settle()

    expect(deleteDialog(wrapper).exists()).toBe(false)
    // API を呼んでいないので一覧の件数も行数も動かない
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(exists(wrapper, 'blocked-dates-notice')).toBe(false)
  })

  it('[BDL-25] 削除が成功するとモーダルが閉じ成功メッセージと減った件数が出る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openDelete(wrapper, DELETE_TARGET.id)

    await confirmDelete(wrapper)
    // DELETE → 一覧の再取得 → 再描画 の 2 往復を待つ
    await settle()
    await settle()

    expect(deleteDialog(wrapper).exists()).toBe(false)
    const notice = wrapper.find('[data-testid="blocked-dates-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain(DELETE_TARGET.date)
    expect(countText(wrapper)).toBe(`${TOTAL - 1} 件`)
    expect(deleteButton(wrapper, DELETE_TARGET.id).exists()).toBe(false)
  })

  it('[BDL-26] 削除が 404 のときモーダル内にエラーが出て成功メッセージは出ない', async () => {
    server.use(deleteNotFoundHandler())
    const { wrapper } = await mountView()
    await settle()
    await openDelete(wrapper, DELETE_TARGET.id)

    await confirmDelete(wrapper)
    await settle()

    expect(deleteDialog(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-testid="blocked-dates-delete-error"]').text()).toContain(
      NOT_FOUND_MESSAGE,
    )
    expect(exists(wrapper, 'blocked-dates-notice')).toBe(false)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[BDL-27] 最終ページの最後の 1 件を消すと 1 ページ前に戻る', async () => {
    const { wrapper, router } = await mountView({
      date_from: LAST_PAGE_FROM,
      date_to: LAST_PAGE_TO,
      offset: String(PAGE_SIZE),
    })
    await settle()
    expect(rows(wrapper)).toHaveLength(1)

    await openDelete(wrapper, LAST_PAGE_TARGET.id)
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
})
