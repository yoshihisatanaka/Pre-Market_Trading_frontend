import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { customers } from '@/mocks/fixtures/customers'
import { holdings } from '@/mocks/fixtures/holdings'
import { symbols } from '@/mocks/fixtures/symbols'
import { buildCalculationResponse, calculationMessages } from '@/mocks/fixtures/calculations'
import { ApiError } from './client'
import { calculate } from './calculations'

/*
 * API 層のテスト。送る本文（CalculationRequest の日本語キーと型）と応答の変換を、
 * MSW の既定ハンドラ（src/mocks/handlers/calculations.js）に当てて確かめる。
 * 応答の期待値は、ハンドラと同じ計算（buildCalculationResponse）で同じ本文から組み立てる。
 */
const PATH = '*/api/calculations'

const yamada = customers.find((row) => row.口座番号 === 1230001)
const aapl = symbols.find((row) => row.Ticker === 'AAPL')
const aaplHolding = holdings.find(
  (row) =>
    row.口座番号 === yamada.口座番号 && row.銘柄コード === aapl.銘柄コード && row.預り売買区分 === '1',
)

/** 送る条件（アプリ内モデル）。既定は AAPL を特定で 10 株売り、任意項目は空 */
function input(overrides = {}) {
  return {
    accountNumber: String(yamada.口座番号),
    symbol: aapl.Ticker,
    side: '1',
    quantity: 10,
    unitPrice: 230.5,
    specificDeposit: '1',
    fxRate: null,
    localFee1: null,
    localFee2: null,
    localTax1: null,
    localTax2: null,
    localTax3: null,
    otherCost1: null,
    otherCost2: null,
    feePattern: null,
    feeMultiplier: null,
    basisPoints: null,
    taxExempt: false,
    feeMin: null,
    feeMax: null,
    ...overrides,
  }
}

/** POST の本文を記録する（応答は既定ハンドラに任せる） */
function recordBodies() {
  const bodies = []
  server.use(
    http.post(PATH, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

/** 応答の 1 系統 → アプリ内モデルの期待値 */
function expectedBlock(raw) {
  const orNull = (value) => (typeof value === 'number' ? value : null)
  return {
    tradeFxRate: raw.約定為替レート,
    grossAmount: orNull(raw.現地約定金額),
    localFee: orNull(raw.現地手数料),
    localTax: orNull(raw.現地取引税),
    otherCost: orNull(raw.現地諸経費),
    settlementAmount: raw.現地精算金額,
    domesticFee: raw.国内手数料,
    consumptionTax: raw.消費税,
    finalAmount: raw.最終精算金額,
    nisaTradeYear: orNull(raw.NISA取引年),
    nisaFxRate: orNull(raw.NISA計算用為替レート),
    nisaAmount: orNull(raw.NISA使用予定額),
    capitalGainFxRate: orNull(raw.譲渡益税為替レート),
    averageCost: orNull(raw.概算平均取得単価),
    profitLoss: orNull(raw.概算譲渡損益),
    capitalGainTax: orNull(raw.概算譲渡益税額),
    afterTaxAmount: orNull(raw.税引後受渡金額),
  }
}

/** ハンドラと同じ計算で、既定の条件の生の応答を作る */
function rawResponse(overrides = {}) {
  return buildCalculationResponse({
    口座番号: yamada.口座番号,
    銘柄コード: aapl.Ticker,
    売買区分: '1',
    数量: 10,
    単価: 230.5,
    特定預り区分: '1',
    ...overrides,
  })
}

/** 'YYYYMMDD' の integer → 'YYYY-MM-DD' */
const toIso = (value) => String(value).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')

// シナリオ: docs/unit/api-calculations.md
describe('api/calculations', () => {
  it('[TCA-01] 本文は日本語キーで、口座番号は integer、空欄の任意項目は null', async () => {
    const bodies = recordBodies()
    await calculate(input())

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({
      口座番号: yamada.口座番号,
      銘柄コード: aapl.Ticker,
      売買区分: '1',
      数量: 10,
      単価: 230.5,
      特定預り区分: '1',
      為替レート: null,
      現地手数料1: null,
      現地手数料2: null,
      その他諸経費1: null,
      その他諸経費2: null,
      現地取引税1: null,
      現地取引税2: null,
      現地取引税3: null,
      手数料パターン: null,
      掛目: null,
      BP: null,
      消費税不要区分: false,
      手数料下限: null,
      手数料上限: null,
    })
    expect(typeof bodies[0].口座番号).toBe('number')
  })

  it('[TCA-02] 入力した任意項目は対応する日本語キーに数値のまま載る', async () => {
    const bodies = recordBodies()
    await calculate(
      input({
        fxRate: 149.5,
        localFee1: 1.5,
        localFee2: 0.25,
        localTax1: 0.02,
        localTax2: 0.03,
        localTax3: 0.04,
        otherCost1: 0.3,
        otherCost2: 0.4,
        feePattern: 'A',
        feeMultiplier: 80,
        basisPoints: 15,
        taxExempt: true,
        feeMin: 100,
        feeMax: 5000,
      }),
    )

    expect(bodies[0]).toMatchObject({
      為替レート: 149.5,
      現地手数料1: 1.5,
      現地手数料2: 0.25,
      現地取引税1: 0.02,
      現地取引税2: 0.03,
      現地取引税3: 0.04,
      その他諸経費1: 0.3,
      その他諸経費2: 0.4,
      手数料パターン: 'A',
      掛目: 80,
      BP: 15,
      消費税不要区分: true,
      手数料下限: 100,
      手数料上限: 5000,
    })
  })

  it('[TCA-03] 応答を円貨 / 外貨の系統に分けたアプリ内モデルにする', async () => {
    const raw = rawResponse()
    const result = await calculate(input())

    expect(result).toEqual({
      accountNumber: String(yamada.口座番号),
      symbolCode: aapl.銘柄コード,
      ticker: aapl.Ticker,
      symbolName: aapl.銘柄名,
      side: '1',
      quantity: 10,
      unitPrice: 230.5,
      specificDeposit: '1',
      specificDepositName: raw.特定預り区分名,
      fxRate: raw.為替レート,
      fxRateSource: raw.為替レート取得元,
      fxBaseDate: toIso(raw.為替基準日),
      spread: raw.スプレッド,
      spreadSource: raw.スプレッド取得元,
      holdingQuantity: aaplHolding.数量,
      averageCost: aaplHolding.平均取得単価,
      localFeeSource: raw.手数料パラメータ.現地手数料出所,
      localTaxSource: raw.手数料パラメータ.現地取引税出所,
      feePattern: raw.手数料パラメータ.手数料パターン,
      feePatternSource: raw.手数料パラメータ.手数料パターン出所,
      params: {
        localFeeRateBp: raw.計算パラメータ.現地手数料率_bp,
        exchangeTaxRate: raw.計算パラメータ.取引所税率,
        consumptionTaxRate: raw.計算パラメータ.消費税率,
        nisaFxMarkupRate: raw.計算パラメータ.NISA為替上乗せ率,
      },
      foreign: expectedBlock(raw.外貨),
      yen: expectedBlock(raw.円貨),
      warnings: [],
    })
    expect(result.fxBaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // 円貨の系統に外貨専用の項目は無い
    expect(result.yen.grossAmount).toBeNull()
    expect(result.yen.localFee).toBeNull()
    expect(result.yen.localTax).toBeNull()
    expect(result.yen.otherCost).toBeNull()
    expect(result.yen.profitLoss).toBe(raw.円貨.概算譲渡損益)
  })

  it('[TCA-04] 為替を手入力したら基準日は空、取得元はハンド入力', async () => {
    const result = await calculate(input({ fxRate: 149.5 }))

    expect(result.fxRate).toBe(149.5)
    expect(result.fxRateSource).toBe('ハンド入力')
    expect(result.spreadSource).toBe('ハンド入力')
    expect(result.spread).toBe(0)
    expect(result.fxBaseDate).toBe('')
  })

  it('[TCA-05] 欠けた項目・数値でない null 許容項目は空文字 / null / [] にする', async () => {
    const raw = rawResponse()
    delete raw.Ticker
    delete raw.銘柄名
    delete raw.残高数量
    raw.warnings = null
    raw.外貨.NISA使用予定額 = 'x'
    raw.円貨.概算譲渡損益 = '1000'
    server.use(http.post(PATH, () => HttpResponse.json(raw)))

    const result = await calculate(input())

    expect(result.warnings).toEqual([])
    expect(result.ticker).toBe('')
    expect(result.symbolName).toBe('')
    expect(result.holdingQuantity).toBeNull()
    expect(result.foreign.nisaAmount).toBeNull()
    expect(result.yen.profitLoss).toBeNull()
  })

  it('[TCA-06] 計算できた警告は例外にせず warnings に入る', async () => {
    const quantity = aaplHolding.数量 + 1
    const result = await calculate(input({ quantity }))

    expect(result.warnings).toContain(calculationMessages.overHolding(quantity, aaplHolding.数量))
  })

  it('[TCA-07] 400 は ApiError で、message はサーバの detail', async () => {
    const error = await calculate(input({ symbol: 'ZZZZ' })).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.message).toBe(calculationMessages.symbolNotFound('ZZZZ'))
  })

  it('[TCA-08] 422 は ApiError で、message の先頭に項目名が付く', async () => {
    const error = await calculate(input({ unitPrice: 0 })).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.message.startsWith('単価: ')).toBe(true)
  })
})
