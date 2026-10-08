import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { calculationSetting } from '@/mocks/fixtures/calculationSettings'
import { fetchCalculationSettings, updateCalculationSettings } from './calculationSettings'

/*
 * API 層のテスト。ここだけが「バックエンドの形」を知ってよい層なので、
 * **送り出すリクエストそのもの** を docs/api/openapi.json の CalculationSettingUpdateRequest と突き合わせる。
 *
 * 部分更新なので、画面に出さない 消費税率・譲渡益税率・備考 は「送らない」ことを守る
 * （送ると、画面が持っていない値でサーバの現在値を上書きしうる）。
 */

const PATH = '*/api/masters/calculation-settings'

/** 最後に届いたリクエストを覚えておくための入れ物 */
let lastRequest = null

afterEach(() => {
  lastRequest = null
})

/**
 * リクエストを記録して、指定の本文を返すハンドラを立てる。
 *
 * @param {'get'|'put'} method
 * @param {unknown} body 返す本文
 * @param {number} [status]
 */
function record(method, body, status = 200) {
  server.use(
    http[method](PATH, async ({ request }) => {
      const url = new URL(request.url)
      lastRequest = {
        url,
        params: url.searchParams,
        headers: request.headers,
        // GET は本文が無いので読まない（読むと空文字で例外になる）
        body: method === 'put' ? await request.json() : null,
      }
      return HttpResponse.json(body, { status })
    }),
  )
}

/** 更新の応答（CalculationSettingActionResponse） */
const SAVED_MESSAGE = '仮計算マスタを変更しました。'
const actionResponse = { success: true, calculation_setting: calculationSetting, message: SAVED_MESSAGE }

/** updateCalculationSettings() に渡すアプリ内モデル側の引数。値はフィクスチャから導く */
const updateArgs = {
  exchangeTaxRate: calculationSetting['取引所税率'] * 2,
  localCommissionBp: calculationSetting['現地手数料率_bp'] * 2,
  fxSpread: calculationSetting['為替スプレッド'] * 2,
  nisaFxMarkupRate: calculationSetting['NISA為替上乗せ率'] * 2,
  updatedAt: calculationSetting['更新日時'],
}

// シナリオ: docs/unit/api-calculation-settings.md
describe('api/calculationSettings', () => {
  it('[PCA-01] 取得は /masters/calculation-settings をクエリなしで呼ぶ', async () => {
    record('get', calculationSetting)

    await fetchCalculationSettings()

    expect(lastRequest.url.pathname).toBe('/api/masters/calculation-settings')
    // 単一リソースなので絞り込みもページングも無い
    expect([...lastRequest.params.keys()]).toEqual([])
  })

  it('[PCA-02] 日本語キーの応答が camelCase のモデルに変換される', async () => {
    record('get', calculationSetting)

    const settings = await fetchCalculationSettings()

    // 単位は API のまま（取引所税率は比率、現地手数料率は bp）。% への換算は画面の仕事
    expect(settings).toEqual({
      id: calculationSetting['ID'],
      fxSpread: calculationSetting['為替スプレッド'],
      localCommissionBp: calculationSetting['現地手数料率_bp'],
      exchangeTaxRate: calculationSetting['取引所税率'],
      consumptionTaxRate: calculationSetting['消費税率'],
      capitalGainsIncomeTaxRate: calculationSetting['譲渡益所得税率'],
      capitalGainsResidentTaxRate: calculationSetting['譲渡益住民税率'],
      nisaFxMarkupRate: calculationSetting['NISA為替上乗せ率'],
      note: calculationSetting['備考'],
      updatedAt: calculationSetting['更新日時'],
      updatedBy: calculationSetting['更新者'],
    })
  })

  it('[PCA-03] 備考・更新日時・更新者が null のときは null のまま返る', async () => {
    record('get', { ...calculationSetting, 備考: null, 更新日時: null, 更新者: null })

    const settings = await fetchCalculationSettings()

    expect(settings.note).toBeNull()
    expect(settings.updatedAt).toBeNull()
    expect(settings.updatedBy).toBeNull()
  })

  it('[PCA-04] 本文が返らないときは null になる', async () => {
    server.use(http.get(PATH, () => new HttpResponse(null, { status: 204 })))

    await expect(fetchCalculationSettings()).resolves.toBeNull()
  })

  it('[PCA-05] 更新の本文が画面の 4 項目と更新日時の 5 キーになる', async () => {
    record('put', actionResponse)

    await updateCalculationSettings(updateArgs)

    expect(lastRequest.url.pathname).toBe('/api/masters/calculation-settings')
    expect(lastRequest.body).toEqual({
      取引所税率: updateArgs.exchangeTaxRate,
      現地手数料率_bp: updateArgs.localCommissionBp,
      為替スプレッド: updateArgs.fxSpread,
      NISA為替上乗せ率: updateArgs.nisaFxMarkupRate,
      更新日時: updateArgs.updatedAt,
    })
  })

  it('[PCA-06] 画面に出さない消費税率・譲渡益税率・備考は送らない', async () => {
    record('put', actionResponse)

    await updateCalculationSettings(updateArgs)

    // 部分更新なので、送らなければサーバ側で現在値が保たれる
    for (const key of ['消費税率', '譲渡益所得税率', '譲渡益住民税率', '備考']) {
      expect(lastRequest.body).not.toHaveProperty(key)
    }
  })

  it('[PCA-07] 更新の応答が { settings, message } にほどかれる', async () => {
    record('put', actionResponse)

    const result = await updateCalculationSettings(updateArgs)

    expect(result.message).toBe(SAVED_MESSAGE)
    expect(result.settings).toMatchObject({
      id: calculationSetting['ID'],
      exchangeTaxRate: calculationSetting['取引所税率'],
      localCommissionBp: calculationSetting['現地手数料率_bp'],
      fxSpread: calculationSetting['為替スプレッド'],
      nisaFxMarkupRate: calculationSetting['NISA為替上乗せ率'],
      updatedAt: calculationSetting['更新日時'],
    })
  })

  it('[PCA-08] 更新に X-User-Code ヘッダが載る', async () => {
    record('put', actionResponse)

    await updateCalculationSettings(updateArgs)

    expect(lastRequest.headers.get('X-User-Code')).toBeTruthy()
  })

  it('[PCA-09] 422 は項目ごとの理由をつないだ ApiError になる', async () => {
    const detail = [
      {
        type: 'less_than_equal',
        loc: ['body', 'NISA為替上乗せ率'],
        msg: '指定できる上限を超えています',
        input: 101,
        ctx: { le: 100 },
      },
      {
        type: 'greater_than_equal',
        loc: ['body', '為替スプレッド'],
        msg: '指定できる下限を下回っています',
        input: -1,
        ctx: { ge: 0 },
      },
    ]
    record('put', { detail }, 422)

    await expect(updateCalculationSettings(updateArgs)).rejects.toMatchObject({
      status: 422,
      // 実 API の msg は項目名を含まないので、client.js が loc から補って区別できるようにする
      message:
        'NISA為替上乗せ率: 指定できる上限を超えています / 為替スプレッド: 指定できる下限を下回っています',
    })
  })

  it('[PCA-10] 409 はサーバの文言をそのまま持つ ApiError になる', async () => {
    const conflict =
      '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。'
    record('put', { detail: conflict }, 409)

    await expect(updateCalculationSettings(updateArgs)).rejects.toMatchObject({
      status: 409,
      message: conflict,
    })
  })
})
