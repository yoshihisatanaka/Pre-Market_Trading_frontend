import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
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

  it('[STV-03] 列が銘柄コードから備考まで 11 列この順で並ぶ', async () => {
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

  it('[STV-17] 読むだけの画面なので追加・編集・削除の導線を持たない', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'symbols-reload')).toBe(true)
    expect(exists(wrapper, 'symbols-add')).toBe(false)
    // 行の中にボタンが無いこと（操作列そのものが無い）
    expect(rows(wrapper)[0].findAll('button')).toHaveLength(0)
  })
})
