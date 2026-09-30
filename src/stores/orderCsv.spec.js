import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { supervisorOperator } from '@/mocks/fixtures/currentOperator'
import {
  BULK_ORDER_FIRST_ID,
  ORDER_CSV_TEMPLATE_FILENAME,
  bulkOrderCreateResponse,
  orderCsvColumnNames,
  orderCsvColumns,
  orderCsvSampleOrders,
  orderCsvTemplateText,
  orderCsvValidateResponse,
  orderCsvValidateWithErrorsResponse,
} from '@/mocks/fixtures/orderCsv'
import { useOrderCsvStore } from './orderCsv'

const PATH = '*/api/orders/csv-spec'
const TEMPLATE_PATH = '*/api/orders/csv-template'
const VALIDATE_PATH = '*/api/orders/validate-csv'
const BULK_PATH = '*/api/orders/bulk-create'
const DETAIL = 'サーバーでエラーが発生しました。'

/*
 * 事前検証は multipart。jsdom の FormData は MSW(node) を通らないので、テストの間だけ
 * Node（undici）の FormData に差し替え、File も Node の実装にする（src/api/stalledOrders.spec.js と同じ）。
 */
let NodeFormData = null

beforeAll(async () => {
  const response = new Response('', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  NodeFormData = (await response.formData()).constructor
})

beforeEach(() => {
  vi.stubGlobal('FormData', NodeFormData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const csvFile = (text, name = 'orders.csv') => new NodeFile([text], name, { type: 'text/csv' })
const templateFile = () => csvFile(orderCsvTemplateText)

/** ヘッダーの列が足りない CSV（先頭 2 列だけ）と、そのとき handler が返す detail */
const SHORT_HEADER = orderCsvColumnNames.slice(0, 2)
const shortHeaderFile = () => csvFile(`${SHORT_HEADER.join(',')}\r\n`)
const SHORT_HEADER_DETAIL = `CSVヘッダーに不足があります: 不足項目=[${orderCsvColumnNames
  .filter((name) => !SHORT_HEADER.includes(name))
  .map((name) => `'${name}'`)
  .join(', ')}]`

/**
 * 応答を握るハンドラ。release() を呼ぶまで応答せず、そのあと既定のハンドラに回す。
 * @returns {() => void}
 */
function holdPost(path) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  server.use(
    http.post(path, async () => {
      await gate
    }),
  )
  return release
}

/**
 * 一括受付の本文を記録する。応答は返さず既定のハンドラに回す。
 * @returns {object[]} 届いた本文の配列
 */
function recordBulk() {
  const bodies = []
  server.use(
    http.post(BULK_PATH, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

const bulkErrorHandler = () =>
  http.post(BULK_PATH, () => HttpResponse.json({ detail: DETAIL }, { status: 500 }))

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

  it('[OCS-07] 作った直後は結果が無く、どの処理も動いていない', () => {
    const store = useOrderCsvStore()

    expect(store.validation).toBeNull()
    expect(store.completion).toBeNull()
    expect(store.canSubmit).toBe(false)
    expect(store.validating).toBe(false)
    expect(store.submitting).toBe(false)
    expect(store.templateLoading).toBe(false)
  })

  it('[OCS-08] テンプレートを Blob とファイル名で返す', async () => {
    const store = useOrderCsvStore()

    const template = await store.downloadTemplate()

    expect(template.blob).toBeInstanceOf(Blob)
    expect(template.filename).toBe(ORDER_CSV_TEMPLATE_FILENAME)
    expect(store.templateError).toBeNull()
  })

  it('[OCS-09] テンプレートが 500 のとき null を返し、templateError に理由が入る', async () => {
    server.use(http.get(TEMPLATE_PATH, () => HttpResponse.json({ detail: DETAIL }, { status: 500 })))
    const store = useOrderCsvStore()

    const template = await store.downloadTemplate()

    expect(template).toBeNull()
    expect(store.templateError).toBeInstanceOf(Error)
    expect(store.templateError.status).toBe(500)
  })

  it('[OCS-10] テンプレートの CSV を検証すると件数が入り、受付できる', async () => {
    const store = useOrderCsvStore()

    const result = await store.validateFile(templateFile())

    expect(result).not.toBeNull()
    expect(store.validation.totalCount).toBe(orderCsvValidateResponse.total_count)
    expect(store.validation.validCount).toBe(orderCsvValidateResponse.valid_count)
    expect(store.validation.invalidCount).toBe(orderCsvValidateResponse.invalid_count)
    expect(store.validation.rows).toHaveLength(orderCsvSampleOrders.length)
    expect(store.canSubmit).toBe(true)
  })

  it('[OCS-11] NG 行を含む結果では受付できず、一括受付は送らない', async () => {
    server.use(http.post(VALIDATE_PATH, () => HttpResponse.json(orderCsvValidateWithErrorsResponse)))
    const bodies = recordBulk()
    const store = useOrderCsvStore()
    await store.validateFile(templateFile())

    expect(store.canSubmit).toBe(false)
    await expect(store.submitOrders()).resolves.toBe(false)
    expect(bodies).toHaveLength(0)
  })

  it('[OCS-12] 事前検証の応答を待つ間は validating が true', async () => {
    const release = holdPost(VALIDATE_PATH)
    const store = useOrderCsvStore()

    const pending = store.validateFile(templateFile())

    expect(store.validating).toBe(true)

    release()
    await pending
    expect(store.validating).toBe(false)
  })

  it('[OCS-13] 400 になるファイルを検証すると前回の結果を残さず、理由が入る', async () => {
    const store = useOrderCsvStore()
    await store.validateFile(templateFile())
    expect(store.validation).not.toBeNull()

    const result = await store.validateFile(shortHeaderFile())

    expect(result).toBeNull()
    expect(store.validation).toBeNull()
    expect(store.validationError.message).toBe(SHORT_HEADER_DETAIL)
  })

  it('[OCS-14] 検証し直すと前回の受付のエラーが消える', async () => {
    server.use(bulkErrorHandler())
    const store = useOrderCsvStore()
    await store.validateFile(templateFile())
    await store.submitOrders()
    expect(store.submitError).not.toBeNull()

    await store.validateFile(templateFile())

    expect(store.submitError).toBeNull()
  })

  it('[OCS-15] 受付に成功すると採番付きの completion が入り、validation は空になる', async () => {
    const bodies = recordBulk()
    const store = useOrderCsvStore()
    await store.validateFile(templateFile())
    const validatedRows = store.validation.rows

    const accepted = await store.submitOrders()

    expect(accepted).toBe(true)
    expect(Object.keys(store.completion).sort()).toEqual(['message', 'rows', 'totalOrders'])
    expect(store.completion.totalOrders).toBe(bulkOrderCreateResponse.total_orders)
    expect(store.completion.message).toBe(bulkOrderCreateResponse.message)
    expect(store.completion.rows).toEqual(
      validatedRows.map((row, index) => ({ ...row, orderId: String(BULK_ORDER_FIRST_ID + index) })),
    )
    expect(store.validation).toBeNull()
    expect(bodies[0].orders.map((order) => order.作成者)).toEqual(
      orderCsvSampleOrders.map(() => supervisorOperator.操作者コード),
    )
  })

  it('[OCS-16] 一括受付が 500 のとき false を返し、結果を残したまま理由が入る', async () => {
    server.use(bulkErrorHandler())
    const store = useOrderCsvStore()
    await store.validateFile(templateFile())

    const accepted = await store.submitOrders()

    expect(accepted).toBe(false)
    expect(store.submitError).toBeInstanceOf(Error)
    expect(store.submitError.message).toBe(DETAIL)
    expect(store.validation).not.toBeNull()
    expect(store.completion).toBeNull()
  })

  it('[OCS-17] 受付の応答を待つ間は送り直せない', async () => {
    const bodies = recordBulk()
    const release = holdPost(BULK_PATH)
    const store = useOrderCsvStore()
    await store.validateFile(templateFile())

    const first = store.submitOrders()

    expect(store.submitting).toBe(true)
    expect(store.canSubmit).toBe(false)
    await expect(store.submitOrders()).resolves.toBe(false)

    release()
    await expect(first).resolves.toBe(true)
    expect(bodies).toHaveLength(1)
  })

  it('[OCS-18] 検証結果が無いと受付は送らない', async () => {
    const bodies = recordBulk()
    const store = useOrderCsvStore()

    await expect(store.submitOrders()).resolves.toBe(false)
    expect(bodies).toHaveLength(0)
  })

  it('[OCS-19] clearUploadErrors でテンプレートと検証のエラーが消える', async () => {
    server.use(http.get(TEMPLATE_PATH, () => HttpResponse.json({ detail: DETAIL }, { status: 500 })))
    const store = useOrderCsvStore()
    await store.downloadTemplate()
    await store.validateFile(shortHeaderFile())
    expect(store.templateError).not.toBeNull()
    expect(store.validationError).not.toBeNull()

    store.clearUploadErrors()

    expect(store.templateError).toBeNull()
    expect(store.validationError).toBeNull()
  })

  it('[OCS-20] clearSubmitError で受付のエラーが消える', async () => {
    server.use(bulkErrorHandler())
    const store = useOrderCsvStore()
    await store.validateFile(templateFile())
    await store.submitOrders()
    expect(store.submitError).not.toBeNull()

    store.clearSubmitError()

    expect(store.submitError).toBeNull()
  })

  it('[OCS-21] clearCompletion で受付の結果が消える', async () => {
    const store = useOrderCsvStore()
    await store.validateFile(templateFile())
    await store.submitOrders()
    expect(store.completion).not.toBeNull()

    store.clearCompletion()

    expect(store.completion).toBeNull()
  })
})
