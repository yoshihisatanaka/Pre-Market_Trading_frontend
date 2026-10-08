import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { fxRates } from '@/mocks/fixtures/fxRates'
import { ApiError } from './client'
import {
  createFxRate,
  fetchFxRate,
  fetchLatestFxRate,
  updateFxRate,
  validateFxRate,
} from './fxRates'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの**と生データの変換を docs/api/openapi.json の宣言と突き合わせる。
 */

/** フィクスチャは生の形（基準日は YYYYMMDD の integer）なので、期待値を作るときはここで直す */
const toIsoDate = (value) => {
  const digits = String(value)
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

// 期待値はフィクスチャから導く（150.25 / 20260731 を直接書かない）
const ROW = fxRates.at(-1)
const ROW_ID = String(ROW.ID)
const ROW_DATE = toIsoDate(ROW.基準日)
const NEW_RATE = ROW.為替レート + 1
const NEW_WITHHOLDING_RATE = ROW.源泉レート + 1

/** アプリ内モデル → 生の形の期待値（FxRequest の 4 項目。源泉レートは省略時 null） */
const expectedRequest = ({ baseDate, currencyCode, rate, withholdingRate = null }) => ({
  基準日: Number(baseDate.replaceAll('-', '')),
  通貨コード: currencyCode,
  為替レート: rate,
  源泉レート: withholdingRate,
})

// 源泉レートを渡さない呼び出し（省略時の既定 null を確かめる）
const saveArgsWithoutWithholding = {
  baseDate: ROW_DATE,
  currencyCode: ROW.通貨コード,
  rate: NEW_RATE,
}
const saveArgs = { ...saveArgsWithoutWithholding, withholdingRate: NEW_WITHHOLDING_RATE }

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {'get'|'post'|'put'} method
 * @param {string} path `*` 始まりのパス
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(method, path, body, status = 200) {
  server.use(
    http[method](path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = {
        url,
        params: url.searchParams,
        // GET は本文が無いので読まない（読むと空文字で例外になる）
        body: method === 'get' ? null : await request.json(),
      }
      return HttpResponse.json(body, { status })
    }),
  )
}

const LATEST_PATH = '*/api/masters/fx/latest'
const DETAIL_PATH = '*/api/masters/fx/:fxId'
const VALIDATE_PATH = '*/api/masters/fx/validate'
const CREATE_PATH = '*/api/masters/fx'

const latestBody = {
  ID: ROW.ID,
  基準日: ROW.基準日,
  通貨コード: ROW.通貨コード,
  為替レート: ROW.為替レート,
  源泉レート: ROW.源泉レート,
}

/** FxItem → アプリ内モデルの期待値 */
const expectedFxRate = (raw) => ({
  id: String(raw.ID),
  baseDate: toIsoDate(raw.基準日),
  currencyCode: raw.通貨コード,
  rate: raw.為替レート,
  withholdingRate: raw.源泉レート,
  updatedAt: raw.更新日時,
  updatedBy: raw.更新者,
  createdAt: raw.作成日時,
})

// シナリオ: docs/unit/api-fx-rates.md
describe('api/fxRates', () => {
  it('[FXA-01] latest は通貨コードと YYYYMMDD の対象日をクエリに載せる', async () => {
    record('get', LATEST_PATH, latestBody)

    await fetchLatestFxRate({ currencyCode: ROW.通貨コード, targetDate: ROW_DATE })

    expect(lastRequest.url.pathname).toBe('/api/masters/fx/latest')
    expect(lastRequest.params.get('currency_code')).toBe(ROW.通貨コード)
    expect(lastRequest.params.get('target_date')).toBe(String(ROW.基準日))
  })

  it('[FXA-02] latest の応答が文字列の id と YYYY-MM-DD の基準日に変換される', async () => {
    record('get', LATEST_PATH, latestBody)

    const latest = await fetchLatestFxRate({ targetDate: ROW_DATE })

    expect(latest).toEqual({
      id: ROW_ID,
      baseDate: ROW_DATE,
      currencyCode: ROW.通貨コード,
      rate: ROW.為替レート,
      withholdingRate: ROW.源泉レート,
    })
  })

  it('[FXA-03] latest が 404 のときは null を返す', async () => {
    record('get', LATEST_PATH, { detail: '有効な為替レートが存在しません' }, 404)

    await expect(fetchLatestFxRate({ targetDate: ROW_DATE })).resolves.toBeNull()
  })

  it('[FXA-04] latest が 500 のときは ApiError で reject する', async () => {
    const detail = 'サーバーでエラーが発生しました。'
    record('get', LATEST_PATH, { detail }, 500)

    const promise = fetchLatestFxRate({ targetDate: ROW_DATE })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({ status: 500, message: detail })
  })

  it('[FXA-05] 対象日が空のときは target_date をクエリに載せない', async () => {
    record('get', LATEST_PATH, latestBody)

    await fetchLatestFxRate({ currencyCode: ROW.通貨コード, targetDate: '' })

    expect(lastRequest.params.has('target_date')).toBe(false)
  })

  it('[FXA-06] 詳細は ID をパスに載せ、包みを外した 1 件を camelCase にする', async () => {
    record('get', DETAIL_PATH, { exchange_rate: ROW })

    const fxRate = await fetchFxRate(ROW_ID)

    expect(lastRequest.url.pathname).toBe(`/api/masters/fx/${ROW_ID}`)
    expect(fxRate).toEqual(expectedFxRate(ROW))
  })

  it('[FXA-07] 登録の事前検証は FxRequest の本文をクエリなしで送る', async () => {
    record('post', VALIDATE_PATH, { valid: true, errors: [], warnings: [] })

    await validateFxRate(saveArgs)

    expect(lastRequest.url.pathname).toBe('/api/masters/fx/validate')
    expect(lastRequest.body).toEqual(expectedRequest(saveArgs))
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[FXA-08] 変更の事前検証は fx_id と is_update=true をクエリに載せる', async () => {
    record('post', VALIDATE_PATH, { valid: true, errors: [], warnings: [] })

    await validateFxRate({ ...saveArgs, id: ROW_ID })

    expect(lastRequest.params.get('fx_id')).toBe(ROW_ID)
    expect(lastRequest.params.get('is_update')).toBe('true')
    expect(lastRequest.body).toEqual(expectedRequest(saveArgs))
  })

  it('[FXA-09] 事前検証の不合格は例外にせず errors を返し、無い warnings は空配列にする', async () => {
    const reason = `基準日 ${ROW.基準日} の ${ROW.通貨コード} は既に登録されています`
    record('post', VALIDATE_PATH, { valid: false, errors: [reason] })

    const result = await validateFxRate(saveArgs)

    expect(result).toEqual({ valid: false, errors: [reason], warnings: [] })
  })

  it('[FXA-10] 登録は FxRequest の 4 項目だけを送り、登録された 1 件を返す', async () => {
    const saved = { ...ROW, 為替レート: NEW_RATE, 源泉レート: NEW_WITHHOLDING_RATE }
    record('post', CREATE_PATH, { success: true, exchange_rate: saved, message: '' }, 201)

    const result = await createFxRate(saveArgs)

    expect(lastRequest.url.pathname).toBe('/api/masters/fx')
    // ID も更新日時も載せない（toEqual なので余計なキーがあれば落ちる）
    expect(lastRequest.body).toEqual(expectedRequest(saveArgs))
    expect(result).toEqual(expectedFxRate(saved))
  })

  it('[FXA-11] 変更は ID をパスに載せ、本文に更新日時を渡した値のまま載せる', async () => {
    const saved = { ...ROW, 為替レート: NEW_RATE, 源泉レート: NEW_WITHHOLDING_RATE }
    record('put', DETAIL_PATH, { success: true, exchange_rate: saved, message: '' })

    const result = await updateFxRate({ ...saveArgs, id: ROW_ID, updatedAt: ROW.更新日時 })

    expect(lastRequest.url.pathname).toBe(`/api/masters/fx/${ROW_ID}`)
    expect(lastRequest.body).toEqual({ ...expectedRequest(saveArgs), 更新日時: ROW.更新日時 })
    expect(result).toEqual(expectedFxRate(saved))
  })

  it('[FXA-12] 更新日時が空のときは本文に更新日時のキーを載せない', async () => {
    record('put', DETAIL_PATH, { success: true, exchange_rate: ROW, message: '' })

    await updateFxRate({ ...saveArgs, id: ROW_ID, updatedAt: '' })

    expect(Object.hasOwn(lastRequest.body, '更新日時')).toBe(false)
  })

  it('[FXA-13] 変更が 409 のときは detail を message にした ApiError で reject する', async () => {
    const detail = '他のユーザーによって為替レートが更新されました。最新情報を再取得してください。'
    record('put', DETAIL_PATH, { detail }, 409)

    const promise = updateFxRate({ ...saveArgs, id: ROW_ID, updatedAt: ROW.更新日時 })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({ status: 409, message: detail })
  })

  it('[FXA-14] latest の源泉レートが null のときは null のまま返す', async () => {
    record('get', LATEST_PATH, { ...latestBody, 源泉レート: null })

    const latest = await fetchLatestFxRate({ targetDate: ROW_DATE })

    expect(latest.withholdingRate).toBeNull()
  })

  it('[FXA-15] 詳細の源泉レートが null のときは null のまま返す', async () => {
    record('get', DETAIL_PATH, { exchange_rate: { ...ROW, 源泉レート: null } })

    const fxRate = await fetchFxRate(ROW_ID)

    expect(fxRate.withholdingRate).toBeNull()
  })

  it('[FXA-16] 登録で源泉レートを渡さないときは本文に 源泉レート: null を載せる', async () => {
    record('post', CREATE_PATH, { success: true, exchange_rate: ROW, message: '' }, 201)

    await createFxRate(saveArgsWithoutWithholding)

    expect(Object.hasOwn(lastRequest.body, '源泉レート')).toBe(true)
    expect(lastRequest.body.源泉レート).toBeNull()
  })

  it('[FXA-17] 変更で源泉レートを渡さないときは本文に 源泉レート: null を載せる', async () => {
    record('put', DETAIL_PATH, { success: true, exchange_rate: ROW, message: '' })

    await updateFxRate({ ...saveArgsWithoutWithholding, id: ROW_ID, updatedAt: ROW.更新日時 })

    expect(Object.hasOwn(lastRequest.body, '源泉レート')).toBe(true)
    expect(lastRequest.body.源泉レート).toBeNull()
  })
})
