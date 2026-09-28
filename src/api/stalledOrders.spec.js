import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { stalledOrderErrors, stalledWorkingOrders } from '@/mocks/fixtures/stalledOrders'
import { ApiError } from './client'
import { fetchStalledOrders, importConfirmationCsv } from './stalledOrders'

/*
 * API 層のテスト。滞留注文抽出の生の形（日本語キー・2 本の配列）をアプリ内モデルへ
 * 畳む変換と、コンファメーション CSV の取込の送り方・応答の変換を固定する。
 * 期待値はフィクスチャ（バックエンドが返す生の形）から導く。
 */

const LIST_PATH = '*/api/operations/stalled-orders'
const IMPORT_PATH = '*/api/operations/stalled-orders/confirmation-import'

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

/** 最後に届いた一覧のリクエスト */
let lastListRequest = null

afterEach(() => {
  lastListRequest = null
  vi.unstubAllGlobals()
})

/** 一覧の応答を差し替える（リクエストも記録する） */
function respondList(body, status = 200) {
  server.use(
    http.get(LIST_PATH, ({ request }) => {
      lastListRequest = new URL(request.url)
      return HttpResponse.json(body, { status })
    }),
  )
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

const MARKET_ORDER = stalledOrderErrors.find((row) => row.指成区分 === 'MO')
const BUY_ROW = stalledOrderErrors.find((row) => row.売買区分 === '1')
const SELL_ROW = stalledOrderErrors.find((row) => row.売買区分 === '3')

// シナリオ: docs/unit/api-stalled-orders.md
describe('api/stalledOrders', () => {
  it('[SOA-01] 既定モックでは注文エラーと注文中がフィクスチャの件数で返る', async () => {
    const result = await fetchStalledOrders()

    expect(result.orderErrors).toHaveLength(stalledOrderErrors.length)
    expect(result.workingOrders).toHaveLength(stalledWorkingOrders.length)
  })

  it('[SOA-02] 日本語キーが camelCase のモデルになる', async () => {
    const { orderErrors } = await fetchStalledOrders()
    const raw = stalledOrderErrors[0]

    expect(orderErrors[0]).toMatchObject({
      id: String(raw.ID),
      branchCode: raw.部店,
      customerName: raw.顧客名,
      symbol: raw.銘柄コード,
      quantity: raw.数量,
      orderType: raw.指成区分,
      marketCategoryName: raw.発注範囲名,
      statusName: raw.処理状況名,
      errorReason: raw.エラー内容,
      confirmationNote: '',
    })
  })

  it('[SOA-03] integer の口座番号は文字列で返る', async () => {
    const { orderErrors } = await fetchStalledOrders()

    expect(typeof stalledOrderErrors[0].口座番号).toBe('number')
    expect(orderErrors[0].accountNumber).toBe(String(stalledOrderErrors[0].口座番号))
  })

  it('[SOA-04] 売買区分 1 / 3 が buy / sell になる', async () => {
    const { orderErrors } = await fetchStalledOrders()
    const byId = (raw) => orderErrors.find((order) => order.id === String(raw.ID))

    expect(byId(BUY_ROW).side).toBe('buy')
    expect(byId(SELL_ROW).side).toBe('sell')
  })

  it('[SOA-05] 未知の売買区分は空文字になり買いに丸めない', async () => {
    respondList({ 注文エラー: [{ ...BUY_ROW, 売買区分: '9' }], 注文中: [] })

    const { orderErrors } = await fetchStalledOrders()

    expect(orderErrors[0].side).toBe('')
  })

  it('[SOA-06] 成行の指値単価は null のまま返る', async () => {
    const { orderErrors } = await fetchStalledOrders()
    const order = orderErrors.find((row) => row.id === String(MARKET_ORDER.ID))

    expect(MARKET_ORDER.指値単価).toBeNull()
    expect(order.limitPrice).toBeNull()
  })

  it('[SOA-07] 受注日と受注時刻が 1 本の日時になる', async () => {
    const { orderErrors } = await fetchStalledOrders()
    const raw = stalledOrderErrors[0]

    expect(orderErrors[0].orderedAt).toBe(`${raw.受注日}T${raw.受注時刻}`)
  })

  it('[SOA-08] 受注日か受注時刻が欠けると日時は空文字になる', async () => {
    const raw = stalledOrderErrors[0]
    respondList({
      注文エラー: [
        { ...raw, 受注日: null },
        { ...raw, ID: raw.ID + 1000, 受注時刻: '' },
      ],
      注文中: [],
    })

    const { orderErrors } = await fetchStalledOrders()

    expect(orderErrors.map((order) => order.orderedAt)).toEqual(['', ''])
  })

  it('[SOA-09] 応答に 注文エラー / 注文中 が無くても空配列で返る', async () => {
    respondList({})

    const result = await fetchStalledOrders()

    expect(result).toEqual({ orderErrors: [], workingOrders: [] })
  })

  it('[SOA-10] 部店コードだけが branch_code として送られ、空の条件は載らない', async () => {
    respondList({ 注文エラー: [], 注文中: [] })

    await fetchStalledOrders({ branchCode: '123', accountNumber: '', symbol: '' })

    expect(lastListRequest.pathname).toBe('/api/operations/stalled-orders')
    expect(Object.fromEntries(lastListRequest.searchParams)).toEqual({ branch_code: '123' })
  })

  it('[SOA-11] 500 は ApiError になる', async () => {
    respondList({ detail: 'サーバーでエラーが発生しました。' }, 500)

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
})
