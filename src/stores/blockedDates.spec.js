import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { blockedDates, canceledBlockedDates } from '@/mocks/fixtures/blockedDates'
import { BLOCKED_DATES_PAGE_SIZE, useBlockedDatesStore } from './blockedDates'

/*
 * フィクスチャはバックエンドの生の形（日本語キー / 受注不可日は YYYYMMDD の integer）なので、
 * 期待値を作るときはここで 'YYYY-MM-DD' に直す（アプリ内モデルの形は api 層が決める）。
 */
const toIsoDate = (blackoutDate) => {
  const digits = String(blackoutDate)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
const toId = (blocked) => String(blocked.受注不可日)

// 期待値はフィクスチャと表示件数から導く（56 / 50 を直接書かない）
const PAGE_SIZE = BLOCKED_DATES_PAGE_SIZE
const TOTAL = blockedDates.length
// フィクスチャは実 API と同じ受注不可日の降順なので、この並びがそのまま 1 ページ目になる
const firstPage = blockedDates.slice(0, PAGE_SIZE)
const secondPage = blockedDates.slice(PAGE_SIZE, PAGE_SIZE * 2)

// 絞り込みはフィクスチャ先頭の年をそのまま使う（年もハードコードしない）
const YEAR = String(blockedDates[0].受注不可日).slice(0, 4)
const DATE_FROM = `${YEAR}-01-01`
const DATE_TO = `${YEAR}-12-31`
const inYear = blockedDates.filter((blocked) => String(blocked.受注不可日).startsWith(YEAR))

// 全期間を含む絞り込み条件（最古 / 最新の日付そのもの）
const allDates = blockedDates.map((blocked) => blocked.受注不可日)
const ALL_FROM = toIsoDate(Math.min(...allDates))
const ALL_TO = toIsoDate(Math.max(...allDates))

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'

// 登録に使う「フィクスチャに無い日付」もフィクスチャから導く（既存日付と衝突したら別日になる）
const fixtureDates = blockedDates.map((blocked) => toIsoDate(blocked.受注不可日))
const existingDates = new Set(fixtureDates)
const NEW_DATE = (() => {
  for (let day = 1; day <= 28; day += 1) {
    const date = `${YEAR}-06-${String(day).padStart(2, '0')}`
    if (!existingDates.has(date)) return date
  }
  throw new Error('フィクスチャに無い日付が見つからなかった')
})()
const NEW_REASON = 'テスト受注不可日'

// 既定ハンドラの事前検証は既存の日付を弾くので、既存日付をそのまま重複の再現に使う
const DUPLICATE_DATE = toIsoDate(blockedDates[0].受注不可日)
const duplicateMessage = (blackoutDate) => `受注不可日(${blackoutDate})は既に登録されています`

// 取消済み（論理削除）の日付。実 API は警告を出さず、そのまま再有効化する
const CANCELED_DATE = toIsoDate(canceledBlockedDates[0].受注不可日)

// 削除・更新の対象と、既定ハンドラが 404 を返す「存在しない受注不可日」
const DELETE_TARGET = blockedDates[0]
const DELETE_TARGET_ID = toId(DELETE_TARGET)
// フィクスチャは 2023 年以降しか持たないので、この日付は必ず存在しない
const MISSING_ID = '19000101'
const DELETE_NOT_FOUND_MESSAGE = '指定された受注不可日が存在しないか、既に削除されています'
const UPDATE_NOT_FOUND_MESSAGE = '指定された受注不可日データが存在しません'

/*
 * 編集の対象もフィクスチャから導く。合札（更新日時）は行ごとに一意なので、
 * 別の行の値を渡せば「盤面が古い」状況を再現できる。
 */
const EDIT_TARGET = blockedDates[0]
const OTHER_ROW = blockedDates[1]
const EDITED_REASON = '編集後の理由'
const CONFLICT_MESSAGE =
  '他のユーザーによって受注不可日データが更新されています。最新データを再取得してください。'

const ids = (items) => items.map((item) => item.id)
const dates = (items) => items.map((item) => item.date)
const expectedIds = (rows) => rows.map(toId)

/** 受注不可日の降順に並べ替える（実 API と同じ並び。期待値の組み立てに使う） */
const sortedDesc = (isoDates) => [...isoDates].sort().reverse()

/** BlackoutDateListResponse の形で返す */
const listBody = (rows, total = TOTAL) => ({
  total,
  limit: PAGE_SIZE,
  offset: 0,
  blackout_dates: rows,
})

/** BlackoutDateResponse の形で返す（登録・更新・削除の応答） */
const itemBody = (row) => ({ success: true, blackout_date: row, message: 'ok' })

// 事前検証（HTTP は常に 200。可否は valid / errors で表す）を差し替えるためのハンドラ
const validateErrorHandler = (options) =>
  http.post(
    '*/api/blackout-dates/validate',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )

const errorHandler = (options) =>
  http.get(
    '*/api/blackout-dates',
    () => HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
    options,
  )
const emptyHandler = (options) =>
  http.get('*/api/blackout-dates', () => HttpResponse.json(listBody([], 0)), options)

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
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
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
    expect(ids(store.items)).toEqual(expectedIds(secondPage))
  })

  it('[BDS-04] 日付で絞り込むと total も絞り込み後の件数になる', async () => {
    const store = useBlockedDatesStore()

    await store.load({ dateFrom: DATE_FROM, dateTo: DATE_TO })

    expect(store.dateFrom).toBe(DATE_FROM)
    expect(store.dateTo).toBe(DATE_TO)
    expect(store.total).toBe(inYear.length)
    expect(ids(store.items)).toEqual(expectedIds(inYear))
  })

  it('[BDS-05] 取得中は loading が true になり完了すると false に戻る', async () => {
    server.use(
      http.get('*/api/blackout-dates', async () => {
        await delay(50)
        return HttpResponse.json(listBody(firstPage))
      }),
    )
    const store = useBlockedDatesStore()

    const pending = store.load()

    expect(store.loading).toBe(true)

    await pending
    expect(store.loading).toBe(false)
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
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
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
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
    expect(ids(store.items)).toEqual(expectedIds(secondPage))
  })

  it('[BDS-09] 後から届いた古い応答で結果が巻き戻らない', async () => {
    server.use(
      http.get('*/api/blackout-dates', async ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
        // 1 ページ目だけ遅らせ、「古い応答が後から返る」状況を作る
        if (offset === 0) await delay(50)
        return HttpResponse.json(listBody(blockedDates.slice(offset, offset + PAGE_SIZE)))
      }),
    )
    const store = useBlockedDatesStore()

    const stale = store.load({ offset: 0 })
    const fresh = store.load({ offset: PAGE_SIZE })
    await Promise.all([fresh, stale])

    expect(ids(store.items)).toEqual(expectedIds(secondPage))
  })

  it('[BDS-10] limit は表示件数の定数だがリクエストには載らない', async () => {
    let sentParams = null
    server.use(
      http.get('*/api/blackout-dates', ({ request }) => {
        sentParams = new URL(request.url).searchParams
        return HttpResponse.json(listBody(firstPage))
      }),
    )
    const store = useBlockedDatesStore()

    await store.load()

    // ページャーの表示には使うが、実 API の一覧は 1 ページ 50 件で固定されていて
    // limit というクエリを持たない（api 層が落としている）
    expect(store.limit).toBe(PAGE_SIZE)
    expect(sentParams.has('limit')).toBe(false)
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
  })

  it('[BDS-12] 事前検証で弾かれると validationErrors に理由が入り一覧は変わらない', async () => {
    const store = useBlockedDatesStore()
    await store.load()

    const created = await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON })

    expect(created).toBeNull()
    // 通信自体は成功しているので、サーバ障害用の createError には入れない
    expect(store.createError).toBeNull()
    expect(store.validationErrors).toEqual([duplicateMessage(DELETE_TARGET.受注不可日)])
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[BDS-13] 事前検証で弾かれたときは登録の API を呼ばない', async () => {
    let createCalls = 0
    server.use(
      http.post('*/api/blackout-dates', () => {
        createCalls += 1
        return HttpResponse.json(itemBody(blockedDates[0]), { status: 201 })
      }),
    )
    const store = useBlockedDatesStore()

    await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON })

    expect(createCalls).toBe(0)
    expect(store.validationErrors).toEqual([duplicateMessage(DELETE_TARGET.受注不可日)])
  })

  it('[BDS-14] 事前検証が複数の理由を返すとその順番のまま validationErrors に入る', async () => {
    /*
     * 実 API は最初に見つけた 1 件で打ち切るので、既定ハンドラでは 2 件の状況を作れない。
     * それでも「返ってきた順のまま画面へ渡す」ことはストアの約束なので、応答を差し替えて守る。
     */
    const reasons = [
      '受注不可日に有効な日付（YYYYMMDD）を指定してください',
      '理由・備考は45文字以内で指定してください',
    ]
    server.use(
      http.post('*/api/blackout-dates/validate', () =>
        HttpResponse.json({ valid: false, errors: reasons, warnings: [], details: null }),
      ),
    )
    const store = useBlockedDatesStore()

    const created = await store.create({ date: NEW_DATE, reason: NEW_REASON })

    expect(created).toBeNull()
    expect(store.validationErrors).toEqual(reasons)
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
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[BDS-16] 事前検証を通っても登録が拒否されたら createError にその理由が入る', async () => {
    // 事前検証は通るが登録側だけが拒否する状況（サーバ側の防御に到達した場合）。
    // 実 API の重複エラーは 400（ErrorResponse）で返る
    const detail = duplicateMessage(Number(NEW_DATE.replaceAll('-', '')))
    server.use(
      http.post('*/api/blackout-dates', () => HttpResponse.json({ detail }, { status: 400 })),
    )
    const store = useBlockedDatesStore()
    await store.load()

    const created = await store.create({ date: NEW_DATE, reason: NEW_REASON })

    expect(created).toBeNull()
    expect(store.createError).toBeInstanceOf(Error)
    expect(store.createError.status).toBe(400)
    expect(store.createError.message).toBe(detail)
    expect(store.total).toBe(TOTAL)
  })

  it('[BDS-17] create 後の読み直しでもページ位置と絞り込みが保たれる', async () => {
    const store = useBlockedDatesStore()
    await store.load({ offset: PAGE_SIZE, dateFrom: ALL_FROM, dateTo: ALL_TO })

    await store.create({ date: NEW_DATE, reason: NEW_REASON })

    // 登録後の一覧は日付の降順のまま 1 件増える
    const expected = sortedDesc([...fixtureDates, NEW_DATE])
    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.dateFrom).toBe(ALL_FROM)
    expect(store.dateTo).toBe(ALL_TO)
    expect(store.total).toBe(TOTAL + 1)
    expect(dates(store.items)).toEqual(expected.slice(PAGE_SIZE, PAGE_SIZE * 2))
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
      http.post('*/api/blackout-dates', async () => {
        createStarted = true
        await createGate
        return HttpResponse.json(
          itemBody({
            ...blockedDates[0],
            受注不可日: Number(NEW_DATE.replaceAll('-', '')),
            備考: NEW_REASON,
          }),
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

  it('[BDS-21] remove が成功すると一覧が読み直され対象の id が消える', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    expect(ids(store.items)).toContain(DELETE_TARGET_ID)

    const removed = await store.remove(DELETE_TARGET_ID)

    expect(removed).toBe(true)
    expect(store.deleteError).toBeNull()
    expect(store.total).toBe(TOTAL - 1)
    expect(ids(store.items)).not.toContain(DELETE_TARGET_ID)
  })

  it('[BDS-22] 存在しない id のとき deleteError に 404 が入り一覧は変わらない', async () => {
    const store = useBlockedDatesStore()
    await store.load()

    const removed = await store.remove(MISSING_ID)

    expect(removed).toBe(false)
    expect(store.deleteError).toBeInstanceOf(Error)
    expect(store.deleteError.status).toBe(404)
    expect(store.deleteError.message).toBe(DELETE_NOT_FOUND_MESSAGE)
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[BDS-23] remove 後の読み直しでもページ位置と絞り込みが保たれる', async () => {
    const store = useBlockedDatesStore()
    await store.load({ offset: PAGE_SIZE, dateFrom: ALL_FROM, dateTo: ALL_TO })

    await store.remove(DELETE_TARGET_ID)

    // 削除は論理削除だが、既定の一覧は取消済みを返さないので 1 件減って見える
    const remaining = blockedDates.filter((blocked) => toId(blocked) !== DELETE_TARGET_ID)
    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.dateFrom).toBe(ALL_FROM)
    expect(store.dateTo).toBe(ALL_TO)
    expect(store.total).toBe(TOTAL - 1)
    expect(ids(store.items)).toEqual(expectedIds(remaining.slice(PAGE_SIZE, PAGE_SIZE * 2)))
  })

  it('[BDS-24] clearDeleteError で削除エラーが消える', async () => {
    const store = useBlockedDatesStore()
    await store.remove(MISSING_ID)
    expect(store.deleteError).not.toBeNull()

    store.clearDeleteError()

    expect(store.deleteError).toBeNull()
  })

  it('[BDS-25] 削除中は deleting だけが true になり一覧の loading は false のまま', async () => {
    server.use(
      http.delete('*/api/blackout-dates/:blackoutDate', async () => {
        await delay(50)
        return HttpResponse.json(itemBody({ ...DELETE_TARGET, 取消区分: 1 }))
      }),
    )
    const store = useBlockedDatesStore()
    await store.load()

    const pending = store.remove(DELETE_TARGET_ID)

    expect(store.deleting).toBe(true)
    expect(store.loading).toBe(false)

    await pending
    expect(store.deleting).toBe(false)
  })

  it('[BDS-26] update が成功すると一覧が読み直され理由が新しい値になる', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({
      id: target.id,
      date: target.date,
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })

    expect(updated).toMatchObject({ date: target.date, reason: EDITED_REASON })
    expect(store.updateError).toBeNull()
    expect(store.updateValidationErrors).toEqual([])
    // 日付を変えていないので件数も並びも動かない
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
    expect(store.items[0].reason).toBe(EDITED_REASON)
  })

  it('[BDS-27] 日付を変えて update すると元の日付が消え新しい日付が降順の位置に入る', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({
      id: target.id,
      date: NEW_DATE,
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })

    expect(updated).toMatchObject({ date: NEW_DATE, reason: EDITED_REASON })
    // 日付が入れ替わるだけなので件数は変わらず、一覧は日付の降順のまま
    const expected = sortedDesc([
      ...fixtureDates.filter((date) => date !== target.date),
      NEW_DATE,
    ])
    expect(store.total).toBe(TOTAL)
    expect(dates(store.items)).not.toContain(target.date)
    expect(dates(store.items)).toEqual(expected.slice(0, PAGE_SIZE))
  })

  it('[BDS-28] 日付を変えない update では自分自身が重複と見なされない', async () => {
    // 事前検証のリクエストを、既定ハンドラを差し替えずに観測する
    const validateUrls = []
    const record = ({ request }) => {
      if (request.url.includes('/blackout-dates/validate')) validateUrls.push(request.url)
    }
    server.events.on('request:start', record)

    try {
      const store = useBlockedDatesStore()
      await store.load()
      const target = store.items[0]

      const updated = await store.update({
        id: target.id,
        date: target.date,
        reason: EDITED_REASON,
        updatedAt: target.updatedAt,
      })

      expect(updated).toMatchObject({ date: target.date, reason: EDITED_REASON })
      expect(store.updateValidationErrors).toEqual([])

      /*
       * 日付を変えないときは変更検証（is_update=true）にする。新規検証だと自分自身が
       * 重複として弾かれる。対象を渡す口は実 API に無く、本文の受注不可日が対象を兼ねる。
       */
      expect(validateUrls).toHaveLength(1)
      const params = new URL(validateUrls[0]).searchParams
      expect(params.get('is_update')).toBe('true')
      expect(params.has('id')).toBe(false)
    } finally {
      server.events.removeListener('request:start', record)
    }
  })

  it('[BDS-29] 別の行の日付へ変えると updateValidationErrors に理由が入り一覧は変わらない', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({
      id: target.id,
      date: toIsoDate(OTHER_ROW.受注不可日),
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })

    expect(updated).toBeNull()
    // 通信自体は成功しているので、サーバ障害用の updateError には入れない
    expect(store.updateError).toBeNull()
    expect(store.updateValidationErrors).toEqual([duplicateMessage(OTHER_ROW.受注不可日)])
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[BDS-30] 事前検証で弾かれたときは更新の API を呼ばない', async () => {
    let updateCalls = 0
    server.use(
      http.put('*/api/blackout-dates/:blackoutDate', () => {
        updateCalls += 1
        return HttpResponse.json(itemBody(blockedDates[0]))
      }),
    )
    const store = useBlockedDatesStore()

    // 別の行の日付へ変えようとする入力は、既定ハンドラの事前検証が重複として弾く
    const updated = await store.update({
      id: toId(EDIT_TARGET),
      date: toIsoDate(OTHER_ROW.受注不可日),
      reason: EDITED_REASON,
      updatedAt: EDIT_TARGET.更新日時,
    })

    expect(updated).toBeNull()
    expect(updateCalls).toBe(0)
    expect(store.updateValidationErrors).toEqual([duplicateMessage(OTHER_ROW.受注不可日)])
  })

  it('[BDS-31] 事前検証を通っても更新がサーバエラーなら updateError に入る', async () => {
    server.use(
      http.put('*/api/blackout-dates/:blackoutDate', () =>
        HttpResponse.json({ detail: ERROR_MESSAGE }, { status: 500 }),
      ),
    )
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({
      id: target.id,
      date: target.date,
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })

    expect(updated).toBeNull()
    expect(store.updateError).toBeInstanceOf(Error)
    expect(store.updateError.status).toBe(500)
    expect(store.updateError.message).toBe(ERROR_MESSAGE)
    expect(store.updateValidationErrors).toEqual([])
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[BDS-32] 古い updatedAt で update すると 409 が updateError に入り一覧は変わらない', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    const updated = await store.update({
      id: target.id,
      date: target.date,
      reason: EDITED_REASON,
      // 別の行の合札（= 対象の現在値とは違う値）を渡して「盤面が古い」状況を作る
      updatedAt: OTHER_ROW.更新日時,
    })

    expect(updated).toBeNull()
    expect(store.updateError).toBeInstanceOf(Error)
    expect(store.updateError.status).toBe(409)
    expect(store.updateError.message).toBe(CONFLICT_MESSAGE)
    // 他の利用者の変更を上書きしない
    expect(store.items[0].reason).toBe(EDIT_TARGET.備考)
    expect(ids(store.items)).toEqual(expectedIds(firstPage))
  })

  it('[BDS-33] 存在しない id のとき updateError に 404 が入る', async () => {
    const store = useBlockedDatesStore()

    const updated = await store.update({
      id: MISSING_ID,
      date: NEW_DATE,
      reason: EDITED_REASON,
      updatedAt: EDIT_TARGET.更新日時,
    })

    expect(updated).toBeNull()
    expect(store.updateError).toBeInstanceOf(Error)
    expect(store.updateError.status).toBe(404)
    expect(store.updateError.message).toBe(UPDATE_NOT_FOUND_MESSAGE)
  })

  it('[BDS-34] update 後の読み直しでもページ位置と絞り込みが保たれる', async () => {
    const store = useBlockedDatesStore()
    await store.load({ offset: PAGE_SIZE, dateFrom: ALL_FROM, dateTo: ALL_TO })

    // 対象は 1 ページ目の行なので、合札は表示中の行ではなくフィクスチャから取る
    const updated = await store.update({
      id: toId(EDIT_TARGET),
      date: toIsoDate(EDIT_TARGET.受注不可日),
      reason: EDITED_REASON,
      updatedAt: EDIT_TARGET.更新日時,
    })

    expect(updated).not.toBeNull()
    expect(store.offset).toBe(PAGE_SIZE)
    expect(store.dateFrom).toBe(ALL_FROM)
    expect(store.dateTo).toBe(ALL_TO)
    // 日付を変えていないので件数も並びも動かない
    expect(store.total).toBe(TOTAL)
    expect(ids(store.items)).toEqual(expectedIds(secondPage))
  })

  it('[BDS-35] clearUpdateError はサーバ障害と事前検証の理由をどちらも消す', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    // サーバ障害で失敗した場合
    server.use(validateErrorHandler({ once: true }))
    await store.update({
      id: target.id,
      date: target.date,
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })
    expect(store.updateError).not.toBeNull()

    store.clearUpdateError()
    expect(store.updateError).toBeNull()

    // 事前検証で弾かれた場合
    await store.update({
      id: target.id,
      date: toIsoDate(OTHER_ROW.受注不可日),
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })
    expect(store.updateValidationErrors).not.toEqual([])

    store.clearUpdateError()

    expect(store.updateError).toBeNull()
    expect(store.updateValidationErrors).toEqual([])
  })

  it('[BDS-36] 検証と更新の 2 往復のあいだ updating が true のままになる', async () => {
    // 更新の応答を握って、検証が終わった時点の状態を確かめられるようにする
    let releaseUpdate
    let updateStarted = false
    const updateGate = new Promise((resolve) => {
      releaseUpdate = resolve
    })
    server.use(
      http.put('*/api/blackout-dates/:blackoutDate', async () => {
        updateStarted = true
        await updateGate
        return HttpResponse.json(itemBody({ ...EDIT_TARGET, 備考: EDITED_REASON }))
      }),
    )
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    const pending = store.update({
      id: target.id,
      date: target.date,
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })

    // 1 段目（事前検証）の最中
    expect(store.updating).toBe(true)
    expect(store.loading).toBe(false)

    // 検証が終わって 2 段目（更新）に入っても true のまま
    // （固定時間の sleep にせず、更新ハンドラに入るまで待つ）
    while (!updateStarted) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(store.updating).toBe(true)
    expect(store.loading).toBe(false)

    releaseUpdate()
    await pending
    expect(store.updating).toBe(false)
  })

  it('[BDS-37] 一覧を読み直せば同じ行を続けて 2 回更新できる', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    const first = await store.update({
      id: target.id,
      date: target.date,
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })
    expect(first).not.toBeNull()

    // 合札はサーバが更新のたびに新しくする。読み直した一覧の値でなければ 2 回目は競合する
    const reloaded = store.items.find((item) => item.date === target.date)
    expect(reloaded.updatedAt).not.toBe(target.updatedAt)

    const second = await store.update({
      id: reloaded.id,
      date: reloaded.date,
      reason: `${EDITED_REASON}2`,
      updatedAt: reloaded.updatedAt,
    })

    expect(second).toMatchObject({ date: target.date, reason: `${EDITED_REASON}2` })
    expect(store.updateError).toBeNull()
    expect(store.items.find((item) => item.date === target.date).reason).toBe(`${EDITED_REASON}2`)
  })

  it('[BDS-38] 編集と登録の事前検証の理由は互いに混ざらない', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    const target = store.items[0]

    // 編集で弾かれても、登録側の validationErrors は空のまま
    await store.update({
      id: target.id,
      date: toIsoDate(OTHER_ROW.受注不可日),
      reason: EDITED_REASON,
      updatedAt: target.updatedAt,
    })
    expect(store.updateValidationErrors).toEqual([duplicateMessage(OTHER_ROW.受注不可日)])
    expect(store.validationErrors).toEqual([])

    store.clearUpdateError()

    // 逆に登録で弾かれても、編集側の updateValidationErrors は空のまま
    await store.create({ date: DUPLICATE_DATE, reason: NEW_REASON })
    expect(store.validationErrors).toEqual([duplicateMessage(DELETE_TARGET.受注不可日)])
    expect(store.updateValidationErrors).toEqual([])
  })

  it('[BDS-39] 取消済みの日付は警告なしで登録でき、行は増えずに一覧へ戻る', async () => {
    const store = useBlockedDatesStore()
    await store.load()
    // 取消済みの行は既定の一覧に出ていない
    expect(dates(store.items)).not.toContain(CANCELED_DATE)

    const created = await store.create({ date: CANCELED_DATE, reason: NEW_REASON })

    /*
     * 実 API は取消済みの行を再有効化する（新しい行を作らない）。海外休場日と違って
     * 事前検証は警告を返さないので、利用者に確認を求めず 1 回の操作で通る。
     */
    expect(created).toMatchObject({ date: CANCELED_DATE, reason: NEW_REASON })
    expect(store.validationWarnings).toEqual([])
    expect(store.validationErrors).toEqual([])
    expect(store.total).toBe(TOTAL + 1)
    expect(dates(store.items)).toContain(CANCELED_DATE)
  })
})
