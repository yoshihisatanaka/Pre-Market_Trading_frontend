import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { executions } from '@/mocks/fixtures/executions'
import { EXECUTIONS_PAGE_SIZE } from '@/stores/executions'
import { formatMonthDayTime, formatQuantity, formatUsd } from '@/utils/format'
import ExecutionListView from './ExecutionListView.vue'

/*
 * 画面テスト。実際の Pinia ストア + vue-router + MSW(node) を通し、
 * 4 状態の出し分け・「URL クエリが正」の単方向フロー・件数カードを検証する。
 * 期待値はフィクスチャと表示件数から導く。
 */
const PATH = '/executions'

const PAGE_SIZE = EXECUTIONS_PAGE_SIZE
const TOTAL = executions.length

/** 実 API と同じ並び（約定日時の降順。同じ日時なら ID の降順）。フィクスチャは生成順のまま */
const sortedDesc = [...executions].sort(
  (a, b) => b.約定日時.localeCompare(a.約定日時) || b.ID - a.ID,
)
const newest = sortedDesc[0]

const BUY_COUNT = executions.filter((row) => row.売買区分 === '3').length
const SELL_COUNT = executions.filter((row) => row.売買区分 === '1').length

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/** 列の位置（画面の columns の並び） */
const COL = {
  id: 0,
  orderId: 1,
  accountNumber: 2,
  ticker: 4,
  side: 5,
  price: 8,
  amountUsd: 9,
  executedAt: 10,
  status: 11,
}

/** 件数カード（testid → ラベル） */
const STATS = {
  'executions-summary-count': '総約定件数',
  'executions-summary-buy': '買い約定',
  'executions-summary-sell': '売り約定',
  'executions-summary-partial': '一部出来',
}

const errorHandler = (options) =>
  http.get(
    '*/api/executions',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )

/** 指定の行だけを返すハンドラ（集計は件数だけを数える） */
const rowsHandler = (rows) =>
  http.get('*/api/executions', () =>
    HttpResponse.json({
      total: rows.length,
      summary: {
        件数: rows.length,
        注文件数: rows.length,
        売件数: rows.filter((row) => row.売買区分 === '1').length,
        買件数: rows.filter((row) => row.売買区分 === '3').length,
      },
      executions: rows,
    }),
  )

/** 既定ハンドラに当てたまま、届いた /executions のクエリを記録する */
let requests = []
function listener({ request }) {
  const url = new URL(request.url)
  if (url.pathname === '/api/executions') requests.push(url.searchParams)
}
function recordRequests() {
  requests = []
  server.events.on('request:start', listener)
}
afterEach(() => {
  server.events.removeListener('request:start', listener)
  requests = []
})

const Page = { render: () => h('div') }

/**
 * 画面をマウントする。
 *
 * @param {{ query?: object }} [options]
 */
async function mountView({ query = {} } = {}) {
  // 実 router/index.js は createWebHistory 固定で差し替えられないため、テスト用に最小定義する
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: PATH, component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push({ path: PATH, query })

  const wrapper = mount(ExecutionListView, {
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
const exists = (wrapper, testid) => wrapper.find(`[data-testid="${testid}"]`).exists()
const cellText = (row, column) => row.findAll('td')[column].text()

/** 件数カードの値（ラベルを除いた部分） */
const statValue = (wrapper, testid) =>
  wrapper.find(`[data-testid="${testid}"]`).text().replace(STATS[testid], '').trim()

const selectedLabel = (wrapper, testid) => {
  const select = wrapper.find(`[data-testid="${testid}"]`).element
  return select.options[select.selectedIndex].text
}

// シナリオ: docs/unit/views-execution-list-view.md
describe('ExecutionListView', () => {
  it('[EXV-01] 応答を待つ間はローディングだけを出し、件数カードは — にする', async () => {
    const { wrapper } = await mountView()

    expect(exists(wrapper, 'executions-loading')).toBe(true)
    expect(exists(wrapper, 'executions-table')).toBe(false)
    expect(exists(wrapper, 'executions-empty')).toBe(false)
    expect(exists(wrapper, 'executions-error')).toBe(false)
    for (const testid of Object.keys(STATS)) {
      expect(statValue(wrapper, testid)).toBe('—')
    }

    await settle()
  })

  it('[EXV-02] 取得に失敗したときは理由と再試行を出し、件数カードは — にする', async () => {
    server.use(errorHandler())
    const { wrapper } = await mountView()
    await settle()

    const error = wrapper.find('[data-testid="executions-error"]')
    expect(error.text()).toContain(ERROR_MESSAGE)
    expect(error.find('button').text()).toBe('再試行')
    expect(exists(wrapper, 'executions-table')).toBe(false)
    for (const testid of Object.keys(STATS)) {
      expect(statValue(wrapper, testid)).toBe('—')
    }
  })

  it('[EXV-03] 0 件のときは空状態を出し、総約定件数は 0 にする', async () => {
    server.use(rowsHandler([]))
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="executions-empty"]').text()).toBe(
      '該当する約定はありません。',
    )
    expect(exists(wrapper, 'executions-table')).toBe(false)
    expect(statValue(wrapper, 'executions-summary-count')).toBe(formatQuantity(0))
  })

  it('[EXV-04] 件数と 1 ページぶんの行を出し、1 行目は最も新しい約定になる', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="executions-count"]').text()).toContain(String(TOTAL))
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)

    const first = rows(wrapper)[0]
    expect(cellText(first, COL.id)).toBe(`#${newest.ID}`)
    expect(cellText(first, COL.orderId)).toBe(`#${newest.注文ID}`)
    expect(cellText(first, COL.accountNumber)).toBe(String(newest.口座番号))
    expect(cellText(first, COL.ticker)).toBe(newest.Ticker)
  })

  it('[EXV-05] 再試行で読み直すと一覧が出る', async () => {
    // once を付けて、1 回目だけ 500・2 回目から既定ハンドラに戻す
    server.use(errorHandler({ once: true }))
    const { wrapper } = await mountView()
    await settle()

    await wrapper.find('[data-testid="executions-error"]').find('button').trigger('click')
    await settle()

    expect(exists(wrapper, 'executions-error')).toBe(false)
    expect(rows(wrapper)).toHaveLength(PAGE_SIZE)
  })

  it('[EXV-06] offset 付きで開くと 2 ページ目と範囲の表示が出る', async () => {
    const { wrapper } = await mountView({ query: { offset: String(PAGE_SIZE) } })
    await settle()

    expect(rows(wrapper)).toHaveLength(TOTAL - PAGE_SIZE)
    expect(cellText(rows(wrapper)[0], COL.id)).toBe(`#${sortedDesc[PAGE_SIZE].ID}`)
    expect(wrapper.find('[data-testid="pagination-range"]').text()).toBe(
      `${TOTAL} 件中 ${PAGE_SIZE + 1}–${TOTAL} 件`,
    )
  })

  it('[EXV-07] 銘柄コードで検索すると URL に条件が乗り、その条件で再取得される', async () => {
    const SYMBOL = newest.Ticker
    const expected = executions.filter(
      (row) => row.銘柄コード === SYMBOL || row.Ticker === SYMBOL,
    )
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(TOTAL)

    const { wrapper, router } = await mountView()
    await settle()
    recordRequests()

    await wrapper.find('[data-testid="executions-symbol"]').setValue(SYMBOL)
    await wrapper.find('[data-testid="executions-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ symbol: SYMBOL })
    expect(requests).toHaveLength(1)
    expect(requests[0].get('symbol')).toBe(SYMBOL)
    expect(rows(wrapper)).toHaveLength(expected.length)
  })

  it('[EXV-08] 選択肢に無いクエリ値は条件なしとして扱う', async () => {
    recordRequests()
    const { wrapper } = await mountView({ query: { side: 'x', status: '999', route: '9' } })
    await settle()

    expect(requests).toHaveLength(1)
    expect(requests[0].has('side')).toBe(false)
    expect(requests[0].has('status')).toBe(false)
    expect(requests[0].has('route')).toBe(false)

    for (const testid of ['executions-side', 'executions-status', 'executions-route']) {
      expect(wrapper.find(`[data-testid="${testid}"]`).element.value).toBe('')
      expect(selectedLabel(wrapper, testid)).toBe('-- 全て --')
    }
    // 条件なしなので全件が対象
    expect(wrapper.find('[data-testid="executions-count"]').text()).toContain(String(TOTAL))
  })

  it('[EXV-09] ページ幅の倍数でない offset でも落ちずにその位置から出す', async () => {
    const OFFSET = 7
    const { wrapper } = await mountView({ query: { offset: String(OFFSET) } })
    await settle()

    expect(exists(wrapper, 'executions-error')).toBe(false)
    const expected = sortedDesc.slice(OFFSET, OFFSET + PAGE_SIZE)
    expect(rows(wrapper)).toHaveLength(expected.length)
    expect(cellText(rows(wrapper)[0], COL.id)).toBe(`#${expected[0].ID}`)
  })

  it('[EXV-10] 2 ページ目で絞り込みを変えると 1 ページ目に戻る', async () => {
    const sells = sortedDesc.filter((row) => row.売買区分 === '1')
    const { wrapper, router } = await mountView({ query: { offset: String(PAGE_SIZE) } })
    await settle()

    await wrapper.find('[data-testid="executions-side"]').setValue('sell')
    await wrapper.find('[data-testid="executions-search"]').trigger('submit')
    await settle()

    expect(router.currentRoute.value.query).toEqual({ side: 'sell' })
    expect(rows(wrapper)).toHaveLength(Math.min(PAGE_SIZE, sells.length))
    expect(cellText(rows(wrapper)[0], COL.id)).toBe(`#${sells[0].ID}`)
  })

  it('[EXV-11] 出来状況は処理状況コードから名前を決め、知らないコードはサーバの名前を出す', async () => {
    const UNKNOWN_NAME = 'テスト状況'
    const codes = ['011', '010', '034', '032', '099']
    server.use(
      rowsHandler(
        codes.map((code, index) => ({
          ...newest,
          ID: index + 1,
          処理状況: code,
          処理状況名: code === '099' ? UNKNOWN_NAME : 'サーバの名前',
        })),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper).map((row) => cellText(row, COL.status))).toEqual([
      '全部出来',
      '一部出来',
      '取消済（出来有）',
      '取消済（出来有）',
      UNKNOWN_NAME,
    ])
  })

  it('[EXV-12] 売買は 買 / 売 と出し、知らないコードは — にする', async () => {
    server.use(
      rowsHandler(
        ['3', '1', '9'].map((code, index) => ({ ...newest, ID: index + 1, 売買区分: code })),
      ),
    )
    const { wrapper } = await mountView()
    await settle()

    expect(rows(wrapper).map((row) => cellText(row, COL.side))).toEqual(['買', '売', '—'])
  })

  it('[EXV-13] 件数カードに集計の値を出し、一部出来は — のまま', async () => {
    const { wrapper } = await mountView()
    await settle()

    expect(statValue(wrapper, 'executions-summary-count')).toBe(formatQuantity(TOTAL))
    expect(statValue(wrapper, 'executions-summary-buy')).toBe(formatQuantity(BUY_COUNT))
    expect(statValue(wrapper, 'executions-summary-sell')).toBe(formatQuantity(SELL_COUNT))
    expect(statValue(wrapper, 'executions-summary-partial')).toBe('—')
  })

  it('[EXV-14] 約定単価は小数第 4 位、約定代金は第 2 位の「ドル」表記、約定日時は MM/DD HH:mm で出す', async () => {
    const { wrapper } = await mountView()
    await settle()

    const first = rows(wrapper)[0]

    const price = cellText(first, COL.price)
    expect(price).toMatch(/^[\d,]+\.\d{4} ドル$/)
    expect(Number(price.replace(/[, ドル]/g, ''))).toBeCloseTo(newest.約定単価, 4)

    const amount = cellText(first, COL.amountUsd)
    expect(amount).toMatch(/^[\d,]+\.\d{2} ドル$/)
    expect(amount).toBe(formatUsd(newest.約定代金))

    const executedAt = cellText(first, COL.executedAt)
    expect(executedAt).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/)
    expect(executedAt).toBe(formatMonthDayTime(newest.約定日時))
    // 生の文字列（'YYYY-MM-DDTHH:MM:SS'）の月日・時分と一致する
    const raw = newest.約定日時
    expect(executedAt).toBe(`${raw.slice(5, 7)}/${raw.slice(8, 10)} ${raw.slice(11, 16)}`)
  })
})
