import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { mizuhoExecutions } from '@/mocks/fixtures/mizuhoExecutions'
import { EXECUTIONS_CSV_FILENAME } from '@/api/executions'
import { MIZUHO_EXECUTIONS_PAGE_SIZE, useMizuhoExecutionsStore } from './mizuhoExecutions'

/*
 * 既定の MSW ハンドラ（src/mocks/handlers/mizuhoExecutions.js）に当てる。
 * 期待値はフィクスチャから導き、12 / 7 / 5 のような件数を直接書かない。
 */
const EXECUTIONS_PATH = '*/api/executions'
const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const SELL = '1'
const BUY = '3'
const PARTIAL_CODE = '010'

const countOf = (predicate) => mizuhoExecutions.filter(predicate).length
const idsOf = (predicate) => mizuhoExecutions.filter(predicate).map((row) => String(row.ID))

/** 行の集合から期待する集計を作る（件数カードの 4 つ。一部出来は注文 ID で数える） */
const summaryOf = (predicate) => ({
  executionCount: countOf(predicate),
  buyCount: countOf((row) => predicate(row) && row.売買区分 === BUY),
  sellCount: countOf((row) => predicate(row) && row.売買区分 === SELL),
  partialCount: new Set(
    mizuhoExecutions
      .filter((row) => predicate(row) && row.処理状況 === PARTIAL_CODE)
      .map((row) => row.注文ID),
  ).size,
})

const all = () => true
const idsIn = (store) => store.items.map((item) => item.id)

const EXPORT_PATH = '*/api/executions/export-csv'
const SELL_TICKER = mizuhoExecutions.find((row) => row.売買区分 === SELL).Ticker

const exportErrorHandler = () =>
  http.get(EXPORT_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }))

/** CSV 出力に届いたクエリを記録し、既定ハンドラへ落とすハンドラを立てる */
function recordExport() {
  const requests = []
  server.use(
    http.get(EXPORT_PATH, ({ request }) => {
      requests.push(new URL(request.url).searchParams)
    }),
  )
  return requests
}

/**
 * 売買区分ごとに応答を止められるハンドラ。release(side) を呼ぶまで返さない。
 * 集計はその売買区分の件数だけを載せ、どちらの応答が採られたかを見分けられるようにする。
 */
function gatedBySide() {
  const gates = {}
  server.use(
    http.get(EXECUTIONS_PATH, async ({ request }) => {
      const side = new URL(request.url).searchParams.get('side')
      await new Promise((resolve) => (gates[side] = resolve))
      const rows = mizuhoExecutions.filter((row) => row.売買区分 === side)
      return HttpResponse.json({
        total: rows.length,
        executions: rows,
        summary: {
          件数: rows.length,
          買件数: side === BUY ? rows.length : 0,
          売件数: side === SELL ? rows.length : 0,
          一部出来件数: new Set(
            rows.filter((row) => row.処理状況 === PARTIAL_CODE).map((row) => row.注文ID),
          ).size,
        },
      })
    }),
  )
  return {
    async release(side) {
      await vi.waitFor(() => expect(gates[side]).toBeTypeOf('function'))
      gates[side]()
    },
  }
}

// シナリオ: docs/unit/stores-mizuho-executions.md
describe('stores/mizuhoExecutions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('[MZS-01] 既定の読み込みで全件と件数カードの集計が入る', async () => {
    const store = useMizuhoExecutionsStore()

    await store.load()

    expect(store.items).toHaveLength(mizuhoExecutions.length)
    expect(store.total).toBe(mizuhoExecutions.length)
    expect(store.summary).toEqual(summaryOf(all))
    // 買と売の両方が無いと集計の検証にならない
    expect(store.summary.buyCount).toBeGreaterThan(0)
    expect(store.summary.sellCount).toBeGreaterThan(0)
  })

  it('[MZS-02] 売買区分で絞ると一覧も集計も売の行だけになる', async () => {
    const isSell = (row) => row.売買区分 === SELL
    const store = useMizuhoExecutionsStore()

    await store.load({ side: SELL })

    expect(idsIn(store)).toEqual(idsOf(isSell))
    expect(store.summary).toEqual(summaryOf(isSell))
    expect(store.summary.buyCount).toBe(0)
  })

  it('[MZS-03] 出来状況 010（一部出来）で一部出来の行だけになる', async () => {
    const isPartial = (row) => row.処理状況 === PARTIAL_CODE
    const store = useMizuhoExecutionsStore()

    await store.load({ fillStatus: PARTIAL_CODE })

    expect(idsIn(store)).toEqual(idsOf(isPartial))
    expect(store.items.length).toBeGreaterThan(0)
    expect(store.items.every((item) => item.fillStatus === 'partial')).toBe(true)
  })

  it('[MZS-04] 500 なら error に理由が入り、items は空で loading は戻る', async () => {
    server.use(
      http.get(EXECUTIONS_PATH, () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 })),
    )
    const store = useMizuhoExecutionsStore()

    await store.load()

    expect(store.error?.message).toBe(ERROR_MESSAGE)
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('[MZS-05] 0 件の応答は空とみなし、集計も 0 件になる', async () => {
    server.use(
      http.get(EXECUTIONS_PATH, () =>
        HttpResponse.json({
          total: 0,
          executions: [],
          summary: { 件数: 0, 買件数: 0, 売件数: 0 },
        }),
      ),
    )
    const store = useMizuhoExecutionsStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
    expect(store.summary).toEqual({
      executionCount: 0,
      buyCount: 0,
      sellCount: 0,
      partialCount: 0,
    })
  })

  it('[MZS-06] 先に出した要求の応答が後から返っても、集計は最後の要求の値のまま', async () => {
    const gate = gatedBySide()
    const store = useMizuhoExecutionsStore()

    const stale = store.load({ side: SELL })
    const latest = store.load({ side: BUY })

    await gate.release(BUY)
    await latest
    const expected = summaryOf((row) => row.売買区分 === BUY)
    expect(store.summary).toEqual(expected)

    await gate.release(SELL)
    await stale

    expect(store.summary).toEqual(expected)
    expect(idsIn(store)).toEqual(idsOf((row) => row.売買区分 === BUY))
  })

  it('[MZS-07] 最後に読んだ条件で CSV を取り、route=0 を載せてページ位置は送らない', async () => {
    const requests = recordExport()
    const store = useMizuhoExecutionsStore()

    await store.load({ side: SELL, symbol: SELL_TICKER, offset: MIZUHO_EXECUTIONS_PAGE_SIZE })
    const file = await store.exportCsv()

    expect(requests).toHaveLength(1)
    expect(requests[0].get('route')).toBe('0')
    expect(requests[0].get('side')).toBe(SELL)
    expect(requests[0].get('symbol')).toBe(SELL_TICKER)
    expect(requests[0].has('limit')).toBe(false)
    expect(requests[0].has('offset')).toBe(false)
    expect(Object.prototype.toString.call(file.blob)).toBe('[object Blob]')
    expect(file.filename).toBe(EXECUTIONS_CSV_FILENAME)
  })

  it('[MZS-08] 読み直したあとは新しい条件で CSV を取る', async () => {
    const requests = recordExport()
    const store = useMizuhoExecutionsStore()

    await store.load({ side: SELL, symbol: SELL_TICKER })
    await store.load({ side: BUY })
    await store.exportCsv()

    expect(requests).toHaveLength(1)
    expect(requests[0].get('side')).toBe(BUY)
    expect(requests[0].has('symbol')).toBe(false)
  })

  it('[MZS-09] CSV の取得に失敗したら null を返し、exportError だけに理由が入る', async () => {
    server.use(exportErrorHandler())
    const store = useMizuhoExecutionsStore()
    await store.load()

    const file = await store.exportCsv()

    expect(file).toBeNull()
    expect(store.exportError?.message).toBe(ERROR_MESSAGE)
    expect(store.error).toBeNull()
    expect(store.items).toHaveLength(mizuhoExecutions.length)
    expect(store.exporting).toBe(false)
  })

  it('[MZS-10] 出力中は exporting が立ち、一覧の loading とは独立する', async () => {
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
    const store = useMizuhoExecutionsStore()
    await store.load()

    const pending = store.exportCsv()

    expect(store.exporting).toBe(true)
    expect(store.loading).toBe(false)

    release()
    await pending

    expect(store.exporting).toBe(false)
  })

  it('[MZS-11] clearExportError で出力の失敗だけを消す', async () => {
    server.use(exportErrorHandler())
    const store = useMizuhoExecutionsStore()
    await store.load()
    await store.exportCsv()
    expect(store.exportError).not.toBeNull()
    const itemsBefore = store.items

    store.clearExportError()

    expect(store.exportError).toBeNull()
    expect(store.error).toBeNull()
    expect(store.items).toBe(itemsBefore)
  })
})
