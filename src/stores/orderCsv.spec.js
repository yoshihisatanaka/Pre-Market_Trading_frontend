import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderCsvColumns } from '@/mocks/fixtures/orderCsv'
import { useOrderCsvStore } from './orderCsv'

const PATH = '*/api/orders/csv-spec'
const DETAIL = 'サーバーでエラーが発生しました。'

// 期待値はフィクスチャから導く（22 列・先頭の列名を直接書かない）
const byIndex = [...orderCsvColumns].sort((a, b) => a.index - b.index)
const names = (columns) => columns.map((column) => column.name)

const errorHandler = () => http.get(PATH, () => HttpResponse.json({ detail: DETAIL }, { status: 500 }))
const emptyHandler = () => http.get(PATH, () => HttpResponse.json({ total_columns: 0, columns: [] }))

/**
 * 取得を握るハンドラ。release() を呼ぶまで応答しない。
 * @returns {() => void}
 */
function holdHandler() {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.get(PATH, async () => {
      await gate
      return HttpResponse.json({ total_columns: 0, columns: [] })
    }),
  )
  return release
}

// シナリオ: docs/unit/stores-order-csv.md
describe('stores/orderCsv', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('[OCS-01] 読み込み前は列が空で、ローディングもエラーも無い', () => {
    const store = useOrderCsvStore()

    expect(store.columns).toEqual([])
    expect(store.columnsLoading).toBe(false)
    expect(store.columnsError).toBeNull()
  })

  it('[OCS-02] 既定モックの全列を index 順に読み込む', async () => {
    const store = useOrderCsvStore()

    await store.loadColumns()

    expect(store.columns).toHaveLength(orderCsvColumns.length)
    expect(store.columns[0].name).toBe(byIndex[0].name)
    expect(names(store.columns)).toEqual(names(byIndex))
    expect(store.columnsLoading).toBe(false)
    expect(store.columnsError).toBeNull()
    expect(store.isColumnsEmpty).toBe(false)
  })

  it('[OCS-03] 読み込み中は columnsLoading が true で、空とはみなさない', async () => {
    const release = holdHandler()
    const store = useOrderCsvStore()

    const pending = store.loadColumns()

    expect(store.columnsLoading).toBe(true)
    expect(store.isColumnsEmpty).toBe(false)

    release()
    await pending
  })

  it('[OCS-04] API が 500 のとき columnsError に理由が入り、空とはみなさない', async () => {
    server.use(errorHandler())
    const store = useOrderCsvStore()

    await store.loadColumns()

    expect(store.columnsError).toBeInstanceOf(Error)
    expect(store.columnsError.message).toBe(DETAIL)
    expect(store.columns).toEqual([])
    expect(store.columnsLoading).toBe(false)
    expect(store.isColumnsEmpty).toBe(false)
  })

  it('[OCS-05] 0 列の応答で isColumnsEmpty が true になる', async () => {
    server.use(emptyHandler())
    const store = useOrderCsvStore()

    await store.loadColumns()

    expect(store.isColumnsEmpty).toBe(true)
  })

  it('[OCS-06] エラーのあと読み直すとエラーが消えて全列が入る', async () => {
    server.use(errorHandler())
    const store = useOrderCsvStore()
    await store.loadColumns()
    expect(store.columnsError).not.toBeNull()

    server.resetHandlers()
    await store.loadColumns()

    expect(store.columnsError).toBeNull()
    expect(names(store.columns)).toEqual(names(byIndex))
  })
})
