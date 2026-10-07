import { SPECIFIC_DEPOSIT } from './apiEnums'
import { LOCAL_FEE_CATEGORY_OPTIONS } from './calculationOptions'
import { formatJpyUnit, formatQuantity, formatUsdUnit } from './format'
import { SIDE } from './orderEntryOptions'
import { formatSignedJpyUnit, profitLossTone } from './profitLoss'

/*
 * 仮計算（顧客詳細の仮計算タブ）のフォームと結果の表示の純関数。入力値の初期値・画面での検証・送る値の
 * 組み立てと、結果のカードに出す文字列をここに置き、画面（views/CustomerCalculationView.vue）は状態だけを持つ。
 *
 * 検証の桁数と文言はモックリポジトリの routers/calculations.py（_validate_input）の原文。
 * 画面で止めるのは必須と形式だけで、口座・銘柄の有無や金額帯は `POST /calculations` に任せる。
 * 数値の欄は全角の数字とカンマを受け付ける（モックもカンマを落としてから検査している）。
 *
 * 金額は計算し直さない。結果のカードはサーバの応答（src/api/calculations.js の Calculation）を
 * 書式に流すだけで、足し算は「現地費用合計」（現地手数料 + 現地取引税 + 現地諸経費）の 1 か所だけ。
 */

const PLACEHOLDER = '—'

const MESSAGES = {
  symbolRequired: '銘柄コード／ティッカーを入力してください。',
  quantity: '数量は9桁以内の1株以上で入力してください。',
  tradeDate: '国内約定日はYYYYMMDD形式で入力してください。',
  feeRange: '手数料のFromはTo以下で入力してください。',
}

/**
 * 数値の欄の桁数（モックの _validate_input と同じ）。required は必須、positive は 0 を受けない
 * （CalculationRequest の 単価・為替レート は exclusiveMinimum 0。ほかは 0 以上）。
 */
const NUMBER_FIELDS = [
  { key: 'unitPrice', label: '単価', integer: 7, decimal: 8, required: true, positive: true },
  { key: 'fxRate', label: '為替レート', integer: 4, decimal: 6, positive: true },
  { key: 'localFee1', label: '現地手数料（外貨）①', integer: 7, decimal: 2 },
  { key: 'localFee2', label: '現地手数料（外貨）②', integer: 7, decimal: 2 },
  { key: 'localTax1', label: '現地取引税（外貨）①', integer: 7, decimal: 2 },
  { key: 'localTax2', label: '現地取引税（外貨）②', integer: 7, decimal: 2 },
  { key: 'localTax3', label: '現地取引税（外貨）③', integer: 7, decimal: 2 },
  { key: 'otherCost1', label: 'その他諸経費（外貨）①', integer: 8, decimal: 2 },
  { key: 'otherCost2', label: 'その他諸経費（外貨）②', integer: 8, decimal: 2 },
  { key: 'feeMultiplier', label: '手数料掛目', integer: 3, decimal: 2 },
  { key: 'basisPoints', label: 'ベイシスポイント', integer: 3, decimal: 2 },
  { key: 'feeFrom', label: '手数料From', integer: 7, decimal: 0 },
  { key: 'feeTo', label: '手数料To', integer: 7, decimal: 0 },
]

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Date → 'YYYYMMDD'（ローカル日付。国内約定日の既定） */
function toCompactDate(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
}

/**
 * 入力画面の初期値。手数料条件と現地費用は空（サーバが顧客属性・仮計算マスタで補完する）。
 *
 * @param {{ now?: Date, symbol?: string, side?: string, specificDeposit?: string }} [options]
 *   symbol / side / specificDeposit は外株預り・預り検索の「仮計算」から引き継いだ値
 *   （utils/calculationQuery.js の parseCalculationQuery の結果）。空なら既定（買い・特定）
 */
export function createCalculationForm({
  now = new Date(),
  symbol = '',
  side = '',
  specificDeposit = '',
} = {}) {
  return {
    symbol,
    side: side || SIDE.BUY,
    specificDeposit: specificDeposit || SPECIFIC_DEPOSIT.SPECIFIC,
    quantity: '',
    fxRate: '',
    unitPrice: '',
    domesticTradeDate: toCompactDate(now),
    localFee1: '',
    localFee2: '',
    localFeeCategory: LOCAL_FEE_CATEGORY_OPTIONS[0].value,
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
  }
}

/** 全角の数字・小数点・カンマを半角にし、カンマと前後の空白を落とす */
function normalizeNumberText(value) {
  return String(value ?? '')
    .replace(/[０-９．，]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/,/g, '')
    .trim()
}

/** 数値の欄の不備（無ければ ''） */
function numberFieldError(text, { label, integer, decimal, required = false, positive = false }) {
  const value = normalizeNumberText(text)
  if (!value) return required ? `${label}を入力してください。` : ''

  const pattern = new RegExp(`^\\d{1,${integer}}${decimal ? `(\\.\\d{1,${decimal}})?` : ''}$`)
  if (!pattern.test(value)) {
    return decimal
      ? `${label}は整数${integer}桁、小数${decimal}桁以内で入力してください。`
      : `${label}は整数${integer}桁以内で入力してください。`
  }
  if (positive && Number(value) <= 0) return `${label}は0より大きい数値で入力してください。`
  return ''
}

/** 数量の不備（無ければ ''）。1 株以上の 9 桁以内の整数 */
function quantityError(text) {
  const value = normalizeNumberText(text)
  return /^\d{1,9}$/.test(value) && Number(value) >= 1 ? '' : MESSAGES.quantity
}

/**
 * 画面で止められる不備を項目ごとに返す（FormField の error に渡す）。
 *
 * @param {ReturnType<typeof createCalculationForm>} form
 * @returns {Record<string, string>} キーは form の項目名。不備の無い項目は ''
 */
export function validateCalculationForm(form) {
  const errors = {
    symbol: form.symbol.trim() ? '' : MESSAGES.symbolRequired,
    quantity: quantityError(form.quantity),
    domesticTradeDate:
      !form.domesticTradeDate.trim() || /^\d{8}$/.test(form.domesticTradeDate.trim())
        ? ''
        : MESSAGES.tradeDate,
    ...Object.fromEntries(
      NUMBER_FIELDS.map((field) => [field.key, numberFieldError(form[field.key], field)]),
    ),
  }

  // 下限と上限は両方入っているときだけ比べる（片方だけならもう片方はサーバが手数料パターンで補う）
  const feeFrom = normalizeNumberText(form.feeFrom)
  const feeTo = normalizeNumberText(form.feeTo)
  if (!errors.feeFrom && !errors.feeTo && feeFrom && feeTo && Number(feeFrom) > Number(feeTo)) {
    errors.feeFrom = MESSAGES.feeRange
  }
  return errors
}

/** validateCalculationForm の結果に不備が 1 つでもあるか */
export function hasCalculationFormErrors(errors) {
  return Object.values(errors).some(Boolean)
}

/** 任意の数値の欄 → 送る値（空欄は null。サーバが補完する） */
function optionalNumber(text) {
  const value = normalizeNumberText(text)
  return value ? Number(value) : null
}

/**
 * 送る条件（src/api/calculations.js の CalculationInput）を組み立てる。
 * validateCalculationForm を通ったフォームにだけ使う（数量・単価は変換できる前提）。
 *
 * 国内約定日・現地手数料区分は送らない（CalculationRequest に項目が無い。docs/api/requests.md #47）。
 *
 * @param {ReturnType<typeof createCalculationForm>} form
 * @param {{ accountNumber: string }} context 顧客詳細で開いている顧客の口座番号
 * @returns {import('@/api/calculations').CalculationInput}
 */
export function buildCalculationInput(form, { accountNumber }) {
  return {
    accountNumber,
    symbol: form.symbol.trim().toUpperCase(),
    side: form.side,
    quantity: Number(normalizeNumberText(form.quantity)),
    unitPrice: Number(normalizeNumberText(form.unitPrice)),
    specificDeposit: form.specificDeposit,
    fxRate: optionalNumber(form.fxRate),
    localFee1: optionalNumber(form.localFee1),
    localFee2: optionalNumber(form.localFee2),
    localTax1: optionalNumber(form.localTax1),
    localTax2: optionalNumber(form.localTax2),
    localTax3: optionalNumber(form.localTax3),
    otherCost1: optionalNumber(form.otherCost1),
    otherCost2: optionalNumber(form.otherCost2),
    // 未選択は「顧客属性を適用」。空文字を送るとデフォルトパターンの指定になるので null にする
    feePattern: form.feePattern || null,
    feeMultiplier: optionalNumber(form.feeMultiplier),
    basisPoints: optionalNumber(form.basisPoints),
    taxExempt: form.taxExempt,
    feeMin: optionalNumber(form.feeFrom),
    feeMax: optionalNumber(form.feeTo),
  }
}

/* ---------- 結果のカード ---------- */

/** サーバの出所ラベル（CalculationFeeParams の 現地手数料出所 / 現地取引税出所 と 為替レート取得元） */
const SOURCE_HAND = 'ハンド入力'
const SOURCE_CALCULATED = '計算'
const SOURCE_SETTING = '仮計算マスタ'

const NOTICE =
  '手入力した現地費用・取引税は自動補完より優先します。成長投資枠の買付は、NISA使用予定額を通常為替に上乗せ率を加えて計算します。実際の約定・受渡・手数料・税額を確定するものではありません。'

const fxRateFormat = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 為替を「150.75 円/USD」の形にする */
function formatFxRate(value) {
  return isNumber(value) ? `${fxRateFormat.format(value)} 円/USD` : PLACEHOLDER
}

/** 小数第 digits 位までの固定表記（仮計算マスタの画面と同じ精度で出す） */
function formatFixed(value, digits) {
  return isNumber(value) ? value.toFixed(digits) : PLACEHOLDER
}

/** 値のある項目だけを足す。どれも無ければ null */
function sumOrNull(values) {
  const numbers = values.filter(isNumber)
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null
}

function estimateLabel(side) {
  return side === SIDE.SELL ? '売却概算' : '買付概算'
}

function totalLabel(side) {
  return side === SIDE.SELL ? '概算受取金額' : '概算必要金額'
}

/** 成長投資枠の買付だけ、NISA の 2 行を出す */
function isNisaBuy(side, specificDeposit) {
  return side === SIDE.BUY && specificDeposit === SPECIFIC_DEPOSIT.GROWTH_QUOTA
}

/**
 * 明細行の見出し（並びはモックのとおり。応答に無い円換算の内訳 3 行は「円換算精算金額」1 行にまとめる）。
 * 値は結果があればそこから、無ければ「—」。
 */
function resultRows({ nisa, labels = {}, values = {} }) {
  const row = (key, label) => ({
    key,
    label: labels[key] ?? label,
    value: values[key] ?? PLACEHOLDER,
  })
  return [
    row('grossAmount', '外貨約定代金'),
    row('localCost', '現地費用合計'),
    row('exchangeTax', '取引所税'),
    row('tradeFxRate', '適用為替'),
    row('settlementJpy', '円換算精算金額'),
    ...(nisa ? [row('nisaFxRate', 'NISA仮計算適用為替'), row('nisaAmount', 'NISA使用予定額')] : []),
    row('domesticFee', '国内手数料'),
    row('consumptionTax', '消費税'),
  ]
}

function sourceText({ exchangeTax, spread, spreadNote = '', localFee, nisaMarkup }) {
  return `仮計算マスタ：取引所税 ${exchangeTax}% ／ スプレッド ${spread}円/USD${spreadNote} ／ 現地手数料率 ${localFee}% ／ NISA仮計算用為替上乗せ率 ${nisaMarkup}%。${NOTICE}`
}

/**
 * まだ結果が無いときのカード（未実行・計算中・失敗）。見出しと行は入力中の売買・預り区分に合わせる。
 *
 * @param {{ side: string, specificDeposit: string, status: string }} params status は見出しの右に出す状態（「未実行」など）
 */
export function buildPendingSummary({ side, specificDeposit, status }) {
  return {
    caption: `${estimateLabel(side)} ／ ${status}`,
    totalLabel: totalLabel(side),
    total: PLACEHOLDER,
    rows: resultRows({ nisa: isNisaBuy(side, specificDeposit) }),
    // 概算損益は特定預りの売りでだけ返る（CalculationResponse の 概算譲渡損益 の説明）
    profitLoss:
      side === SIDE.SELL && specificDeposit === SPECIFIC_DEPOSIT.SPECIFIC
        ? { value: PLACEHOLDER, tone: '' }
        : null,
    source: sourceText({
      exchangeTax: PLACEHOLDER,
      spread: PLACEHOLDER,
      localFee: PLACEHOLDER,
      nisaMarkup: PLACEHOLDER,
    }),
  }
}

/**
 * 結果のカード。金額は円貨の系統で出し、外貨（USD）の行だけ外貨の系統から取る。
 *
 * @param {import('@/api/calculations').Calculation} result
 */
export function buildCalculationSummary(result) {
  const { foreign, yen, params } = result
  const nisa = isNumber(foreign.nisaFxRate)
  const spreadNote =
    result.spreadSource && result.spreadSource !== SOURCE_SETTING ? `（${result.spreadSource}）` : ''

  return {
    caption: `${estimateLabel(result.side)} ／ ${result.ticker || result.symbolCode} ${formatQuantity(result.quantity)}株`,
    totalLabel: totalLabel(result.side),
    total: formatJpyUnit(yen.finalAmount),
    rows: resultRows({
      nisa,
      labels: {
        localCost:
          result.localFeeSource === SOURCE_CALCULATED ? '現地費用合計（手数料は自動）' : undefined,
        exchangeTax:
          result.localTaxSource === SOURCE_HAND ? '取引所税（入力値を優先）' : '取引所税（自動）',
        tradeFxRate:
          result.fxRateSource === SOURCE_HAND ? '適用為替（手入力）' : '適用為替（為替 ± スプレッド）',
      },
      values: {
        grossAmount: formatUsdUnit(foreign.grossAmount),
        localCost: formatUsdUnit(sumOrNull([foreign.localFee, foreign.localTax, foreign.otherCost])),
        exchangeTax: formatUsdUnit(foreign.localTax),
        tradeFxRate: formatFxRate(yen.tradeFxRate),
        settlementJpy: formatJpyUnit(yen.settlementAmount),
        // NISA は上乗せ率を加えた外貨の系統の値（円貨の系統は上乗せなし）
        nisaFxRate: formatFxRate(foreign.nisaFxRate),
        nisaAmount: formatJpyUnit(foreign.nisaAmount),
        domesticFee: formatJpyUnit(yen.domesticFee),
        consumptionTax: formatJpyUnit(yen.consumptionTax),
      },
    }),
    profitLoss: isNumber(yen.profitLoss)
      ? { value: formatSignedJpyUnit(yen.profitLoss), tone: profitLossTone(yen.profitLoss) }
      : null,
    source: sourceText({
      // 取引所税率は比率、現地手数料率は bp で返るので % に直す（仮計算マスタの画面と同じ換算）
      exchangeTax: formatFixed(params.exchangeTaxRate * 100, 6),
      spread: formatFixed(result.spread, 4),
      spreadNote,
      localFee: formatFixed(params.localFeeRateBp / 100, 6),
      nisaMarkup: formatFixed(params.nisaFxMarkupRate, 4),
    }),
  }
}
