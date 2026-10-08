import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { canceledFxRates, fxRates } from '@/mocks/fixtures/fxRates'
import { fetchFxRate } from '@/api/fxRates'
import { CURRENCY_CODE, useFxRatesStore } from './fxRates'

/*
 * フィクスチャは生の形（基準日は YYYYMMDD の integer）なので、期待値を作るときはここで直す。
 * 期待値はフィクスチャから導く（150.25 / 2026-07-31 を直接書かない）。
 */
const toIsoDate = (value) => {
  const digits = String(value)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const byBaseDateDesc = (a, b) => b.基準日 - a.基準日

// 有効行のうち基準日が最新の 1 件（latest が返すべき行）
const LATEST = [...fxRates].sort(byBaseDateDesc)[0]
const LATEST_ID = String(LATEST.ID)
const LATEST_DATE = toIsoDate(LATEST.基準日)
// 取消済みも含めた全行より後の日。この日を今日にすると「今日の行が無い」= 登録の経路になる
const AFTER_ALL_DATE = addDays(
  toIsoDate([...fxRates, ...canceledFxRates].sort(byBaseDateDesc)[0].基準日),
  7,
)

const NEW_RATE = LATEST.為替レート + 1
const NEW_WITHHOLDING_RATE = LATEST.源泉レート + 1
// 保存の引数（公示レートと源泉レート）
const NEW_RATES = { rate: NEW_RATE, withholdingRate: NEW_WITHHOLDING_RATE }
// モックの事前検証が警告を返す、一般的な範囲（50〜300 円）から外れるレート
const OUT_OF_RANGE_RATE = LATEST.為替レート * 10
// 本文の型違反（正の数でない）。事前検証の段階で 422 になる
const INVALID_RATE = 0

const ERROR_MESSAGE = 'サーバーでエラーが発生しました。'
const CONFLICT_MESSAGE =
  '他のユーザーによって為替レートが更新されました。最新情報を再取得してください。'
const REJECT_REASON = `基準日 ${LATEST.基準日} の ${CURRENCY_CODE} は既に登録されています`

const LATEST_PATH = '*/api/masters/fx/latest'
const VALIDATE_PATH = '*/api/masters/fx/validate'
const CREATE_PATH = '*/api/masters/fx'
// `:fxId` にすると latest まで拾うので、対象の ID を直接書いたパスで差し替える
const LATEST_DETAIL_PATH = `*/api/masters/fx/${LATEST.ID}`

/** 今日（JST）を固定する。time は JST の時刻 */
function setToday(isoDate, time = '12:00:00') {
  vi.setSystemTime(new Date(`${isoDate}T${time}+09:00`))
}

const failWith = (path, status, detail) =>
  http.get(path, () => HttpResponse.json({ detail }, { status }))

// シナリオ: docs/unit/stores-fx-rates.md
describe('useFxRatesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 「今日」だけを固定する（setTimeout まで止めると MSW の応答が返らない）
    vi.useFakeTimers({ toFake: ['Date'] })
    setToday(AFTER_ALL_DATE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[FXS-01] load で有効行のうち最新の 1 件を詳細つきで読み込み、取消済みは出さない', async () => {
    const store = useFxRatesStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.rate).toEqual({
      id: LATEST_ID,
      baseDate: LATEST_DATE,
      currencyCode: LATEST.通貨コード,
      rate: LATEST.為替レート,
      withholdingRate: LATEST.源泉レート,
      updatedAt: LATEST.更新日時,
      updatedBy: LATEST.更新者,
      createdAt: LATEST.作成日時,
    })
    // 取消済みの行は基準日が新しくても現在値にならない
    for (const canceled of canceledFxRates) {
      expect(store.rate.id).not.toBe(String(canceled.ID))
    }
  })

  it('[FXS-02] 今日は UTC ではなく JST で決める', async () => {
    // JST の 00:00 は UTC ではまだ前日。UTC で決めると 1 つ前の行が出る
    setToday(LATEST_DATE, '00:00:00')
    const store = useFxRatesStore()

    await store.load()

    expect(store.rate.id).toBe(LATEST_ID)
    expect(store.rate.baseDate).toBe(LATEST_DATE)
  })

  it('[FXS-03] latest が 404 のとき rate は null で isEmpty が true になる', async () => {
    server.use(failWith(LATEST_PATH, 404, '有効な為替レートが存在しません'))
    const store = useFxRatesStore()

    await store.load()

    expect(store.rate).toBeNull()
    expect(store.error).toBeNull()
    expect(store.isEmpty).toBe(true)
  })

  it('[FXS-04] latest が 500 のとき error に理由が入り isEmpty は false', async () => {
    server.use(failWith(LATEST_PATH, 500, ERROR_MESSAGE))
    const store = useFxRatesStore()

    await store.load()

    expect(store.loading).toBe(false)
    expect(store.rate).toBeNull()
    expect(store.error.status).toBe(500)
    expect(store.error.message).toBe(ERROR_MESSAGE)
    expect(store.isEmpty).toBe(false)
  })

  it('[FXS-05] 詳細の取得が失敗したとき error に理由が入り rate は null', async () => {
    server.use(failWith(LATEST_DETAIL_PATH, 500, ERROR_MESSAGE))
    const store = useFxRatesStore()

    await store.load()

    expect(store.rate).toBeNull()
    expect(store.error.message).toBe(ERROR_MESSAGE)
  })

  it('[FXS-06] 今日の行が無いときは今日の基準日で登録し、元の行は書き換えない', async () => {
    const store = useFxRatesStore()
    await store.load()

    const saved = await store.save(NEW_RATES)

    expect(saved).toMatchObject({
      baseDate: AFTER_ALL_DATE,
      currencyCode: CURRENCY_CODE,
      rate: NEW_RATE,
      withholdingRate: NEW_WITHHOLDING_RATE,
    })
    expect(saved.id).not.toBe(LATEST_ID)
    expect(store.rate).toEqual(saved)
    expect(store.saveError).toBeNull()
    // 前日までの行は変更の対象にしない
    await expect(fetchFxRate(LATEST_ID)).resolves.toMatchObject({ rate: LATEST.為替レート })
  })

  it('[FXS-07] 今日の行があるときはその行を変更し、新しい行を作らない', async () => {
    setToday(LATEST_DATE)
    const store = useFxRatesStore()
    await store.load()

    const saved = await store.save(NEW_RATES)

    expect(saved).toMatchObject({
      id: LATEST_ID,
      baseDate: LATEST_DATE,
      rate: NEW_RATE,
      withholdingRate: NEW_WITHHOLDING_RATE,
    })
    expect(store.rate).toEqual(saved)
    expect(store.saveError).toBeNull()
  })

  it('[FXS-08] 変更の本文は今日の基準日・USD・新しいレート・取得時の更新日時になる', async () => {
    setToday(LATEST_DATE)
    let putRequest = null
    server.use(
      http.put(LATEST_DETAIL_PATH, async ({ request }) => {
        const body = await request.json()
        putRequest = { pathname: new URL(request.url).pathname, body }
        return HttpResponse.json({
          success: true,
          exchange_rate: { ...LATEST, 為替レート: body.為替レート, 源泉レート: body.源泉レート },
          message: '為替レートを変更しました',
        })
      }),
    )
    const store = useFxRatesStore()
    await store.load()

    await store.save(NEW_RATES)

    expect(putRequest.pathname).toBe(`/api/masters/fx/${LATEST_ID}`)
    expect(putRequest.body).toEqual({
      基準日: LATEST.基準日,
      通貨コード: CURRENCY_CODE,
      為替レート: NEW_RATE,
      源泉レート: NEW_WITHHOLDING_RATE,
      更新日時: LATEST.更新日時,
    })
  })

  it('[FXS-09] 事前検証が不合格なら validationErrors に理由が入り保存しない', async () => {
    server.use(
      http.post(VALIDATE_PATH, () =>
        HttpResponse.json({ valid: false, errors: [REJECT_REASON], warnings: [] }),
      ),
    )
    const store = useFxRatesStore()
    await store.load()
    const before = store.rate

    const saved = await store.save({ rate: NEW_RATE })

    expect(saved).toBeNull()
    expect(store.validationErrors).toEqual([REJECT_REASON])
    expect(store.saveError).toBeNull()
    expect(store.rate).toEqual(before)
    // 登録していれば今日の行が latest に出る
    await store.load()
    expect(store.rate.id).toBe(LATEST_ID)
  })

  it('[FXS-10] 範囲外のレートは警告を返して保存しない', async () => {
    const store = useFxRatesStore()
    await store.load()
    const before = store.rate

    const saved = await store.save({ rate: OUT_OF_RANGE_RATE })

    expect(saved).toBeNull()
    expect(store.validationWarnings).toHaveLength(1)
    expect(store.validationErrors).toEqual([])
    expect(store.rate).toEqual(before)
    await store.load()
    expect(store.rate.id).toBe(LATEST_ID)
  })

  it('[FXS-11] 警告を承知して保存し直すと保存される', async () => {
    const store = useFxRatesStore()
    await store.load()

    const saved = await store.save({ rate: OUT_OF_RANGE_RATE, acknowledgedWarnings: true })

    expect(saved).toMatchObject({ baseDate: AFTER_ALL_DATE, rate: OUT_OF_RANGE_RATE })
    expect(store.rate).toEqual(saved)
    expect(store.validationWarnings).toEqual([])
  })

  it('[FXS-12] 本文の型違反は 422 として saveError に項目名付きで入る', async () => {
    const store = useFxRatesStore()
    await store.load()
    const before = store.rate

    const saved = await store.save({ rate: INVALID_RATE })

    expect(saved).toBeNull()
    expect(store.saveError.status).toBe(422)
    // 実 API の msg は項目名を含まないので、client.js が loc から補っている
    expect(store.saveError.message).toMatch(/^為替レート: /)
    expect(store.validationErrors).toEqual([])
    expect(store.rate).toEqual(before)
  })

  it('[FXS-13] 変更が 409 のとき saveError に detail が入り現在値は変わらない', async () => {
    setToday(LATEST_DATE)
    server.use(
      http.put(LATEST_DETAIL_PATH, () =>
        HttpResponse.json({ detail: CONFLICT_MESSAGE }, { status: 409 }),
      ),
    )
    const store = useFxRatesStore()
    await store.load()
    const before = store.rate

    const saved = await store.save({ rate: NEW_RATE })

    expect(saved).toBeNull()
    expect(store.saveError.status).toBe(409)
    expect(store.saveError.message).toBe(CONFLICT_MESSAGE)
    expect(store.rate).toEqual(before)
  })

  it('[FXS-14] clearSaveError で保存エラー・事前検証の理由・警告がすべて消える', async () => {
    const store = useFxRatesStore()
    await store.load()

    await store.save({ rate: INVALID_RATE })
    expect(store.saveError).not.toBeNull()
    store.clearSaveError()
    expect(store.saveError).toBeNull()

    await store.save({ rate: OUT_OF_RANGE_RATE })
    expect(store.validationWarnings).not.toEqual([])
    store.clearSaveError()
    expect(store.validationWarnings).toEqual([])

    server.use(
      http.post(VALIDATE_PATH, () =>
        HttpResponse.json({ valid: false, errors: [REJECT_REASON], warnings: [] }),
      ),
    )
    await store.save({ rate: NEW_RATE })
    expect(store.validationErrors).not.toEqual([])
    store.clearSaveError()
    expect(store.validationErrors).toEqual([])
  })

  it('[FXS-15] 登録では事前検証と登録の本文の両方に源泉レートが載る', async () => {
    const bodies = { validate: null, create: null }
    // 記録だけして既定ハンドラへ流す（応答は既定の振る舞いのまま）
    server.use(
      http.post(VALIDATE_PATH, async ({ request }) => {
        bodies.validate = await request.clone().json()
      }),
      http.post(CREATE_PATH, async ({ request }) => {
        bodies.create = await request.clone().json()
      }),
    )
    const store = useFxRatesStore()
    await store.load()

    const saved = await store.save(NEW_RATES)

    expect(saved).not.toBeNull()
    expect(bodies.validate.源泉レート).toBe(NEW_WITHHOLDING_RATE)
    expect(bodies.create.源泉レート).toBe(NEW_WITHHOLDING_RATE)
  })

  it('[FXS-16] 源泉レートの型違反は 422 として saveError に項目名付きで入る', async () => {
    const store = useFxRatesStore()
    await store.load()
    const before = store.rate

    const saved = await store.save({ rate: NEW_RATE, withholdingRate: INVALID_RATE })

    expect(saved).toBeNull()
    expect(store.saveError.status).toBe(422)
    expect(store.saveError.message).toMatch(/^源泉レート: /)
    expect(store.rate).toEqual(before)
  })
})
