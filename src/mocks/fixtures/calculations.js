import { calculationSetting } from './calculationSettings'
import { SPECIFIC_DEPOSIT_NAMES } from './codes'
import { customers } from './customers'
import { fxRates } from './fxRates'
import { holdings } from './holdings'
import { symbols } from './symbols'

/*
 * 仮計算（POST /calculations）の応答を組み立てる。ここに書くのは「バックエンドが返す生の形」
 * （openapi.json の CalculationResponse。日本語キー・円貨 / 外貨の 2 系統）であり、アプリ内モデルではない。
 *
 * 計算式はバックエンドの app/services/fee_service.py（calculate_estimate。正本は doc/仮計算.xlsx）を写す。
 * 丸めも同じ向き（切上 / 切捨 / 四捨五入）にしてあるが、浮動小数で計算するので末尾の桁は保証しない
 * （モックの役目は画面の分岐を一通り出すこと）。
 *
 * 引くマスタはフィクスチャの初期値（画面で登録・変更した行は対象外）。ただし仮計算マスタは
 * 仮計算マスタの画面で変えた値を使えるよう、呼び出し側（handlers/calculations.js）から渡せる。
 *   口座   … 顧客マスタ（fixtures/customers.js）の 口座番号
 *   銘柄   … 銘柄マスタの 銘柄コード、無ければ Ticker（実 API と同じ引き直し）
 *   為替   … 為替マスタの最新の有効行（為替レート・源泉レート・基準日）
 *   残高   … 預り（fixtures/holdings.js）の 口座番号 × 銘柄コード × 預り売買区分（= 特定預り区分）
 *   手数料 … 下の FEE_PATTERNS（手数料パターン・優遇マスタのモックは無いので、ここで持つ）
 */

/**
 * 手数料パターン（m_手数料パターン のモック）。'' がデフォルト。どちらも金額帯は 1 つ（全額を覆う）。
 * 登録していない文字を指定すると、実 API と同じくデフォルトで計算して warnings に理由を足す。
 */
export const FEE_PATTERNS = {
  '': {
    ID: 1,
    邦貨精算金額_超: 0,
    邦貨精算金額_以下: 9_999_999_999,
    国内手数料率: 0.45,
    手数料加算金額: 0,
    手数料最低金額: 0,
    手数料最高金額: 20_000,
  },
  A: {
    ID: 2,
    邦貨精算金額_超: 0,
    邦貨精算金額_以下: 9_999_999_999,
    国内手数料率: 0.3,
    手数料加算金額: 0,
    手数料最低金額: 0,
    手数料最高金額: 15_000,
  },
}

/** 実 API が 400 で返す理由の文言（fee_service.py の原文） */
export const calculationMessages = {
  accountNotFound: (accountNo) => `口座番号 ${accountNo} は存在しません`,
  symbolNotFound: (code) => `銘柄コード ${code} は存在しません`,
  invalidDeposit: (code) => `特定預り区分のコードが不正です: ${code}`,
  overHolding: (quantity, held) => `数量 ${quantity} が残高 ${held} を超えています`,
  noHolding: '該当する残高明細が見つかりません',
  unknownPattern: (pattern) =>
    `手数料パターン '${pattern}' は手数料パターンマスタに登録されていないため、デフォルトパターンで計算しました`,
}

/** 口座・銘柄が無いなど、実 API が 400 で返すもの。handlers/calculations.js が { detail } にする */
export class CalculationRejected extends Error {}

const SIDE_SELL = '1'
const DEPOSIT_GENERAL = '0'
const DEPOSIT_SPECIFIC = '1'
const DEPOSIT_GROWTH = '6'

const HAND_INPUT_KEYS = [
  '現地手数料1',
  '現地手数料2',
  'その他諸経費1',
  'その他諸経費2',
  '現地取引税1',
  '現地取引税2',
  '現地取引税3',
  '手数料パターン',
  '掛目',
  'BP',
  '消費税不要区分',
  '手数料下限',
  '手数料上限',
]

/* 丸め。浮動小数の誤差（2.9999999 が 2 に落ちる）を吸収するため、桁をずらしてから微小量を足す */
const EPSILON = 1e-9

function roundDown(value, digits = 2) {
  const factor = 10 ** digits
  return Math.trunc(value * factor + Math.sign(value) * EPSILON) / factor
}

function roundUp(value, digits = 2) {
  const factor = 10 ** digits
  return Math.ceil(value * factor - EPSILON) / factor
}

function roundHalfUp(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor + EPSILON) / factor
}

/** 足し引きで出た末尾の誤差を落とす（金額は小数第 8 位までで十分） */
function tidy(value) {
  return Number(value.toFixed(8))
}

function sumHand(body, keys) {
  return tidy(keys.reduce((total, key) => total + (body[key] ?? 0), 0))
}

function latestFx() {
  return fxRates
    .filter((row) => row.通貨コード === 'USD' && row.取消区分 === 0)
    .reduce((latest, row) => (!latest || row.基準日 > latest.基準日 ? row : latest), null)
}

function findSymbol(code) {
  const value = String(code).trim().toUpperCase()
  return (
    symbols.find((row) => row.銘柄コード === value) ??
    symbols.find((row) => row.Ticker.toUpperCase() === value) ??
    null
  )
}

/** 国内手数料のパラメータ（fee_service.py の resolve_fee_params。優遇マスタは無い前提） */
function resolveFeeParams(body, warnings) {
  const handPattern = body.手数料パターン ?? null
  let pattern = handPattern === null ? '' : String(handPattern).trim().toUpperCase()
  let patternSource = handPattern === null ? '既定' : 'ハンド入力'
  if (!(pattern in FEE_PATTERNS)) {
    warnings.push(calculationMessages.unknownPattern(pattern))
    pattern = ''
    patternSource = '既定'
  }
  const band = FEE_PATTERNS[pattern]
  const handMin = body.手数料下限 ?? null
  const handMax = body.手数料上限 ?? null

  return {
    pattern,
    patternSource,
    band,
    rate: band.国内手数料率,
    surcharge: band.手数料加算金額,
    min: handMin ?? band.手数料最低金額,
    max: handMax ?? band.手数料最高金額,
    minMaxSource: handMin !== null || handMax !== null ? 'ハンド入力' : 'パターンマスタ',
    ratio: body.掛目 ?? 100,
    ratioSource: body.掛目 === null || body.掛目 === undefined ? '既定' : 'ハンド入力',
    bp: body.BP ?? 0,
    bpSource: body.BP === null || body.BP === undefined ? '既定' : 'ハンド入力',
  }
}

function domesticFeeJpy(settlementJpy, fee) {
  const base =
    fee.bp > 0
      ? roundDown((settlementJpy * fee.bp) / 10_000, 0)
      : roundDown((settlementJpy * fee.rate) / 100 + fee.surcharge, 0)
  const amount = roundDown((base * fee.ratio) / 100, 0)
  if (fee.min !== null && amount < fee.min) return fee.min
  if (fee.max !== null && amount >= fee.max) return fee.max
  return amount
}

function domesticFeeUsd(settlementUsd, fxRate, fee) {
  const variable = fee.bp > 0 ? (settlementUsd * fee.bp) / 10_000 : (settlementUsd * fee.rate) / 100
  return tidy(
    roundDown((variable * fee.ratio) / 100, 2) +
      roundDown((fee.surcharge / fxRate) * (fee.ratio / 100), 2),
  )
}

function capitalGainTax(profitLoss, setting) {
  if (profitLoss <= 0) return 0
  return (
    roundDown(profitLoss * setting.譲渡益所得税率, 0) +
    roundDown(profitLoss * setting.譲渡益住民税率, 0)
  )
}

function emptyExtras() {
  return {
    NISA取引年: null,
    NISA計算用為替レート: null,
    NISA使用予定額: null,
    譲渡益税為替レート: null,
    概算平均取得単価: null,
    概算譲渡損益: null,
    概算譲渡益税額: null,
    税引後受渡金額: null,
  }
}

/**
 * CalculationRequest（本文の型は検査済みの前提）から CalculationResponse を組み立てる。
 * 口座・銘柄・特定預り区分が不正なら CalculationRejected を投げる（実 API の 400）。
 *
 * @param {Record<string, unknown>} body
 * @param {{ setting?: typeof calculationSetting, today?: Date }} [options]
 *   setting は仮計算マスタの現在値、today は NISA 取引年の基準
 */
export function buildCalculationResponse(
  body,
  { setting = calculationSetting, today = new Date() } = {},
) {
  const warnings = []
  const accountNo = body.口座番号
  const side = body.売買区分
  const isSell = side === SIDE_SELL
  const quantity = body.数量
  const unitPrice = body.単価
  const deposit = body.特定預り区分 ? String(body.特定預り区分) : DEPOSIT_GENERAL

  if (!(deposit in SPECIFIC_DEPOSIT_NAMES)) {
    throw new CalculationRejected(calculationMessages.invalidDeposit(deposit))
  }
  if (!customers.some((row) => row.口座番号 === accountNo)) {
    throw new CalculationRejected(calculationMessages.accountNotFound(accountNo))
  }
  const symbol = findSymbol(body.銘柄コード)
  if (!symbol) throw new CalculationRejected(calculationMessages.symbolNotFound(body.銘柄コード))

  // 為替。手入力ならスプレッド 0、無ければ為替マスタの最新行に仮計算マスタのスプレッドを乗せる
  const fxRow = latestFx()
  const handFx = body.為替レート ?? null
  const fxRate = handFx ?? fxRow.為替レート
  const spread = handFx === null ? setting.為替スプレッド : 0
  const yenFxRate = tidy(isSell ? fxRate - spread : fxRate + spread)
  const withholdingRate = fxRow?.源泉レート ?? yenFxRate

  // 現地精算（外貨）
  const gross = isSell ? roundUp(quantity * unitPrice, 3) : tidy(quantity * unitPrice)
  const handFee = sumHand(body, ['現地手数料1', '現地手数料2'])
  const localFee =
    handFee > 0 ? handFee : roundHalfUp((gross * setting.現地手数料率_bp) / 10_000, 2)
  const handTax = sumHand(body, ['現地取引税1', '現地取引税2', '現地取引税3'])
  const localTax = handTax > 0 ? handTax : isSell ? roundUp(gross * setting.取引所税率, 2) : 0
  const otherCost = sumHand(body, ['その他諸経費1', 'その他諸経費2'])
  const settlementUsd = tidy(
    isSell ? gross - localFee - localTax - otherCost : gross + localFee + localTax + otherCost,
  )
  const settlementJpy = isSell
    ? roundUp(settlementUsd * roundDown(fxRate - spread, 3), 0)
    : roundDown(settlementUsd * (fxRate + spread), 0)

  // 国内手数料・消費税
  const fee = resolveFeeParams(body, warnings)
  const feeJpy = domesticFeeJpy(settlementJpy, fee)
  const feeUsd = domesticFeeUsd(settlementUsd, fxRate, fee)
  const taxExempt = Boolean(body.消費税不要区分)
  const taxJpy = taxExempt ? 0 : roundDown(feeJpy * setting.消費税率, 0)
  const taxUsd = taxExempt ? 0 : roundDown(feeUsd * setting.消費税率, 2)
  const finalJpy = isSell ? settlementJpy - feeJpy - taxJpy : settlementJpy + feeJpy + taxJpy
  const finalUsd = tidy(isSell ? settlementUsd - feeUsd - taxUsd : settlementUsd + feeUsd + taxUsd)

  // 残高（口座 × 銘柄 × 特定預り区分）
  const holding = holdings.find(
    (row) =>
      row.口座番号 === accountNo &&
      row.銘柄コード === symbol.銘柄コード &&
      row.預り売買区分 === deposit,
  )
  const heldQuantity = holding ? holding.数量 : null
  const averageCost = holding ? holding.平均取得単価 : null
  if (holding && isSell && quantity > heldQuantity) {
    warnings.push(calculationMessages.overHolding(quantity, heldQuantity))
  } else if (!holding && (isSell || deposit === DEPOSIT_SPECIFIC)) {
    warnings.push(calculationMessages.noHolding)
  }

  const foreign = {
    約定為替レート: fxRate,
    現地約定金額: gross,
    現地手数料: localFee,
    現地取引税: localTax,
    現地諸経費: otherCost,
    現地精算金額: settlementUsd,
    国内手数料: feeUsd,
    消費税: taxUsd,
    最終精算金額: finalUsd,
    ...emptyExtras(),
  }
  const yen = {
    約定為替レート: yenFxRate,
    現地精算金額: settlementJpy,
    国内手数料: feeJpy,
    消費税: taxJpy,
    最終精算金額: finalJpy,
    ...emptyExtras(),
  }

  // 成長投資枠: NISA 取引年と、買いのときだけ NISA 使用予定額（外貨の系統は上乗せ率を加えた為替）
  if (deposit === DEPOSIT_GROWTH) {
    foreign.NISA取引年 = today.getFullYear()
    yen.NISA取引年 = today.getFullYear()
    if (!isSell) {
      const nisaFxRate = roundDown(fxRate * (1 + setting.NISA為替上乗せ率 / 100), 2)
      foreign.NISA計算用為替レート = nisaFxRate
      yen.NISA計算用為替レート = fxRate
      foreign.NISA使用予定額 = roundDown(gross * nisaFxRate, 0)
      yen.NISA使用予定額 = roundDown(gross * fxRate, 0)
    }
  }

  // 特定預り: 譲渡損益（売り）と平均取得単価の再計算（買い）
  if (deposit === DEPOSIT_SPECIFIC) {
    foreign.譲渡益税為替レート = withholdingRate
    yen.譲渡益税為替レート = fxRate
    if (isSell && averageCost !== null) {
      const acquisition = averageCost * quantity
      const profitLossJpy = finalJpy - acquisition
      const profitLossUsd =
        roundUp(settlementUsd * withholdingRate, 0) -
        roundDown(feeUsd * withholdingRate, 0) -
        roundDown(taxUsd * withholdingRate, 0) -
        acquisition
      const taxAmountJpy = capitalGainTax(profitLossJpy, setting)
      Object.assign(yen, {
        概算平均取得単価: averageCost,
        概算譲渡損益: profitLossJpy,
        概算譲渡益税額: taxAmountJpy,
        税引後受渡金額: finalJpy - taxAmountJpy,
      })
      Object.assign(foreign, {
        概算平均取得単価: averageCost,
        概算譲渡損益: profitLossUsd,
        概算譲渡益税額: capitalGainTax(profitLossUsd, setting),
        税引後受渡金額: finalUsd,
      })
    } else if (!isSell) {
      const baseQuantity = heldQuantity ?? 0
      const baseCost = averageCost ?? 0
      const total = baseQuantity + quantity
      yen.概算平均取得単価 = roundDown((baseCost * baseQuantity + finalJpy) / total, 0)
      foreign.概算平均取得単価 = roundDown(
        (baseCost * baseQuantity + roundDown(finalUsd * withholdingRate, 0)) / total,
        0,
      )
    }
  }

  return {
    口座番号: accountNo,
    銘柄コード: symbol.銘柄コード,
    Ticker: symbol.Ticker,
    銘柄名: symbol.銘柄名,
    売買区分: side,
    数量: quantity,
    単価: unitPrice,
    特定預り区分: deposit,
    特定預り区分名: SPECIFIC_DEPOSIT_NAMES[deposit],
    為替レート: fxRate,
    スプレッド: spread,
    スプレッド取得元: handFx === null ? '仮計算マスタ' : 'ハンド入力',
    源泉レート: withholdingRate,
    為替レート取得元: handFx === null ? 'm_為替' : 'ハンド入力',
    源泉レート取得元: fxRow?.源泉レート ? 'm_為替' : '代用（円貨約定為替レート）',
    為替基準日: handFx === null ? fxRow.基準日 : null,
    残高数量: heldQuantity,
    平均取得単価: averageCost,
    ハンド入力: Object.fromEntries(
      HAND_INPUT_KEYS.filter((key) => body[key] !== null && body[key] !== undefined).map((key) => [
        key,
        body[key],
      ]),
    ),
    手数料パラメータ: {
      手数料パターン: fee.pattern,
      手数料パターン出所: fee.patternSource,
      適用金額帯: {
        ID: fee.band.ID,
        邦貨精算金額_超: fee.band.邦貨精算金額_超,
        邦貨精算金額_以下: fee.band.邦貨精算金額_以下,
      },
      国内手数料率: fee.rate,
      手数料加算金額: fee.surcharge,
      手数料最低金額: fee.min,
      手数料最大金額: fee.max,
      最低最大出所: fee.minMaxSource,
      掛目: fee.ratio,
      掛目出所: fee.ratioSource,
      BP: fee.bp,
      BP出所: fee.bpSource,
      手数料優遇適用: false,
      現地手数料出所: handFee > 0 ? 'ハンド入力' : '計算',
      現地取引税出所: handTax > 0 ? 'ハンド入力' : '計算',
    },
    計算パラメータ: {
      現地手数料率_bp: setting.現地手数料率_bp,
      取引所税率: setting.取引所税率,
      消費税率: setting.消費税率,
      消費税不要区分: taxExempt,
      譲渡益所得税率: setting.譲渡益所得税率,
      譲渡益住民税率: setting.譲渡益住民税率,
      NISA為替上乗せ率: setting.NISA為替上乗せ率,
    },
    外貨: foreign,
    円貨: yen,
    warnings,
  }
}

/**
 * 契約テストに渡す応答の見本。画面の分岐を一通り含める。
 *   特定・売り（概算損益あり）/ 成長投資枠・買い（NISA の行あり）/ 一般・売り・ハンド入力あり（警告あり）
 */
export const calculationExamples = [
  buildCalculationResponse({
    口座番号: 1230001,
    銘柄コード: 'AAPL',
    売買区分: '1',
    数量: 10,
    単価: 230.5,
    特定預り区分: '1',
  }),
  buildCalculationResponse({
    口座番号: 1230001,
    銘柄コード: 'NVDA',
    売買区分: '3',
    数量: 5,
    単価: 120.12345678,
    特定預り区分: '6',
  }),
  buildCalculationResponse({
    口座番号: 1230001,
    銘柄コード: 'MSFT',
    売買区分: '1',
    数量: 3,
    単価: 420,
    特定預り区分: '0',
    為替レート: 149.5,
    現地手数料1: 1.5,
    現地取引税1: 0.02,
    その他諸経費1: 0.3,
    手数料パターン: 'Z',
    掛目: 80,
    BP: 15,
    消費税不要区分: true,
    手数料下限: 100,
    手数料上限: 5000,
  }),
]
