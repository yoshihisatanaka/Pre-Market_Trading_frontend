import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { blockedDates } from '@/mocks/fixtures/blockedDates'
import { BLOCKED_DATES_PAGE_SIZE, useBlockedDatesStore } from './blockedDates'

// 期待値はフィクスチャと表示件数から導く（件数を直接書かない）
const PAGE_SIZE = BLOCKED_DATES_PAGE_SIZE
const TOTAL = blockedDates.length
const firstPage = blockedDates.slice(0, PAGE_SIZE)
const secondPage = blockedDates.slice(PAGE_SIZE, PAGE_SIZE * 2)

// 絞り込みはフィクスチャ先頭の年をそのまま使う（年もハードコードしない）
const YEAR = blockedDates[0].date.slice(0, 4)
const DATE_FROM = `${YEAR}-01-01`
const DATE_TO = `${YEAR}-12-31`
const inYear = blockedDates.filter((blocked) => blocked.date.startsWith(YEAR))

// 全期間を含む絞り込み条件（先頭 / 末尾の日付そのもの）
const ALL_FROM = blockedDates[0].date
const ALL_TO = blockedDates[blockedDates.length - 1].date

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

const ids = (items) => items.map((item) => item.id)

const errorHandler = (options) =>
  http.get(
    '*/api/blocked-dates',
    () => HttpResponse.json({ message: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get('*/api/blocked-dates', () => HttpResponse.json({ items: [], total: 0 }), options)

describe('useBlockedDatesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // シナリオ: docs/unit/stores-blocked-dates.md
  it('[BDS-01] 既定では 1 ページ目を読み込み total を保持する', async () => {
    const store = useBlockedDatesStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.offset).toBe(0)
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(ids(firstPage))
  })

  it('[BDS-02] API がエラーを返したとき error に ApiError が入り items は空のままになる', async () => {
    server.use(errorHandler())
    const store = useBlockedDatesStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.items).toEqual([])
    expect(store.error).toBeInstanceOf(Error)
    expect(store.error.status).toBe(500)
    expect(store.error.message).toBe(ERROR_MESSAGE)
  })

  it('[BDS-03] offset を保ったままその位置のページを読み込む', async () => {
    const store = useBlockedDatesStore()

    await store.load({ offset: PAGE_SIZE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(ids(secondPage))
  })

  it('[BDS-04] 日付で絞り込むと total も絞り込み後の件数になる', async () => {
    const store = useBlockedDatesStore()

    await store.load({ dateFrom: DATE_FROM, dateTo: DATE_TO })

    expect(store.dateFrom).toBe(DATE_FROM)
    expect(store.dateTo).toBe(DATE_TO)
    expect(store.total).toBe(inYear.length)
    expect(ids(store.items)).toEqual(ids(inYear))
  })

  it('[BDS-05] 取得中は loading が true になり完了すると false に戻る', async () => {
    server.use(
      http.get('*/api/blocked-dates', async () => {
        await delay(50)
        return HttpResponse.json({ items: firstPage, total: TOTAL })
      }),
    )
    const store = useBlockedDatesStore()

    const pending = store.load()

    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
    expect(ids(store.items)).toEqual(ids(firstPage))
  })

  it('[BDS-06] isEmpty は 0 件かつ非ローディング・非エラーのときだけ true になる', async () => {
    server.use(emptyHandler({ once: true }))
    const store = useBlockedDatesStore()

    await store.load()
    expect(store.isEmpty).toBe(true)

    // エラーのときは 0 件でも空状態にしない（エラー表示と二重に出さないため）
    server.use(errorHandler())
    await store.load()
    expect(store.items).toEqual([])
    expect(store.isEmpty).toBe(false)
  })

  it('[BDS-07] エラー後に再取得が成功すると error が null に戻る', async () => {
    server.use(errorHandler({ once: true }))
    const store = useBlockedDatesStore()

    await store.load()
    expect(store.error).not.toBeNull()

    await store.load()

    expect(store.error).toBeNull()
    expect(ids(store.items)).toEqual(ids(firstPage))
  })

  it('[BDS-08] reload は直前のページ位置と絞り込みを保ったまま取り直す', async () => {
    const store = useBlockedDatesStore()
    await store.load({ offset: PAGE_SIZE, dateFrom: ALL_FROM, dateTo: ALL_TO })
    const before = ids(store.items)

    await store.reload()

    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.dateFrom).toBe(ALL_FROM)
    expect(store.dateTo).toBe(ALL_TO)
    expect(ids(store.items)).toEqual(before)
    expect(ids(store.items)).toEqual(ids(secondPage))
  })

  it('[BDS-09] 後から届いた古い応答で結果が巻き戻らない', async () => {
    server.use(
      http.get('*/api/blocked-dates', async ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
        // 1 ページ目だけ遅らせ、「古い応答が後から返る」状況を作る
        if (offset === 0) await delay(50)
        return HttpResponse.json({
          items: blockedDates.slice(offset, offset + PAGE_SIZE),
          total: TOTAL,
        })
      }),
    )
    const store = useBlockedDatesStore()

    const stale = store.load({ offset: 0 })
    const fresh = store.load({ offset: PAGE_SIZE })
    await Promise.all([fresh, stale])

    expect(ids(store.items)).toEqual(ids(secondPage))
  })

  it('[BDS-10] limit は表示件数の定数でリクエストにも載る', async () => {
    let sentLimit = null
    server.use(
      http.get('*/api/blocked-dates', ({ request }) => {
        sentLimit = new URL(request.url).searchParams.get('limit')
        return HttpResponse.json({ items: firstPage, total: TOTAL })
      }),
    )
    const store = useBlockedDatesStore()

    await store.load()

    expect(store.limit).toBe(PAGE_SIZE)
    expect(sentLimit).toBe(String(PAGE_SIZE))
  })
})
