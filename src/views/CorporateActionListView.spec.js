import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { caStocks, corporateActions } from '@/mocks/fixtures/ca'
import { CA_PAGE_SIZE } from '@/stores/ca'
import CorporateActionListView from './CorporateActionListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 *
 * シナリオ: docs/unit/views-corporate-action-list-view.md
 */
const PATH = '/masters/ca'

const PAGE_SIZE = CA_PAGE_SIZE
const TOTAL = corporateActions.length

/*
 * フィクスチャはバックエンドの生の形（日本語キー / 日付は YYYYMMDD の integer）なので、
 * 期待値は api 層と同じ変換でアプリ内モデルの形に直してから使う。
 */
const toIsoDate = (value) => {
  const digits = String(value ?? '')
  if (!/^\d{8}$/.test(digits)) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
const toRow = (ca) => ({
  id: String(ca.ID),
  stockCode: ca.銘柄コード,
  ticker: ca.Ticker ?? '',
  caTypeName: ca.CA種別名 ?? '',
  exRightsDate: toIsoDate(ca.権利付最終日),
  effectiveDate: toIsoDate(ca.効力発生日),
  paymentDate: toIsoDate(ca.支払日),
  ratio: ca.比率 ?? '',
  note: ca.備考 ?? '',
  userModified: ca.ユーザー操作フラグ === 1,
})

/** 実 API と同じ並び（効力発生日の降順、同じなら ID の降順） */
const sortKey = (ca) => ca.効力発生日 ?? ca.権利付最終日 ?? 99999999
const sorted = [...corporateActions].sort((a, b) => sortKey(b) - sortKey(a) || b.ID - a.ID)
const allRows = sorted.map(toRow)
const firstPage = allRows.slice(0, PAGE_SIZE)
const secondPage = allRows.slice(PAGE_SIZE)

// 表示件数の倍数でない offset（丸めないので、この位置から表示件数分が出る）
const ODD_OFFSET = 7
const oddPage = allRows.slice(ODD_OFFSET, ODD_OFFSET + PAGE_SIZE)

// 絞り込みに使う値もフィクスチャから導く
const TICKER = allRows[0].ticker
const CA_TYPE = sorted[0].CA種別
const bothFiltered = sorted.filter((ca) => ca.Ticker === TICKER && ca.CA種別 === CA_TYPE)

/*
 * 追加に使う値。銘柄コードはモックの銘柄マスタ（caStocks）に実在するものでなければ
 * 事前検証で弾かれるので、フィクスチャから採る。
 */
const NEW_STOCK_CODE = caStocks[0].stockCode
const NEW_CA_TYPE = CA_TYPE
const NEW_CA_TYPE_NAME = sorted[0].CA種別名

// 銘柄マスタに無い銘柄コード（事前検証が不合格を返す）
const UNKNOWN_STOCK_CODE = 'ZZZZ'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const CONFLICT_MESSAGE = '他のユーザーによってCAデータが更新されています。'

/** CAListResponse の形で返す */
const listBody = (items, total = items.length) => ({
  total,
  limit: PAGE_SIZE,
  offset: 0,
  ca_list: items,
})

const errorHandler = (options) =>
  http.get('*/api/ca', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }), options)
const emptyHandler = (options) =>
  http.get('*/api/ca', () => HttpResponse.json(listBody([])), options)

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

  const wrapper = mount(CorporateActionListView, {
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
const countText = (wrapper) => wrapper.find('[data-testid="ca-count"]').text()
const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)

/* ここから新規追加モーダル用のヘルパ */

const addInput = (wrapper, name) => wrapper.find(`[data-testid="ca-add-${name}"]`)
const addSubmit = (wrapper) => wrapper.find('[data-testid="ca-add-submit"]')
const addCancel = (wrapper) => wrapper.find('[data-testid="ca-add-cancel"]')

const openAddModal = async (wrapper) => {
  await wrapper.find('[data-testid="ca-add"]').trigger('click')
}

/** 入力欄をまとめて埋める（キーは testid の `ca-add-` より後ろ） */
const fillAdd = async (wrapper, values) => {
  for (const [name, value] of Object.entries(values)) {
    await addInput(wrapper, name).setValue(value)
  }
}

const submitAdd = async (wrapper) => {
  await addSubmit(wrapper).trigger('click')
  await settle()
}

// 事前検証の理由は箇条書きで出るので、行ごとのテキストで取り出す
const validationMessages = (wrapper) =>
  wrapper.findAll('[data-testid="ca-add-validation-error"] li').map((item) => item.text())

/** 入力欄の直下に出ている理由（FormField が aria-describedby で結び付けている） */
const fieldError = (wrapper, input) => {
  const ids = (input.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((el) => el.exists())
  return found ? found.text() : ''
}

/** 登録（事前検証は既定のまま）を 500 にする差し替え */
const failCreate = () =>
  server.use(
    http.post('*/api/ca', () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
  )

/* ここから編集モーダル用のヘルパ。testid の -edit- で追加側と取り違えないようにする */

const editInput = (wrapper, name) => wrapper.find(`[data-testid="ca-edit-${name}"]`)
const editSubmit = (wrapper) => wrapper.find('[data-testid="ca-edit-submit"]')
const editCancel = (wrapper) => wrapper.find('[data-testid="ca-edit-cancel"]')

/** 一覧の n 行目の「編集」を押す */
const openEditModal = async (wrapper, index = 0) => {
  await wrapper.find(`[data-testid="ca-edit-${firstPage[index].id}"]`).trigger('click')
}

const fillEdit = async (wrapper, values) => {
  for (const [name, value] of Object.entries(values)) {
    await editInput(wrapper, name).setValue(value)
  }
}

const submitEdit = async (wrapper) => {
  await editSubmit(wrapper).trigger('click')
  await settle()
}

const editValidationMessages = (wrapper) =>
  wrapper.findAll('[data-testid="ca-edit-validation-error"] li').map((item) => item.text())

/* ここから削除確認ダイアログ用のヘルパ */

const deleteSubmit = (wrapper) => wrapper.find('[data-testid="ca-delete-submit"]')
const deleteCancel = (wrapper) => wrapper.find('[data-testid="ca-delete-cancel"]')

/** 一覧の n 行目の「削除」を押す */
const openDeleteModal = async (wrapper, index = 0) => {
  await wrapper.find(`[data-testid="ca-delete-${firstPage[index].id}"]`).trigger('click')
}

const confirmDelete = async (wrapper) => {
  await deleteSubmit(wrapper).trigger('click')
  await settle()
}

/** 削除を 500 にする差し替え */
const failDelete = () =>
  server.use(
    http.delete('*/api/ca/:caId', () =>
      HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    ),
  )

/** 更新を 409（楽観的ロックの競合）にする差し替え */
const conflictOnUpdate = () =>
  server.use(
    http.put('*/api/ca/:caId', () =>
      HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 }),
    ),
  )

describe('CorporateActionListView', () => {
  it('[CAV-01] 応答を待つ間はローディングだけを出す', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'ca-loading')).toBe(true)
    expect(exists(wrapper, 'ca-table')).toBe(false)
    expect(exists(wrapper, 'ca-empty')).toBe(false)
  })

  it('[CAV-02] 1 ページ目の件数と行がフィクスチャと一致する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)

    const first = rows(wrapper)[0].text()
    expect(first).toContain(firstPage[0].stockCode)
    expect(first).toContain(firstPage[0].ticker)
    expect(first).toContain(firstPage[0].caTypeName)
    expect(first).toContain(firstPage[0].effectiveDate)
    expect(first).toContain(firstPage[0].ratio)
    expect(first).toContain(firstPage[0].note)
  })

  it('[CAV-03] 列が銘柄・CA種別・日付 3 種・比率・備考の順で並ぶ', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toEqual([
      '銘柄',
      'CA種別',
      '権利付最終日',
      '効力発生日',
      '支払日',
      '比率',
      '備考',
      // 行ごとの操作。画面モックに合わせて見出しは空にする
      '',
    ])
  })

  it('[CAV-04] 手動操作された行にだけ印が付く', async () => {
    const { wrapper } = await mountView()
    await settle()

    const marked = rows(wrapper).filter((row) => row.classes().includes('is-user-modified'))
    const expected = firstPage.filter((row) => row.userModified)

    // フィクスチャが両方の行を持っていないと、このシナリオは意味を失う
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(PAGE_SIZE)
    expect(marked).toHaveLength(expected.length)
  })

  it('[CAV-05] 支払日が無い行は — を出す', async () => {
    const target = firstPage.find((row) => row.paymentDate === '')
    // フィクスチャに支払日の無い行が無ければ、このシナリオは意味を失う
    expect(target).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    const row = rows(wrapper).find((candidate) => candidate.text().includes(target.note))
    expect(row.findAll('td')[4].text()).toBe('—')
  })

  it('[CAV-06] CA種別名が欠けた応答でもコードから名前を補う', async () => {
    const raw = { ...sorted[0], CA種別: '120', CA種別名: null }
    server.use(http.get('*/api/ca', () => HttpResponse.json(listBody([raw]))))

    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper)[0].findAll('td')[1].text()).toBe('株式分割')
  })

  it('[CAV-07] 0 件のときは空状態を出し、表は描画しない', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="ca-empty"]').text()).toBe('該当するCAはありません。')
    expect(exists(wrapper, 'ca-table')).toBe(false)
  })

  it('[CAV-08] 取得に失敗したときは理由と再試行を出す', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="ca-error"]').text()).toContain(ERROR_MESSAGE)
    expect(exists(wrapper, 'ca-table')).toBe(false)
    expect(exists(wrapper, 'ca-empty')).toBe(false)
  })

  it('[CAV-09] 再試行で読み直すと表が出る', async () => {
    // once を付けて、1 回目だけ 500・2 回目から既定ハンドラに戻す
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()

    await wrapper.find('[data-testid="ca-error"]').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'ca-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[CAV-10] 表示件数の倍数でない offset は丸めずその位置から表示する', async () => {
    const { wrapper } = await mountView({ offset: String(ODD_OFFSET) })
    await settle()

    expect(rows(wrapper)).toHaveLength(oddPage.length)
    expect(rows(wrapper)[0].text()).toContain(oddPage[0].stockCode)
  })

  it('[CAV-11] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    expect(router.currentRoute.value.query.offset).toBe(String(PAGE_SIZE))
    expect(rows(wrapper)).toHaveLength(secondPage.length)
  })

  it('[CAV-12] 検索すると URL に条件が乗り絞り込まれる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="ca-stock-code"]').setValue(TICKER)
    await wrapper.find('[data-testid="ca-type"]').setValue(CA_TYPE)
    await wrapper.find('[data-testid="ca-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ stock_code: TICKER, ca_type: CA_TYPE })
    expect(rows(wrapper)).toHaveLength(bothFiltered.length)
  })

  it('[CAV-13] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ stock_code: TICKER })
    await settle()
    expect(rows(wrapper).length).toBeLessThan(PAGE_SIZE)

    await wrapper.find('[data-testid="ca-search-clear"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CAV-14] 未知の CA種別コードは条件なしとして捨てる', async () => {
    const { wrapper } = await mountView({ ca_type: '999' })
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(wrapper.find('[data-testid="ca-type"]').element.value).toBe('')
  })

  it('[CAV-15] 説明バナーと検索カードは 4 状態のいずれでも表示される', async () => {
    for (const handler of [null, emptyHandler(), errorHandler()]) {
      if (handler) server.use(handler)
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'ca-description')).toBe(true)
      expect(exists(wrapper, 'ca-search')).toBe(true)
    }
  })

  it('[CAV-16] ヘッダに追加、行に編集と削除の導線がある', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'ca-reload')).toBe(true)
    expect(exists(wrapper, 'ca-add')).toBe(true)

    // 破壊的な操作を最後にする（モーダルのフッタの キャンセル → 危険色 と同じ並び）
    const rowButtons = rows(wrapper)[0].findAll('button')
    expect(rowButtons.map((button) => button.text())).toEqual(['編集', '削除'])
  })

  it('[CAV-17] 追加が成功するとモーダルが閉じ、成功メッセージと増えた件数が出る', async () => {
    const { wrapper, router } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, { 'stock-code': NEW_STOCK_CODE, type: NEW_CA_TYPE })
    await submitAdd(wrapper)

    expect(exists(wrapper, 'ca-add-form')).toBe(false)
    const notice = wrapper.find('[data-testid="ca-notice"]').text()
    expect(notice).toContain(NEW_STOCK_CODE)
    expect(notice).toContain(NEW_CA_TYPE_NAME)
    expect(countText(wrapper)).toContain(String(TOTAL + 1))
    // 一覧の単方向フローには触らない
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[CAV-18] 必須が未入力なら項目の直下に理由を出し、API へ送らない', async () => {
    let validateCalls = 0
    let createCalls = 0
    server.use(
      http.post('*/api/ca/validate', () => {
        validateCalls += 1
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
      http.post('*/api/ca', () => {
        createCalls += 1
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await submitAdd(wrapper)

    expect(exists(wrapper, 'ca-add-form')).toBe(true)
    expect(fieldError(wrapper, addInput(wrapper, 'stock-code'))).toBe(
      '銘柄コードを入力してください。',
    )
    expect(fieldError(wrapper, addInput(wrapper, 'type'))).toBe('CA種別を選択してください。')
    // 無駄な往復をしない（事前検証も登録も呼ばない）
    expect(validateCalls).toBe(0)
    expect(createCalls).toBe(0)
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CAV-19] 比率は片方だけ・0 以下を弾き、理由を欠けている側に出す', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, { 'stock-code': NEW_STOCK_CODE, type: NEW_CA_TYPE })

    // 分母だけを入れると、欠けている分子の側に理由が出る
    await fillAdd(wrapper, { denominator: '1' })
    await submitAdd(wrapper)

    expect(exists(wrapper, 'ca-add-form')).toBe(true)
    expect(fieldError(wrapper, addInput(wrapper, 'denominator'))).toBe('')
    expect(fieldError(wrapper, addInput(wrapper, 'numerator'))).toBe(
      '比率は分母と分子の両方を入力してください。',
    )

    // 0 を入れた項目には、正の数値を求める理由が出る
    await fillAdd(wrapper, { numerator: '0' })
    await submitAdd(wrapper)

    expect(fieldError(wrapper, addInput(wrapper, 'numerator'))).toBe(
      '分子には正の数値を入力してください。',
    )
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CAV-20] 事前検証の不合格はモーダル内に箇条書きで出し、登録しない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, { 'stock-code': UNKNOWN_STOCK_CODE, type: NEW_CA_TYPE })
    await submitAdd(wrapper)

    expect(exists(wrapper, 'ca-add-form')).toBe(true)
    expect(validationMessages(wrapper)).toEqual([
      `銘柄コード(${UNKNOWN_STOCK_CODE})は銘柄マスタに存在しません`,
    ])
    // 通信は成功しているので、サーバ障害の枠には出さない
    expect(exists(wrapper, 'ca-add-error')).toBe(false)
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CAV-21] 通信・サーバ障害はモーダル内に 1 行で出す', async () => {
    failCreate()
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, { 'stock-code': NEW_STOCK_CODE, type: NEW_CA_TYPE })
    await submitAdd(wrapper)

    expect(exists(wrapper, 'ca-add-form')).toBe(true)
    expect(wrapper.find('[data-testid="ca-add-error"]').text()).toContain(ERROR_MESSAGE)
    // 事前検証は通っているので、そちらの枠には出さない
    expect(exists(wrapper, 'ca-add-validation-error')).toBe(false)
  })

  it('[CAV-22] 登録中は送信もキャンセルもできない', async () => {
    server.use(
      http.post('*/api/ca', async () => {
        await delay(20)
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, { 'stock-code': NEW_STOCK_CODE, type: NEW_CA_TYPE })

    // 応答を待たずに押した直後を見る
    const pending = addSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(addSubmit(wrapper).text()).toContain('追加中…')
    expect(addSubmit(wrapper).attributes('disabled')).toBeDefined()
    expect(addCancel(wrapper).attributes('disabled')).toBeDefined()

    await pending
    await settle()
  })

  it('[CAV-23] モーダルを開き直すと前回の入力と失敗理由が残らない', async () => {
    failCreate()
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, { 'stock-code': NEW_STOCK_CODE, type: NEW_CA_TYPE, note: 'メモ' })
    await submitAdd(wrapper)
    expect(exists(wrapper, 'ca-add-error')).toBe(true)

    await addCancel(wrapper).trigger('click')
    await openAddModal(wrapper)

    expect(exists(wrapper, 'ca-add-error')).toBe(false)
    expect(addInput(wrapper, 'stock-code').element.value).toBe('')
    expect(addInput(wrapper, 'type').element.value).toBe('')
    expect(addInput(wrapper, 'note').element.value).toBe('')
  })

  it('[CAV-24] 追加の成功メッセージは次にモーダルを開いたときに消える', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, { 'stock-code': NEW_STOCK_CODE, type: NEW_CA_TYPE })
    await submitAdd(wrapper)
    expect(exists(wrapper, 'ca-notice')).toBe(true)

    await openAddModal(wrapper)

    expect(exists(wrapper, 'ca-notice')).toBe(false)
  })

  it('[CAV-25] 編集モーダルはその行の現在値で開く', async () => {
    const { wrapper } = await mountView()
    await settle()

    await openEditModal(wrapper)

    expect(exists(wrapper, 'ca-edit-form')).toBe(true)
    expect(editInput(wrapper, 'stock-code').element.value).toBe(firstPage[0].stockCode)
    expect(editInput(wrapper, 'type').element.value).toBe(sorted[0].CA種別)
    expect(editInput(wrapper, 'ex-rights-date').element.value).toBe(firstPage[0].exRightsDate)
    expect(editInput(wrapper, 'denominator').element.value).toBe(String(sorted[0].分母))
    expect(editInput(wrapper, 'numerator').element.value).toBe(String(sorted[0].分子))
    expect(editInput(wrapper, 'note').element.value).toBe(firstPage[0].note)
  })

  it('[CAV-32] 分母・分子が未設定の行では空欄になり 0 にならない', async () => {
    // フィクスチャは全行が比率を持つので、未設定の行はここで作る
    const withoutRatio = { ...corporateActions[0], ID: 900, 分母: null, 分子: null, 比率: null }
    server.use(http.get('*/api/ca', () => HttpResponse.json(listBody([withoutRatio]))))
    const { wrapper } = await mountView()
    await settle()

    await wrapper.find('[data-testid="ca-edit-900"]').trigger('click')

    // null（未設定）を 0 に読み替えると、更新のたびに比率が勝手に付く
    expect(editInput(wrapper, 'denominator').element.value).toBe('')
    expect(editInput(wrapper, 'numerator').element.value).toBe('')
  })

  it('[CAV-26] 更新が成功するとモーダルが閉じ、一覧の該当行が入れ替わる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await fillEdit(wrapper, { note: '編集した備考' })
    await submitEdit(wrapper)

    expect(exists(wrapper, 'ca-edit-form')).toBe(false)
    const notice = wrapper.find('[data-testid="ca-notice"]').text()
    expect(notice).toContain(firstPage[0].stockCode)
    expect(notice).toContain(firstPage[0].caTypeName)
    expect(rows(wrapper)[0].text()).toContain('編集した備考')
    // 更新は行を増やさない
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CAV-27] 必須を空にすると項目の直下に理由を出し、API へ送らない', async () => {
    let updateCalls = 0
    server.use(
      http.put('*/api/ca/:caId', () => {
        updateCalls += 1
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await fillEdit(wrapper, { 'stock-code': '' })
    await submitEdit(wrapper)

    expect(exists(wrapper, 'ca-edit-form')).toBe(true)
    expect(fieldError(wrapper, editInput(wrapper, 'stock-code'))).toBe(
      '銘柄コードを入力してください。',
    )
    expect(updateCalls).toBe(0)
  })

  it('[CAV-28] 事前検証の不合格は編集モーダル内に箇条書きで出す', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await fillEdit(wrapper, { 'stock-code': UNKNOWN_STOCK_CODE })
    await submitEdit(wrapper)

    expect(exists(wrapper, 'ca-edit-form')).toBe(true)
    expect(editValidationMessages(wrapper)).toEqual([
      `銘柄コード(${UNKNOWN_STOCK_CODE})は銘柄マスタに存在しません`,
    ])
    expect(exists(wrapper, 'ca-edit-error')).toBe(false)
  })

  it('[CAV-29] 楽観的ロックの競合は通信・サーバ障害と同じ枠に出す', async () => {
    conflictOnUpdate()
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await fillEdit(wrapper, { note: '編集した備考' })
    await submitEdit(wrapper)

    expect(exists(wrapper, 'ca-edit-form')).toBe(true)
    expect(wrapper.find('[data-testid="ca-edit-error"]').text()).toContain(CONFLICT_MESSAGE)
    // 409 を事前検証の不合格として扱わない（画面は 409 を特別扱いしない）
    expect(exists(wrapper, 'ca-edit-validation-error')).toBe(false)
    // 一覧を自動で読み直さない（モーダルが握る合札は古いままなので意味が無い）
    expect(rows(wrapper)[0].text()).toContain(firstPage[0].note)
  })

  it('[CAV-30] 更新中は送信もキャンセルもできない', async () => {
    server.use(
      http.put('*/api/ca/:caId', async () => {
        await delay(20)
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    const pending = editSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(editSubmit(wrapper).text()).toContain('更新中…')
    expect(editSubmit(wrapper).attributes('disabled')).toBeDefined()
    expect(editCancel(wrapper).attributes('disabled')).toBeDefined()

    await pending
    await settle()
  })

  it('[CAV-31] 追加の失敗理由が編集モーダルに漏れない', async () => {
    failCreate()
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, { 'stock-code': NEW_STOCK_CODE, type: NEW_CA_TYPE })
    await submitAdd(wrapper)
    expect(exists(wrapper, 'ca-add-error')).toBe(true)

    await addCancel(wrapper).trigger('click')
    await openEditModal(wrapper)

    // 登録側と更新側で枠が分かれている（共用すると片方の消し忘れが漏れる）
    expect(exists(wrapper, 'ca-edit-error')).toBe(false)
    expect(exists(wrapper, 'ca-edit-validation-error')).toBe(false)
  })

  it('[CAV-33] 絞り込み中に最終ページの最後の 1 件を圏外へ変えると 1 ページ戻る', async () => {
    /*
     * 絞り込み結果がちょうど「1 ページ + 1 件」になる状況はフィクスチャに無いので、
     * ここで組む（絞り込みごとの件数は 8〜24 件で、表示件数の 50 を超えるのは全件だけ）。
     * 同じ理由で E2E には置けない（mockApi は固定の body を返すだけで、
     * 更新の前後で件数を変えられない）。
     */
    const FILTER_TYPE = '110'
    const OTHER_TYPE = '120'
    const LAST_ID = 500 + PAGE_SIZE
    let rowsState = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
      ...corporateActions[0],
      ID: 500 + index,
      CA種別: FILTER_TYPE,
      CA種別名: '現金配当',
    }))

    server.use(
      /*
       * 事前検証も差し替える。ここで組んだ行は既定ハンドラの持ち物ではないので、
       * 既定のままだと変更検証が「指定されたCAは存在しません」で弾いてしまう。
       */
      http.post('*/api/ca/validate', () =>
        HttpResponse.json({ valid: true, errors: [], warnings: [], details: null }),
      ),
      http.get('*/api/ca', ({ request }) => {
        const params = new URL(request.url).searchParams
        const caType = params.get('ca_type') ?? ''
        const offset = Number(params.get('offset') ?? 0)
        const filtered = rowsState.filter((ca) => !caType || ca.CA種別 === caType)
        return HttpResponse.json({
          total: filtered.length,
          limit: PAGE_SIZE,
          offset,
          ca_list: filtered.slice(offset, offset + PAGE_SIZE),
        })
      }),
      http.put('*/api/ca/:caId', async ({ params, request }) => {
        const body = await request.json()
        const id = Number(params.caId)
        const updated = { ...rowsState.find((ca) => ca.ID === id), CA種別: body.CA種別 }
        rowsState = rowsState.map((ca) => (ca.ID === id ? updated : ca))
        return HttpResponse.json({ success: true, ca: updated, message: 'ok' })
      }),
    )

    const { wrapper, router } = await mountView({
      ca_type: FILTER_TYPE,
      offset: String(PAGE_SIZE),
    })
    await settle()
    expect(rows(wrapper)).toHaveLength(1)

    await wrapper.find(`[data-testid="ca-edit-${LAST_ID}"]`).trigger('click')
    await fillEdit(wrapper, { type: OTHER_TYPE })
    await submitEdit(wrapper)
    // 事前検証 → 更新 → 読み直し → ページ戻し → 再取得 と続くので、settle を重ねて待つ
    await settle()
    await settle()

    // 空のページに取り残さない。絞り込み条件は残したまま 1 ページ前へ戻す
    expect(router.currentRoute.value.query.offset).toBeUndefined()
    expect(router.currentRoute.value.query.ca_type).toBe(FILTER_TYPE)
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[CAV-34] 削除確認は消す対象と取り消せない旨を出す', async () => {
    const { wrapper } = await mountView()
    await settle()

    await openDeleteModal(wrapper)

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain(firstPage[0].stockCode)
    expect(dialog.text()).toContain(firstPage[0].caTypeName)
    expect(dialog.text()).toContain(firstPage[0].effectiveDate)
    expect(dialog.text()).toContain('この操作は元に戻せません。')
  })

  it('[CAV-35] 削除が成功するとダイアログが閉じ、件数が 1 減る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openDeleteModal(wrapper)

    await confirmDelete(wrapper)

    expect(exists(wrapper, 'ca-delete-submit')).toBe(false)
    const notice = wrapper.find('[data-testid="ca-notice"]').text()
    expect(notice).toContain(firstPage[0].stockCode)
    expect(notice).toContain(firstPage[0].caTypeName)
    expect(countText(wrapper)).toContain(String(TOTAL - 1))
    /*
     * 論理削除だが、一覧は取消済みを返さないので消えたように見える。
     * 備考や銘柄は他の行と重なりうる（フィクスチャは同じ CA を銘柄ごとに持つ）ので、
     * 行そのものが消えたことは id で見る。
     */
    expect(exists(wrapper, `ca-edit-${firstPage[0].id}`)).toBe(false)
  })

  it('[CAV-36] 削除に失敗するとダイアログは開いたまま理由を出す', async () => {
    failDelete()
    const { wrapper } = await mountView()
    await settle()
    await openDeleteModal(wrapper)

    await confirmDelete(wrapper)

    expect(exists(wrapper, 'ca-delete-submit')).toBe(true)
    expect(wrapper.find('[data-testid="ca-delete-error"]').text()).toContain(ERROR_MESSAGE)
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[CAV-37] 削除中は削除もキャンセルもできない', async () => {
    server.use(
      http.delete('*/api/ca/:caId', async () => {
        await delay(20)
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openDeleteModal(wrapper)

    const pending = deleteSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(deleteSubmit(wrapper).text()).toContain('削除中…')
    expect(deleteSubmit(wrapper).attributes('disabled')).toBeDefined()
    expect(deleteCancel(wrapper).attributes('disabled')).toBeDefined()

    await pending
    await settle()
  })

  it('[CAV-38] 最終ページの最後の 1 件を消すと 1 ページ戻る', async () => {
    // 全件をちょうど「1 ページ + 1 件」にして、2 ページ目の唯一の行を消す
    let rowsState = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
      ...corporateActions[0],
      ID: 600 + index,
    }))
    const LAST_ID = 600 + PAGE_SIZE

    server.use(
      http.get('*/api/ca', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
        return HttpResponse.json({
          total: rowsState.length,
          limit: PAGE_SIZE,
          offset,
          ca_list: rowsState.slice(offset, offset + PAGE_SIZE),
        })
      }),
      http.delete('*/api/ca/:caId', ({ params }) => {
        const id = Number(params.caId)
        const target = rowsState.find((ca) => ca.ID === id)
        rowsState = rowsState.filter((ca) => ca.ID !== id)
        return HttpResponse.json({ success: true, ca: target, message: 'ok' })
      }),
    )

    const { wrapper, router } = await mountView({ offset: String(PAGE_SIZE) })
    await settle()
    expect(rows(wrapper)).toHaveLength(1)

    await wrapper.find(`[data-testid="ca-delete-${LAST_ID}"]`).trigger('click')
    await confirmDelete(wrapper)
    await settle()

    expect(router.currentRoute.value.query.offset).toBeUndefined()
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })
})
