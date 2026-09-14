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

  it('[CAV-16] ヘッダに追加の導線があり、行には編集・削除のボタンが無い', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'ca-reload')).toBe(true)
    expect(exists(wrapper, 'ca-add')).toBe(true)
    // 行の中にボタンが無いこと（操作列そのものが無い）
    expect(rows(wrapper)[0].findAll('button')).toHaveLength(0)
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
})
