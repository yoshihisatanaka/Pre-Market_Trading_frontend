import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { blackoutDates } from '@/mocks/fixtures/blackoutDates'
import { BLACKOUT_DATES_PAGE_SIZE } from '@/stores/blackoutDates'
import BlackoutDateListView from './BlackoutDateListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 */
const PATH = '/masters/blackout-dates'

/*
 * フィクスチャはバックエンドの生の形（日本語キー / 受注不可日は YYYYMMDD の integer）なので、
 * 期待値は toRow でアプリ内モデルの形（api 層が返す形）に直してから使う。
 * これ以降のテスト本体は id / date / reason だけを見る。
 */
const toIsoDate = (blackoutDate) => {
  const digits = String(blackoutDate)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
const toRow = (blackout) => ({
  // 主キーは受注不可日ではなく ID。data-testid にもこの値が入る
  id: String(blackout.ID),
  date: toIsoDate(blackout.受注不可日),
  reason: blackout.備考 ?? '',
})

// 期待値はフィクスチャと表示件数から導く（56 / 50 を直接書かない）
const PAGE_SIZE = BLACKOUT_DATES_PAGE_SIZE
const TOTAL = blackoutDates.length
// フィクスチャは実 API と同じ受注不可日の降順なので、この並びがそのまま 1 ページ目になる
const allRows = blackoutDates.map(toRow)
const firstPage = allRows.slice(0, PAGE_SIZE)
const secondPage = allRows.slice(PAGE_SIZE, PAGE_SIZE * 2)

// 表示件数の倍数でない offset（丸めを廃止したので、この位置から表示件数分が出る）
const ODD_OFFSET = 7
const oddPage = allRows.slice(ODD_OFFSET, ODD_OFFSET + PAGE_SIZE)

// 絞り込みはフィクスチャ先頭の年をそのまま使う（年もハードコードしない）
const YEAR = allRows[0].date.slice(0, 4)
const DATE_FROM = `${YEAR}-01-01`
const DATE_TO = `${YEAR}-12-31`
const inYear = allRows.filter((blackout) => blackout.date.startsWith(YEAR))

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

// 登録に使う「フィクスチャに無い日付」もフィクスチャから導く（既存日付と衝突したら別日になる）
const existingDates = new Set(allRows.map((blackout) => blackout.date))
const NEW_DATE = (() => {
  for (let day = 1; day <= 28; day += 1) {
    const date = `${YEAR}-06-${String(day).padStart(2, '0')}`
    if (!existingDates.has(date)) return date
  }
  throw new Error('フィクスチャに無い日付が見つからなかった')
})()
const NEW_REASON = 'テスト受注不可日'

// 既定ハンドラの事前検証は既存の日付を重複として弾くので、先頭の行の日付をそのまま使う
const DUPLICATE_DATE = allRows[0].date
/**
 * 実 API（とモック）が重複を知らせる文言。**本文に入るのは id ではなく日付**
 * （主キーが ID になっても、人に見せるのは日付のまま）。
 */
const duplicateMessage = (row) => `受注不可日(${row.date.replaceAll('-', '')})は既に登録されています`

/*
 * 複数の理由が並ぶ表示を確かめるための応答。
 * 実 API は最初に見つけた 1 件で打ち切るので、「2 件同時」は差し替えで作る。
 */
const MULTI_MESSAGES = [
  '受注不可日に有効な日付（YYYYMMDD）を指定してください',
  '理由・備考は45文字以内で指定してください',
]

// 削除の対象もフィクスチャから導く（id / 日付を直接書かない）
const DELETE_TARGET = allRows[0]
const NOT_FOUND_MESSAGE = '指定された受注不可日が存在しないか、既に削除されています'

/*
 * 「最終ページが 1 件だけ」を作るための絞り込み。
 * 一覧は日付の降順なので、先頭（最新）から PAGE_SIZE + 1 件目までを範囲に取ると
 * 2 ページ目がちょうど 1 件になる（From が古い側 = その 1 件、To が最新の日付）。
 */
const LAST_PAGE_TARGET = allRows[PAGE_SIZE]
const LAST_PAGE_FROM = LAST_PAGE_TARGET.date
const LAST_PAGE_TO = allRows[0].date

// 編集の対象もフィクスチャから導く（別の行の日付へ変えれば重複で弾かれる）
const EDIT_TARGET = allRows[0]
const OTHER_TARGET = allRows[1]
const EDITED_REASON = '編集後の理由'
const CONFLICT_MESSAGE =
  '他のユーザーによって受注不可日データが更新されています。最新データを再取得してください。'

/*
 * 「絞り込みの範囲外へ動かす日付」。降順の先頭が最新なので YEAR はフィクスチャの最終年で、
 * その翌年はフィクスチャに無く LAST_PAGE_TO より後になる（= 範囲から出て total が 1 減る）。
 */
const OUT_OF_RANGE_DATE = `${Number(YEAR) + 1}-06-01`

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

  const wrapper = mount(BlackoutDateListView, {
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
const countText = (wrapper) => wrapper.find('[data-testid="blackout-dates-count"]').text()
const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)

/** BlackoutDateListResponse の形で返す */
const listBody = (items, total = TOTAL) => ({
  total,
  limit: PAGE_SIZE,
  offset: 0,
  blackout_dates: items,
})

/** BlackoutDateResponse の形で返す（登録・更新・削除の応答） */
const itemBody = (item) => ({ success: true, blackout_date: item, message: 'ok' })

const errorHandler = (options) =>
  http.get(
    '*/api/masters/blackout-dates',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get('*/api/masters/blackout-dates', () => HttpResponse.json(listBody([], 0)), options)

// 事前検証は HTTP 200 で valid / errors を返す契約なので、不合格も 200 で作る
const validateInvalidHandler = (errors) =>
  http.post('*/api/masters/blackout-dates/validate', () =>
    HttpResponse.json({ valid: false, errors, warnings: [], details: null }),
  )
const validateErrorHandler = () =>
  http.post('*/api/masters/blackout-dates/validate', () =>
    HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
  )
const deleteNotFoundHandler = () =>
  http.delete('*/api/masters/blackout-dates/:blackoutDate', () =>
    HttpResponse.json({ detail: NOT_FOUND_MESSAGE }, { status: 404 }),
  )

/**
 * 一覧の取得を握るハンドラ。解放するまで応答しない。
 * 「登録・更新のあとの読み直しを待たずにモーダルが閉じる」ことを確かめるために使う。
 *
 * @returns {() => void} 呼ぶと応答が返る
 */
function gateListResponse() {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.get('*/api/masters/blackout-dates', async () => {
      await gate
      return HttpResponse.json(listBody([], 0))
    }),
  )
  return release
}

const deleteButton = (wrapper, id) => wrapper.find(`[data-testid="blackout-dates-delete-${id}"]`)
const editButton = (wrapper, id) => wrapper.find(`[data-testid="blackout-dates-edit-${id}"]`)
// 削除確認モーダルは表の行と同じ日付を出すので、dialog に絞ってから本文を読む
const deleteDialog = (wrapper) => wrapper.find('[role="dialog"][aria-label="削除確認"]')
const openDelete = async (wrapper, id) => {
  await deleteButton(wrapper, id).trigger('click')
}
const confirmDelete = async (wrapper) => {
  await wrapper.find('[data-testid="blackout-dates-delete-submit"]').trigger('click')
}

const addDateInput = (wrapper) => wrapper.find('[data-testid="blackout-dates-add-date"]')
const addReasonInput = (wrapper) => wrapper.find('[data-testid="blackout-dates-add-reason"]')
const addSubmit = (wrapper) => wrapper.find('[data-testid="blackout-dates-add-submit"]')
const addCancel = (wrapper) => wrapper.find('[data-testid="blackout-dates-add-cancel"]')
const openAddModal = async (wrapper) => {
  await wrapper.find('[data-testid="blackout-dates-add"]').trigger('click')
}
const fillAdd = async (wrapper, date, reason) => {
  await addDateInput(wrapper).setValue(date)
  await addReasonInput(wrapper).setValue(reason)
}
// 事前検証の理由は箇条書きで出るので、行ごとのテキストで取り出す
const validationMessages = (wrapper) =>
  wrapper
    .findAll('[data-testid="blackout-dates-add-validation-error"] li')
    .map((item) => item.text())

/*
 * 編集モーダル。追加・削除と同時に開いていても取り違えないよう、
 * dialog はタイトルで絞り、入力欄とボタンは -edit- の testid で引く
 */
const editDialog = (wrapper) => wrapper.find('[role="dialog"][aria-label="受注不可日 編集"]')
const editDateInput = (wrapper) => wrapper.find('[data-testid="blackout-dates-edit-date"]')
const editReasonInput = (wrapper) => wrapper.find('[data-testid="blackout-dates-edit-reason"]')
const editSubmit = (wrapper) => wrapper.find('[data-testid="blackout-dates-edit-submit"]')
const editCancel = (wrapper) => wrapper.find('[data-testid="blackout-dates-edit-cancel"]')
const openEditModal = async (wrapper, id) => {
  await editButton(wrapper, id).trigger('click')
}
const fillEdit = async (wrapper, date, reason) => {
  await editDateInput(wrapper).setValue(date)
  await editReasonInput(wrapper).setValue(reason)
}
const editValidationMessages = (wrapper) =>
  wrapper
    .findAll('[data-testid="blackout-dates-edit-validation-error"] li')
    .map((item) => item.text())
// 表の中だけを見る（成功メッセージにも日付が出るので、画面全体のテキストでは判定できない）
const tableText = (wrapper) => wrapper.find('[data-testid="blackout-dates-table"]').text()
// FormField はエラー文の id を入力欄の aria-describedby に渡すので、そこから項目単位で引く
// （role="alert" で絞ると、同じ aria-describedby に並ぶ hint を拾わない）
const fieldError = (wrapper, input) => {
  const ids = (input.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((el) => el.exists())
  return found ? found.text() : ''
}

// シナリオ: docs/unit/views-blackout-date-list-view.md
describe('BlackoutDateListView', () => {
  it('[BDL-01] 取得中はローディングを表示する', async () => {
    // watch(immediate) は setup 中に同期で走るので、最初の描画が既にローディング状態
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'blackout-dates-loading')).toBe(true)
    expect(exists(wrapper, 'blackout-dates-table')).toBe(false)
  })

  it('[BDL-02] 取得成功時は 1 ページ目と件数・ページャーを表示する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'blackout-dates-loading')).toBe(false)
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

    const error = wrapper.find('[data-testid="blackout-dates-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'blackout-dates-table')).toBe(false)
  })

  it('[BDL-04] 受注不可日が 0 件のときは空状態を表示する', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'blackout-dates-empty')).toBe(true)
    expect(exists(wrapper, 'blackout-dates-table')).toBe(false)
    expect(exists(wrapper, 'blackout-dates-pagination')).toBe(false)
  })

  it('[BDL-05] エラーのときも検索フォームは表示され続ける', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'blackout-dates-error')).toBe(true)
    expect(exists(wrapper, 'blackout-dates-search')).toBe(true)
    expect(exists(wrapper, 'blackout-dates-date-from')).toBe(true)
    expect(exists(wrapper, 'blackout-dates-date-to')).toBe(true)
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

    await wrapper.find('[data-testid="blackout-dates-date-from"]').setValue(DATE_FROM)
    await wrapper.find('[data-testid="blackout-dates-date-to"]').setValue(DATE_TO)
    await wrapper.find('[data-testid="blackout-dates-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ date_from: DATE_FROM, date_to: DATE_TO })
    expect(rows(wrapper)).toHaveLength(inYear.length)
    expect(countText(wrapper)).toBe(`${inYear.length} 件`)
  })

  it('[BDL-10] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ date_from: DATE_FROM, date_to: DATE_TO })
    await settle()
    expect(rows(wrapper)).toHaveLength(inYear.length)

    await wrapper.find('[data-testid="blackout-dates-search-clear"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
  })

  it('[BDL-11] URL の日付条件が入力欄に反映される', async () => {
    const { wrapper } = await mountView({ date_from: DATE_FROM, date_to: DATE_TO })
    await settle()

    expect(wrapper.find('[data-testid="blackout-dates-date-from"]').element.value).toBe(DATE_FROM)
    expect(wrapper.find('[data-testid="blackout-dates-date-to"]').element.value).toBe(DATE_TO)
  })

  it('[BDL-13] 説明バナーは 4 状態のいずれでも表示される', async () => {
    // ローディング中
    const loadingView = await mountView()
    expect(exists(loadingView.wrapper, 'blackout-dates-loading')).toBe(true)
    expect(exists(loadingView.wrapper, 'blackout-dates-description')).toBe(true)

    // データあり
    await settle()
    expect(rows(loadingView.wrapper)).toHaveLength(firstPage.length)
    expect(exists(loadingView.wrapper, 'blackout-dates-description')).toBe(true)

    // エラー
    server.use(errorHandler({ once: true }))
    const errorView = await mountView()
    await settle()
    expect(exists(errorView.wrapper, 'blackout-dates-error')).toBe(true)
    expect(exists(errorView.wrapper, 'blackout-dates-description')).toBe(true)

    // 空
    server.use(emptyHandler({ once: true }))
    const emptyView = await mountView()
    await settle()
    expect(exists(emptyView.wrapper, 'blackout-dates-empty')).toBe(true)
    expect(exists(emptyView.wrapper, 'blackout-dates-description')).toBe(true)
  })

  it('[BDL-14] 表に日付 / 理由と操作列が出て行の内容がフィクスチャと一致する', async () => {
    const { wrapper } = await mountView()
    await settle()

    // 行ごとの編集・削除ボタンを置く操作列が末尾に付く。見出しは画面モックに合わせて空
    expect(headers(wrapper)).toEqual(['日付', '理由', ''])

    // 期待値はフィクスチャの値そのものから作る（表示文言を並べ書きしない）。
    // 操作列はボタンなので、データの 2 列だけを突き合わせる
    const cellTexts = rows(wrapper).map((row) =>
      row
        .findAll('td')
        .slice(0, 2)
        .map((td) => td.text()),
    )
    expect(cellTexts).toEqual(firstPage.map((blackout) => [blackout.date, blackout.reason]))

    // 操作列には行ごとの編集・削除ボタンが出る
    expect(firstPage.every((blackout) => editButton(wrapper, blackout.id).exists())).toBe(true)
    expect(firstPage.every((blackout) => deleteButton(wrapper, blackout.id).exists())).toBe(true)
  })

  it('[BDL-15] 「新規追加」で空の追加モーダルが開く', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(false)

    await openAddModal(wrapper)

    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(true)
    expect(addDateInput(wrapper).element.value).toBe('')
    expect(addReasonInput(wrapper).element.value).toBe('')
  })

  it('[BDL-16] 未入力で「追加」を押すと項目ごとのエラーが出て API を呼ばない', async () => {
    let validateCalls = 0
    let createCalls = 0
    server.use(
      http.post('*/api/masters/blackout-dates/validate', () => {
        validateCalls += 1
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
      http.post('*/api/masters/blackout-dates', () => {
        createCalls += 1
        return HttpResponse.json(itemBody(blackoutDates[0]), { status: 201 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await addSubmit(wrapper).trigger('click')
    await settle()

    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(true)
    expect(fieldError(wrapper, addDateInput(wrapper))).toBe('日付を入力してください。')
    expect(fieldError(wrapper, addReasonInput(wrapper))).toBe('理由を入力してください。')
    // 無駄な往復をしない（事前検証も登録も呼ばない）
    expect(validateCalls).toBe(0)
    expect(createCalls).toBe(0)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(exists(wrapper, 'blackout-dates-notice')).toBe(false)
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

    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(false)
    const notice = wrapper.find('[data-testid="blackout-dates-notice"]')
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

    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(true)
    expect(validationMessages(wrapper)).toEqual([duplicateMessage(allRows[0])])
    // サーバの拒否は項目のエラーにも通信障害用の表示にも混ぜない
    expect(fieldError(wrapper, addDateInput(wrapper))).toBe('')
    expect(exists(wrapper, 'blackout-dates-add-error')).toBe(false)
    expect(exists(wrapper, 'blackout-dates-notice')).toBe(false)
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

    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(true)
    expect(wrapper.find('[data-testid="blackout-dates-add-error"]').text()).toContain(ERROR_MESSAGE)
    // 事前検証の不合格ではないので箇条書きは出さない
    expect(exists(wrapper, 'blackout-dates-add-validation-error')).toBe(false)
    expect(exists(wrapper, 'blackout-dates-notice')).toBe(false)
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
    expect(exists(wrapper, 'blackout-dates-add-validation-error')).toBe(true)

    await addCancel(wrapper).trigger('click')
    await openAddModal(wrapper)

    expect(exists(wrapper, 'blackout-dates-add-validation-error')).toBe(false)
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
      http.post('*/api/masters/blackout-dates/validate', async () => {
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
    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(true)

    releaseValidate()
    await settle()
    await settle()
    await settle()

    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(false)
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

    await wrapper.find('[data-testid="blackout-dates-delete-cancel"]').trigger('click')
    await settle()

    expect(deleteDialog(wrapper).exists()).toBe(false)
    // API を呼んでいないので一覧の件数も行数も動かない
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(rows(wrapper)).toHaveLength(firstPage.length)
    expect(exists(wrapper, 'blackout-dates-notice')).toBe(false)
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
    const notice = wrapper.find('[data-testid="blackout-dates-notice"]')
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
    expect(wrapper.find('[data-testid="blackout-dates-delete-error"]').text()).toContain(
      NOT_FOUND_MESSAGE,
    )
    expect(exists(wrapper, 'blackout-dates-notice')).toBe(false)
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

  it('[BDL-28] 行の「編集」で現在値の入った編集モーダルが開く', async () => {
    const { wrapper } = await mountView()
    await settle()
    expect(editDialog(wrapper).exists()).toBe(false)

    await openEditModal(wrapper, EDIT_TARGET.id)

    expect(editDialog(wrapper).exists()).toBe(true)
    expect(editDateInput(wrapper).element.value).toBe(EDIT_TARGET.date)
    expect(editReasonInput(wrapper).element.value).toBe(EDIT_TARGET.reason)
    // 追加モーダルは開かない（同じ部品を使い回しているので取り違えないことを確かめる）
    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(false)
  })

  it('[BDL-29] 理由だけ変えて更新すると成功メッセージが出て件数は変わらない', async () => {
    const { wrapper, router } = await mountView()
    await settle()
    await openEditModal(wrapper, EDIT_TARGET.id)

    await editReasonInput(wrapper).setValue(EDITED_REASON)
    await editSubmit(wrapper).trigger('click')
    // 事前検証 → 更新 → 一覧の再取得 → 再描画 の往復を待つ
    await settle()
    await settle()
    await settle()

    expect(editDialog(wrapper).exists()).toBe(false)
    const notice = wrapper.find('[data-testid="blackout-dates-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain(EDIT_TARGET.date)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    // 日付は変えていないので同じ位置の行の理由だけが変わる
    expect(rows(wrapper)[0].text()).toContain(EDIT_TARGET.date)
    expect(rows(wrapper)[0].text()).toContain(EDITED_REASON)
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[BDL-30] 日付を変えて更新すると新しい日付の行に入れ替わる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper, EDIT_TARGET.id)

    await fillEdit(wrapper, NEW_DATE, EDITED_REASON)
    await editSubmit(wrapper).trigger('click')
    await settle()
    await settle()
    await settle()

    expect(editDialog(wrapper).exists()).toBe(false)
    // 成功メッセージはサーバが受理した「新しい」日付を出す
    expect(wrapper.find('[data-testid="blackout-dates-notice"]').text()).toContain(NEW_DATE)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(tableText(wrapper)).toContain(NEW_DATE)
    expect(tableText(wrapper)).not.toContain(EDIT_TARGET.date)
  })

  it('[BDL-31] 空のまま「更新」を押すと項目ごとのエラーが出て API を呼ばない', async () => {
    let validateCalls = 0
    let updateCalls = 0
    server.use(
      http.post('*/api/masters/blackout-dates/validate', () => {
        validateCalls += 1
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
      http.put('*/api/masters/blackout-dates/:blackoutDate', () => {
        updateCalls += 1
        return HttpResponse.json(itemBody(blackoutDates[0]))
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper, EDIT_TARGET.id)

    await fillEdit(wrapper, '', '')
    await editSubmit(wrapper).trigger('click')
    await settle()

    expect(editDialog(wrapper).exists()).toBe(true)
    expect(fieldError(wrapper, editDateInput(wrapper))).toBe('日付を入力してください。')
    expect(fieldError(wrapper, editReasonInput(wrapper))).toBe('理由を入力してください。')
    // 無駄な往復をしない（事前検証も更新も呼ばない）
    expect(validateCalls).toBe(0)
    expect(updateCalls).toBe(0)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(exists(wrapper, 'blackout-dates-notice')).toBe(false)
  })

  it('[BDL-32] 更新が 409 のときモーダル内に通信障害用のエラーが出る', async () => {
    server.use(
      http.put('*/api/masters/blackout-dates/:blackoutDate', () =>
        HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 }),
      ),
    )
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper, EDIT_TARGET.id)

    await editReasonInput(wrapper).setValue(EDITED_REASON)
    await editSubmit(wrapper).trigger('click')
    await settle()
    await settle()

    expect(editDialog(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-testid="blackout-dates-edit-error"]').text()).toContain(
      CONFLICT_MESSAGE,
    )
    // 事前検証の不合格ではないので箇条書きは出さない
    expect(exists(wrapper, 'blackout-dates-edit-validation-error')).toBe(false)
    expect(exists(wrapper, 'blackout-dates-notice')).toBe(false)
    expect(countText(wrapper)).toBe(`${TOTAL} 件`)
    expect(rows(wrapper)[0].text()).toContain(EDIT_TARGET.reason)
  })

  it('[BDL-33] 更新中は「更新中…」になり更新もキャンセルも押せない', async () => {
    // 事前検証の応答を握って、更新中の表示を確かめられるようにする
    let releaseValidate
    const validateGate = new Promise((resolve) => {
      releaseValidate = resolve
    })
    server.use(
      http.post('*/api/masters/blackout-dates/validate', async () => {
        await validateGate
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper, EDIT_TARGET.id)
    await editReasonInput(wrapper).setValue(EDITED_REASON)

    await editSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(editSubmit(wrapper).text()).toBe('更新中…')
    expect(editSubmit(wrapper).attributes('disabled')).toBeDefined()
    expect(editCancel(wrapper).attributes('disabled')).toBeDefined()
    // 閉じさせない（結果の行き先が無くなるため）
    await editCancel(wrapper).trigger('click')
    expect(editDialog(wrapper).exists()).toBe(true)

    releaseValidate()
    await settle()
    await settle()
    await settle()

    expect(editDialog(wrapper).exists()).toBe(false)
  })

  it('[BDL-34] 事前検証で弾かれた後に別の行を開くと理由が消え現在値が入る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper, EDIT_TARGET.id)

    // 別の行の日付へ変えると重複で弾かれる
    await fillEdit(wrapper, OTHER_TARGET.date, EDITED_REASON)
    await editSubmit(wrapper).trigger('click')
    await settle()
    await settle()
    expect(editValidationMessages(wrapper)).toEqual([duplicateMessage(OTHER_TARGET)])

    await editCancel(wrapper).trigger('click')
    await openEditModal(wrapper, OTHER_TARGET.id)

    expect(exists(wrapper, 'blackout-dates-edit-validation-error')).toBe(false)
    expect(editDateInput(wrapper).element.value).toBe(OTHER_TARGET.date)
    expect(editReasonInput(wrapper).element.value).toBe(OTHER_TARGET.reason)
  })

  it('[BDL-35] 追加と編集の事前検証の理由は互いのモーダルに漏れない', async () => {
    const { wrapper } = await mountView()
    await settle()

    // 編集で弾かれた直後に追加モーダルを開く
    await openEditModal(wrapper, EDIT_TARGET.id)
    await fillEdit(wrapper, OTHER_TARGET.date, EDITED_REASON)
    await editSubmit(wrapper).trigger('click')
    await settle()
    await settle()
    expect(editValidationMessages(wrapper)).toEqual([duplicateMessage(OTHER_TARGET)])

    await openAddModal(wrapper)
    expect(exists(wrapper, 'blackout-dates-add-validation-error')).toBe(false)

    // 逆順（追加で弾かれた直後に編集モーダルを開く）
    await fillAdd(wrapper, DUPLICATE_DATE, NEW_REASON)
    await addSubmit(wrapper).trigger('click')
    await settle()
    await settle()
    expect(validationMessages(wrapper)).toEqual([duplicateMessage(allRows[0])])

    await addCancel(wrapper).trigger('click')
    await openEditModal(wrapper, OTHER_TARGET.id)

    expect(exists(wrapper, 'blackout-dates-edit-validation-error')).toBe(false)
  })

  it('[BDL-36] 最終ページの 1 件を絞り込みの範囲外へ動かすと 1 ページ前に戻る', async () => {
    const { wrapper, router } = await mountView({
      date_from: LAST_PAGE_FROM,
      date_to: LAST_PAGE_TO,
      offset: String(PAGE_SIZE),
    })
    await settle()
    expect(rows(wrapper)).toHaveLength(1)

    await openEditModal(wrapper, LAST_PAGE_TARGET.id)
    await fillEdit(wrapper, OUT_OF_RANGE_DATE, EDITED_REASON)
    await editSubmit(wrapper).trigger('click')
    // 事前検証 → 更新 → 再取得 → 0 件を見て 1 ページ戻る → 再取得 の分だけ待つ
    await settle()
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

  it('[BDL-37] 登録が受理されたら一覧の読み直しを待たずに追加モーダルが閉じる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, NEW_DATE, NEW_REASON)

    // 登録の後に走る読み直しを握る
    const releaseList = gateListResponse()
    await addSubmit(wrapper).trigger('click')
    await settle()
    await settle()

    // 読み直しはまだ終わっていないが、登録は受理されているのでモーダルを残さない
    expect(exists(wrapper, 'blackout-dates-loading')).toBe(true)
    expect(exists(wrapper, 'blackout-dates-add-form')).toBe(false)
    expect(wrapper.find('[data-testid="blackout-dates-notice"]').text()).toContain(NEW_DATE)

    releaseList()
    await settle()
  })

  it('[BDL-38] 更新が受理されたら一覧の読み直しを待たずに編集モーダルが閉じる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper, EDIT_TARGET.id)
    await editReasonInput(wrapper).setValue(EDITED_REASON)

    const releaseList = gateListResponse()
    await editSubmit(wrapper).trigger('click')
    await settle()
    await settle()

    expect(exists(wrapper, 'blackout-dates-loading')).toBe(true)
    expect(editDialog(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="blackout-dates-notice"]').text()).toContain(EDIT_TARGET.date)

    releaseList()
    await settle()
  })

  it('[BDL-39] 削除が受理されたら一覧の読み直しを待たずに確認モーダルが閉じる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openDelete(wrapper, DELETE_TARGET.id)

    const releaseList = gateListResponse()
    await confirmDelete(wrapper)
    await settle()

    expect(exists(wrapper, 'blackout-dates-loading')).toBe(true)
    expect(deleteDialog(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="blackout-dates-notice"]').text()).toContain(
      DELETE_TARGET.date,
    )

    releaseList()
    await settle()
  })
})
