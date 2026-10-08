import { apiClient } from './client'

/*
 * 仮計算（概算損益・受渡概算額の試算。実 API `POST /calculations`。DB は更新しない）。
 *
 * 計算はすべてサーバが行う（式の正本はバックエンドの doc/仮計算.xlsx）。画面は入力を送って、
 * 返った値を出すだけにする（端末側で金額を計算し直さない）。
 *
 * バックエンドの形を知ってよいのはこの層だけ。吸収している差は次のとおり。
 *   - プロパティ名が日本語（口座番号 / 銘柄コード / 売買区分 …）。warnings だけ英語
 *   - 口座番号は integer。アプリ内は文字列（顧客マスタの口座番号と同じ）
 *   - 応答は円貨・外貨の 2 系統（円貨 / 外貨 のブロック）。アプリ内は yen / foreign
 *   - 任意のハンド入力は「送らない（null）」と「0 を送る」で意味が違う。空欄は null で送る
 *     （null ならサーバが仮計算マスタ・優遇マスタで補完する）
 *   - 為替基準日は YYYYMMDD の integer。アプリ内は 'YYYY-MM-DD'
 *
 * 銘柄コード は銘柄コードでもティッカーでもよい（サーバが銘柄コードで引けなければ Ticker で引き直し、
 * 応答の 銘柄コード は正式なコードになる）。画面の「銘柄コード／ティッカー」はそのまま送る。
 *
 * 画面の 国内約定日・現地手数料区分 は CalculationRequest に項目が無いので送らない（docs/api/requests.md #47）。
 */

/**
 * 送る仮計算の条件（アプリ内モデル）。組み立ては src/utils/calculationForm.js の buildCalculationInput。
 * 任意の数値は、空欄なら null（サーバ側で補完）。
 *
 * @typedef {{
 *   accountNumber: string,
 *   symbol: string,
 *   side: string,
 *   quantity: number,
 *   unitPrice: number,
 *   specificDeposit: string,
 *   fxRate: number|null,
 *   localFee1: number|null,
 *   localFee2: number|null,
 *   localTax1: number|null,
 *   localTax2: number|null,
 *   localTax3: number|null,
 *   otherCost1: number|null,
 *   otherCost2: number|null,
 *   feePattern: string|null,
 *   feeMultiplier: number|null,
 *   basisPoints: number|null,
 *   taxExempt: boolean,
 *   feeMin: number|null,
 *   feeMax: number|null,
 * }} CalculationInput
 *   side は売買区分のコード（'1' 売 / '3' 買）、specificDeposit は特定預り区分のコード（'1' 特定 / '0' 一般 / '6' 成長投資枠）。
 *   feePattern は A〜Z の 1 文字。null は「顧客属性（手数料優遇マスタ）を適用」
 */

/**
 * 円貨・外貨のどちらかの系統の算出値。系統に無い値・条件に当たらない値は null。
 *
 * @typedef {{
 *   tradeFxRate: number,
 *   grossAmount: number|null,
 *   localFee: number|null,
 *   localTax: number|null,
 *   otherCost: number|null,
 *   settlementAmount: number,
 *   domesticFee: number,
 *   consumptionTax: number,
 *   finalAmount: number,
 *   nisaTradeYear: number|null,
 *   nisaFxRate: number|null,
 *   nisaAmount: number|null,
 *   capitalGainFxRate: number|null,
 *   averageCost: number|null,
 *   profitLoss: number|null,
 *   capitalGainTax: number|null,
 *   afterTaxAmount: number|null,
 * }} CalculationBlock
 *   grossAmount / localFee / localTax / otherCost は外貨（USD）にだけある（円貨は null）
 */

/**
 * 仮計算の結果（アプリ内モデル）。
 *
 * @typedef {{
 *   accountNumber: string,
 *   symbolCode: string,
 *   ticker: string,
 *   symbolName: string,
 *   side: string,
 *   quantity: number,
 *   unitPrice: number,
 *   specificDeposit: string,
 *   specificDepositName: string,
 *   fxRate: number,
 *   fxRateSource: string,
 *   fxBaseDate: string,
 *   spread: number,
 *   spreadSource: string,
 *   holdingQuantity: number|null,
 *   averageCost: number|null,
 *   localFeeSource: string,
 *   localTaxSource: string,
 *   feePattern: string,
 *   feePatternSource: string,
 *   params: { localFeeRateBp: number, exchangeTaxRate: number, consumptionTaxRate: number, nisaFxMarkupRate: number },
 *   foreign: CalculationBlock,
 *   yen: CalculationBlock,
 *   warnings: string[],
 * }} Calculation
 *   fxBaseDate は為替マスタの基準日（'YYYY-MM-DD'。為替を手入力したときは ''）。
 *   localFeeSource / localTaxSource は「ハンド入力」か「計算」（サーバの出所ラベルのまま）
 */

/**
 * 仮計算を実行する。
 *
 * 口座・銘柄が無い、手数料の金額帯が無いなどは 400、本文の型の不備は 422 で返り、どちらも
 * ApiError として呼び出し側（stores/calculation.js の useAsync）の error に入る。
 * 計算はできたが確認が要ること（残高を超える売り数量など）は 200 の warnings に入る。
 *
 * @param {CalculationInput} input
 * @returns {Promise<Calculation>}
 */
export async function calculate(input) {
  const { data } = await apiClient.post('/calculations', toCalculationRequest(input))
  return toCalculation(data)
}

/** アプリ内モデル → CalculationRequest */
function toCalculationRequest(input) {
  return {
    口座番号: Number(input.accountNumber),
    銘柄コード: input.symbol,
    売買区分: input.side,
    数量: input.quantity,
    単価: input.unitPrice,
    特定預り区分: input.specificDeposit,
    為替レート: input.fxRate,
    現地手数料1: input.localFee1,
    現地手数料2: input.localFee2,
    その他諸経費1: input.otherCost1,
    その他諸経費2: input.otherCost2,
    現地取引税1: input.localTax1,
    現地取引税2: input.localTax2,
    現地取引税3: input.localTax3,
    手数料パターン: input.feePattern,
    掛目: input.feeMultiplier,
    BP: input.basisPoints,
    消費税不要区分: input.taxExempt,
    手数料下限: input.feeMin,
    手数料上限: input.feeMax,
  }
}

function toNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** YYYYMMDD の integer → 'YYYY-MM-DD'（無ければ ''） */
function toIsoDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ''))
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function toBlock(raw = {}) {
  return {
    tradeFxRate: raw['約定為替レート'],
    grossAmount: toNumberOrNull(raw['現地約定金額']),
    localFee: toNumberOrNull(raw['現地手数料']),
    localTax: toNumberOrNull(raw['現地取引税']),
    otherCost: toNumberOrNull(raw['現地諸経費']),
    settlementAmount: raw['現地精算金額'],
    domesticFee: raw['国内手数料'],
    consumptionTax: raw['消費税'],
    finalAmount: raw['最終精算金額'],
    nisaTradeYear: toNumberOrNull(raw['NISA取引年']),
    nisaFxRate: toNumberOrNull(raw['NISA計算用為替レート']),
    nisaAmount: toNumberOrNull(raw['NISA使用予定額']),
    capitalGainFxRate: toNumberOrNull(raw['譲渡益税為替レート']),
    averageCost: toNumberOrNull(raw['概算平均取得単価']),
    profitLoss: toNumberOrNull(raw['概算譲渡損益']),
    capitalGainTax: toNumberOrNull(raw['概算譲渡益税額']),
    afterTaxAmount: toNumberOrNull(raw['税引後受渡金額']),
  }
}

// バックエンドのキーは日本語。ここでだけ生の形を知る
function toCalculation(raw) {
  const feeParams = raw['手数料パラメータ'] ?? {}
  const params = raw['計算パラメータ'] ?? {}

  return {
    accountNumber: String(raw['口座番号']),
    symbolCode: raw['銘柄コード'],
    ticker: raw['Ticker'] ?? '',
    symbolName: raw['銘柄名'] ?? '',
    side: raw['売買区分'],
    quantity: raw['数量'],
    unitPrice: raw['単価'],
    specificDeposit: raw['特定預り区分'],
    specificDepositName: raw['特定預り区分名'] ?? '',
    fxRate: raw['為替レート'],
    fxRateSource: raw['為替レート取得元'],
    fxBaseDate: toIsoDate(raw['為替基準日']),
    spread: raw['スプレッド'],
    spreadSource: raw['スプレッド取得元'] ?? '',
    holdingQuantity: toNumberOrNull(raw['残高数量']),
    averageCost: toNumberOrNull(raw['平均取得単価']),
    localFeeSource: feeParams['現地手数料出所'] ?? '',
    localTaxSource: feeParams['現地取引税出所'] ?? '',
    feePattern: feeParams['手数料パターン'] ?? '',
    feePatternSource: feeParams['手数料パターン出所'] ?? '',
    params: {
      localFeeRateBp: params['現地手数料率_bp'],
      exchangeTaxRate: params['取引所税率'],
      consumptionTaxRate: params['消費税率'],
      nisaFxMarkupRate: params['NISA為替上乗せ率'],
    },
    foreign: toBlock(raw['外貨']),
    yen: toBlock(raw['円貨']),
    // default_factory 付きの項目だが、実 API 以外（プロキシのエラー等）に備える
    warnings: Array.isArray(raw['warnings']) ? raw['warnings'] : [],
  }
}
