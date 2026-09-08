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

// 登録に使う「フィクスチャに無い日付」もフィクスチャから導く（既存日付と衝突したら別日になる）
const existingDates = new Set(blockedDates.map((blocked) => blocked.date))
const NEW_DATE = (() => {
  for (let day = 1; day <= 28; day += 1) {
    const date = `${YEAR}-06-${String(day).padStart(2, '0')}`
    if (!existingDates.has(date)) return date
  }
  throw new Error('フィクスチャに無い日付が見つからなかった')
})()
const NEW_REASON = 'テスト受注不可日'

// 既定の事前検証は既存の日付を重複として弾くので、フィクスチャ先頭の日付をそのまま使う
const DUPLICATE_DATE = blockedDates[0].date

// 事前検証・登録ハンドラが返す文言（src/mocks/handlers/index.js と共有する定数）
const DUPLICATE_MESSAGE = 'その日付の受注不可日はすでに登録されています。'
const INVALID_DATE_MESSAGE = '日付は YYYY-MM-DD 形式で入力してください。'
const INVALID_REASON_MESSAGE = '理由を入力してください。'

const ids = (items) => items.map((item) => item.id)
const dates = (items) => items.map((item) => item.date)

// 事前検証（HTTP は常に 200。可否は valid / errors で表す）を差し替えるためのハンドラ
const validateErrorHandler = (options) =>
  http.post(
    '*/api/blocked-dates/validate',
    () => HttpResponse.json({ message: ERROR_MESSAGE }, { status: 500 }),
    options,
  )

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

  it('[BDS-11] create が成功すると一覧が読み直され登録した日付が現れる', async () => {
    const store = useBlockedDatesStore()
    await store.load()

    const created = await store.create({ date: NEW_DATE, reason: NEW_REASON })

    expect(created).toMatchObject({ date: NEW_DATE, reason: NEW_REASON })
    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])
    expect(store.total).toBe(TOTAL + 1)
    expect(dates(store.items)).toContain(NEW_DATE)

    // 対象市場はリクエストに含めずサーバが決める。応答と一覧の行で同じ値になっていること
    const row = store.items.find((item) => item.date === NEW_DATE)
    expect(created.market).toBeTruthy()
    expect(row?.market).toBe(created.market)
  })

  it('[BDS-12] 事前検証で弾かれると validationErrors に理由が入り一覧は変わらない', async () => {
    const store = useBlockedDatesStore()
    await store.load()

    const created = await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON })

    expect(created).toBeNull()
    // 通信自体は成功しているので、サーバ障害用の createError には入れない
    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([DUPLICATE_MESSAGE])
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(ids(firstPage))
  })

  it('[BDS-13] 事前検証で弾かれたときは登録の API を呼ばない', async () => {
    let createCalls = 0
    server.use(
      http.post('*/api/blocked-dates', () => {
        createCalls += 1
        return HttpResponse.json(
          { id: 'unexpected', date: NEW_DATE, market: '', reason: '' },
          { status: 201 },
        )
      }),
    )
    const store = useBlockedDatesStore()

    await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON })

    expect(createCalls).toBe(0)
    expect(store.validationErrors).toEqual([DUPLICATE_MESSAGE])
  })

  it('[BDS-14] 事前検証が複数の理由を返すとその順番のまま validationErrors に入る', async () => {
    const store = useBlockedDatesStore()

    // 日付が不正で理由も空の入力は、既定ハンドラが 2 件の理由を返す
    const created = await store.create({ date: '', reason: '' })

    expect(created).toBeNull()
    expect(store.validationErrors).toEqual([INVALID_DATE_MESSAGE, INVALID_REASON_MESSAGE])
  })

  it('[BDS-15] 事前検証がサーバエラーのとき createError に入り validationErrors は空のまま', async () => {
    server.use(validateErrorHandler())
    const store = useBlockedDatesStore()
    await store.load()

    const created = await store.create({ date: NEW_DATE, reason: NEW_REASON })

    expect(created).toBeNull()
    expect(store.createError).toBeInstanceOf(Error)
    expect(store.createError.status).toBe(500)
    expect(store.createError.message).toBe(ERROR_MESSAGE)
    expect(store.validationErrors).toEqual([])
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(ids(firstPage))
  })

  it('[BDS-16] 事前検証を通っても登録が 409 なら createError にその理由が入る', async () => {
    // 事前検証は通るが登録側だけが拒否する状況（サーバ側の防御に到達した場合）
    server.use(
      http.post('*/api/blocked-dates', () =>
        HttpResponse.json({ message: DUPLICATE_MESSAGE, code: 'duplicate_date' }, { status: 409 }),
      ),
    )
    const store = useBlockedDatesStore()
    await store.load()

    const created = await store.create({ date: NEW_DATE, reason: NEW_REASON })

    expect(created).toBeNull()
    expect(store.createError).toBeInstanceOf(Error)
    expect(store.createError.status).toBe(409)
    expect(store.createError.message).toBe(DUPLICATE_MESSAGE)
    expect(store.total).toBe(TOTAL)
  })

  it('[BDS-17] create 後の読み直しでもページ位置と絞り込みが保たれる', async () => {
    const store = useBlockedDatesStore()
    await store.load({ offset: PAGE_SIZE, dateFrom: ALL_FROM, dateTo: ALL_TO })

    await store.create({ date: NEW_DATE, reason: NEW_REASON })

    // 登録後の一覧は日付昇順のまま 1 件増える
    const expected = [...blockedDates, { date: NEW_DATE, reason: NEW_REASON }].sort((a, b) =>
      a.date.localeCompare(b.date),
    )
    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.dateFrom).toBe(ALL_FROM)
    expect(store.dateTo).toBe(ALL_TO)
    expect(store.total).toBe(TOTAL + 1)
    expect(dates(store.items)).toEqual(dates(expected.slice(PAGE_SIZE, PAGE_SIZE * 2)))
  })

  it('[BDS-18] clearCreateError はサーバ障害と事前検証の理由をどちらも消す', async () => {
    const store = useBlockedDatesStore()

    // サーバ障害で失敗した場合
    server.use(validateErrorHandler({ once: true }))
    await store.create({ date: NEW_DATE, reason: NEW_REASON })
    expect(store.createError).not.toBeNull()

    store.clearCreateError()
    expect(store.createError).toBeNull()

    // 事前検証で弾かれた場合
    await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON })
    expect(store.validationErrors).not.toEqual([])

    store.clearCreateError()

    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([])
  })

  it('[BDS-19] 事前検証で弾かれた後に成功すると validationErrors が空に戻る', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON })
    expect(store.validationErrors).not.toEqual([])

    const created = await store.create({ date: NEW_DATE, reason: NEW_REASON })

    expect(created).toMatchObject({ date: NEW_DATE })
    expect(store.validationErrors).toEqual([])
  })

  it('[BDS-20] 検証と登録の 2 往復のあいだ creating が true のままになる', async () => {
    // 登録の応答を握って、検証が終わった時点の状態を確かめられるようにする
    let releaseCreate
    let createStarted = false
    const createGate = new Promise((resolve) => {
      releaseCreate = resolve
    })
    server.use(
      http.post('*/api/blocked-dates', async () => {
        createStarted = true
        await createGate
        return HttpResponse.json(
          {
            id: `bkd_${NEW_DATE.replaceAll('-', '')}`,
            date: NEW_DATE,
            market: blockedDates[0].market,
            reason: NEW_REASON,
          },
          { status: 201 },
        )
      }),
    )
    const store = useBlockedDatesStore()
    await store.load()

    const pending = store.create({ date: NEW_DATE, reason: NEW_REASON })

    // 1 段目（事前検証）の最中
    expect(store.creating).toBe(true)
    expect(store.loading).toBe(false)

    // 検証が終わって 2 段目（登録）に入っても true のまま
    // （固定時間の sleep にせず、登録ハンドラに入るまで待つ）
    while (!createStarted) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(store.creating).toBe(true)
    expect(store.loading).toBe(false)

    releaseCreate()
    await pending
    expect(store.creating).toBe(false)
  })
})
