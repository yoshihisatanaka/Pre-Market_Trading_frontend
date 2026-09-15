import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { orderListResponse } from '@/mocks/fixtures/orders'
import { fetchOrders } from './orders'

/*
 * API 層のテスト。ここだけが「バックエンドの形」（items 配列・ordered_at の snake_case）を
 * 知ってよい層なので、送り出すリクエストそのものと、生データ 1 件の変換規則を固定する。
 *
 * ストア・画面のテストは MSW のモックが返した結果を見ているので、モックと実装が
 * 同じ誤解をしていても気づけない。ずれをこの 1 か所で見つけられるようにしておく。
 *
 * シナリオ: docs/unit/api-orders.md
 */

/** 届いたリクエストの記録（1 テスト内で複数回叩く場合があるので配列） */
let requests = []

afterEach(() => {
  requests = []
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(body, status = 200) {
  server.use(
    http.get('*/api/orders', ({ request }) => {
      const url = new URL(request.url)
      requests.push({ url, params: url.searchParams })
      return HttpResponse.json(body, { status })
    }),
  )
}

/** バックエンドが返す生の注文 1 件（fixtures と同じ形） */
const rawOrder = {
  id: 'ord_9001',
  symbol: 'AAPL',
  name: 'Apple Inc.',
  side: 'buy',
  quantity: 10,
  price: 227.52,
  status: 'filled',
  ordered_at: '2026-08-25T14:32:00Z',
}

/** アプリ内モデルが持つキー（この 8 つだけを外へ出す） */
const modelKeys = ['id', 'symbol', 'name', 'side', 'quantity', 'price', 'status', 'orderedAt']

describe('api/orders', () => {
  it('[ORA-01] 一覧取得は /api/orders へクエリなしで 1 回だけ送る', async () => {
    record({ items: [] })

    await fetchOrders()

    expect(requests).toHaveLength(1)
    expect(requests[0].url.pathname).toBe('/api/orders')
    // 絞り込みもページングも持たない API なので、クエリは 1 つも載らない
    expect([...requests[0].params.keys()]).toEqual([])
  })

  it('[ORA-02] ordered_at を orderedAt に変換し、他の項目は同名で素通しする', async () => {
    record({ items: [rawOrder] })

    const orders = await fetchOrders()

    expect(orders).toEqual([
      {
        id: rawOrder.id,
        symbol: rawOrder.symbol,
        name: rawOrder.name,
        side: rawOrder.side,
        quantity: rawOrder.quantity,
        price: rawOrder.price,
        status: rawOrder.status,
        orderedAt: rawOrder.ordered_at,
      },
    ])
  })

  it('[ORA-03] アプリが使わないキーは外へ出さない', async () => {
    record({ items: [{ ...rawOrder, settled_at: '2026-08-27T00:00:00Z', venue: 'NASDAQ' }] })

    const orders = await fetchOrders()

    expect(Object.keys(orders[0]).sort()).toEqual([...modelKeys].sort())
  })

  it('[ORA-04] 応答の並び順のまま配列そのものを返す', async () => {
    const rawOrders = ['ord_9001', 'ord_9002', 'ord_9003'].map((id) => ({ ...rawOrder, id }))
    record({ items: rawOrders, total: rawOrders.length })

    const orders = await fetchOrders()

    expect(Array.isArray(orders)).toBe(true)
    expect(orders.map((order) => order.id)).toEqual(rawOrders.map((raw) => raw.id))
  })

  it('[ORA-05] items が無い応答・items が null の応答は空配列になる', async () => {
    record({ total: 0 })
    expect(await fetchOrders()).toEqual([])

    record({ items: null, total: 0 })
    expect(await fetchOrders()).toEqual([])
  })

  it('[ORA-06] items が空配列なら空配列を返す', async () => {
    record({ items: [], total: 0 })

    expect(await fetchOrders()).toEqual([])
  })

  it('[ORA-07] 数値は数値のまま、side / status は原文字列のまま返す', async () => {
    record({
      items: [{ ...rawOrder, quantity: 20, price: 133.86, side: 'sell', status: 'canceled' }],
    })

    const [order] = await fetchOrders()

    expect(order.quantity).toBe(20)
    expect(order.price).toBe(133.86)
    // 表示用の言い換え（「売」「取消」など）はこの層では行わない
    expect(order.side).toBe('sell')
    expect(order.status).toBe('canceled')
  })

  it('[ORA-08] ordered_at が null / 欠落でも空文字へ寄せず素通しする', async () => {
    record({ items: [{ ...rawOrder, ordered_at: null }] })
    const [nulled] = await fetchOrders()
    expect(nulled.orderedAt).toBeNull()

    const { ordered_at: _omitted, ...withoutOrderedAt } = rawOrder
    record({ items: [withoutOrderedAt] })
    const [missing] = await fetchOrders()
    expect(missing.orderedAt).toBeUndefined()
  })

  it('[ORA-09] 既定モックのフィクスチャをそのまま変換できる', async () => {
    const orders = await fetchOrders()

    expect(orders).toHaveLength(orderListResponse.items.length)
    expect(orders[0].orderedAt).toBe(orderListResponse.items[0].ordered_at)
    expect(orders[0].id).toBe(orderListResponse.items[0].id)
  })

  it('[ORA-10] サーバエラーは例外になる', async () => {
    record({ detail: 'サーバーでエラーが発生しました。' }, 500)

    await expect(fetchOrders()).rejects.toBeTruthy()
  })
})
