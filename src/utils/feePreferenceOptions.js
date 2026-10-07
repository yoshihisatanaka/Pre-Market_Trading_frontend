import { FEE_PATTERN_OPTIONS } from './calculationOptions'

/*
 * 手数料優遇マスタ（/masters/fee-preferences）の選択肢と表示名。
 *
 * 手数料パターンは A〜Z の 1 文字で、**空文字がデフォルトパターン**（FeePreferenceItem の既定）。
 * 空文字が「値そのもの」なので、検索条件では「条件なし（空文字）」と区別できない。
 * そこで検索欄だけは、デフォルトパターンを DEFAULT_FEE_PATTERN_FILTER という目印で持ち、
 * api 層（src/api/feePreferences.js）が `fee_pattern=`（空文字）に直して送る。
 * 入力フォームは目印を使わず、空文字のまま持つ（本文の 手数料パターン に空文字を送ればデフォルト）。
 */

/** 検索条件で「デフォルトパターンの口座」を指す目印。URL クエリにもこの綴りで載る */
export const DEFAULT_FEE_PATTERN_FILTER = 'default'

const DEFAULT_FEE_PATTERN_LABEL = 'デフォルト'

/** 検索欄の選択肢（未選択 = 条件なしは BaseSelect の placeholder が受け持つ） */
export const FEE_PATTERN_FILTER_OPTIONS = [
  { value: DEFAULT_FEE_PATTERN_FILTER, label: DEFAULT_FEE_PATTERN_LABEL },
  ...FEE_PATTERN_OPTIONS,
]

/** 入力フォームの選択肢。デフォルトは空文字（未選択を作らず、先頭から始める） */
export const FEE_PATTERN_FORM_OPTIONS = [
  { value: '', label: DEFAULT_FEE_PATTERN_LABEL },
  ...FEE_PATTERN_OPTIONS,
]

/** 検索条件として受け付ける値か（URL クエリの検査に使う。未知の値は条件なしとして捨てる） */
export function isFeePatternFilter(value) {
  return FEE_PATTERN_FILTER_OPTIONS.some((option) => option.value === value)
}

/** 手数料パターンの表示名。空文字はデフォルト */
export function formatFeePattern(code) {
  return code ? code : DEFAULT_FEE_PATTERN_LABEL
}

/** 適用方式（FeePreferenceItem.適用方式）の表示名。値はサーバが付ける BASIS / PATTERN */
const APPLY_METHOD_LABELS = {
  BASIS: 'ベイシス方式',
  PATTERN: 'パターン方式',
}

/** 適用方式の表示名。未知の値はそのまま、空なら '—' */
export function formatApplyMethod(code) {
  if (!code) return '—'
  return APPLY_METHOD_LABELS[code] ?? code
}
