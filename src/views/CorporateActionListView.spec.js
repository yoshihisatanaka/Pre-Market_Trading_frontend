import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { corporateActions } from '@/mocks/fixtures/ca'
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

  it('[CAV-16] 読むだけの画面なので追加・編集・削除の導線を持たない', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(exists(wrapper, 'ca-reload')).toBe(true)
    expect(exists(wrapper, 'ca-add')).toBe(false)
    // 行の中にボタンが無いこと（操作列そのものが無い）
    expect(rows(wrapper)[0].findAll('button')).toHaveLength(0)
  })
})
