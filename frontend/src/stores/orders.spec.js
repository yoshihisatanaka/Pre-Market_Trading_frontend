import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { useOrdersStore } from './orders'

describe('useOrdersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('MSW のモック応答をアプリ内モデル(camelCase)に変換して保持する', async () => {
    const store = useOrdersStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.items).toHaveLength(3)
    expect(store.items[0]).toMatchObject({
      id: 'ord_0001',
      symbol: 'AAPL',
      side: 'buy',
      quantity: 10,
      // api 層で ordered_at → orderedAt に変換されていること
      orderedAt: '2026-08-25T14:32:00Z',
    })
  })

  it('API がエラーを返したとき error に ApiError が入り items は空のままになる', async () => {
    server.use(
      http.get('*/api/orders', () =>
        HttpResponse.json({ message: 'サーバーでエラーが発生しました。' }, { status: 500 }),
      ),
    )
    const store = useOrdersStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.items).toEqual([])
    expect(store.error).toBeInstanceOf(Error)
    expect(store.error.status).toBe(500)
    expect(store.error.message).toBe('サーバーでエラーが発生しました。')
  })

  it('空配列が返ったとき isEmpty が true になる', async () => {
    server.use(http.get('*/api/orders', () => HttpResponse.json({ items: [], total: 0 })))
    const store = useOrdersStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
  })
})
