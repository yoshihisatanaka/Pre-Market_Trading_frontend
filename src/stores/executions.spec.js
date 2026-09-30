import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { executions } from '@/mocks/fixtures/executions'
import { EXECUTIONS_CSV_FILENAME } from '@/api/executions'
import { EXECUTIONS_PAGE_SIZE, useExecutionsStore } from './executions'

/*
 * 既定の MSW ハンドラ（実 API と同じ絞り込み・並び順・集計）に当てる。
 * 期待値はフィクスチャと表示件数から導き、56 / 50 のような数値を直接書かない。
 */

const PAGE_SIZE = EXECUTIONS_PAGE_SIZE
const TOTAL = executions.length

/** 売買区分のコード（生の形）ごとの件数 */
const countBySide = (code) => executions.filter((row) => row.売買区分 === code).length
const SELL_COUNT = countBySide('1')

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

/**
 * 売買区分ごとに待ち時間を変えて返す差し替え。
 * 集計は件数・売件数・買件数だけを、その条件の行から数える。
 *
 * @param {(side: string) => number} waitFor side（コード）に対する待ち時間（ミリ秒）
 */
function slowBySide(waitFor) {
  server.use(
    http.get('*/api/executions', async ({ request }) => {
      const side = new URL(request.url).searchParams.get('side') ?? ''
      await delay(waitFor(side))
      const rows = executions.filter((row) => !side || row.売買区分 === side)
      return HttpResponse.json({
        total: rows.length,
        summary: {
          件数: rows.length,
          売件数: rows.filter((row) => row.売買区分 === '1').length,
          買件数: rows.filter((row) => row.売買区分 === '3').length,
        },
        executions: rows.slice(0, PAGE_SIZE),
      })
    }),
  )
}

const EXPORT_PATH = '*/api/executions/export-csv'

const exportErrorHandler = () =>
  http.get(EXPORT_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))

/** 既定ハンドラに当てたまま、届いた /executions/export-csv のクエリを記録する */
let exportRequests = []
function exportListener({ request }) {
  const url = new URL(request.url)
  if (url.pathname === '/api/executions/export-csv') exportRequests.push(url.searchParams)
}
function recordExport() {
  exportRequests = []
  server.events.on('request:start', exportListener)
}
afterEach(() => {
  server.events.removeListener('request:start', exportListener)
  exportRequests = []
})

// シナリオ: docs/unit/stores-executions.md
describe('stores/executions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[EXS-01] 既定の読み込みで 1 ページ目と条件全体の集計が入る', async () => {
    const store = useExecutionsStore()

    await store.load()

    // 1 ページに収まってしまうとページングを検証できない
    expect(TOTAL).toBeGreaterThan(PAGE_SIZE)
    expect(store.items).toHaveLength(PAGE_SIZE)
    expect(store.total).toBe(TOTAL)
    expect(store.summary.count).toBe(TOTAL)
  })

  it('[EXS-02] 2 ページ目を読んでも集計はページではなく条件全体のまま', async () => {
    const store = useExecutionsStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.items).toHaveLength(TOTAL - PAGE_SIZE)
    expect(store.summary.count).toBe(TOTAL)
  })

  it('[EXS-03] 売買区分で絞り込むと集計もその条件の値になる', async () => {
    const store = useExecutionsStore()

    await store.load({ side: 'sell' })

    expect(SELL_COUNT).toBeGreaterThan(0)
    expect(store.side).toBe('sell')
    expect(store.total).toBe(SELL_COUNT)
    expect(store.items.every((item) => item.side === 'sell')).toBe(true)
    expect(store.summary.sellCount).toBe(store.total)
    expect(store.summary.buyCount).toBe(0)
  })

  it('[EXS-04] 取得に失敗したときは error に入り、loading が戻る', async () => {
    server.use(
      http.get('*/api/executions', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const store = useExecutionsStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('[EXS-05] 0 件の応答では空とみなし、集計は 0 件になる', async () => {
    server.use(
      http.get('*/api/executions', () =>
        HttpResponse.json({
          total: 0,
          summary: { 件数: 0, 注文件数: 0, 売件数: 0, 買件数: 0 },
          executions: [],
        }),
      ),
    )
    const store = useExecutionsStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
    expect(store.summary.count).toBe(0)
  })

  it('[EXS-06] 遅れて届いた古い応答の集計で上書きしない', async () => {
    // 先に投げる買い（3）を遅く、後から投げる売り（1）を速く返す
    slowBySide((side) => (side === '3' ? 60 : 10))
    const store = useExecutionsStore()

    const stale = store.load({ side: 'buy' })
    const latest = store.load({ side: 'sell' })
    await Promise.all([stale, latest])

    expect(store.summary.count).toBe(SELL_COUNT)
    expect(store.summary.sellCount).toBe(SELL_COUNT)
    expect(store.summary.buyCount).toBe(0)
  })

  it('[EXS-07] 1 度も読み込んでいなければ集計は null', () => {
    const store = useExecutionsStore()

    expect(store.summary).toBeNull()
  })

  it('[EXS-08] 最後に読んだ条件で CSV を取り、ページ位置は送らない', async () => {
    const SYMBOL = executions.find((row) => row.売買区分 === '1').Ticker
    recordExport()
    const store = useExecutionsStore()

    await store.load({ side: 'sell', symbol: SYMBOL, offset: PAGE_SIZE })
    const file = await store.exportCsv()

    expect(exportRequests).toHaveLength(1)
    expect(exportRequests[0].get('side')).toBe('1')
    expect(exportRequests[0].get('symbol')).toBe(SYMBOL)
    expect(exportRequests[0].has('limit')).toBe(false)
    expect(exportRequests[0].has('offset')).toBe(false)
    expect(Object.prototype.toString.call(file.blob)).toBe('[object Blob]')
    expect(file.filename).toBe(EXECUTIONS_CSV_FILENAME)
  })

  it('[EXS-09] 読み直したあとは新しい条件で CSV を取る', async () => {
    const SYMBOL = executions.find((row) => row.売買区分 === '1').Ticker
    recordExport()
    const store = useExecutionsStore()

    await store.load({ side: 'sell', symbol: SYMBOL })
    await store.load({ side: 'buy' })
    await store.exportCsv()

    expect(exportRequests).toHaveLength(1)
    expect(exportRequests[0].get('side')).toBe('3')
    expect(exportRequests[0].has('symbol')).toBe(false)
  })

  it('[EXS-10] CSV の取得に失敗したら null を返し、一覧の状態は変えない', async () => {
    server.use(exportErrorHandler())
    const store = useExecutionsStore()

    await store.load()
    const file = await store.exportCsv()

    expect(file).toBeNull()
    expect(store.exportError?.message).toBe(ERROR_MESSAGE)
    expect(store.error).toBeNull()
    expect(store.items).toHaveLength(PAGE_SIZE)
    expect(store.exporting).toBe(false)
  })

  it('[EXS-11] 出力中は exporting が立ち、一覧の loading とは独立する', async () => {
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    server.use(
      http.get(EXPORT_PATH, async () => {
        await held
        return new HttpResponse('a\r\n', { headers: { 'Content-Type': 'text/csv' } })
      }),
    )
    const store = useExecutionsStore()
    await store.load()

    const pending = store.exportCsv()

    expect(store.exporting).toBe(true)
    expect(store.loading).toBe(false)

    release()
    await pending

    expect(store.exporting).toBe(false)
  })

  it('[EXS-12] clearExportError で出力の失敗だけを消す', async () => {
    server.use(exportErrorHandler())
    const store = useExecutionsStore()
    await store.load()
    await store.exportCsv()
    const itemsBefore = store.items

    store.clearExportError()

    expect(store.exportError).toBeNull()
    expect(store.error).toBeNull()
    expect(store.items).toBe(itemsBefore)
  })
})
