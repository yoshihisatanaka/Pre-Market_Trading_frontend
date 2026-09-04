import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { marketHolidays } from '@/mocks/fixtures/marketHolidays'
import { MARKET_HOLIDAYS_PAGE_SIZE, useMarketHolidaysStore } from './marketHolidays'

// 期待値はフィクスチャと表示件数から導く（56 / 50 を直接書かない）
const PAGE_SIZE = MARKET_HOLIDAYS_PAGE_SIZE
const TOTAL = marketHolidays.length
const firstPage = marketHolidays.slice(0, PAGE_SIZE)
const secondPage = marketHolidays.slice(PAGE_SIZE, PAGE_SIZE * 2)

// 絞り込みはフィクスチャ先頭の年をそのまま使う（年もハードコードしない）
const YEAR = marketHolidays[0].date.slice(0, 4)
const DATE_FROM = `${YEAR}-01-01`
const DATE_TO = `${YEAR}-12-31`
const inYear = marketHolidays.filter((holiday) => holiday.date.startsWith(YEAR))

const ids = (items) => items.map((item) => item.id)

describe('useMarketHolidaysStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // シナリオ: docs/unit/stores-market-holidays.md
  it('[MHS-01] 既定では 1 ページ目を読み込み total を保持する', async () => {
    const store = useMarketHolidaysStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.offset).toBe(0)
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(ids(firstPage))
  })

  it('[MHS-02] API がエラーを返したとき error に ApiError が入り items は空のままになる', async () => {
    server.use(
      http.get('*/api/market-holidays', () =>
        HttpResponse.json({ message: 'サーバーでエラーが発生しました。' }, { status: 500 }),
      ),
    )
    const store = useMarketHolidaysStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.items).toEqual([])
    expect(store.error).toBeInstanceOf(Error)
    expect(store.error.status).toBe(500)
    expect(store.error.message).toBe('サーバーでエラーが発生しました。')
  })

  it('[MHS-03] 空配列が返ったとき isEmpty が true になる', async () => {
    server.use(
      http.get('*/api/market-holidays', () => HttpResponse.json({ items: [], total: 0 })),
    )
    const store = useMarketHolidaysStore()

    await store.load()

    expect(store.isEmpty).toBe(true)
  })

  it('[MHS-04] offset を保ったままその位置のページを読み込む', async () => {
    const store = useMarketHolidaysStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(ids(secondPage))
  })

  it('[MHS-05] 日付で絞り込むと total も絞り込み後の件数になる', async () => {
    const store = useMarketHolidaysStore()

    await store.load({ dateFrom: DATE_FROM, dateTo: DATE_TO })

    expect(store.dateFrom).toBe(DATE_FROM)
    expect(store.dateTo).toBe(DATE_TO)
    expect(store.total).toBe(inYear.length)
    expect(ids(store.items)).toEqual(ids(inYear))
  })

  it('[MHS-06] reload は直前のページ位置と絞り込みを保ったまま取り直す', async () => {
    const store = useMarketHolidaysStore()
    await store.load({ offset: PAGE_SIZE })
    const before = ids(store.items)

    await store.reload()

    expect(store.offset).toBe(PAGE_SIZE)
    expect(ids(store.items)).toEqual(before)
  })

  it('[MHS-07] 後から届いた古い応答で結果が巻き戻らない', async () => {
    server.use(
      http.get('*/api/market-holidays', async ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
        // 1 ページ目だけ遅らせ、「古い応答が後から返る」状況を作る
        if (offset === 0) await delay(50)
        return HttpResponse.json({
          items: marketHolidays.slice(offset, offset + PAGE_SIZE),
          total: TOTAL,
        })
      }),
    )
    const store = useMarketHolidaysStore()

    const stale = store.load({ offset: 0 })
    const fresh = store.load({ offset: PAGE_SIZE })
    await Promise.all([fresh, stale])

    expect(ids(store.items)).toEqual(ids(secondPage))
  })
})
