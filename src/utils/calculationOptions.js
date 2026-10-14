import { SPECIFIC_DEPOSIT } from './apiEnums'

/*
 * 仮計算（顧客詳細の仮計算タブ）の選択肢。値は CalculationRequest に送るコード。
 *
 * 預り区分は CalculationRequest.特定預り区分（預りの明細と同じ向き。1 特定 / 0 一般 / 6 成長投資枠）で、
 * 新規注文の預り売買区分（utils/orderEntryOptions.js の DEPOSIT_CATEGORY。0 / 1 が逆）とは別物。
 */

/**
 * 預り区分のコード列。表示名はコードマスタ `特定預り区分` から引く（views/CustomerCalculationView.vue）。
 * 並びはモック（provisional_calculation.html）のとおり（特定が先頭で既定）。NISA・継続管理勘定は出さない
 * （画面モックに合わせた絞り込み。docs/api/requests.md #73）
 */
export const CALCULATION_DEPOSIT_CODES = [
  SPECIFIC_DEPOSIT.SPECIFIC,
  SPECIFIC_DEPOSIT.NON_SPECIFIC,
  SPECIFIC_DEPOSIT.GROWTH_QUOTA,
]

/** 手数料パターン（A〜Z の 1 文字）。未選択は顧客属性（手数料優遇マスタ）を適用する */
export const FEE_PATTERN_OPTIONS = Array.from({ length: 26 }, (_, index) => {
  const letter = String.fromCharCode('A'.charCodeAt(0) + index)
  return { value: letter, label: letter }
})
