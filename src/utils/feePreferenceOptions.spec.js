import { describe, expect, it } from 'vitest'
import { FEE_PATTERN_OPTIONS } from './calculationOptions'
import {
  DEFAULT_FEE_PATTERN_FILTER,
  FEE_PATTERN_FILTER_OPTIONS,
  FEE_PATTERN_FORM_OPTIONS,
  formatApplyMethod,
  formatFeePattern,
  isFeePatternFilter,
} from './feePreferenceOptions'

/*
 * 手数料パターンは空文字が「デフォルトパターン」という値。検索欄は目印、入力フォームは空文字で持つ。
 * A〜Z の並びは calculationOptions の FEE_PATTERN_OPTIONS から導く（26 を直接書かない）。
 */
const LETTERS = FEE_PATTERN_OPTIONS.map((option) => option.value)

// シナリオ: docs/unit/utils-fee-preference-options.md
describe('utils/feePreferenceOptions', () => {
  it('[FPO-01] 検索欄の選択肢は目印の「デフォルト」から始まり A〜Z が続く', () => {
    expect(FEE_PATTERN_FILTER_OPTIONS).toHaveLength(LETTERS.length + 1)
    expect(FEE_PATTERN_FILTER_OPTIONS[0]).toEqual({
      value: DEFAULT_FEE_PATTERN_FILTER,
      label: 'デフォルト',
    })
    expect(FEE_PATTERN_FILTER_OPTIONS.slice(1).map((option) => option.value)).toEqual(LETTERS)
    expect(LETTERS[0]).toBe('A')
    expect(LETTERS.at(-1)).toBe('Z')
  })

  it('[FPO-02] 入力フォームの選択肢は空文字の「デフォルト」から始まり A〜Z が続く', () => {
    expect(FEE_PATTERN_FORM_OPTIONS).toHaveLength(LETTERS.length + 1)
    expect(FEE_PATTERN_FORM_OPTIONS[0]).toEqual({ value: '', label: 'デフォルト' })
    expect(FEE_PATTERN_FORM_OPTIONS.slice(1).map((option) => option.value)).toEqual(LETTERS)
  })

  it('[FPO-03] 検索条件として受け付けるのは目印と A〜Z だけ', () => {
    for (const value of [DEFAULT_FEE_PATTERN_FILTER, 'A', 'Z']) {
      expect(isFeePatternFilter(value)).toBe(true)
    }
    // 空文字は「条件なし」で、検索条件の値ではない。小文字・2 文字も捨てる
    for (const value of ['', 'a', 'ZZ']) {
      expect(isFeePatternFilter(value)).toBe(false)
    }
  })

  it('[FPO-04] 手数料パターンの表示名は空文字だけ「デフォルト」になる', () => {
    expect(formatFeePattern('')).toBe('デフォルト')
    expect(formatFeePattern('B')).toBe('B')
  })

  it('[FPO-05] 適用方式の表示名は既知の値を日本語に、空を —、未知の値はそのまま出す', () => {
    expect(formatApplyMethod('BASIS')).toBe('ベイシス方式')
    expect(formatApplyMethod('PATTERN')).toBe('パターン方式')
    expect(formatApplyMethod('')).toBe('—')
    expect(formatApplyMethod('OTHER')).toBe('OTHER')
  })
})
