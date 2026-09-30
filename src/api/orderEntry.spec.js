import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { symbols } from '@/mocks/fixtures/symbols'
import { FIRST_ORDER_ID, orderMessages } from '@/mocks/fixtures/orderEntry'
import { ApiError } from './client'
import { createOrder, validateOrder } from './orderEntry'

/*
 * API 層のテスト。送る本文（OrderRequest の日本語キーと型）と応答の変換を、
 * MSW の既定ハンドラ（src/mocks/handlers/orderEntry.js）に当てて確かめる。
 */
const VALIDATE_PATH = '*/api/orders/validate'
const CREATE_PATH = '*/api/orders'

// 警告の出ない顧客（コンプラ C・停止なし）と、取引できる銘柄 / 取引不可の銘柄
const quietCustomer = customers.find((row) => row.コンプラランク === 'C' && !row.取引停止区分_全取引)
const tradable = symbols.find((row) => row.Ticker === 'AAPL')
const prohibited = symbols.find((row) => row.規制情報 === '1')

/** 送る注文（アプリ内モデル）。既定は成行の買い 10 株 */
function order(overrides = {}) {
  return {
    branchCode: quietCustomer.部店コード,
    accountNumber: String(quietCustomer.口座番号),
    symbolCode: tradable.銘柄コード,
    side: '3',
    quantity: 10,
    orderType: 'MO',
    limitPrice: null,
    executionScope: '03',
    expiryDate: '2026-10-05',
    settlementCurrency: '0',
    depositCategory: '0',
    securitiesDelivery: '500',
    transactionType: '100',
    solicitation: '1',
    orderMethod: '3',
    fundNature: '1',
    orderChannel: 'EGY',
    cashDelivery: '000',
    vwap: false,
    orderDate: '2026-09-29',
    orderTime: '10:30',
    orderPerson: 'test-user',
    forced: false,
    createdBy: 'test-user',
    ...overrides,
  }
}

/** POST の本文を記録する（応答は既定ハンドラに任せる） */
function recordBodies(path) {
  const bodies = []
  server.use(
    http.post(path, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

const errorHandler = (path) =>
  http.post(path, () => HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }))

// シナリオ: docs/unit/api-order-entry.md
describe('api/orderEntry', () => {
  it('[NOA-01] 本文は日本語キーで、口座番号は integer、日付は YYYYMMDD', async () => {
    const bodies = recordBodies(VALIDATE_PATH)
    await validateOrder(order())

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({
      部店: quietCustomer.部店コード,
      口座番号: quietCustomer.口座番号,
      銘柄コード: tradable.銘柄コード,
      売買区分: '3',
      数量: 10,
      指成区分: 'MO',
      指値単価: null,
      決済通貨区分: '0',
      証券受渡方法: '500',
      預り売買区分: '0',
      取引: '100',
      勧誘区分: '1',
      受注方法: '3',
      資金性格: '1',
      有効期限: '20261005',
      注文チャネル: 'EGY',
      金銭受渡方法: '000',
      受注日: '20260929',
      受注時刻: '10:30',
      受注者: 'test-user',
      強制区分: 0,
      発注範囲: '03',
      作成者: 'test-user',
      VWAP区分: 0,
    })
    expect(typeof bodies[0].口座番号).toBe('number')
  })

  it('[NOA-02] 成行の指値単価・空の受注者は null、フラグなしは 0', async () => {
    const bodies = recordBodies(VALIDATE_PATH)
    await validateOrder(order({ orderPerson: '' }))

    expect(bodies[0].指値単価).toBeNull()
    expect(bodies[0].受注者).toBeNull()
    expect(bodies[0].強制区分).toBe(0)
    expect(bodies[0].VWAP区分).toBe(0)
  })

  it('[NOA-03] 指値単価は数値、強制区分・VWAP区分は 1', async () => {
    const bodies = recordBodies(CREATE_PATH)
    await createOrder(order({ orderType: 'LO', limitPrice: 200.5, forced: true, vwap: true }))

    expect(bodies[0].指成区分).toBe('LO')
    expect(bodies[0].指値単価).toBe(200.5)
    expect(bodies[0].強制区分).toBe(1)
    expect(bodies[0].VWAP区分).toBe(1)
  })

  it('[NOA-04] 合格の応答はそのまま valid: true', async () => {
    await expect(validateOrder(order())).resolves.toEqual({
      valid: true,
      errors: [],
      warnings: [],
    })
  })

  it('[NOA-05] 200 の不合格は例外にせず errors を返す', async () => {
    const result = await validateOrder(order({ symbolCode: prohibited.銘柄コード }))

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(orderMessages.prohibited)
  })

  it('[NOA-06] 応答に配列が無ければ [] にする', async () => {
    server.use(
      http.post(VALIDATE_PATH, () => HttpResponse.json({ valid: false })),
      http.post(CREATE_PATH, () => HttpResponse.json({ success: false, order_id: null })),
    )

    await expect(validateOrder(order())).resolves.toEqual({
      valid: false,
      errors: [],
      warnings: [],
    })
    await expect(createOrder(order())).resolves.toEqual({
      success: false,
      orderId: '',
      message: '',
      errors: [],
      warnings: [],
    })
  })

  it('[NOA-07] 事前検証の 500 は ApiError', async () => {
    server.use(errorHandler(VALIDATE_PATH))

    const error = await validateOrder(order()).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
  })

  it('[NOA-08] 登録できたら採番された注文 ID を文字列で返す', async () => {
    await expect(createOrder(order())).resolves.toEqual({
      success: true,
      orderId: String(FIRST_ORDER_ID),
      message: orderMessages.created,
      errors: [],
      warnings: [],
    })
  })

  it('[NOA-09] 登録の 200 の不合格は例外にせず success: false', async () => {
    const result = await createOrder(order({ symbolCode: prohibited.銘柄コード }))

    expect(result.success).toBe(false)
    expect(result.orderId).toBe('')
    expect(result.errors).toContain(orderMessages.prohibited)
  })

  it('[NOA-10] 登録の 500 は ApiError', async () => {
    server.use(errorHandler(CREATE_PATH))

    const error = await createOrder(order()).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
  })
})
