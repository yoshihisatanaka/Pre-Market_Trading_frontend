import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { canceledMarketHolidays, marketHolidays } from '@/mocks/fixtures/marketHolidays'
import {
  MARKET_HOLIDAY_TYPE_DEFAULT,
  MARKET_HOLIDAY_TYPE_OPTIONS,
} from '@/utils/marketHolidayTypes'
import { MARKET_HOLIDAYS_PAGE_SIZE, useMarketHolidaysStore } from './marketHolidays'
import { useMarketStatusStore } from './marketStatus'

/*
 * フィクスチャはバックエンドの生の形（日本語キー / 休場日は YYYYMMDD の integer）なので、
 * 期待値を作るときはここで 'YYYY-MM-DD' に直す（アプリ内モデルの形は api 層が決める）。
 */
const toIsoDate = (holidayDate) => {
  const digits = String(holidayDate)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
// 主キーは休場日ではなく ID（api 層が文字列にして返す）
const toId = (holiday) => String(holiday.ID)

// 期待値はフィクスチャと表示件数から導く（56 / 50 を直接書かない）
const PAGE_SIZE = MARKET_HOLIDAYS_PAGE_SIZE
const TOTAL = marketHolidays.length
// フィクスチャは実 API と同じ休場日の降順なので、この並びがそのまま 1 ページ目になる
const firstPage = marketHolidays.slice(0, PAGE_SIZE)
const secondPage = marketHolidays.slice(PAGE_SIZE, PAGE_SIZE * 2)

// 登録用の日付を作るための年。フィクスチャ先頭の年をそのまま使う（年もハードコードしない）
const YEAR = String(marketHolidays[0].休場日).slice(0, 4)

/*
 * 絞り込みは画面モックどおり 1 日指定（date）。フィクスチャの 2 件目の日付を使い、
 * その日の行（休場日は一意なので 1 件）を期待値にする。
 */
const FILTER_ROW = marketHolidays[1]
const FILTER_DATE = toIsoDate(FILTER_ROW.休場日)
const onFilterDate = marketHolidays.filter((holiday) => holiday.休場日 === FILTER_ROW.休場日)

// 登録に使う「フィクスチャに無い日付」もフィクスチャから導く（既存日付と衝突したら別日になる）
const existingDates = new Set(marketHolidays.map((holiday) => toIsoDate(holiday.休場日)))
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
const shortenedHolidays = marketHolidays.filter((holiday) => holiday.休場区分 === SHORTENED_TYPE)
const NEW_TYPE = MARKET_HOLIDAY_TYPE_DEFAULT

// 既定ハンドラの事前検証は既存の日付を弾くので、既存日付をそのまま重複の再現に使う
const DUPLICATE_DATE = toIsoDate(marketHolidays[0].休場日)
const DUPLICATE_MESSAGE = `休場日 ${marketHolidays[0].休場日} は既に登録されています`

// 取消済み（論理削除）の日付。事前検証が「再有効化になる」と警告を返す
const CANCELED_DATE = toIsoDate(canceledMarketHolidays[0].休場日)
const REACTIVATION_WARNING = 'この日付は以前登録され削除されています。再度有効にします'

// 削除の対象と、既定ハンドラが 404 を返す「存在しない id」
const DELETE_TARGET = marketHolidays[0]
const DELETE_TARGET_ID = toId(DELETE_TARGET)
// 採番は取消済みも含めて 1..57 なので、この id は必ず存在しない
const MISSING_ID = '999999'
const NOT_FOUND_MESSAGE = `指定された海外休場日が存在しません: ${MISSING_ID}`

const ids = (items) => items.map((item) => item.id)
const dates = (items) => items.map((item) => item.date)
const expectedIds = (rows) => rows.map(toId)

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
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[MHS-02] API がエラーを返したとき error に ApiError が入り items は空のままになる', async () => {
    server.use(
      http.get('*/api/masters/market-holidays', () =>
        HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }),
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
      http.get('*/api/masters/market-holidays', () =>
        HttpResponse.json({ total: 0, limit: PAGE_SIZE, offset: 0, holidays: [] }),
      ),
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
    expect(ids(store.items)).toEqual(expectedIds(secondPage))
  })

  it('[MHS-05] 日付で絞り込むとその日の行だけになり total も絞り込み後の件数になる', async () => {
    const store = useMarketHolidaysStore()

    await store.load({ date: FILTER_DATE })

    expect(store.date).toBe(FILTER_DATE)
    expect(store.total).toBe(onFilterDate.length)
    expect(ids(store.items)).toEqual(expectedIds(onFilterDate))
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
      http.get('*/api/masters/market-holidays', async ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
        // 1 ページ目だけ遅らせ、「古い応答が後から返る」状況を作る
        if (offset === 0) await delay(50)
        return HttpResponse.json({
          total: TOTAL,
          limit: PAGE_SIZE,
          offset,
          holidays: marketHolidays.slice(offset, offset + PAGE_SIZE),
        })
      }),
    )
    const store = useMarketHolidaysStore()

    const stale = store.load({ offset: 0 })
    const fresh = store.load({ offset: PAGE_SIZE })
    await Promise.all([fresh, stale])

    expect(ids(store.items)).toEqual(expectedIds(secondPage))
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

  it('[MHS-09] 日付が重複したとき事前検証で弾かれ validationErrors に理由が入る', async () => {
    const store = useMarketHolidaysStore()
    await store.load()

    const created = await store.create({
      date: DUPLICATE_DATE,
      reason: NEW_REASON,
      holidayType: NEW_TYPE,
    })

    expect(created).toBeNull()
    // 事前検証の不合格は通信エラーではないので createError には入らない
    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([DUPLICATE_MESSAGE])
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[MHS-10] create 後の読み直しでもページ位置と絞り込みが保たれる', async () => {
    /*
     * これから登録する日付で絞っておく（登録前は 0 件）。1 日指定の結果は 1 ページに収まるので、
     * 表示件数の位置には行が無い。読み直しが全件に戻れば TOTAL + 1、1 ページ目に戻れば
     * 登録した行が見える。
     */
    const store = useMarketHolidaysStore()
    await store.load({ offset: PAGE_SIZE, date: NEW_DATE })
    expect(store.total).toBe(0)

    await store.create({ date: NEW_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })

    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.date).toBe(NEW_DATE)
    expect(store.total).toBe(1)
    expect(store.items).toEqual([])
  })

  it('[MHS-11] clearCreateError で登録エラーと事前検証の理由が消える', async () => {
    server.use(
      http.post('*/api/masters/market-holidays', () =>
        HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }),
      ),
    )
    const store = useMarketHolidaysStore()
    await store.create({ date: NEW_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })
    expect(store.createError).not.toBeNull()

    store.clearCreateError()

    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])
    expect(store.validationWarnings).toEqual([])
  })

  it('[MHS-12] 登録中は creating だけが true になり一覧の loading は false のまま', async () => {
    server.use(
      http.post('*/api/masters/market-holidays', async () => {
        await delay(50)
        return HttpResponse.json(
          {
            success: true,
            holiday: {
              休場日: Number(NEW_DATE.replaceAll('-', '')),
              休場区分: NEW_TYPE,
              休場理由: NEW_REASON,
              取消区分: 0,
            },
            message: '海外休場日を登録しました',
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
    expect(ids(store.items)).toContain(DELETE_TARGET_ID)

    const removed = await store.remove(DELETE_TARGET_ID)

    expect(removed).toBe(true)
    expect(store.deleteError).toBeNull()
    expect(store.total).toBe(TOTAL - 1)
    expect(ids(store.items)).not.toContain(DELETE_TARGET_ID)
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
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[MHS-15] remove 後の読み直しでもページ位置と絞り込みが保たれる', async () => {
    // 削除する行の日付で絞っておく
    const targetDate = toIsoDate(DELETE_TARGET.休場日)
    const store = useMarketHolidaysStore()
    await store.load({ offset: PAGE_SIZE, date: targetDate })
    const before = store.total

    await store.remove(DELETE_TARGET_ID)

    // 論理削除なので取消区分 1 の行は返らず、その日の件数が 1 減る（全件に戻れば TOTAL - 1）
    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.date).toBe(targetDate)
    expect(store.total).toBe(before - 1)
    expect(store.items).toEqual([])
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
      http.delete('*/api/masters/market-holidays/:id', async () => {
        await delay(50)
        return HttpResponse.json({
          success: true,
          holiday: { ...DELETE_TARGET, 取消区分: 1 },
          message: '海外休場日を削除しました',
        })
      }),
    )
    const store = useMarketHolidaysStore()
    await store.load()

    const pending = store.remove(DELETE_TARGET_ID)

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
    expect(ids(store.items)).toEqual(expectedIds(shortenedHolidays))
  })

  it('[MHS-19] reload は休場区分の絞り込みも保ったまま取り直す', async () => {
    /*
     * 短縮取引ではない行の日付と「短縮取引」を組み合わせ、両方に合う行が無い条件にする。
     * 休場区分が落ちればその日の行が、日付が落ちれば短縮取引の行が現れるので、
     * 0 件のままなら両方の条件が保たれている。
     */
    const regularRow = marketHolidays.find((holiday) => holiday.休場区分 !== SHORTENED_TYPE)
    const regularDate = toIsoDate(regularRow.休場日)
    const store = useMarketHolidaysStore()
    await store.load({ date: regularDate, holidayType: SHORTENED_TYPE })

    await store.reload()

    expect(store.holidayType).toBe(SHORTENED_TYPE)
    expect(store.date).toBe(regularDate)
    expect(store.total).toBe(0)
    expect(store.items).toEqual([])
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

  it('[MHS-21] 取消済みの日付は警告を返し、1 回目は登録しない', async () => {
    const store = useMarketHolidaysStore()
    await store.load()

    const created = await store.create({
      date: CANCELED_DATE,
      reason: NEW_REASON,
      holidayType: NEW_TYPE,
    })

    expect(created).toBeNull()
    expect(store.validationWarnings).toEqual([REACTIVATION_WARNING])
    // 警告は登録できない理由ではないので、errors にも createError にも入らない
    expect(store.validationErrors).toEqual([])
    expect(store.createError).toBeNull()
    expect(store.total).toBe(TOTAL)
    expect(dates(store.items)).not.toContain(CANCELED_DATE)
  })

  it('[MHS-22] 警告を承知して押し直すと登録され一覧に現れる', async () => {
    const store = useMarketHolidaysStore()
    await store.load()
    await store.create({ date: CANCELED_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })

    const created = await store.create({
      date: CANCELED_DATE,
      reason: NEW_REASON,
      holidayType: NEW_TYPE,
      acknowledgedWarnings: true,
    })

    expect(created).toMatchObject({ date: CANCELED_DATE, reason: NEW_REASON })
    expect(store.validationWarnings).toEqual([])
    // 取消済みの行が有効に戻るので、一覧の件数は 1 件増える（行そのものは増えていない）
    expect(store.total).toBe(TOTAL + 1)
    expect(dates(store.items)).toContain(CANCELED_DATE)
  })

  /*
   * 当日を短縮取引・休場にしたときにヘッダを追随させるため、保存に成功したら市場状況を取り直す。
   * 市場状況の load は差し替えて、呼ばれたかどうかだけを見る（通信の中身は MSS の担当）。
   */
  const spyMarketStatusLoad = () =>
    vi.spyOn(useMarketStatusStore(), 'load').mockResolvedValue(null)

  it('[MHS-23] create が成功すると市場状況を取り直す', async () => {
    const load = spyMarketStatusLoad()
    const store = useMarketHolidaysStore()
    await store.load()

    await store.create({ date: NEW_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('[MHS-24] remove が成功すると市場状況を取り直す', async () => {
    const load = spyMarketStatusLoad()
    const store = useMarketHolidaysStore()
    await store.load()

    await store.remove(DELETE_TARGET_ID)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('[MHS-25] 保存に至らなかったときは市場状況を取り直さない', async () => {
    const load = spyMarketStatusLoad()
    const store = useMarketHolidaysStore()
    await store.load()

    // 事前検証で不合格
    await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })
    // 存在しない id の削除は 404
    await store.remove(MISSING_ID)
    // 事前検証は通るが登録が 500
    server.use(
      http.post('*/api/masters/market-holidays', () =>
        HttpResponse.json({ detail: 'サーバーでエラーが発生しました。' }, { status: 500 }),
      ),
    )
    await store.create({ date: NEW_DATE, reason: NEW_REASON, holidayType: NEW_TYPE })

    expect(store.createError).not.toBeNull()
    expect(store.deleteError).not.toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
