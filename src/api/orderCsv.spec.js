import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  bulkOrderCreateResponse,
  orderCsvColumnNames,
  orderCsvColumns,
  orderCsvCustomerNameOf,
  orderCsvDetailsOf,
  orderCsvSampleOrders,
  orderCsvTemplateText,
  orderCsvValidateResponse,
  orderCsvValidateWithErrorsResponse,
} from '@/mocks/fixtures/orderCsv'
import { ApiError } from './client'
import {
  bulkCreateOrders,
  fetchOrderCsvSpec,
  fetchOrderCsvTemplate,
  validateOrderCsv,
} from './orderCsv'

/*
 * API 層のテスト。CsvHeaderSpecResponse の生の形（列ごとに型が違う example / null の condition /
 * 順不同の列）がアプリ内モデルに揃うことと、テンプレートDL・事前検証・一括受付の送り方と変換を守る。
 */

const PATH = '*/api/orders/csv-spec'
const TEMPLATE_PATH = '*/api/orders/csv-template'
const VALIDATE_PATH = '*/api/orders/validate-csv'
const BULK_PATH = '*/api/orders/bulk-create'

/*
 * jsdom の FormData は MSW(node) の XHR インターセプタが Fetch の Request に変換できず、
 * POST が応答しないまま止まる。テストの間だけ Node（undici）の FormData に差し替える
 * （src/api/stalledOrders.spec.js と同じ）。
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

/** 送る File も Node の実装にする（jsdom の File を Node の FormData に積むと文字列で届く） */
const csvFile = (text, name = 'orders.csv') => new NodeFile([text], name, { type: 'text/csv' })

/** 例外を受け取る（投げられなければテストを落とす） */
async function caught(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('例外が投げられなかった')
}

/** 事前検証の応答を差し替える */
function respondValidate(body, status = 200) {
  server.use(http.post(VALIDATE_PATH, () => HttpResponse.json(body, { status })))
}

/**
 * 一括受付の本文を記録する。応答は返さず既定のハンドラに回す（MSW は何も返さないと次のハンドラへ進む）。
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

/** 生の行の data（日本語キー）から、アプリ内の注文に期待する形を作る */
const SIDE_OF = { 1: 'sell', 3: 'buy' }
const toExpectedOrder = (raw) => ({
  branchCode: raw.部店,
  accountNumber: raw.口座番号,
  symbol: raw.銘柄コード,
  side: SIDE_OF[raw.売買区分],
  quantity: raw.数量,
  orderType: raw.指成区分,
  limitPrice: raw.指値単価,
  settlementCurrency: raw.決済通貨区分,
  securitiesDelivery: raw.証券受渡方法,
  depositCategory: raw.預り売買区分,
  transactionType: raw.取引,
  solicitation: raw.勧誘区分,
  orderMethod: raw.受注方法,
  fundNature: raw.資金性格,
  cashDelivery: raw.金銭受渡方法,
  expiryDate: raw.有効期限,
  orderChannel: raw.注文チャネル,
  orderDate: raw.受注日,
  orderTime: raw.受注時刻,
  receiver: raw.受注者,
  vwap: raw.VWAP区分 === 1,
  marketScope: raw.発注範囲,
})

/** ヘッダーの列が足りない CSV（先頭 2 列だけ）と、そのとき handler が返す detail */
const SHORT_HEADER = orderCsvColumnNames.slice(0, 2)
const SHORT_HEADER_CSV = `${SHORT_HEADER.join(',')}\r\n`
const SHORT_HEADER_DETAIL = `CSVヘッダーに不足があります: 不足項目=[${orderCsvColumnNames
  .filter((name) => !SHORT_HEADER.includes(name))
  .map((name) => `'${name}'`)
  .join(', ')}]`

/** 応答を差し替える（列だけ渡せば total_columns はその件数にする） */
function respondWithColumns(columns) {
  server.use(
    http.get(PATH, () => HttpResponse.json({ total_columns: columns.length, columns })),
  )
}

// 期待値はフィクスチャから導く（22 列・列名を直接書かない）
const byIndex = [...orderCsvColumns].sort((a, b) => a.index - b.index)
const withCondition = orderCsvColumns.filter((column) => column.condition)
const typesOfExample = new Set(orderCsvColumns.map((column) => typeof column.example))
const numericExample = orderCsvColumns.find((column) => typeof column.example === 'number')

// シナリオ: docs/unit/api-order-csv.md
describe('api/orderCsv', () => {
  it('[OCA-01] 既定モックの全列を 6 つのキーだけのアプリ内モデルで返す', async () => {
    const columns = await fetchOrderCsvSpec()

    expect(columns).toHaveLength(orderCsvColumns.length)
    for (const column of columns) {
      expect(Object.keys(column).sort()).toEqual(
        ['condition', 'description', 'example', 'index', 'name', 'required'].sort(),
      )
    }
    expect(columns.map((column) => column.name)).toEqual(byIndex.map((column) => column.name))
  })

  it('[OCA-02] 列が順不同で来ても index の昇順に並べ直す', async () => {
    respondWithColumns([...orderCsvColumns].reverse())

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.index)).toEqual(byIndex.map((column) => column.index))
    expect(columns.map((column) => column.name)).toEqual(byIndex.map((column) => column.name))
  })

  it('[OCA-03] 型の違う例をすべて文字列にする', async () => {
    // 前提: フィクスチャに string 以外の例が混ざっている
    expect(typesOfExample.size).toBeGreaterThan(1)

    const columns = await fetchOrderCsvSpec()

    for (const column of columns) {
      expect(typeof column.example).toBe('string')
    }
    const expected = byIndex.map((column) => String(column.example))
    expect(columns.map((column) => column.example)).toEqual(expected)
    const numeric = columns.find((column) => column.index === numericExample.index)
    expect(numeric.example).toBe(String(numericExample.example))
  })

  it('[OCA-04] 例が null の列と、例が無い列は空文字になる', async () => {
    const [first, second] = byIndex
    const withoutExample = { ...second }
    delete withoutExample.example
    respondWithColumns([{ ...first, example: null }, withoutExample])

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.example)).toEqual(['', ''])
  })

  it('[OCA-05] condition は文言があればそのまま、null は空文字になる', async () => {
    // 前提: condition を持つ列がフィクスチャにある
    expect(withCondition.length).toBeGreaterThan(0)

    const columns = await fetchOrderCsvSpec()

    for (const column of columns) {
      const raw = orderCsvColumns.find((item) => item.index === column.index)
      expect(column.condition).toBe(raw.condition ?? '')
    }
    const conditioned = columns.filter((column) => column.condition !== '')
    expect(conditioned.map((column) => column.name)).toEqual(
      withCondition.map((column) => column.name),
    )
  })

  it('[OCA-06] required は true のときだけ必須になる', async () => {
    const [base] = byIndex
    const withoutRequired = { ...base }
    delete withoutRequired.required
    respondWithColumns([
      { ...base, index: 1, required: false },
      { ...withoutRequired, index: 2 },
      { ...base, index: 3, required: 'true' },
      { ...base, index: 4, required: 1 },
      { ...base, index: 5, required: true },
    ])

    const columns = await fetchOrderCsvSpec()

    expect(columns.map((column) => column.required)).toEqual([false, false, false, false, true])
  })

  it('[OCA-07] columns が無い応答は空配列になる', async () => {
    server.use(http.get(PATH, () => HttpResponse.json({})))

    await expect(fetchOrderCsvSpec()).resolves.toEqual([])
  })

  it('[OCA-08] 500 は detail を message に持つ ApiError になる', async () => {
    const detail = 'サーバーでエラーが発生しました。'
    server.use(http.get(PATH, () => HttpResponse.json({ detail }, { status: 500 })))

    const error = await fetchOrderCsvSpec().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe(detail)
  })

  /*
   * OCA-09（BOM 付きのバイト列がそのまま返る）は保留。MSW(node) の XHR インターセプタが
   * responseType 'blob' の本文を一度テキストに復号してから Blob を作り直すため、BOM がテストの環境で落ちる
   * （@mswjs/interceptors の XMLHttpRequest の "blob" 分岐）。製品コードの挙動とは切り分けられない。
   */

  it('[OCA-10] Content-Disposition が無いときは既定のファイル名になる', async () => {
    server.use(
      http.get(
        TEMPLATE_PATH,
        () => new HttpResponse(orderCsvTemplateText, { headers: { 'Content-Type': 'text/csv' } }),
      ),
    )

    const { filename } = await fetchOrderCsvTemplate()

    expect(filename).toBe('bulk_orders_template.csv')
  })

  it('[OCA-11] 引用符の無い filename も読む', async () => {
    server.use(
      http.get(
        TEMPLATE_PATH,
        () =>
          new HttpResponse(orderCsvTemplateText, {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': 'attachment; filename=orders.csv',
            },
          }),
      ),
    )

    const { filename } = await fetchOrderCsvTemplate()

    expect(filename).toBe('orders.csv')
  })

  it('[OCA-12] テンプレートが 500 のとき ApiError になり、detail は読めない', async () => {
    const detail = 'テンプレートを作れませんでした'
    server.use(http.get(TEMPLATE_PATH, () => HttpResponse.json({ detail }, { status: 500 })))

    const error = await caught(fetchOrderCsvTemplate())

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
    // 本文が Blob で来るので detail を取り出せず、status 既定の文言になる（今の仕様を固定する）
    expect(error.message).not.toBe(detail)
    expect(error.message).toBe('サーバーでエラーが発生しました。')
  })

  it('[OCA-13] テンプレートの CSV を multipart で送り、行を camelCase の注文で返す', async () => {
    let received = null
    server.use(
      http.post(VALIDATE_PATH, async ({ request }) => {
        const form = await request.clone().formData()
        const file = form.get('file')
        received = {
          contentType: request.headers.get('content-type') ?? '',
          name: typeof file === 'string' ? null : file?.name,
        }
      }),
    )

    const result = await validateOrderCsv(csvFile(orderCsvTemplateText, 'template.csv'))

    expect(received.contentType).toMatch(/^multipart\/form-data/)
    expect(received.name).toBe('template.csv')
    expect(result.totalCount).toBe(orderCsvValidateResponse.total_count)
    expect(result.validCount).toBe(orderCsvValidateResponse.valid_count)
    expect(result.invalidCount).toBe(orderCsvValidateResponse.invalid_count)
    expect(result.allValid).toBe(orderCsvValidateResponse.all_valid)
    expect(result.hasError).toBe(orderCsvValidateResponse.has_error)
    expect(result.rows.map((row) => row.rowNumber)).toEqual(
      orderCsvSampleOrders.map((_, index) => index + 2),
    )
    result.rows.forEach((row, index) => {
      const raw = orderCsvSampleOrders[index]
      expect(row.valid).toBe(true)
      expect(row.order).toEqual(toExpectedOrder(raw))
      expect(row.customerName).toBe(orderCsvCustomerNameOf(raw))
      expect(row.stockName).toBe(orderCsvDetailsOf(raw).stock_name)
    })
    // 前提: フィクスチャに成行・売・買の行がある。成行の指値単価は null のまま
    const market = result.rows.find((row) => row.order.orderType === 'MO')
    expect(market.order.limitPrice).toBeNull()
    expect(new Set(result.rows.map((row) => row.order.side))).toEqual(new Set(['buy', 'sell']))
    expect(result.rows.every((row) => typeof row.order.vwap === 'boolean')).toBe(true)
  })

  it('[OCA-14] 行のエラーと警告はそのまま返り、引けなかった名前は空文字になる', async () => {
    respondValidate(orderCsvValidateWithErrorsResponse)

    const result = await validateOrderCsv(csvFile('x'))

    result.rows.forEach((row, index) => {
      const raw = orderCsvValidateWithErrorsResponse.rows[index]
      expect(row.errors).toEqual(raw.errors)
      expect(row.warnings).toEqual(raw.warnings)
      expect(row.valid).toBe(raw.valid)
      expect(row.stockName).toBe(raw.details?.stock_name ?? '')
      expect(row.customerName).toBe(raw.customer_name ?? '')
    })
    // 前提: details と customer_name が null の行がある
    const unresolved = result.rows.filter(
      (_, index) => orderCsvValidateWithErrorsResponse.rows[index].details === null,
    )
    expect(unresolved.length).toBeGreaterThan(0)
    for (const row of unresolved) {
      expect(row.stockName).toBe('')
      expect(row.customerName).toBe('')
    }
  })

  it('[OCA-15] 欠けた値や知らない値は正常や片方の向きに倒さない', async () => {
    const [base] = orderCsvValidateResponse.rows
    const withoutValid = { ...base }
    delete withoutValid.valid
    const unknownSide = { ...base, data: { ...base.data, 売買区分: '9' } }
    const withoutRowNumber = { ...base }
    delete withoutRowNumber.row_number
    respondValidate({
      total_count: 1.5,
      valid_count: '3',
      invalid_count: null,
      all_valid: false,
      has_error: false,
      rows: [withoutValid, unknownSide, withoutRowNumber],
    })

    const result = await validateOrderCsv(csvFile('x'))

    expect(result.rows[0].valid).toBe(false)
    expect(result.rows[1].order.side).toBe('')
    expect(result.rows[2].rowNumber).toBeNull()
    expect([result.totalCount, result.validCount, result.invalidCount]).toEqual([0, 0, 0])
  })

  it('[OCA-16] ヘッダーの列が足りない CSV は detail を持つ 400 の ApiError になる', async () => {
    const error = await caught(validateOrderCsv(csvFile(SHORT_HEADER_CSV)))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: SHORT_HEADER_DETAIL })
  })

  it('[OCA-17] file が無いと 422 の ApiError になる', async () => {
    const error = await caught(validateOrderCsv(undefined))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
  })

  it('[OCA-18] 事前検証の注文を作成者付きの元の形で送り、採番を文字列で返す', async () => {
    const CREATED_BY = 'operator-x'
    const validation = await validateOrderCsv(csvFile(orderCsvTemplateText))
    const bodies = recordBulk()

    const result = await bulkCreateOrders(
      validation.rows.map((row) => row.order),
      { createdBy: CREATED_BY },
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0].orders).toEqual(
      orderCsvSampleOrders.map((order) => ({ ...order, 作成者: CREATED_BY })),
    )
    expect(result.orderIds).toEqual(bulkOrderCreateResponse.order_ids.map(String))
    expect(result.totalOrders).toBe(bulkOrderCreateResponse.total_orders)
    expect(result.message).toBe(bulkOrderCreateResponse.message)
  })

  it('[OCA-19] createdBy を渡さなければ作成者は空文字で届き、422 にならない', async () => {
    const validation = await validateOrderCsv(csvFile(orderCsvTemplateText))
    const bodies = recordBulk()

    const result = await bulkCreateOrders(validation.rows.map((row) => row.order))

    expect(bodies[0].orders.map((order) => order.作成者)).toEqual(
      orderCsvSampleOrders.map(() => ''),
    )
    expect(result.totalOrders).toBe(orderCsvSampleOrders.length)
  })

  it('[OCA-20] 空の注文は detail を持つ 400 の ApiError になる', async () => {
    const error = await caught(bulkCreateOrders([]))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: '登録対象の注文データが空です' })
  })

  it('[OCA-21] 一括受付が 422 のとき ApiError になる', async () => {
    const validation = await validateOrderCsv(csvFile(orderCsvTemplateText))
    server.use(
      http.post(BULK_PATH, () =>
        HttpResponse.json(
          { detail: [{ loc: ['body', 'orders', 0, '作成者'], msg: 'Field required', type: 'missing' }] },
          { status: 422 },
        ),
      ),
    )

    const error = await caught(bulkCreateOrders(validation.rows.map((row) => row.order)))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
  })
})
