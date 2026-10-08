import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { ApiError } from './client'
import { fetchStalledOrders, importConfirmationCsv } from './stalledOrders'

/*
 * API 層のテスト。注文照会と共用の `GET /orders`（OrderItemResponse の生の形）を処理状況で
 * 2 本引いてアプリ内モデルへ畳む変換と、コンファメーション CSV の取込の送り方・応答の変換を固定する。
 * 期待値はフィクスチャ（バックエンドが返す生の形）から導く。
 */

const LIST_PATH = '*/api/orders'
const IMPORT_PATH = '*/api/operations/stalled-orders/confirmation-import'

/** 注文エラー（Dream発注失敗 / IB発注失敗）と注文中の処理状況。送る status の値でもある */
const ERROR_STATUSES = ['101', '103']
const WORKING_STATUS = '003'
const PAGE_SIZE = 200

/*
 * jsdom の FormData は MSW(node) の XHR インターセプタが Fetch の Request に変換できず、
 * POST が応答しないまま止まる（2026-09-28 に確認）。テストの間だけ、グローバルの FormData を
 * Node（undici）の実装に差し替える。Node の Response から formData() で取り出すと
 * import なしで同じ実装が手に入る（jsdom 環境でも Response は Node のもの）。
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

/** 届いた一覧のリクエストのクエリ（届いた順） */
let listQueries = []

afterEach(() => {
  listQueries = []
  vi.unstubAllGlobals()
})

const byIdDesc = (a, b) => b.ID - a.ID
const errorRows = orderInquiryRows.filter((row) => ERROR_STATUSES.includes(row.処理状況)).sort(byIdDesc)
const workingRows = orderInquiryRows.filter((row) => row.処理状況 === WORKING_STATUS).sort(byIdDesc)
const DREAM_FAILED = errorRows.find((row) => row.処理状況 === '101')
const IB_FAILED = errorRows.find((row) => row.処理状況 === '103')
const MARKET_ORDER = errorRows.find((row) => row.指成区分 === 'MO')
// 売買区分はコードマスタどおり 3 買 / 1 売
const BUY_ROW = errorRows.find((row) => row.売買区分 === '3')
const SELL_ROW = errorRows.find((row) => row.売買区分 === '1')

const ids = (orders) => orders.map((order) => order.id)
const rawIds = (rows) => rows.map((row) => String(row.ID))

/** 記録だけして既定のハンドラへ流す（resolver が何も返さなければ次のハンドラが応答する） */
function recordList() {
  server.use(
    http.get(LIST_PATH, ({ request }) => {
      listQueries.push(Object.fromEntries(new URL(request.url).searchParams))
    }),
  )
}

/**
 * 一覧の応答を差し替える。status が 003 の本には working、それ以外（101,103）の本には errors を返す。
 * ページは送られた offset から全部を 1 ページで返す（total は行数）。
 */
function respondOrders({ errors = [], working = [] } = {}) {
  server.use(
    http.get(LIST_PATH, ({ request }) => {
      const params = new URL(request.url).searchParams
      listQueries.push(Object.fromEntries(params))
      const rows = params.get('status') === WORKING_STATUS ? working : errors
      const offset = Number(params.get('offset') ?? 0)
      return HttpResponse.json({ orders: rows.slice(offset), total: rows.length })
    }),
  )
}

/** 注文エラーの本に 1 行だけ返し、変換の結果（注文エラーの 1 件目）を受け取る */
async function convert(raw) {
  respondOrders({ errors: [raw] })
  const { orderErrors } = await fetchStalledOrders()
  return orderErrors[0]
}

/** 取込の応答を差し替える（本文は読まない） */
function respondImport(body, status = 200) {
  server.use(http.post(IMPORT_PATH, () => HttpResponse.json(body, { status })))
}

/** 例外を受け取る（投げられなければテストを落とす） */
async function caught(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('例外が投げられなかった')
}

/*
 * 送る File も Node の実装にする。jsdom の File を Node の FormData に積むと、
 * ファイルではなく文字列（'[object File]'）として届く。
 */
const csvFile = (text, name = 'confirmation.csv') => new NodeFile([text], name, { type: 'text/csv' })

// シナリオ: docs/unit/api-stalled-orders.md
describe('api/stalledOrders', () => {
  it('[SOA-01] 既定モックでは注文エラーが 101 / 103、注文中が 003 の行で ID の降順に返る', async () => {
    const result = await fetchStalledOrders()

    expect(ids(result.orderErrors)).toEqual(rawIds(errorRows))
    expect(ids(result.workingOrders)).toEqual(rawIds(workingRows))
  })

  it('[SOA-02] 日本語キーが camelCase のモデルになる', async () => {
    const { orderErrors } = await fetchStalledOrders()
    const raw = errorRows[0]

    expect(orderErrors[0]).toMatchObject({
      id: String(raw.ID),
      branchCode: raw.部店,
      customerName: raw.顧客名,
      symbol: raw.Ticker,
      quantity: raw.数量,
      orderType: raw.指成区分,
      marketCategoryName: raw.発注範囲名,
      statusName: raw.表示状況名,
      errorReason: raw.エラー内容,
    })
  })

  it('[SOA-03] integer の口座番号は文字列で返る', async () => {
    const { orderErrors } = await fetchStalledOrders()

    expect(typeof errorRows[0].口座番号).toBe('number')
    expect(orderErrors[0].accountNumber).toBe(String(errorRows[0].口座番号))
  })

  it('[SOA-04] 売買区分 3 / 1 が buy / sell になる', async () => {
    const { orderErrors } = await fetchStalledOrders()
    const byId = (raw) => orderErrors.find((order) => order.id === String(raw.ID))

    expect(byId(BUY_ROW).side).toBe('buy')
    expect(byId(SELL_ROW).side).toBe('sell')
  })

  it('[SOA-05] 未知の売買区分は空文字になり買いに丸めない', async () => {
    const order = await convert({ ...BUY_ROW, 売買区分: '9' })

    expect(order.side).toBe('')
  })

  it('[SOA-06] 成行の指値単価は null のまま返る', async () => {
    const { orderErrors } = await fetchStalledOrders()
    const order = orderErrors.find((row) => row.id === String(MARKET_ORDER.ID))

    expect(MARKET_ORDER.指値単価).toBeNull()
    expect(order.limitPrice).toBeNull()
  })

  it('[SOA-07] 受注日と受注時刻が 1 本の日時になる', async () => {
    const { orderErrors } = await fetchStalledOrders()
    const order = orderErrors.find((row) => row.id === String(IB_FAILED.ID))

    expect(order.orderedAt).toBe(`${IB_FAILED.受注日}T${IB_FAILED.受注時刻}`)
  })

  it('[SOA-08] 受注日か受注時刻が欠けると日時は空文字になる', async () => {
    const raw = errorRows[0]
    respondOrders({
      errors: [
        { ...raw, 受注日: null },
        { ...raw, ID: raw.ID + 1000, 受注時刻: '' },
      ],
    })

    const { orderErrors } = await fetchStalledOrders()

    expect(orderErrors.map((order) => order.orderedAt)).toEqual(['', ''])
  })

  it('[SOA-09] 応答に orders が無くても空配列で返る', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({})))

    const result = await fetchStalledOrders()

    expect(result).toEqual({ orderErrors: [], workingOrders: [] })
  })

  it('[SOA-10] 部店コードだけが branch_code として送られ、空の条件は載らない', async () => {
    respondOrders()

    await fetchStalledOrders({ branchCode: '123', accountNumber: '', symbol: '' })

    expect(listQueries).toHaveLength(2)
    for (const query of listQueries) {
      expect(query).toEqual({
        branch_code: '123',
        status: query.status,
        limit: String(PAGE_SIZE),
        offset: '0',
      })
    }
  })

  it('[SOA-11] 500 は ApiError になる', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }),
      ),
    )

    const error = await caught(fetchStalledOrders())

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
  })

  it('[SOA-12] 取込は multipart の file 項目で CSV を送る', async () => {
    let received = null
    server.use(
      http.post(IMPORT_PATH, async ({ request }) => {
        const form = await request.formData()
        const file = form.get('file')
        received = {
          contentType: request.headers.get('content-type') ?? '',
          name: file?.name,
          text: typeof file?.text === 'function' ? await file.text() : null,
        }
        return HttpResponse.json({
          success: true,
          total_count: 0,
          success_count: 0,
          error_count: 0,
          errors: [],
          message: '',
        })
      }),
    )
    const TEXT = 'order_id,confirmation_ref\r\n6,TWS-1\r\n'

    await importConfirmationCsv(csvFile(TEXT, 'tws.csv'))

    expect(received.contentType).toMatch(/^multipart\/form-data/)
    expect(received.name).toBe('tws.csv')
    expect(received.text).toBe(TEXT)
  })

  it('[SOA-13] 200 の件数と文言が camelCase の結果になる', async () => {
    const raw = {
      success: true,
      total_count: 2,
      success_count: 2,
      error_count: 0,
      errors: [],
      message: 'コンファメーションを 2 件取り込みました。',
    }
    respondImport(raw)

    const result = await importConfirmationCsv(csvFile('x'))

    expect(result).toEqual({
      success: raw.success,
      totalCount: raw.total_count,
      successCount: raw.success_count,
      errorCount: raw.error_count,
      message: raw.message,
      errors: [],
    })
  })

  it('[SOA-14] 行エラーは行番号・注文 ID（文字列）・理由の配列になる', async () => {
    const reasons = ['注文ID「999」は滞留注文にありません。', 'confirmation_status「X」は指定できません。']
    respondImport({
      success: false,
      total_count: 1,
      success_count: 0,
      error_count: 1,
      errors: [{ line_number: 2, errors: reasons, row_data: { order_id: 999 } }],
      message: '1 行にエラーがあるため、取り込みませんでした。',
    })

    const result = await importConfirmationCsv(csvFile('x'))

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([{ lineNumber: 2, orderId: '999', messages: reasons }])
  })

  it('[SOA-15] 行エラーの row_data が null なら注文 ID は空文字になる', async () => {
    respondImport({
      success: false,
      total_count: 1,
      success_count: 0,
      error_count: 1,
      errors: [{ line_number: 3, errors: ['読めません'], row_data: null }],
      message: '',
    })

    const result = await importConfirmationCsv(csvFile('x'))

    expect(result.errors[0].orderId).toBe('')
  })

  it('[SOA-16] 400 は detail を message に持つ ApiError になる', async () => {
    const detail = 'ヘッダが違います。'
    respondImport({ detail }, 400)

    const error = await caught(importConfirmationCsv(csvFile('x')))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: detail })
  })

  it('[SOA-17] 422 は ApiError になる', async () => {
    respondImport({ detail: [{ loc: ['body', 'file'], msg: 'Field required', type: 'missing' }] }, 422)

    const error = await caught(importConfirmationCsv(csvFile('x')))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
  })

  it('[SOA-18] 500 は ApiError になる', async () => {
    respondImport({ detail: 'サーバーでエラーが発生しました。' }, 500)

    const error = await caught(importConfirmationCsv(csvFile('x')))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
  })

  it('[SOA-19] 注文エラーは status=101,103、注文中は status=003 で GET /orders を 2 本呼ぶ', async () => {
    recordList()

    await fetchStalledOrders()

    expect(listQueries.map((query) => query.status).sort()).toEqual(
      [ERROR_STATUSES.join(','), WORKING_STATUS].sort(),
    )
  })

  it('[SOA-20] 数字の口座番号は空白を除いて account_no に、銘柄は symbol に載る', async () => {
    const target = SELL_ROW
    const accountNo = String(target.口座番号)
    const symbol = target.Ticker.toLowerCase()
    recordList()

    const { orderErrors } = await fetchStalledOrders({ accountNumber: ` ${accountNo} `, symbol })

    expect(listQueries).toHaveLength(2)
    for (const query of listQueries) {
      expect(query).toMatchObject({ account_no: accountNo, symbol })
    }
    const expected = errorRows.filter(
      (row) => String(row.口座番号) === accountNo && row.Ticker.toLowerCase().includes(symbol),
    )
    expect(ids(orderErrors)).toEqual(rawIds(expected))
    expect(expected).toContain(target)
  })

  it('[SOA-21] 数字以外を含む口座番号は account_no に載らない', async () => {
    respondOrders()

    await fetchStalledOrders({ accountNumber: '300-003' })

    expect(listQueries).toHaveLength(2)
    for (const query of listQueries) {
      expect(query).not.toHaveProperty('account_no')
    }
  })

  it('[SOA-22] total に届くまで offset を送ってページを集める', async () => {
    const rows = errorRows
    const offsets = []
    const limits = []
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        const params = new URL(request.url).searchParams
        if (params.get('status') === WORKING_STATUS) {
          return HttpResponse.json({ orders: [], total: 0 })
        }
        const offset = Number(params.get('offset'))
        offsets.push(offset)
        limits.push(params.get('limit'))
        // 1 ページに 1 行だけ返す
        return HttpResponse.json({ orders: rows.slice(offset, offset + 1), total: rows.length })
      }),
    )

    const { orderErrors } = await fetchStalledOrders()

    expect(rows.length).toBeGreaterThan(1)
    expect(offsets).toEqual(rows.map((_, index) => index))
    expect(limits).toEqual(rows.map(() => String(PAGE_SIZE)))
    expect(ids(orderErrors)).toEqual(rawIds(rows))
  })

  it('[SOA-23] 空のページが返ったら total に届かなくても止まる', async () => {
    const rows = errorRows
    const offsets = []
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        const params = new URL(request.url).searchParams
        if (params.get('status') === WORKING_STATUS) {
          return HttpResponse.json({ orders: [], total: 0 })
        }
        const offset = Number(params.get('offset'))
        offsets.push(offset)
        // total は実際より多いまま、行が尽きたら空のページを返す
        return HttpResponse.json({ orders: rows.slice(offset, offset + 1), total: rows.length + 10 })
      }),
    )

    const { orderErrors } = await fetchStalledOrders()

    expect(offsets).toEqual([...rows.map((_, index) => index), rows.length])
    expect(ids(orderErrors)).toEqual(rawIds(rows))
  })

  it('[SOA-24] 銘柄は Ticker が優先で、無ければ銘柄コードになる', async () => {
    const raw = errorRows[0]
    respondOrders({
      errors: [
        { ...raw, Ticker: 'BRK.B', 銘柄コード: 'BRKB' },
        { ...raw, ID: raw.ID + 1000, Ticker: null, 銘柄コード: 'BRKB' },
      ],
    })

    const { orderErrors } = await fetchStalledOrders()

    expect(orderErrors.map((order) => order.symbol)).toEqual(['BRK.B', 'BRKB'])
  })

  it('[SOA-25] 数値の文字列の指値単価は数値になる', async () => {
    const order = await convert({ ...errorRows[0], 指成区分: 'LO', 指値単価: '228.5000' })

    expect(order.limitPrice).toBe(228.5)
  })

  it('[SOA-26] 区切りの無い受注日と受注時刻も 1 本の日時になる', async () => {
    const order = await convert({ ...errorRows[0], 受注日: '20260916', 受注時刻: '1022' })

    expect(order.orderedAt).toBe('2026-09-16T10:22:00')
  })

  it('[SOA-27] 表示状況名が無ければ処理状況名が出来状況になる', async () => {
    const raw = errorRows[0]
    const order = await convert({ ...raw, 表示状況名: null })

    expect(order.statusName).toBe(raw.処理状況名)
  })

  it('[SOA-28] Dream 発注失敗（101）は Dreamエラー内容を先に、空ならエラー内容を見る', async () => {
    const raw = { ...DREAM_FAILED, Dreamエラー内容: 'Dream 側で拒否されました。', エラー内容: 'IB 側の理由' }
    respondOrders({
      errors: [raw, { ...raw, ID: raw.ID + 1000, Dreamエラー内容: null }],
    })

    const { orderErrors } = await fetchStalledOrders()

    expect(orderErrors.map((order) => order.errorReason)).toEqual([
      raw.Dreamエラー内容,
      raw.エラー内容,
    ])
  })

  it('[SOA-29] IB 発注失敗（103）はエラー内容を先に、空なら Dreamエラー内容を見る', async () => {
    const raw = { ...IB_FAILED, Dreamエラー内容: 'Dream 側の理由', エラー内容: 'IB 側で拒否されました。' }
    respondOrders({
      errors: [raw, { ...raw, ID: raw.ID + 1000, エラー内容: '' }],
    })

    const { orderErrors } = await fetchStalledOrders()

    expect(orderErrors.map((order) => order.errorReason)).toEqual([
      raw.エラー内容,
      raw.Dreamエラー内容,
    ])
  })

  it('[SOA-30] 確認状況（confirmationNote）はどの行も空文字', async () => {
    const { orderErrors, workingOrders } = await fetchStalledOrders()

    expect(workingOrders.length).toBeGreaterThan(0)
    expect([...orderErrors, ...workingOrders].map((order) => order.confirmationNote)).toEqual(
      [...orderErrors, ...workingOrders].map(() => ''),
    )
  })
})
