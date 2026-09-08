import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { marketHolidays } from '@/mocks/fixtures/marketHolidays'
import {
  MARKET_HOLIDAY_TYPE_DEFAULT,
  MARKET_HOLIDAY_TYPE_OPTIONS,
} from '@/utils/marketHolidayTypes'
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

// 全期間を含む絞り込み条件（先頭 / 末尾の日付そのもの）
const ALL_FROM = marketHolidays[0].date
const ALL_TO = marketHolidays[marketHolidays.length - 1].date

// 登録に使う「フィクスチャに無い日付」もフィクスチャから導く（既存日付と衝突したら別日になる）
const existingDates = new Set(marketHolidays.map((holiday) => holiday.date))
const NEW_DATE = (() => {
  for (let day = 1; day <= 28; day += 1) {
    const date = `${YEAR}-06-${String(day).padStart(2, '0')}`
    if (!existingDates.has(date)) return date
  }
  throw new Error('フィクスチャに無い日付が見つからなかった')
})()
const NEW_REASON = 'テスト休場日'

/*
 * 休場区分。コードは選択肢の定義から引き、件数はフィクスチャを数えて出す
 * （'1' が 7 件、といった内訳を直接書かない）。
 */
const SHORTENED_TYPE = MARKET_HOLIDAY_TYPE_OPTIONS[1].value
const shortenedHolidays = marketHolidays.filter(
  (holiday) => holiday.holiday_type === SHORTENED_TYPE,
)
const NEW_TYPE = MARKET_HOLIDAY_TYPE_DEFAULT

// 既定ハンドラは日付が重複すると 409 を返すので、既存日付をそのまま重複の再現に使う
const DUPLICATE_DATE = marketHolidays[0].date

// 削除の対象と、既定ハンドラが 404 を返す「存在しない id」もフィクスチャから導く
const DELETE_TARGET = marketHolidays[0]
const MISSING_ID = `${DELETE_TARGET.id}_missing`
const NOT_FOUND_MESSAGE = '対象の海外休場日が見つかりません。'

const ids = (items) => items.map((item) => item.id)
const dates = (items) => items.map((item) => item.date)

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

  it('[MHS-08] create が成功すると一覧が読み直され登録した日付が現れる', async () => {
    const store = useMarketHolidaysStore()
    await store.load()

    const created = await store.create({
      date: NEW_DATE,
      reason: NEW_REASON,
      holidayType: NEW_TYPE,
    })

    expect(created).toMatchObject({
      date: NEW_DATE,
      reason: NEW_REASON,
      holidayType: NEW_TYPE,
    })
    expect(store.createError).toBeNull()
    expect(store.total).toBe(TOTAL + 1)
    expect(dates(store.items)).toContain(NEW_DATE)
  })

  it('[MHS-09] 日付が重複したとき createError に 409 が入り一覧は変わらない', async () => {
    const store = useMarketHolidaysStore()
    await store.load()

    const created = await store.create({
      date: DUPLICATE_DATE,
      reason: NEW_REASON,
      holidayType: NEW_TYPE,
    })

    expect(created).toBeNull()
    expect(store.createError).toBeInstanceOf(Error)
    expect(store.createError.status).toBe(409)
    expect(store.createError.message).toBe('その日付の海外休場日はすでに登録されています。')
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(ids(firstPage))
  })

  it('[MHS-10] create 後の読み直しでもページ位置と絞り込みが保たれる', async () => {
    const store = useMarketHolidaysStore()
    await store.load({ offset: PAGE_SIZE, dateFrom: ALL_FROM, dateTo: ALL_TO })

    await store.create({ date: NEW_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })

    // 登録後の一覧は日付昇順のまま 1 件増える
    const expected = [...marketHolidays, { date: NEW_DATE, reason: NEW_REASON }].sort((a, b) =>
      a.date.localeCompare(b.date),
    )
    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.dateFrom).toBe(ALL_FROM)
    expect(store.dateTo).toBe(ALL_TO)
    expect(store.total).toBe(TOTAL + 1)
    expect(dates(store.items)).toEqual(dates(expected.slice(PAGE_SIZE, PAGE_SIZE * 2)))
  })

  it('[MHS-11] clearCreateError で登録エラーが消える', async () => {
    const store = useMarketHolidaysStore()
    // 休場区分まで正しく埋めて、狙いどおり「日付重複」で失敗させる
    // （区分を欠くとモックの検証順で先に 400 になり、別の経路を見てしまう）
    await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })
    expect(store.createError).not.toBeNull()

    store.clearCreateError()

    expect(store.createError).toBeNull()
  })

  it('[MHS-12] 登録中は creating だけが true になり一覧の loading は false のまま', async () => {
    server.use(
      http.post('*/api/market-holidays', async () => {
        await delay(50)
        return HttpResponse.json(
          {
            id: `mhd_${NEW_DATE.replaceAll('-', '')}`,
            date: NEW_DATE,
            reason: NEW_REASON,
            holiday_type: NEW_TYPE,
          },
          { status: 201 },
        )
      }),
    )
    const store = useMarketHolidaysStore()
    await store.load()

    const pending = store.create({ date: NEW_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })

    expect(store.creating).toBe(true)
    expect(store.loading).toBe(false)

    await pending
    expect(store.creating).toBe(false)
  })

  it('[MHS-13] remove が成功すると一覧が読み直され対象の id が消える', async () => {
    const store = useMarketHolidaysStore()
    await store.load()
    expect(ids(store.items)).toContain(DELETE_TARGET.id)

    const removed = await store.remove(DELETE_TARGET.id)

    expect(removed).toBe(true)
    expect(store.deleteError).toBeNull()
    expect(store.total).toBe(TOTAL - 1)
    expect(ids(store.items)).not.toContain(DELETE_TARGET.id)
  })

  it('[MHS-14] 存在しない id のとき deleteError に 404 が入り一覧は変わらない', async () => {
    const store = useMarketHolidaysStore()
    await store.load()

    const removed = await store.remove(MISSING_ID)

    expect(removed).toBe(false)
    expect(store.deleteError).toBeInstanceOf(Error)
    expect(store.deleteError.status).toBe(404)
    expect(store.deleteError.message).toBe(NOT_FOUND_MESSAGE)
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(ids(firstPage))
  })

  it('[MHS-15] remove 後の読み直しでもページ位置と絞り込みが保たれる', async () => {
    const store = useMarketHolidaysStore()
    await store.load({ offset: PAGE_SIZE, dateFrom: ALL_FROM, dateTo: ALL_TO })

    await store.remove(DELETE_TARGET.id)

    // 削除後の一覧は日付昇順のまま 1 件減る
    const remaining = marketHolidays.filter((holiday) => holiday.id !== DELETE_TARGET.id)
    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.dateFrom).toBe(ALL_FROM)
    expect(store.dateTo).toBe(ALL_TO)
    expect(store.total).toBe(TOTAL - 1)
    expect(ids(store.items)).toEqual(ids(remaining.slice(PAGE_SIZE, PAGE_SIZE * 2)))
  })

  it('[MHS-16] clearDeleteError で削除エラーが消える', async () => {
    const store = useMarketHolidaysStore()
    await store.remove(MISSING_ID)
    expect(store.deleteError).not.toBeNull()

    store.clearDeleteError()

    expect(store.deleteError).toBeNull()
  })

  it('[MHS-17] 削除中は deleting だけが true になり一覧の loading は false のまま', async () => {
    server.use(
      http.delete('*/api/market-holidays/:id', async () => {
        await delay(50)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const store = useMarketHolidaysStore()
    await store.load()

    const pending = store.remove(DELETE_TARGET.id)

    expect(store.deleting).toBe(true)
    expect(store.loading).toBe(false)

    await pending
    expect(store.deleting).toBe(false)
  })

  it('[MHS-18] 休場区分で絞り込むと total も絞り込み後の件数になる', async () => {
    const store = useMarketHolidaysStore()

    await store.load({ holidayType: SHORTENED_TYPE })

    expect(store.holidayType).toBe(SHORTENED_TYPE)
    expect(store.total).toBe(shortenedHolidays.length)
    expect(ids(store.items)).toEqual(ids(shortenedHolidays))
  })

  it('[MHS-19] reload は休場区分の絞り込みも保ったまま取り直す', async () => {
    const store = useMarketHolidaysStore()
    await store.load({
      dateFrom: ALL_FROM,
      dateTo: ALL_TO,
      holidayType: SHORTENED_TYPE,
    })

    await store.reload()

    expect(store.holidayType).toBe(SHORTENED_TYPE)
    expect(store.dateFrom).toBe(ALL_FROM)
    expect(store.dateTo).toBe(ALL_TO)
    // 条件が落ちて全件に戻っていないこと
    expect(store.total).toBe(shortenedHolidays.length)
    expect(ids(store.items)).toEqual(ids(shortenedHolidays))
  })

  it('[MHS-20] create は休場区分を送り、登録された行にその区分が入る', async () => {
    const store = useMarketHolidaysStore()
    await store.load()

    const created = await store.create({
      date: NEW_DATE,
      reason: NEW_REASON,
      holidayType: SHORTENED_TYPE,
    })

    expect(created).toMatchObject({ date: NEW_DATE, holidayType: SHORTENED_TYPE })
    expect(store.createError).toBeNull()
    // 読み直した一覧側でも区分が保たれている（POST の応答だけの話にしない）
    const row = store.items.find((item) => item.date === NEW_DATE)
    expect(row?.holidayType).toBe(SHORTENED_TYPE)
  })
})
