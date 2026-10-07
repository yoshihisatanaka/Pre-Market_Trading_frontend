import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { feePreferences } from '@/mocks/fixtures/feePreferences'
import { DEFAULT_FEE_PATTERN_FILTER } from '@/utils/feePreferenceOptions'
import {
  createFeePreference,
  deleteFeePreference,
  fetchFeePreferences,
  updateFeePreference,
  validateFeePreference,
} from './feePreferences'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** と、受け取った生データの変換を固定する。
 *
 * 一覧は既定ハンドラに当てたまま、届いた URL を request:start で記録する（応答は既定モックのまま）。
 * 登録・変更・削除・事前検証は本文を読みたいので、記録するハンドラに差し替える。
 */

const LIST_PATH = '/api/masters/fee-preferences'

/** 実 API と同じ並び（口座番号の昇順）。フィクスチャは生成順のまま置かれている */
const sorted = [...feePreferences].sort((a, b) => a.口座番号 - b.口座番号)

/** 既定ハンドラに届いた一覧のクエリ */
let listRequests = []
function listener({ request }) {
  const url = new URL(request.url)
  if (url.pathname === LIST_PATH) listRequests.push(url)
}
function recordList() {
  listRequests = []
  server.events.on('request:start', listener)
}
const lastList = () => listRequests.at(-1)

/** 差し替えたハンドラが受けた最後のリクエスト */
let lastRequest = null

afterEach(() => {
  server.events.removeListener('request:start', listener)
  listRequests = []
  lastRequest = null
})

/** 一覧の応答を差し替える */
function respondList(body) {
  server.use(http.get(`*${LIST_PATH}`, () => HttpResponse.json(body)))
}

/** POST の本文まで記録して、指定の本文を返す */
function recordPost(path, body, status = 200) {
  server.use(
    http.post(path, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams, body: await request.json() }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** PUT の本文まで記録して、指定の本文を返す */
function recordPut(body, status = 200) {
  server.use(
    http.put(`*${LIST_PATH}/:id`, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams, body: await request.json() }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** DELETE を記録する。本文は text で読む（DELETE は本文を取らない） */
function recordDelete(body, status = 200) {
  server.use(
    http.delete(`*${LIST_PATH}/:id`, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = { url, params: url.searchParams, body: await request.text() }
      return HttpResponse.json(body, { status })
    }),
  )
}

const CREATE_PATH = `*${LIST_PATH}`
const VALIDATE_PATH = `*${LIST_PATH}/validate`

/** 1 件の応答（FeePreferenceResponse）。fee_preference はフィクスチャの先頭行を借りる */
const saveBody = (warnings) => ({
  success: true,
  fee_preference: sorted[0],
  ...(warnings === undefined ? {} : { warnings }),
  message: 'ok',
})

/** 画面の入力欄と同じ形（数値は文字列、空欄あり、デフォルトパターン） */
const formInput = {
  accountNumber: '1230014',
  feePattern: '',
  feeMultiplier: '80',
  minFee: '1000',
  maxFee: '',
  basisPoints: '',
  minBasisFee: '',
  maxBasisFee: '',
  fxSpread: '0.25',
}

/** formInput を送ったときの本文（FeePreferenceRequest の形） */
const formBody = {
  口座番号: 1230014,
  手数料パターン: '',
  掛目: 80,
  下限手数料: 1000,
  上限手数料: null,
  ベイシス: null,
  下限ベイシス円: null,
  上限ベイシス円: null,
  スプレッド: 0.25,
}

const UPDATED_AT = '2026-10-05T15:30:00'

// シナリオ: docs/unit/api-fee-preferences.md
describe('api/feePreferences', () => {
  it('[FPA-01] 一覧は { items, total } を返し、行のキーが camelCase になる', async () => {
    const { items, total } = await fetchFeePreferences()

    // 取消済みは既定で返らないので、有効行の件数
    expect(total).toBe(feePreferences.length)

    const raw = sorted[0]
    expect(items[0]).toEqual({
      id: String(raw.ID),
      // integer の口座番号は文字列にする
      accountNumber: String(raw.口座番号),
      branchCode: raw.部店コード,
      customerName: raw.顧客名,
      feePattern: raw.手数料パターン,
      feeMultiplier: raw.掛目,
      minFee: raw.下限手数料,
      maxFee: raw.上限手数料,
      basisPoints: raw.ベイシス,
      minBasisFee: raw.下限ベイシス円,
      maxBasisFee: raw.上限ベイシス円,
      fxSpread: raw.スプレッド,
      applyMethod: raw.適用方式,
      updatedAt: raw.更新日時 ?? '',
    })
    expect(typeof items[0].accountNumber).toBe('string')
  })

  it('[FPA-02] 空文字の条件はクエリに載せない', async () => {
    recordList()

    await fetchFeePreferences({ branchCode: '', accountNumber: '', feePattern: '' })

    const params = lastList().searchParams
    expect(params.has('branch_code')).toBe(false)
    expect(params.has('account_no')).toBe(false)
    // 空文字の fee_pattern は「デフォルトの口座」に絞り込む値なので、条件なしでは載せない
    expect(params.has('fee_pattern')).toBe(false)
  })

  it('[FPA-03] 絞り込み条件は英語のクエリ名で送る', async () => {
    recordList()

    await fetchFeePreferences({ branchCode: '123', accountNumber: '1230001', feePattern: 'A' })

    const params = lastList().searchParams
    expect(params.get('branch_code')).toBe('123')
    expect(params.get('account_no')).toBe('1230001')
    expect(params.get('fee_pattern')).toBe('A')
  })

  it('[FPA-04] デフォルトの目印は fee_pattern の空文字として送る', async () => {
    recordList()

    const { items, total } = await fetchFeePreferences({ feePattern: DEFAULT_FEE_PATTERN_FILTER })

    const url = lastList()
    expect(url.searchParams.has('fee_pattern')).toBe(true)
    expect(url.searchParams.get('fee_pattern')).toBe('')
    // 目印の綴りはサーバに出さない
    expect(url.search).not.toContain(DEFAULT_FEE_PATTERN_FILTER)

    const defaults = feePreferences.filter((row) => row.手数料パターン === '')
    // フィクスチャにデフォルトの行もそれ以外の行も無いと、このシナリオは意味を失う
    expect(defaults.length).toBeGreaterThan(0)
    expect(defaults.length).toBeLessThan(feePreferences.length)
    expect(total).toBe(defaults.length)
    expect(items.every((item) => item.feePattern === '')).toBe(true)
  })

  it('[FPA-05] 数字以外を含む口座番号は account_no に載せない', async () => {
    recordList()

    await fetchFeePreferences({ accountNumber: '12a' })

    expect(lastList().searchParams.has('account_no')).toBe(false)
  })

  it('[FPA-06] 数値 7 項目の null は null のまま、文字列 3 項目の null は空文字になる', async () => {
    respondList({
      total: 1,
      limit: 50,
      offset: 0,
      fee_preferences: [
        {
          ...sorted[0],
          掛目: null,
          下限手数料: null,
          上限手数料: null,
          ベイシス: null,
          下限ベイシス円: null,
          上限ベイシス円: null,
          スプレッド: null,
          部店コード: null,
          顧客名: null,
          適用方式: null,
        },
        { ...sorted[0], ID: 9001, スプレッド: 0 },
      ],
    })

    const { items } = await fetchFeePreferences()

    // 0 に寄せると「未設定」と「0（為替手数料の免除）」の区別が消える
    expect(items[0]).toMatchObject({
      feeMultiplier: null,
      minFee: null,
      maxFee: null,
      basisPoints: null,
      minBasisFee: null,
      maxBasisFee: null,
      fxSpread: null,
      branchCode: '',
      customerName: '',
      applyMethod: '',
    })
    expect(items[1].fxSpread).toBe(0)
  })

  it('[FPA-07] 登録の本文は FeePreferenceRequest の形で、空欄は null・目印は載らない', async () => {
    recordPost(CREATE_PATH, saveBody([]), 201)

    await createFeePreference({ ...formInput, acknowledgedWarnings: true })

    expect(lastRequest.url.pathname).toBe(LIST_PATH)
    // 口座番号は integer、手数料パターンは空文字のまま、数値は number、空欄は null で明示する
    expect(lastRequest.body).toEqual(formBody)
    for (const key of ['ID', 'id', 'acknowledgedWarnings', '更新日時']) {
      expect(Object.hasOwn(lastRequest.body, key)).toBe(false)
    }
  })

  it('[FPA-08] 変更は ID をパスに載せ、取得時の 更新日時 をそのまま送り返す', async () => {
    recordPut(saveBody([]))

    await updateFeePreference({ ...formInput, id: '3', updatedAt: UPDATED_AT })

    expect(lastRequest.url.pathname).toBe(`${LIST_PATH}/3`)
    expect(lastRequest.body).toEqual({ ...formBody, 更新日時: UPDATED_AT })
    expect(Object.hasOwn(lastRequest.body, 'id')).toBe(false)

    // 合札が無い行はキーごと送らない（空文字を送ると照合されて弾かれうる）
    await updateFeePreference({ ...formInput, id: '3', updatedAt: '' })
    expect(Object.hasOwn(lastRequest.body, '更新日時')).toBe(false)
  })

  it('[FPA-09] 削除は ID をパスに載せ、本文を送らず、削除した id を返す', async () => {
    recordDelete(saveBody([]))

    const deleted = await deleteFeePreference('3')

    expect(lastRequest.url.pathname).toBe(`${LIST_PATH}/3`)
    expect(lastRequest.body).toBe('')
    expect(deleted).toBe('3')
  })

  it('[FPA-10] 事前検証の不合格は例外にせず、合格の warnings も返す', async () => {
    const error = '口座番号(1230001)の手数料優遇は既に登録されています'
    recordPost(VALIDATE_PATH, { valid: false, errors: [error], warnings: [], details: null })

    await expect(validateFeePreference(formInput)).resolves.toEqual({
      valid: false,
      errors: [error],
      warnings: [],
    })

    const warning = 'ベイシス方式のため、掛目は使用されません'
    recordPost(VALIDATE_PATH, { valid: true, errors: [], warnings: [warning], details: null })

    // CA・銘柄と違い、warnings を捨てない（登録側の確認待ちに使う）
    await expect(validateFeePreference(formInput)).resolves.toEqual({
      valid: true,
      errors: [],
      warnings: [warning],
    })
  })

  it('[FPA-11] 変更検証は fee_preference_id と is_update をクエリに付け、新規検証は付けない', async () => {
    recordPost(VALIDATE_PATH, { valid: true, errors: [], warnings: [], details: null })

    await validateFeePreference({ ...formInput, id: '3', updatedAt: UPDATED_AT })

    expect(lastRequest.url.pathname).toBe(`${LIST_PATH}/validate`)
    expect(lastRequest.params.get('fee_preference_id')).toBe('3')
    expect(lastRequest.params.get('is_update')).toBe('true')
    // 事前検証は楽観的ロックの照合をしない。id は対象を指すためだけの呼び出し側の都合
    expect(lastRequest.body).toEqual(formBody)

    await validateFeePreference(formInput)

    expect(lastRequest.url.search).toBe('')
    expect(Object.hasOwn(lastRequest.body, '更新日時')).toBe(false)
  })

  it('[FPA-12] 登録・変更の戻り値は 1 件に warnings を足したもので、無ければ空配列', async () => {
    const warning = '手数料パターン(E)は手数料パターンマスタに未登録です'
    recordPost(CREATE_PATH, saveBody([warning]), 201)

    const created = await createFeePreference(formInput)

    expect(created).toMatchObject({
      id: String(sorted[0].ID),
      accountNumber: String(sorted[0].口座番号),
      warnings: [warning],
    })

    recordPut(saveBody(undefined))

    const updated = await updateFeePreference({ ...formInput, id: '3', updatedAt: UPDATED_AT })

    expect(updated).toMatchObject({ id: String(sorted[0].ID), warnings: [] })
  })
})
