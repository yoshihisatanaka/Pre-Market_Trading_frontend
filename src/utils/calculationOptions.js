import { SPECIFIC_DEPOSIT } from './apiEnums'

/*
 * 仮計算（顧客詳細の仮計算タブ）の選択肢。
 *
 * 表示名はモックリポジトリの provisional_calculation.html、値は CalculationRequest に送るコード。
 * 預り区分は CalculationRequest.特定預り区分（預りの明細と同じ向き。1 特定 / 0 非特定 / 6 成長投資枠）で、
 * 新規注文の預り売買区分（utils/orderEntryOptions.js の DEPOSIT_CATEGORY。0 / 1 が逆）とは別物。
 */

/** 預り区分。並びはモックのとおり（特定が先頭で既定） */
export const CALCULATION_DEPOSIT_OPTIONS = [
  { value: SPECIFIC_DEPOSIT.SPECIFIC, label: '特定' },
  { value: SPECIFIC_DEPOSIT.NON_SPECIFIC, label: '一般' },
  { value: SPECIFIC_DEPOSIT.GROWTH_QUOTA, label: '成長投資枠' },
]

/** 手数料パターン（A〜Z の 1 文字）。未選択は顧客属性（手数料優遇マスタ）を適用する */
export const FEE_PATTERN_OPTIONS = Array.from({ length: 26 }, (_, index) => {
  const letter = String.fromCharCode('A'.charCodeAt(0) + index)
  return { value: letter, label: letter }
})
