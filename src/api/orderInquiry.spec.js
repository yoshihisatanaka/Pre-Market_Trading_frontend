import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderInquiryRows } from '@/mocks/fixtures/orderInquiry'
import { amendOrder, cancelOrder, fetchOrderDetail, fetchOrderInquiry } from './orderInquiry'

/*
 * API 層のテスト。注文照会の一覧（GET /orders）の変換とまとめ方、
 * 1 件の詳細・訂正・取消（GET /orders/{id}・POST amend / cancel）の送り方と読み方を固定する。
 * 期待値はフィクスチャ（バックエンドの生の形）から導く。
 */
const ORDERS = '*/api/orders'
const DETAIL = '*/api/orders/:orderId'
const AMEND = '*/api/orders/:orderId/amend'
const CANCEL = '*/api/orders/:orderId/cancel'

const byId = (id) => orderInquiryRows.find((row) => row.ID === id)
const rootOf = (row) => row.元注文ID ?? row.ID
const MAX_ID = Math.max(...orderInquiryRows.map((row) => row.ID))
// フィクスチャに無い注文 ID（既定ハンドラが 404 / 400 を返す）
const MISSING_ID = String(MAX_ID + 100)
const NOT_FOUND_MESSAGE = `指定された注文が存在しません: ID=${MISSING_ID}`

/** 一覧の GET を記録し、指定の本文を返す。記録は URLSearchParams の配列 */
function recordList(body = { orders: [], total: 0 }) {
  const seen = []
  server.use(
    http.get(ORDERS, ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return HttpResponse.json(body)
    }),
  )
  return seen
}

/** 一覧が指定の行だけを返すようにする */
const respondRows = (rows) => recordList({ orders: rows, total: rows.length })

/** 一覧の 1 行（既定は #36 を土台に、元注文・種別を外した独立の行） */
const row = (overrides) => ({ ...byId(36), 元注文ID: null, 注文種別: null, ...overrides })

/** 詳細の GET が指定の本文を返すようにする */
function respondDetail(body) {
  server.use(http.get(DETAIL, () => HttpResponse.json(body)))
}

/** POST を記録し、指定の本文を返す。記録は { path, body } の配列 */
function recordPost(path, response) {
  const seen = []
  server.use(
    http.post(path, async ({ request }) => {
      seen.push({ path: new URL(request.url).pathname, body: await request.json() })
      return HttpResponse.json(response)
    }),
  )
  return seen
}

const inPlaceResponse = {
  success: true,
  mode: 'IN_PLACE',
  original_order_id: 36,
  amendment_order_id: null,
  status: '000',
  message: '訂正しました',
  warnings: [],
}
const cancelResponse = {
  success: true,
  order_id: 36,
  status: '034',
  message: '取り消しました',
  errors: [],
  warnings: [],
}

// シナリオ: docs/unit/api-order-inquiry.md
describe('api/orderInquiry', () => {
  it('[OIA-01] 一覧は注文の行数と元注文ごとのまとまりを返し、キーは camelCase', async () => {
    const { items, total } = await fetchOrderInquiry()

    expect(total).toBe(orderInquiryRows.length)
    expect(items).toHaveLength(new Set(orderInquiryRows.map(rootOf)).size)
    for (const key of Object.keys(items[0].latest)) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*$/)
    }
  })

  it('[OIA-02] 空文字の条件はクエリに載せず limit / offset は常に載る', async () => {
    const seen = recordList()

    await fetchOrderInquiry({ branchCode: '', symbol: '' })

    const params = seen[0]
    expect(params.has('branch_code')).toBe(false)
    expect(params.has('symbol')).toBe(false)
    expect(params.has('limit')).toBe(true)
    expect(params.has('offset')).toBe(true)
  })

  it('[OIA-03] 部店・口座番号・銘柄はバックエンドのクエリ名で送られる', async () => {
    const seen = recordList()

    await fetchOrderInquiry({ branchCode: '123', accountNumber: '300001', symbol: 'AAPL' })

    expect(seen[0].get('branch_code')).toBe('123')
    expect(seen[0].get('account_no')).toBe('300001')
    expect(seen[0].get('symbol')).toBe('AAPL')
  })

  it('[OIA-04] 数字だけでない口座番号は account_no に載せない', async () => {
    const seen = recordList()

    await fetchOrderInquiry({ accountNumber: '30-01' })

    expect(seen[0].has('account_no')).toBe(false)
  })

  it('[OIA-05] 出来状況は処理状況コードに読み替えて status で送られる', async () => {
    const seen = recordList()
    const cases = [
      ['未出来', '000'],
      ['注文中', '003'],
      ['一部出来', '010'],
      ['全部出来', '011'],
      ['取消済', '034'],
      ['注文エラー', '101'],
    ]

    for (const [executionStatus] of cases) {
      await fetchOrderInquiry({ executionStatus })
    }

    expect(seen.map((params) => params.get('status'))).toEqual(cases.map(([, code]) => code))
  })

  it('[OIA-06] 売買区分 1 / 3 / その他は sell / buy / 空文字になる', async () => {
    respondRows([row({ ID: 1, 売買区分: '1' }), row({ ID: 2, 売買区分: '3' }), row({ ID: 3, 売買区分: '9' })])

    const { items } = await fetchOrderInquiry()

    expect(items.map((group) => group.latest.side)).toEqual(['sell', 'buy', ''])
  })

  it('[OIA-07] 受注日と受注時刻が 1 本の日時にまとまり、欠けたら空文字になる', async () => {
    respondRows([
      row({ ID: 1, 受注日: '2026-09-28', 受注時刻: '09:15:00' }),
      row({ ID: 2, 受注日: '20260928', 受注時刻: '0915' }),
      row({ ID: 3, 受注日: '2026-09-28', 受注時刻: null }),
    ])

    const { items } = await fetchOrderInquiry()

    expect(items.map((group) => group.latest.orderedAt)).toEqual([
      '2026-09-28T09:15:00',
      '2026-09-28T09:15:00',
      '',
    ])
  })

  it('[OIA-08] 成行の単価と未約定の代金は null、出来数量 0 は 0 のまま', async () => {
    respondRows([row({ ID: 1, 指成区分: 'MO', 指値単価: null, 出来数量: 0, 約定代金: null })])

    const { items } = await fetchOrderInquiry()

    expect(items[0].latest.limitPrice).toBeNull()
    expect(items[0].latest.filledAmountUsd).toBeNull()
    expect(items[0].latest.filledQuantity).toBe(0)
  })

  it('[OIA-09] 訂正の版は起点の注文にまとまり、latest が最新で history が古い順になる', async () => {
    const versions = orderInquiryRows
      .filter((raw) => rootOf(raw) === 30 && raw.注文種別 !== 'SLICE_CHILD')
      .map((raw) => String(raw.ID))
      .sort((a, b) => Number(a) - Number(b))

    const { items } = await fetchOrderInquiry()
    const group = items.find((item) => item.id === '30')

    expect(group.latest.id).toBe(versions.at(-1))
    expect(group.history.map((order) => order.id)).toEqual(versions.slice(0, -1))
  })

  it('[OIA-10] スライス子注文は親の slices に ID 順で入り history には入らない', async () => {
    const sliceIds = orderInquiryRows
      .filter((raw) => raw.注文種別 === 'SLICE_CHILD' && raw.元注文ID === 35)
      .map((raw) => String(raw.ID))
      .sort((a, b) => Number(a) - Number(b))

    const { items } = await fetchOrderInquiry()
    const group = items.find((item) => item.id === '35')

    expect(group.slices.map((order) => order.id)).toEqual(sliceIds)
    expect(group.history).toEqual([])
  })

  it('[OIA-11] 親の無い子注文は 1 件ずつ独立した行になる', async () => {
    const slices = orderInquiryRows.filter((raw) => raw.注文種別 === 'SLICE_CHILD')
    respondRows(slices)

    const { items } = await fetchOrderInquiry()

    expect(items.map((group) => group.id)).toEqual(
      slices.map((raw) => String(raw.ID)).sort((a, b) => Number(a) - Number(b)),
    )
    for (const group of items) {
      expect(group.latest.id).toBe(group.id)
      expect(group.history).toEqual([])
      expect(group.slices).toEqual([])
    }
  })

  it('[OIA-12] 取消・訂正の可否は処理状況コードで決まる（141 は取消できる）', async () => {
    const codes = ['000', '003', '010', '131', '133', '101', '103', '141', '011', '034', '040']
    respondRows(codes.map((code, index) => row({ ID: index + 1, 処理状況: code })))

    const { items } = await fetchOrderInquiry()
    const byCode = Object.fromEntries(items.map((group, index) => [codes[index], group.latest]))

    expect(codes.filter((code) => byCode[code].cancelable)).toEqual(codes.slice(0, 8))
    expect(codes.filter((code) => byCode[code].amendable)).toEqual(['000', '003', '010'])
  })

  it('[OIA-13] 出来状況の色分けは処理状況コードで決まる', async () => {
    const codes = ['010', '101', '034', '002']
    respondRows(codes.map((code, index) => row({ ID: index + 1, 処理状況: code })))

    const { items } = await fetchOrderInquiry()

    expect(items.map((group) => group.latest.statusTone)).toEqual(['partial', 'error', 'canceled', ''])
  })

  it('[OIA-14] 選択肢に無い出来状況は status に載せない', async () => {
    const seen = recordList()

    await fetchOrderInquiry({ executionStatus: '不明な値' })
    // Object の組み込み名も「選択肢に無い値」として扱う
    await fetchOrderInquiry({ executionStatus: 'toString' })

    expect(seen[0].has('status')).toBe(false)
    expect(seen[1].has('status')).toBe(false)
  })

  it('[OIA-15] 詳細は d_注文 の行と約定から OrderDetail に変換される', async () => {
    const raw = byId(35)
    const sides = { 1: 'sell', 3: 'buy' }

    const detail = await fetchOrderDetail(String(raw.ID))

    expect(detail).toEqual({
      id: String(raw.ID),
      branchCode: raw.部店,
      accountNumber: String(raw.口座番号),
      symbol: raw.Ticker,
      side: sides[raw.売買区分],
      quantity: raw.数量,
      orderType: raw.指成区分,
      limitPrice: raw.指値単価,
      marketScope: raw.発注範囲,
      vwap: raw.VWAP区分 === 1,
      status: raw.処理状況,
      filledQuantity: raw.出来数量,
      orderedAt: `${raw.受注日}T${raw.受注時刻}`,
      amendable: true,
      cancelable: true,
    })
  })

  it('[OIA-16] 銘柄は Ticker を優先し、空なら銘柄コードになる', async () => {
    respondDetail({ order: row({ Ticker: 'BRK.B', 銘柄コード: 'BRKB' }), executions: [] })
    expect((await fetchOrderDetail('36')).symbol).toBe('BRK.B')

    respondDetail({ order: row({ Ticker: '', 銘柄コード: 'BRKB' }), executions: [] })
    expect((await fetchOrderDetail('36')).symbol).toBe('BRKB')
  })

  it('[OIA-17] 出来数量は約定の合計で、約定が無ければ 0', async () => {
    respondDetail({ order: row(), executions: [{ 約定数量: 30 }, { 約定数量: '20' }] })
    expect((await fetchOrderDetail('36')).filledQuantity).toBe(50)

    respondDetail({ order: row(), executions: [] })
    expect((await fetchOrderDetail('36')).filledQuantity).toBe(0)

    respondDetail({ order: row() })
    expect((await fetchOrderDetail('36')).filledQuantity).toBe(0)
  })

  it('[OIA-18] 指値単価は数値の文字列でも数値になり、null は null のまま', async () => {
    const results = []
    for (const value of ['410.0000', 410, null]) {
      respondDetail({ order: row({ 指値単価: value }), executions: [] })
      results.push((await fetchOrderDetail('36')).limitPrice)
    }

    expect(results).toEqual([410, 410, null])
  })

  it('[OIA-19] 無い注文の詳細は 404 の ApiError になる', async () => {
    await expect(fetchOrderDetail(MISSING_ID)).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: NOT_FOUND_MESSAGE,
    })
  })

  it('[OIA-20] 訂正は渡した項目だけを日本語キーで送る', async () => {
    const seen = recordPost(AMEND, inPlaceResponse)

    await amendOrder({ id: '36', quantity: 30, limitPrice: 145 })

    expect(seen[0].path).toBe('/api/orders/36/amend')
    expect(seen[0].body).toEqual({ 数量: 30, 指値単価: 145 })
  })

  it('[OIA-21] 空の訂正理由は送らず、入れた理由は 理由 で送る', async () => {
    const seen = recordPost(AMEND, inPlaceResponse)

    await amendOrder({ id: '36', orderType: 'MO', marketScope: '02', reason: '' })
    await amendOrder({ id: '36', orderType: 'MO', marketScope: '02', reason: 'お客様申出' })

    expect(seen[0].body).toEqual({ 指成区分: 'MO', 発注範囲: '02' })
    expect(seen[1].body).toEqual({ 指成区分: 'MO', 発注範囲: '02', 理由: 'お客様申出' })
  })

  it('[OIA-22] 未発注の訂正は inPlace の結果になる', async () => {
    const result = await amendOrder({ id: '36', quantity: 30 })

    expect(result).toEqual({
      mode: 'inPlace',
      originalOrderId: '36',
      amendmentOrderId: '',
      message: '注文を訂正しました（注文ID: 36）',
      warnings: [],
    })
  })

  it('[OIA-23] 発注済みの訂正は cancelReplace で訂正注文の ID を返す', async () => {
    const result = await amendOrder({ id: '34', quantity: 600 })

    expect(result.mode).toBe('cancelReplace')
    expect(result.originalOrderId).toBe('34')
    expect(result.amendmentOrderId).toBe(String(MAX_ID + 1))
  })

  it('[OIA-24] success が true でない訂正は ApiError になる', async () => {
    recordPost(AMEND, { success: false, message: '受け付けられませんでした' })
    await expect(amendOrder({ id: '36', quantity: 30 })).rejects.toMatchObject({
      name: 'ApiError',
      message: '受け付けられませんでした',
    })

    recordPost(AMEND, { success: false })
    await expect(amendOrder({ id: '36', quantity: 30 })).rejects.toMatchObject({
      name: 'ApiError',
      message: '注文を訂正できませんでした。',
    })
  })

  it('[OIA-25] 未知の mode は空文字、warnings は空でない文字列だけになる', async () => {
    recordPost(AMEND, { ...inPlaceResponse, mode: 'SOMETHING', warnings: [null, '', '注意1', 3] })

    const result = await amendOrder({ id: '36', quantity: 30 })

    expect(result.mode).toBe('')
    expect(result.warnings).toEqual(['注意1'])
  })

  it('[OIA-26] 訂正できない注文は 400、無い注文は 404 の ApiError になる', async () => {
    const filled = byId(41)

    await expect(amendOrder({ id: String(filled.ID), quantity: 1 })).rejects.toMatchObject({
      status: 400,
      message: `この注文は訂正できません（処理状況: ${filled.処理状況}）`,
    })
    await expect(amendOrder({ id: MISSING_ID, quantity: 1 })).rejects.toMatchObject({
      status: 404,
      message: NOT_FOUND_MESSAGE,
    })
  })

  it('[OIA-27] 取消は空のオブジェクトを送る', async () => {
    const seen = recordPost(CANCEL, cancelResponse)

    await cancelOrder({ id: '36' })

    expect(seen[0].path).toBe('/api/orders/36/cancel')
    expect(seen[0].body).toEqual({})
  })

  it('[OIA-28] 取消の結果は注文 ID とサーバの文言になる', async () => {
    const result = await cancelOrder({ id: '36' })

    expect(result).toEqual({
      orderId: '36',
      message: '注文を取り消しました（注文ID: 36）',
      warnings: [],
    })
  })

  it('[OIA-29] success が true でない取消は errors の連結・message・既定文言の順で ApiError になる', async () => {
    recordPost(CANCEL, { success: false, errors: ['理由1', '理由2'], message: '無視される' })
    await expect(cancelOrder({ id: '36' })).rejects.toMatchObject({ message: '理由1 / 理由2' })

    recordPost(CANCEL, { success: false, errors: [], message: '取り消せません' })
    await expect(cancelOrder({ id: '36' })).rejects.toMatchObject({ message: '取り消せません' })

    recordPost(CANCEL, { success: false })
    await expect(cancelOrder({ id: '36' })).rejects.toMatchObject({
      name: 'ApiError',
      message: '注文を取り消せませんでした。',
    })
  })

  it('[OIA-30] 取消できない注文は 400 の ApiError になる', async () => {
    const filled = byId(41)

    await expect(cancelOrder({ id: String(filled.ID) })).rejects.toMatchObject({
      status: 400,
      message: `この注文は取消できません（処理状況: ${filled.処理状況}）`,
    })
  })
})
