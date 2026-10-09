import { describe, expect, it } from 'vitest'
import { SPECIFIC_DEPOSIT } from './apiEnums'
import { SIDE } from './orderEntryOptions'
import {
  buildCalculationInput,
  buildCalculationSummary,
  buildPendingSummary,
  createCalculationForm,
  hasCalculationFormErrors,
  validateCalculationForm,
} from './calculationForm'

/*
 * 仮計算フォームと結果カードの純関数。日付は引数で固定する（基準日 2026-10-06）。
 * 検証の文言はモック原文（routers/calculations.py の _validate_input）が仕様で、ファイル内の
 * MESSAGES / NUMBER_FIELDS は公開されていないため、ここでは文言そのものを期待値に書く。
 * 結果カードの Calculation はここで組み立てる（既定モックの AAPL 売り 10 株 × 230.5 の応答の値）。
 */
const NOW = new Date(2026, 9, 6, 10, 30)
const PLACEHOLDER = '—'

const MESSAGES = {
  symbolRequired: '銘柄コード／ティッカーを入力してください。',
  quantity: '数量は9桁以内の1株以上で入力してください。',
  unitPriceRequired: '単価を入力してください。',
  unitPriceDigits: '単価は整数7桁、小数8桁以内で入力してください。',
  unitPricePositive: '単価は0より大きい数値で入力してください。',
  fxRatePositive: '為替レートは0より大きい数値で入力してください。',
  feeFromDigits: '手数料Fromは整数7桁以内で入力してください。',
  basisPointsDigits: 'ベイシスポイントは整数3桁、小数2桁以内で入力してください。',
  tradeDate: '国内約定日はYYYYMMDD形式で入力してください。',
  feeRange: '手数料のFromはTo以下で入力してください。',
}

/** 未入力の行の見出し（並びどおり。NISA の 2 行は円換算精算金額の後ろに入る） */
const BASE_LABELS = ['外貨約定代金', '現地費用合計', '取引所税', '適用為替', '円換算精算金額']
const NISA_LABELS = ['NISA仮計算適用為替', 'NISA使用予定額']
const TAIL_LABELS = ['国内手数料', '消費税']

/** 必須を埋めたフォーム */
function filledForm(overrides = {}) {
  return {
    ...createCalculationForm({ now: NOW }),
    symbol: 'AAPL',
    quantity: '10',
    unitPrice: '230.5',
    ...overrides,
  }
}

/** 数値の欄の文言だけを取り出す */
function errorOf(key, overrides) {
  return validateCalculationForm(filledForm(overrides))[key]
}

/** 結果の 1 系統。既定は値なし */
function block(overrides = {}) {
  return {
    tradeFxRate: null,
    grossAmount: null,
    localFee: null,
    localTax: null,
    otherCost: null,
    settlementAmount: null,
    domesticFee: null,
    consumptionTax: null,
    finalAmount: null,
    nisaTradeYear: null,
    nisaFxRate: null,
    nisaAmount: null,
    capitalGainFxRate: null,
    averageCost: null,
    profitLoss: null,
    capitalGainTax: null,
    afterTaxAmount: null,
    ...overrides,
  }
}

/** AAPL を特定で 10 株売った結果（既定モックの値） */
function sellResult({ foreign = {}, yen = {}, ...overrides } = {}) {
  return {
    accountNumber: '1230001',
    symbolCode: 'S001',
    ticker: 'AAPL',
    symbolName: 'アップル',
    side: SIDE.SELL,
    quantity: 10,
    unitPrice: 230.5,
    specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC,
    specificDepositName: '特定',
    fxRate: 150.25,
    fxRateSource: 'm_為替',
    fxBaseDate: '2026-10-05',
    spread: 0.5,
    spreadSource: '仮計算マスタ',
    holdingQuantity: 100,
    averageCost: 30000,
    localFeeSource: '計算',
    localTaxSource: '計算',
    feePattern: '',
    feePatternSource: '既定',
    params: { localFeeRateBp: 10, exchangeTaxRate: 0.00002, consumptionTaxRate: 0.1, nisaFxMarkupRate: 5 },
    foreign: block({
      tradeFxRate: 150.25,
      grossAmount: 2305,
      localFee: 2.31,
      localTax: 0.05,
      otherCost: 0,
      ...foreign,
    }),
    yen: block({
      tradeFxRate: 149.75,
      settlementAmount: 344821,
      domesticFee: 1551,
      consumptionTax: 155,
      finalAmount: 343115,
      profitLoss: 43115,
      ...yen,
    }),
    warnings: [],
    ...overrides,
  }
}

/** NVDA を成長投資枠で 10 株買った結果（既定モックの値） */
function nisaBuyResult(nisaFxRate = 157.76) {
  return sellResult({
    symbolCode: 'S004',
    ticker: 'NVDA',
    side: SIDE.BUY,
    specificDeposit: SPECIFIC_DEPOSIT.GROWTH_QUOTA,
    foreign: { nisaFxRate, nisaAmount: nisaFxRate === null ? null : 363636 },
    yen: { tradeFxRate: 150.75, settlementAmount: 347826, finalAmount: 349547, profitLoss: null },
  })
}

const labelsOf = (summary) => summary.rows.map((row) => row.label)
const valueOf = (summary, key) => summary.rows.find((row) => row.key === key)?.value

// シナリオ: docs/unit/utils-calculation-form.md
describe('utils/calculationForm', () => {
  it('[TCF-01] 初期値は買い・特定・今日の国内約定日で、ほかは空（現地手数料区分の項目は無い）', () => {
    expect(createCalculationForm({ now: NOW })).toEqual({
      symbol: '',
      side: SIDE.BUY,
      specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC,
      quantity: '',
      fxRate: '',
      unitPrice: '',
      domesticTradeDate: '20261006',
      localFee1: '',
      localFee2: '',
      localTax1: '',
      localTax2: '',
      localTax3: '',
      otherCost1: '',
      otherCost2: '',
      taxExempt: false,
      feePattern: '',
      feeMultiplier: '',
      basisPoints: '',
      feeFrom: '',
      feeTo: '',
    })
  })

  it('[TCF-02] 引き継いだ銘柄・売買・預り区分が入り、空文字なら既定のまま', () => {
    const carried = createCalculationForm({
      now: NOW,
      symbol: 'NVDA',
      side: SIDE.SELL,
      specificDeposit: SPECIFIC_DEPOSIT.GROWTH_QUOTA,
    })
    expect(carried.symbol).toBe('NVDA')
    expect(carried.side).toBe(SIDE.SELL)
    expect(carried.specificDeposit).toBe(SPECIFIC_DEPOSIT.GROWTH_QUOTA)

    const empty = createCalculationForm({ now: NOW, symbol: '', side: '', specificDeposit: '' })
    expect(empty.symbol).toBe('')
    expect(empty.side).toBe(SIDE.BUY)
    expect(empty.specificDeposit).toBe(SPECIFIC_DEPOSIT.SPECIFIC)
  })

  it('[TCF-03] すべて正しく埋めたフォームは不備なし', () => {
    const errors = validateCalculationForm(
      filledForm({
        fxRate: '150.25',
        localFee1: '1.5',
        localFee2: '0',
        localTax1: '0.02',
        localTax2: '0.03',
        localTax3: '0.04',
        otherCost1: '12345678.12',
        otherCost2: '0.3',
        feePattern: 'A',
        feeMultiplier: '80',
        basisPoints: '15.5',
        feeFrom: '100',
        feeTo: '5000',
      }),
    )

    expect(Object.values(errors).every((message) => message === '')).toBe(true)
    expect(hasCalculationFormErrors(errors)).toBe(false)
  })

  it('[TCF-04] 初期値のままなら銘柄・数量・単価だけが不備', () => {
    const errors = validateCalculationForm(createCalculationForm({ now: NOW }))

    expect(errors.symbol).toBe(MESSAGES.symbolRequired)
    expect(errors.quantity).toBe(MESSAGES.quantity)
    expect(errors.unitPrice).toBe(MESSAGES.unitPriceRequired)
    const others = Object.entries(errors).filter(
      ([key]) => !['symbol', 'quantity', 'unitPrice'].includes(key),
    )
    expect(others.length).toBeGreaterThan(0)
    expect(others.every(([, message]) => message === '')).toBe(true)
    expect(errors.domesticTradeDate).toBe('')
    expect(hasCalculationFormErrors(errors)).toBe(true)
  })

  it('[TCF-05] 空白だけの銘柄は未入力', () => {
    expect(errorOf('symbol', { symbol: '   ' })).toBe(MESSAGES.symbolRequired)
  })

  it('[TCF-06] 数量は 1 株以上の 9 桁以内の整数（全角・カンマは受ける）', () => {
    for (const quantity of ['0', '1234567890', '1.5', 'abc']) {
      expect(errorOf('quantity', { quantity })).toBe(MESSAGES.quantity)
    }
    for (const quantity of ['１，０００', '999999999']) {
      expect(errorOf('quantity', { quantity })).toBe('')
    }
  })

  it('[TCF-07] 単価は整数 7 桁・小数 8 桁以内（全角・カンマは受ける）', () => {
    for (const unitPrice of ['12345678', '1.123456789']) {
      expect(errorOf('unitPrice', { unitPrice })).toBe(MESSAGES.unitPriceDigits)
    }
    for (const unitPrice of ['１２３．５', '1,234.5']) {
      expect(errorOf('unitPrice', { unitPrice })).toBe('')
    }
  })

  it('[TCF-08] 単価・為替は 0 を受けず、現地手数料は 0 を受ける', () => {
    const errors = validateCalculationForm(filledForm({ unitPrice: '0', fxRate: '0', localFee1: '0' }))

    expect(errors.unitPrice).toBe(MESSAGES.unitPricePositive)
    expect(errors.fxRate).toBe(MESSAGES.fxRatePositive)
    expect(errors.localFee1).toBe('')
  })

  it('[TCF-09] 整数だけの欄は小数の桁を言わない', () => {
    const errors = validateCalculationForm(filledForm({ feeFrom: '100.5', basisPoints: '1234' }))

    expect(errors.feeFrom).toBe(MESSAGES.feeFromDigits)
    expect(errors.basisPoints).toBe(MESSAGES.basisPointsDigits)
  })

  it('[TCF-10] 手数料 From/To は両方入っているときだけ大小を比べ、エラーは From に付く', () => {
    const reversed = validateCalculationForm(filledForm({ feeFrom: '5,000', feeTo: '100' }))
    expect(reversed.feeFrom).toBe(MESSAGES.feeRange)
    expect(reversed.feeTo).toBe('')

    for (const [feeFrom, feeTo] of [
      ['100', '100'],
      ['5000', ''],
      ['', '100'],
    ]) {
      const errors = validateCalculationForm(filledForm({ feeFrom, feeTo }))
      expect(errors.feeFrom).toBe('')
      expect(errors.feeTo).toBe('')
    }
  })

  it('[TCF-11] 国内約定日は空か 8 桁の数字', () => {
    for (const domesticTradeDate of ['', '20261006']) {
      expect(errorOf('domesticTradeDate', { domesticTradeDate })).toBe('')
    }
    for (const domesticTradeDate of ['2026106', '2026/10/06']) {
      expect(errorOf('domesticTradeDate', { domesticTradeDate })).toBe(MESSAGES.tradeDate)
    }
  })

  it('[TCF-12] 送る条件は銘柄を大文字にし、空欄の任意項目と未選択のパターンは null', () => {
    const input = buildCalculationInput(
      filledForm({ symbol: '  aapl ', side: SIDE.SELL, taxExempt: true }),
      { accountNumber: '1230001' },
    )

    expect(input).toEqual({
      accountNumber: '1230001',
      symbol: 'AAPL',
      side: SIDE.SELL,
      quantity: 10,
      unitPrice: 230.5,
      specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC,
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
      taxExempt: true,
      feeMin: null,
      feeMax: null,
    })
    expect(input).not.toHaveProperty('domesticTradeDate')
  })

  it('[TCF-13] 全角・カンマを正規化した数値にし、From/To は feeMin / feeMax に入る', () => {
    const input = buildCalculationInput(
      filledForm({
        quantity: '１，０００',
        unitPrice: '１２３．４５',
        fxRate: '１５０．２５',
        localFee1: '1,234.5',
        otherCost2: '０',
        feePattern: 'A',
        feeMultiplier: '８０',
        basisPoints: '15',
        feeFrom: '1,000',
        feeTo: '５０００',
      }),
      { accountNumber: '1230001' },
    )

    expect(input).toMatchObject({
      quantity: 1000,
      unitPrice: 123.45,
      fxRate: 150.25,
      localFee1: 1234.5,
      otherCost2: 0,
      feePattern: 'A',
      feeMultiplier: 80,
      basisPoints: 15,
      feeMin: 1000,
      feeMax: 5000,
    })
  })

  it('[TCF-14] 未実行の買い・特定は 7 行すべて「—」で、概算損益の枠は無い', () => {
    const summary = buildPendingSummary({
      side: SIDE.BUY,
      specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC,
      status: '未実行',
    })

    expect(summary.caption).toBe('買付概算 ／ 未実行')
    expect(summary.totalLabel).toBe('概算必要金額')
    expect(summary.total).toBe(PLACEHOLDER)
    expect(labelsOf(summary)).toEqual([...BASE_LABELS, ...TAIL_LABELS])
    expect(summary.rows.every((row) => row.value === PLACEHOLDER)).toBe(true)
    expect(summary.profitLoss).toBeNull()
    expect(summary.source).toContain(
      `取引所税 ${PLACEHOLDER}% ／ スプレッド ${PLACEHOLDER}円/USD ／ 現地手数料率 ${PLACEHOLDER}% ／ NISA仮計算用為替上乗せ率 ${PLACEHOLDER}%`,
    )
  })

  it('[TCF-15] 計算中の売り・特定は売却概算で、概算損益の枠が「—」で出る', () => {
    const summary = buildPendingSummary({
      side: SIDE.SELL,
      specificDeposit: SPECIFIC_DEPOSIT.SPECIFIC,
      status: '計算中',
    })

    expect(summary.caption).toBe('売却概算 ／ 計算中')
    expect(summary.totalLabel).toBe('概算受取金額')
    expect(summary.profitLoss).toEqual({ value: PLACEHOLDER, tone: '' })
  })

  it('[TCF-16] NISA の 2 行は買い × 成長投資枠だけ', () => {
    const pending = (side, specificDeposit) =>
      buildPendingSummary({ side, specificDeposit, status: '未実行' })

    const nisaBuy = pending(SIDE.BUY, SPECIFIC_DEPOSIT.GROWTH_QUOTA)
    expect(labelsOf(nisaBuy)).toEqual([...BASE_LABELS, ...NISA_LABELS, ...TAIL_LABELS])
    expect(nisaBuy.profitLoss).toBeNull()

    for (const summary of [
      pending(SIDE.SELL, SPECIFIC_DEPOSIT.GROWTH_QUOTA),
      pending(SIDE.SELL, SPECIFIC_DEPOSIT.NON_SPECIFIC),
    ]) {
      expect(labelsOf(summary)).toEqual([...BASE_LABELS, ...TAIL_LABELS])
      expect(summary.profitLoss).toBeNull()
    }
  })

  it('[TCF-17] 売り・特定の結果カード', () => {
    const summary = buildCalculationSummary(sellResult())

    expect(summary.caption).toBe('売却概算 ／ AAPL 10株')
    expect(summary.totalLabel).toBe('概算受取金額')
    expect(summary.total).toBe('343,115 円')
    expect(summary.rows.map((row) => [row.label, row.value])).toEqual([
      ['外貨約定代金', '2,305.00 ドル'],
      ['現地費用合計（手数料は自動）', '2.36 ドル'],
      ['取引所税（自動）', '0.05 ドル'],
      ['適用為替（為替 ± スプレッド）', '149.75 円/USD'],
      ['円換算精算金額', '344,821 円'],
      ['国内手数料', '1,551 円'],
      ['消費税', '155 円'],
    ])
    expect(summary.profitLoss).toEqual({ value: '+43,115 円', tone: 'profit' })
  })

  it('[TCF-18] 出所がハンド入力なら見出しが変わる', () => {
    const summary = buildCalculationSummary(
      sellResult({
        localFeeSource: 'ハンド入力',
        localTaxSource: 'ハンド入力',
        fxRateSource: 'ハンド入力',
      }),
    )

    expect(labelsOf(summary).slice(1, 4)).toEqual([
      '現地費用合計',
      '取引所税（入力値を優先）',
      '適用為替（手入力）',
    ])
  })

  it('[TCF-19] 成長投資枠の買いは NISA の 2 行が外貨の系統の値で入る', () => {
    const summary = buildCalculationSummary(nisaBuyResult())

    expect(summary.caption).toBe('買付概算 ／ NVDA 10株')
    expect(summary.totalLabel).toBe('概算必要金額')
    expect(summary.total).toBe('349,547 円')
    expect(labelsOf(summary).slice(5, 7)).toEqual(NISA_LABELS)
    expect(valueOf(summary, 'tradeFxRate')).toBe('150.75 円/USD')
    expect(valueOf(summary, 'settlementJpy')).toBe('347,826 円')
    expect(valueOf(summary, 'nisaFxRate')).toBe('157.76 円/USD')
    expect(valueOf(summary, 'nisaAmount')).toBe('363,636 円')
    expect(summary.profitLoss).toBeNull()

    const withoutNisa = buildCalculationSummary(nisaBuyResult(null))
    expect(labelsOf(withoutNisa)).not.toEqual(expect.arrayContaining(NISA_LABELS))
    expect(withoutNisa.rows).toHaveLength(BASE_LABELS.length + TAIL_LABELS.length)
  })

  it('[TCF-20] 概算損益は負なら − 付きで loss、0 は符号なし、null は枠ごと無い', () => {
    expect(buildCalculationSummary(sellResult({ yen: { profitLoss: -1200 } })).profitLoss).toEqual({
      value: '−1,200 円',
      tone: 'loss',
    })
    expect(buildCalculationSummary(sellResult({ yen: { profitLoss: 0 } })).profitLoss).toEqual({
      value: '0 円',
      tone: '',
    })
    expect(buildCalculationSummary(sellResult({ yen: { profitLoss: null } })).profitLoss).toBeNull()
  })

  it('[TCF-21] 現地費用がすべて無ければ現地費用合計と取引所税は「—」', () => {
    const summary = buildCalculationSummary(
      sellResult({ foreign: { localFee: null, localTax: null, otherCost: null } }),
    )

    expect(valueOf(summary, 'localCost')).toBe(PLACEHOLDER)
    expect(valueOf(summary, 'exchangeTax')).toBe(PLACEHOLDER)
  })

  it('[TCF-22] 仮計算マスタの注記は % に直した固定桁で、取得元が仮計算マスタなら付けない', () => {
    const summary = buildCalculationSummary(sellResult())

    expect(
      summary.source.startsWith(
        '仮計算マスタ：取引所税 0.002000% ／ スプレッド 0.5000円/USD ／ 現地手数料率 0.100000% ／ NISA仮計算用為替上乗せ率 5.0000%。',
      ),
    ).toBe(true)
  })

  it('[TCF-23] スプレッドの取得元が仮計算マスタ以外なら後ろに付ける', () => {
    const summary = buildCalculationSummary(sellResult({ spread: 0, spreadSource: 'ハンド入力' }))

    // 取得元の注記がスプレッドの項に入ること（単位との前後は問わない。報告の懸念を参照）
    expect(summary.source).toMatch(/スプレッド 0\.0000[^／]*（ハンド入力）[^／]* ／ 現地手数料率/)
    expect(buildCalculationSummary(sellResult()).source).not.toContain('（仮計算マスタ）')
  })

  it('[TCF-24] Ticker が無ければ銘柄コード、数量と為替は桁区切り・小数 2〜6 桁', () => {
    const noTicker = buildCalculationSummary(sellResult({ ticker: '', quantity: 1000 }))
    expect(noTicker.caption).toBe('売却概算 ／ S001 1,000株')

    expect(valueOf(buildCalculationSummary(sellResult({ yen: { tradeFxRate: 150 } })), 'tradeFxRate')).toBe(
      '150.00 円/USD',
    )
    expect(
      valueOf(buildCalculationSummary(sellResult({ yen: { tradeFxRate: 150.123456 } })), 'tradeFxRate'),
    ).toBe('150.123456 円/USD')
  })
})
