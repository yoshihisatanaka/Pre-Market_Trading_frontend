import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { symbols } from '@/mocks/fixtures/symbols'
import { SYMBOLS_PAGE_SIZE } from '@/stores/symbols'
import { formatQuantity, formatUsdUnit } from '@/utils/format'
import { ORDER_ROUTE_OPTIONS, REGULATION_OPTIONS, VWAP_TARGET_OPTIONS } from '@/utils/symbolTypes'
import SymbolListView from './SymbolListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4状態の出し分けと「URL クエリが正」の単方向フローを検証する。
 *
 * 取引可否セルは表示名だけを見る（色は仮置きのコード値に依存するため。
 * docs/unit/views-symbol-list-view.md）。
 *
 * シナリオ: docs/unit/views-symbol-list-view.md
 */
const PATH = '/masters/symbols'

const PAGE_SIZE = SYMBOLS_PAGE_SIZE
const TOTAL = symbols.length

/*
 * フィクスチャはバックエンドの生の形（日本語キー / フラグは 0/1 の integer）なので、
 * 期待値は api 層と同じ変換でアプリ内モデルの形に直してから使う。
 */
const toRow = (symbol) => ({
  id: String(symbol.ID),
  symbolCode: symbol.銘柄コード,
  ticker: symbol.Ticker ?? '',
  name: symbol.銘柄名 ?? '',
  nameEn: symbol.銘柄名_英字 ?? '',
  regulation: symbol.規制情報 ?? '',
  regulationName: symbol.規制情報名 ?? '',
  orderRoute: symbol.注文ルート ?? '',
  orderRouteName: symbol.注文ルート名 ?? '',
  vwapTarget: symbol.VWAP対象区分 ?? '',
  vwapTargetName: symbol.VWAP対象区分名 ?? '',
  note: symbol.備考 ?? '',
  previousClose: symbol.前日終値,
  previousVolume: symbol.前日出来高,
  averageVolume: symbol.平均出来高,
  userModified: symbol.ユーザー操作フラグ === 1,
})

/** 実 API と同じ並び（銘柄コードの昇順） */
const sorted = [...symbols].sort((a, b) => a.銘柄コード.localeCompare(b.銘柄コード))
const allRows = sorted.map(toRow)
const firstPage = allRows.slice(0, PAGE_SIZE)
const secondPage = allRows.slice(PAGE_SIZE)

// 表示件数の倍数でない offset（丸めないので、この位置から表示件数分が出る）
const ODD_OFFSET = 7
const oddPage = allRows.slice(ODD_OFFSET, ODD_OFFSET + PAGE_SIZE)

// 絞り込みに使う値もフィクスチャから導く
const TICKER = allRows[0].ticker
const REGULATION = allRows[0].regulation
const ORDER_ROUTE = allRows[0].orderRoute
const VWAP_TARGET = allRows[0].vwapTarget
const filtered = allRows.filter(
  (row) =>
    row.ticker === TICKER &&
    row.regulation === REGULATION &&
    row.orderRoute === ORDER_ROUTE &&
    row.vwapTarget === VWAP_TARGET,
)

/** どの区分の選択肢にも無いコード（手で URL に書かれた値を模す） */
const UNKNOWN_CODE = '9'

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** SymbolListResponse の形で返す */
const listBody = (items, total = items.length) => ({
  total,
  limit: PAGE_SIZE,
  offset: 0,
  stocks: items,
})

const errorHandler = (options) =>
  http.get(
    '*/api/masters/symbols',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get('*/api/masters/symbols', () => HttpResponse.json(listBody([])), options)

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

  const wrapper = mount(SymbolListView, {
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
const countText = (wrapper) => wrapper.find('[data-testid="symbols-count"]').text()
const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const headers = (wrapper) => wrapper.findAll('th').map((th) => th.text())
const cells = (row) => row.findAll('td').map((td) => td.text())
const rowOf = (wrapper, symbolCode) =>
  rows(wrapper).find((candidate) => candidate.text().includes(symbolCode))
const pageButton = (wrapper, page) =>
  wrapper.find(`[data-testid="pagination-page"][data-page="${page}"]`)

/** 選択肢定数から表示名を引く（仮置きのラベル文字列をテストに直接書かない） */
const labelOf = (options, value) => options.find((option) => option.value === value).label

/* ここから新規追加モーダル用のヘルパ */

// フィクスチャに無い銘柄コードと、既にある銘柄コード（事前検証に重複で弾かれる）
const NEW_SYMBOL = { 'symbol-code': 'S900', ticker: 'ZZZZ', name: 'テスト銘柄' }
const EXISTING_CODE = allRows[0].symbolCode

const addInput = (wrapper, name) => wrapper.find(`[data-testid="symbols-add-${name}"]`)
const addSubmit = (wrapper) => wrapper.find('[data-testid="symbols-add-submit"]')
const addCancel = (wrapper) => wrapper.find('[data-testid="symbols-add-cancel"]')

const openAddModal = async (wrapper) => {
  await wrapper.find('[data-testid="symbols-add"]').trigger('click')
}

/** 入力欄をまとめて埋める（キーは testid の `symbols-add-` より後ろ） */
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
  wrapper.findAll('[data-testid="symbols-add-validation-error"] li').map((item) => item.text())

/** 入力欄の直下に出ている理由（FormField が aria-describedby で結び付けている） */
const fieldError = (wrapper, input) => {
  const ids = (input.attributes('aria-describedby') ?? '').split(' ').filter(Boolean)
  const found = ids.map((id) => wrapper.find(`#${id}[role="alert"]`)).find((el) => el.exists())
  return found ? found.text() : ''
}

/** 登録（事前検証は既定のまま）を 500 にする差し替え */
const failCreate = () =>
  server.use(
    http.post('*/api/masters/symbols', () =>
      HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    ),
  )

/* ここから編集モーダル用のヘルパ（testid は symbols-edit- に振り替わる） */

const editInput = (wrapper, name) => wrapper.find(`[data-testid="symbols-edit-${name}"]`)
const editSubmit = (wrapper) => wrapper.find('[data-testid="symbols-edit-submit"]')
const editCancel = (wrapper) => wrapper.find('[data-testid="symbols-edit-cancel"]')

/** 行の「編集」を押す（ボタンの testid は行の id を含む） */
const openEditModal = async (wrapper, id = firstPage[0].id) => {
  await wrapper.find(`[data-testid="symbols-edit-${id}"]`).trigger('click')
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
  wrapper.findAll('[data-testid="symbols-edit-validation-error"] li').map((item) => item.text())

/** 更新（事前検証は既定のまま）を差し替える */
const respondToUpdate = (body, status = 200, wait = 0) =>
  server.use(
    http.put('*/api/masters/symbols/:id', async () => {
      if (wait) await delay(wait)
      return HttpResponse.json(body, { status })
    }),
  )

/* ここから削除確認ダイアログ用のヘルパ（事前検証が無いので差し替えは DELETE の 1 本だけ） */

const deleteSubmit = (wrapper) => wrapper.find('[data-testid="symbols-delete-submit"]')
const deleteCancel = (wrapper) => wrapper.find('[data-testid="symbols-delete-cancel"]')

/** 行の「削除」を押す（ボタンの testid は行の id を含む） */
const openDeleteModal = async (wrapper, id = firstPage[0].id) => {
  await wrapper.find(`[data-testid="symbols-delete-${id}"]`).trigger('click')
}

const submitDelete = async (wrapper) => {
  await deleteSubmit(wrapper).trigger('click')
  await settle()
}

/** 削除の応答を差し替える（wait を渡すと過渡状態を観測できる） */
const respondToDelete = (body, status = 200, wait = 0) =>
  server.use(
    http.delete('*/api/masters/symbols/:id', async () => {
      if (wait) await delay(wait)
      return HttpResponse.json(body, { status })
    }),
  )

/** 事前検証を不合格にする差し替え（編集からは重複も存在エラーも起こせないため） */
const failValidate = (message) =>
  server.use(
    http.post('*/api/masters/symbols/validate', () =>
      HttpResponse.json({ valid: false, errors: [message], warnings: [], details: null }),
    ),
  )

describe('SymbolListView', () => {
  it('[STV-01] 応答を待つ間はローディングだけを出す', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'symbols-loading')).toBe(true)
    expect(exists(wrapper, 'symbols-table')).toBe(false)
    expect(exists(wrapper, 'symbols-empty')).toBe(false)
  })

  it('[STV-02] 1 ページ目の件数と行がフィクスチャと一致する', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)

    const first = rows(wrapper)[0].text()
    expect(first).toContain(firstPage[0].symbolCode)
    expect(first).toContain(firstPage[0].ticker)
    expect(first).toContain(firstPage[0].nameEn)
    expect(first).toContain(firstPage[0].name)
  })

  it('[STV-03] 列が銘柄コードから備考まで並び、右端に見出しの無い操作列が付く', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(headers(wrapper)).toEqual([
      '銘柄コード',
      'ティッカーコード',
      '銘柄名（英語）',
      '銘柄名（日本語）',
      '前日終値',
      '前日出来高',
      '5日平均出来高',
      '取引可否',
      '預託先区分',
      'VWAP対象区分',
      '備考',
      // 行ごとの操作。画面モックに合わせて見出しは空
      '',
    ])
  })

  it('[STV-04] 手動操作された行にだけ印が付く', async () => {
    const { wrapper } = await mountView()
    await settle()

    const marked = rows(wrapper).filter((row) => row.classes().includes('is-user-modified'))
    const expected = firstPage.filter((row) => row.userModified)

    // フィクスチャが両方の行を持っていないと、このシナリオは意味を失う
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(PAGE_SIZE)
    expect(marked).toHaveLength(expected.length)
  })

  it('[STV-05] 相場が未取得の行は 3 列とも — を出す', async () => {
    const target = firstPage.find((row) => row.previousClose === null)
    // フィクスチャに未取得の行が無ければ、このシナリオは意味を失う
    expect(target).toBeTruthy()

    const { wrapper } = await mountView()
    await settle()

    expect(cells(rowOf(wrapper, target.symbolCode)).slice(4, 7)).toEqual(['—', '—', '—'])
  })

  it('[STV-06] 前日終値は「ドル」付き、出来高は 3 桁区切りで出す', async () => {
    const target = firstPage.find((row) => row.previousClose !== null)

    const { wrapper } = await mountView()
    await settle()

    const quote = cells(rowOf(wrapper, target.symbolCode)).slice(4, 7)
    expect(quote).toEqual([
      formatUsdUnit(target.previousClose),
      formatQuantity(target.previousVolume),
      formatQuantity(target.averageVolume),
    ])
    // 整形の形そのもの（'227.16 ドル' / '43,820,000'）もここで確かめる
    expect(quote[0]).toMatch(/^[\d,]+\.\d{2} ドル$/)
    expect(quote[1]).toMatch(/^[\d,]+$/)
  })

  it('[STV-07] 区分名が欠けた応答でもコードから名前を補う', async () => {
    const raw = { ...sorted[0], 規制情報名: null, 注文ルート名: null, VWAP対象区分名: null }
    server.use(http.get('*/api/masters/symbols', () => HttpResponse.json(listBody([raw]))))

    const { wrapper } = await mountView()
    await settle()

    expect(cells(rows(wrapper)[0]).slice(7, 10)).toEqual([
      labelOf(REGULATION_OPTIONS, raw.規制情報),
      labelOf(ORDER_ROUTE_OPTIONS, raw.注文ルート),
      labelOf(VWAP_TARGET_OPTIONS, raw.VWAP対象区分),
    ])
  })

  it('[STV-08] 0 件のときは空状態を出し、表は描画しない', async () => {
    server.use(emptyHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="symbols-empty"]').text()).toBe('該当する銘柄はありません。')
    expect(exists(wrapper, 'symbols-table')).toBe(false)
  })

  it('[STV-09] 取得に失敗したときは理由と再試行を出す', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="symbols-error"]').text()).toContain(ERROR_MESSAGE)
    expect(exists(wrapper, 'symbols-table')).toBe(false)
    expect(exists(wrapper, 'symbols-empty')).toBe(false)
  })

  it('[STV-10] 再試行で読み直すと表が出る', async () => {
    // once を付けて、1 回目だけ 500・2 回目から既定ハンドラに戻す
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()

    await wrapper.find('[data-testid="symbols-error"]').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'symbols-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[STV-11] 表示件数の倍数でない offset は丸めずその位置から表示する', async () => {
    const { wrapper } = await mountView({ offset: String(ODD_OFFSET) })
    await settle()

    expect(rows(wrapper)).toHaveLength(oddPage.length)
    expect(rows(wrapper)[0].text()).toContain(oddPage[0].symbolCode)
  })

  it('[STV-12] ページ番号を click すると URL に offset が乗り表が入れ替わる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await pageButton(wrapper, 2).trigger('click')
    await settle()

    expect(router.currentRoute.value.query.offset).toBe(String(PAGE_SIZE))
    expect(rows(wrapper)).toHaveLength(secondPage.length)
  })

  it('[STV-13] 検索すると URL に 4 条件が乗り絞り込まれる', async () => {
    const { wrapper, router } = await mountView()
    await settle()

    await wrapper.find('[data-testid="symbols-symbol-code"]').setValue(TICKER)
    await wrapper.find('[data-testid="symbols-regulation"]').setValue(REGULATION)
    await wrapper.find('[data-testid="symbols-order-route"]').setValue(ORDER_ROUTE)
    await wrapper.find('[data-testid="symbols-vwap-target"]').setValue(VWAP_TARGET)
    await wrapper.find('[data-testid="symbols-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({
      symbol_code: TICKER,
      regulation: REGULATION,
      order_route: ORDER_ROUTE,
      vwap_target: VWAP_TARGET,
    })
    expect(rows(wrapper)).toHaveLength(filtered.length)
  })

  it('[STV-14] クリアで URL クエリが空になり全件に戻る', async () => {
    const { wrapper, router } = await mountView({ symbol_code: TICKER })
    await settle()
    expect(rows(wrapper).length).toBeLessThan(PAGE_SIZE)

    await wrapper.find('[data-testid="symbols-search-clear"]').trigger('click')
    await settle()

    expect(router.currentRoute.value.query).toEqual({})
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[STV-15] 未知の取引可否コードは条件なしとして捨てる', async () => {
    const { wrapper } = await mountView({ regulation: UNKNOWN_CODE })
    await settle()

    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(wrapper.find('[data-testid="symbols-regulation"]').element.value).toBe('')
  })

  it('[STV-16] 説明バナーと検索カードは 4 状態のいずれでも表示される', async () => {
    for (const handler of [null, emptyHandler(), errorHandler()]) {
      if (handler) server.use(handler)
      const { wrapper } = await mountView()
      await settle()

      expect(exists(wrapper, 'symbols-description')).toBe(true)
      expect(exists(wrapper, 'symbols-search')).toBe(true)
    }
  })

  it('[STV-17] ヘッダに追加の導線があり、行には編集と削除がこの順で並ぶ', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'symbols-add')).toBe(true)

    // 破壊的な操作を最後にする既存の並び（編集が左・削除が右端）
    const buttons = rows(wrapper)[0].findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons.map((button) => button.text())).toEqual(['編集', '削除'])
  })

  it('[STV-18] 新規追加を押すと 10 項目の空のフォームが開く', async () => {
    const { wrapper } = await mountView()
    await settle()

    await openAddModal(wrapper)

    expect(exists(wrapper, 'symbols-add-form')).toBe(true)
    for (const name of [
      'symbol-code',
      'ticker',
      'name',
      'name-en',
      'previous-close',
      'average-volume',
      'note',
    ]) {
      expect(addInput(wrapper, name).element.value).toBe('')
    }
    // 区分 3 つを含めて、入力欄はちょうど 10 個（市場名・前日出来高・Pre区分 は持たない）
    const fields = wrapper.findAll('[data-testid^="symbols-add-"]')
    const inputs = fields.filter((field) =>
      ['input', 'select'].includes(field.element.tagName.toLowerCase()),
    )
    expect(inputs).toHaveLength(10)
  })

  it('[STV-19] 必須が未入力なら項目の直下に理由を出し、API へ送らない', async () => {
    let validateCalls = 0
    let createCalls = 0
    server.use(
      http.post('*/api/masters/symbols/validate', () => {
        validateCalls += 1
        return HttpResponse.json({ valid: true, errors: [], warnings: [], details: null })
      }),
      http.post('*/api/masters/symbols', () => {
        createCalls += 1
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await submitAdd(wrapper)

    expect(exists(wrapper, 'symbols-add-form')).toBe(true)
    expect(fieldError(wrapper, addInput(wrapper, 'symbol-code'))).toBe(
      '銘柄コードを入力してください。',
    )
    expect(fieldError(wrapper, addInput(wrapper, 'ticker'))).toBe(
      'ティッカーコードを入力してください。',
    )
    expect(fieldError(wrapper, addInput(wrapper, 'name'))).toBe(
      '銘柄名（日本語）を入力してください。',
    )
    // 無駄な往復をしない（事前検証も登録も呼ばない）
    expect(validateCalls).toBe(0)
    expect(createCalls).toBe(0)
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[STV-20] 追加が成功するとモーダルが閉じ、成功メッセージと増えた件数が出る', async () => {
    const { wrapper, router } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, NEW_SYMBOL)
    await submitAdd(wrapper)

    expect(exists(wrapper, 'symbols-add-form')).toBe(false)
    /*
     * 一覧は銘柄コードの昇順なので、追加した行が 1 ページ目に出るとは限らない。
     * 行を追わず、メッセージに銘柄コードが入っていること（＝検索できること）を見る。
     */
    const notice = wrapper.find('[data-testid="symbols-notice"]').text()
    expect(notice).toContain(NEW_SYMBOL['symbol-code'])
    expect(notice).toContain(NEW_SYMBOL.ticker)
    expect(countText(wrapper)).toContain(String(TOTAL + 1))
    // 一覧の単方向フローには触らない
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('[STV-21] 事前検証の不合格はモーダル内に箇条書きで出し、登録しない', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, { ...NEW_SYMBOL, 'symbol-code': EXISTING_CODE })
    await submitAdd(wrapper)

    expect(exists(wrapper, 'symbols-add-form')).toBe(true)
    expect(validationMessages(wrapper)).toEqual([
      `銘柄コード(${EXISTING_CODE})は既に登録されています`,
    ])
    // 通信は成功しているので、サーバ障害の枠には出さない
    expect(exists(wrapper, 'symbols-add-error')).toBe(false)
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[STV-22] 通信・サーバ障害はモーダル内に 1 行で出す', async () => {
    failCreate()
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)

    await fillAdd(wrapper, NEW_SYMBOL)
    await submitAdd(wrapper)

    expect(exists(wrapper, 'symbols-add-form')).toBe(true)
    expect(wrapper.find('[data-testid="symbols-add-error"]').text()).toContain(ERROR_MESSAGE)
    // 事前検証は通っているので、そちらの枠には出さない
    expect(exists(wrapper, 'symbols-add-validation-error')).toBe(false)
  })

  it('[STV-23] 登録中は送信もキャンセルもできない', async () => {
    server.use(
      http.post('*/api/masters/symbols', async () => {
        await delay(20)
        return HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, NEW_SYMBOL)

    // 応答を待たずに押した直後を見る
    const pending = addSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(addSubmit(wrapper).text()).toContain('追加中')
    expect(addSubmit(wrapper).attributes('disabled')).toBeDefined()
    // 結果の行き先が無くなるので、閉じさせない
    expect(addCancel(wrapper).attributes('disabled')).toBeDefined()

    await pending
    await settle()
    expect(exists(wrapper, 'symbols-add-form')).toBe(true)
  })

  it('[STV-24] モーダルを開き直すと前回の入力と失敗理由が残らない', async () => {
    failCreate()
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, { ...NEW_SYMBOL, note: 'メモ' })
    await submitAdd(wrapper)
    expect(exists(wrapper, 'symbols-add-error')).toBe(true)

    await addCancel(wrapper).trigger('click')
    await openAddModal(wrapper)

    expect(exists(wrapper, 'symbols-add-error')).toBe(false)
    expect(addInput(wrapper, 'symbol-code').element.value).toBe('')
    expect(addInput(wrapper, 'ticker').element.value).toBe('')
    expect(addInput(wrapper, 'note').element.value).toBe('')
  })

  it('[STV-25] 区分 3 つは未選択を作らず実 API の既定から始まる', async () => {
    const { wrapper } = await mountView()
    await settle()

    await openAddModal(wrapper)

    // 注文ルートは null を送れないので、未選択の選択肢そのものを置かない
    for (const name of ['regulation', 'order-route', 'vwap-target']) {
      expect(addInput(wrapper, name).element.value).toBe('0')
      expect(addInput(wrapper, name).findAll('option[value=""]')).toHaveLength(0)
    }
  })

  it('[STV-26] 「編集」を押すと現在値が入り、銘柄コードは読み取り専用になる', async () => {
    const { wrapper } = await mountView()
    await settle()

    await openEditModal(wrapper)

    expect(exists(wrapper, 'symbols-edit-form')).toBe(true)
    const target = firstPage[0]
    expect(editInput(wrapper, 'symbol-code').element.value).toBe(target.symbolCode)
    expect(editInput(wrapper, 'ticker').element.value).toBe(target.ticker)
    expect(editInput(wrapper, 'name').element.value).toBe(target.name)
    expect(editInput(wrapper, 'name-en').element.value).toBe(target.nameEn)
    expect(editInput(wrapper, 'regulation').element.value).toBe(target.regulation)
    expect(editInput(wrapper, 'order-route').element.value).toBe(target.orderRoute)
    expect(editInput(wrapper, 'vwap-target').element.value).toBe(target.vwapTarget)
    expect(editInput(wrapper, 'previous-close').element.value).toBe(String(target.previousClose))
    expect(editInput(wrapper, 'average-volume').element.value).toBe(String(target.averageVolume))
    expect(editInput(wrapper, 'note').element.value).toBe(target.note)

    /*
     * 銘柄コードは主キーではなくなったが、実 API の詳細照会・更新履歴がこの値で 1 件を指すので
     * 変更させない。見た目（面が一段沈む）は scoped CSS なので jsdom では検証できない。
     */
    expect(editInput(wrapper, 'symbol-code').attributes('readonly')).toBeDefined()

    // 項目の増減はしない（追加と同じ 10 個であることが部品化の狙い）
    const fields = wrapper.findAll('[data-testid^="symbols-edit-"]')
    const inputs = fields.filter((field) =>
      ['input', 'select'].includes(field.element.tagName.toLowerCase()),
    )
    expect(inputs).toHaveLength(10)
  })

  it('[STV-27] 更新するとモーダルが閉じ、一覧の該当行が新しい内容になる', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await fillEdit(wrapper, { note: '直した備考' })
    await submitEdit(wrapper)

    expect(exists(wrapper, 'symbols-edit-form')).toBe(false)

    const target = firstPage[0]
    const notice = wrapper.find('[data-testid="symbols-notice"]').text()
    for (const part of [target.symbolCode, target.ticker, target.name]) {
      expect(notice).toContain(part)
    }

    // 更新は行を増やさない
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(rowOf(wrapper, target.symbolCode).text()).toContain('直した備考')
  })

  it('[STV-28] 必須を空にすると項目の直下に理由を出し、API へ送らない', async () => {
    let putCalls = 0
    server.use(
      http.put('*/api/masters/symbols/:id', () => {
        putCalls += 1
        return HttpResponse.json({ success: true, stock: {}, message: 'ok' })
      }),
    )
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await fillEdit(wrapper, { ticker: '' })
    await submitEdit(wrapper)

    expect(fieldError(wrapper, editInput(wrapper, 'ticker'))).toBe(
      'ティッカーコードを入力してください。',
    )
    expect(exists(wrapper, 'symbols-edit-form')).toBe(true)
    expect(putCalls).toBe(0)
    expect(exists(wrapper, 'symbols-notice')).toBe(false)
  })

  it('[STV-29] 事前検証の不合格は編集モーダル内に箇条書きで出す', async () => {
    const message = '注文ルート(9)はコードマスタに存在しません'
    failValidate(message)
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await fillEdit(wrapper, { note: '直した備考' })
    await submitEdit(wrapper)

    expect(exists(wrapper, 'symbols-edit-form')).toBe(true)
    expect(editValidationMessages(wrapper)).toEqual([message])
    // 通信は成功しているので、サーバ障害の枠には出さない
    expect(exists(wrapper, 'symbols-edit-error')).toBe(false)
    expect(countText(wrapper)).toContain(String(TOTAL))
  })

  it('[STV-30] 競合(409)は事前検証ではなく通信・サーバ障害の枠に出す', async () => {
    const detail = '他のユーザーによって銘柄データが更新されています。'
    respondToUpdate({ detail }, 409)
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)

    await fillEdit(wrapper, { note: '直した備考' })
    await submitEdit(wrapper)

    expect(exists(wrapper, 'symbols-edit-form')).toBe(true)
    expect(wrapper.find('[data-testid="symbols-edit-error"]').text()).toContain(detail)
    // 画面は 409 を特別扱いしない（事前検証の枠には出さない）
    expect(exists(wrapper, 'symbols-edit-validation-error')).toBe(false)
  })

  it('[STV-31] 更新中は送信もキャンセルもできない', async () => {
    respondToUpdate({ detail: ERROR_MESSAGE }, 500, 20)
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)
    await fillEdit(wrapper, { note: '直した備考' })

    // 応答を待たずに押した直後を見る
    const pending = editSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(editSubmit(wrapper).text()).toContain('更新中')
    expect(editSubmit(wrapper).attributes('disabled')).toBeDefined()
    // 結果の行き先が無くなるので、閉じさせない
    expect(editCancel(wrapper).attributes('disabled')).toBeDefined()

    await pending
    await settle()
    expect(exists(wrapper, 'symbols-edit-form')).toBe(true)
  })

  it('[STV-32] 追加の失敗理由が編集モーダルに漏れない', async () => {
    failCreate()
    const { wrapper } = await mountView()
    await settle()
    await openAddModal(wrapper)
    await fillAdd(wrapper, NEW_SYMBOL)
    await submitAdd(wrapper)
    expect(exists(wrapper, 'symbols-add-error')).toBe(true)

    await addCancel(wrapper).trigger('click')
    await openEditModal(wrapper)

    // 登録側と更新側で枠が分かれている（共用すると前回の理由が漏れる）
    expect(exists(wrapper, 'symbols-edit-error')).toBe(false)
    expect(exists(wrapper, 'symbols-edit-validation-error')).toBe(false)
  })

  it('[STV-33] 相場が未取得の行を開くと入力欄が空欄になる', async () => {
    const blank = {
      ...symbols[0],
      ID: 9001,
      銘柄コード: 'S901',
      前日終値: null,
      前日出来高: null,
      平均出来高: null,
    }
    server.use(http.get('*/api/masters/symbols', () => HttpResponse.json(listBody([blank]))))
    const { wrapper } = await mountView()
    await settle()

    await openEditModal(wrapper, '9001')

    // 0 に読み替えると、備考を直すだけの更新で 0 が書き込まれてしまう
    expect(editInput(wrapper, 'previous-close').element.value).toBe('')
    expect(editInput(wrapper, 'average-volume').element.value).toBe('')
  })

  it('[STV-34] 絞り込み中に最終ページの最後の 1 件を圏外へ変えると 1 ページ戻る', async () => {
    /*
     * 絞り込み結果がちょうど「1 ページ + 1 件」になる状況はフィクスチャに無いのでここで組む。
     * 同じ理由で E2E には置けない（mockApi は固定の body を返すだけで、
     * 更新の前後で件数を変えられない）。
     */
    const FILTER_VALUE = '0'
    const OTHER_VALUE = '1'
    const LAST_ID = 900 + PAGE_SIZE
    let rowsState = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
      ...symbols[0],
      ID: 900 + index,
      銘柄コード: `T${String(index).padStart(3, '0')}`,
      規制情報: FILTER_VALUE,
    }))

    server.use(
      /*
       * 事前検証も差し替える。ここで組んだ行は既定ハンドラの持ち物ではないので、
       * 既定のままだと変更検証が「指定された銘柄は存在しません」で弾いてしまう。
       */
      http.post('*/api/masters/symbols/validate', () =>
        HttpResponse.json({ valid: true, errors: [], warnings: [], details: null }),
      ),
      http.get('*/api/masters/symbols', ({ request }) => {
        const params = new URL(request.url).searchParams
        const regulation = params.get('restriction') ?? ''
        const offset = Number(params.get('offset') ?? 0)
        const rows = rowsState.filter((row) => !regulation || row.規制情報 === regulation)
        return HttpResponse.json({
          total: rows.length,
          limit: PAGE_SIZE,
          offset,
          stocks: rows.slice(offset, offset + PAGE_SIZE),
        })
      }),
      http.put('*/api/masters/symbols/:id', async ({ params, request }) => {
        const body = await request.json()
        const id = Number(params.id)
        const updated = { ...rowsState.find((row) => row.ID === id), 規制情報: body.規制情報 }
        rowsState = rowsState.map((row) => (row.ID === id ? updated : row))
        return HttpResponse.json({ success: true, stock: updated, message: 'ok' })
      }),
    )

    const { wrapper, router } = await mountView({
      regulation: FILTER_VALUE,
      offset: String(PAGE_SIZE),
    })
    await settle()
    expect(rows(wrapper)).toHaveLength(1)

    await openEditModal(wrapper, String(LAST_ID))
    await fillEdit(wrapper, { regulation: OTHER_VALUE })
    await submitEdit(wrapper)
    // 事前検証 → 更新 → 読み直し → ページ戻し → 再取得 と続くので、settle を重ねて待つ
    await settle()
    await settle()

    // 空のページに取り残さない。絞り込み条件は残したまま 1 ページ前へ戻す
    expect(router.currentRoute.value.query.offset).toBeUndefined()
    expect(router.currentRoute.value.query.regulation).toBe(FILTER_VALUE)
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[STV-35] 編集モーダルを開き直すと前回の失敗理由が残らない', async () => {
    respondToUpdate({ detail: ERROR_MESSAGE }, 500)
    const { wrapper } = await mountView()
    await settle()
    await openEditModal(wrapper)
    await fillEdit(wrapper, { note: '直した備考' })
    await submitEdit(wrapper)
    expect(exists(wrapper, 'symbols-edit-error')).toBe(true)

    await editCancel(wrapper).trigger('click')
    await openEditModal(wrapper)

    expect(exists(wrapper, 'symbols-edit-error')).toBe(false)
    // 入力もその行の現在値に戻る（前回の書きかけを持ち込まない）
    expect(editInput(wrapper, 'note').element.value).toBe(firstPage[0].note)
  })

  it('[STV-36] 削除確認は消す対象と取り消せない旨を出す', async () => {
    const { wrapper } = await mountView()
    await settle()

    await openDeleteModal(wrapper)

    // 銘柄コードだけでは何の銘柄か分からないので、一覧で実際に読む 3 点を並べる
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain(firstPage[0].symbolCode)
    expect(dialog.text()).toContain(firstPage[0].ticker)
    expect(dialog.text()).toContain(firstPage[0].name)
    expect(dialog.text()).toContain('この操作は元に戻せません。')
  })

  it('[STV-37] 削除が成功するとダイアログが閉じ、件数が 1 減る', async () => {
    const { wrapper } = await mountView()
    await settle()
    await openDeleteModal(wrapper)

    await submitDelete(wrapper)

    expect(exists(wrapper, 'symbols-delete-submit')).toBe(false)
    const notice = wrapper.find('[data-testid="symbols-notice"]').text()
    expect(notice).toContain(firstPage[0].symbolCode)
    expect(notice).toContain(firstPage[0].ticker)
    expect(notice).toContain(firstPage[0].name)
    expect(countText(wrapper)).toContain(String(TOTAL - 1))
    // 論理削除だが、一覧は取消済みを返さないので消えたように見える
    expect(exists(wrapper, `symbols-edit-${firstPage[0].id}`)).toBe(false)
  })

  it('[STV-38] 削除に失敗するとダイアログは開いたまま理由を出す', async () => {
    respondToDelete({ detail: ERROR_MESSAGE }, 500)
    const { wrapper } = await mountView()
    await settle()
    await openDeleteModal(wrapper)

    await submitDelete(wrapper)

    expect(exists(wrapper, 'symbols-delete-submit')).toBe(true)
    expect(wrapper.find('[data-testid="symbols-delete-error"]').text()).toContain(ERROR_MESSAGE)
    expect(countText(wrapper)).toContain(String(TOTAL))
    expect(exists(wrapper, 'symbols-notice')).toBe(false)
  })

  it('[STV-39] 削除中は削除もキャンセルもできない', async () => {
    respondToDelete({ detail: ERROR_MESSAGE }, 500, 20)
    const { wrapper } = await mountView()
    await settle()
    await openDeleteModal(wrapper)

    const pending = deleteSubmit(wrapper).trigger('click')
    await flushPromises()

    expect(deleteSubmit(wrapper).text()).toContain('削除中…')
    expect(deleteSubmit(wrapper).attributes('disabled')).toBeDefined()
    // 結果の行き先が無くなるので、終わるまで閉じさせない
    expect(deleteCancel(wrapper).attributes('disabled')).toBeDefined()

    await pending
    await settle()
  })

  it('[STV-40] 削除確認を開き直すと前回の失敗理由が残らない', async () => {
    respondToDelete({ detail: ERROR_MESSAGE }, 500)
    const { wrapper } = await mountView()
    await settle()
    await openDeleteModal(wrapper)
    await submitDelete(wrapper)
    expect(exists(wrapper, 'symbols-delete-error')).toBe(true)

    await deleteCancel(wrapper).trigger('click')
    await openDeleteModal(wrapper)

    expect(exists(wrapper, 'symbols-delete-error')).toBe(false)
  })
})
