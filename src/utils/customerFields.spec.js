import { describe, expect, it } from 'vitest'
import { CORPORATE_TYPE, NISA_CONTRACT } from './apiEnums'
import {
  CUSTOMER_FIELD_GROUPS,
  CUSTOMER_FIELDS,
  corporateFixedValues,
  emptyCustomerForm,
  hasCustomerFormErrors,
  isLockedByCorporateType,
  toCustomerForm,
  validateCustomerForm,
} from './customerFields'

/*
 * 顧客マスタのフォーム項目定義。項目はこれから増えるので、項目数やラベルを直接書かず、
 * 宣言（required / initial / control / min / max / pattern）から期待値を導く。
 */

const CONTROLS = ['text', 'integer', 'decimal', 'select']
const isNumeric = (field) => field.control === 'integer' || field.control === 'decimal'

const requiredMessage = (field) =>
  field.control === 'select'
    ? `${field.label}を選択してください。`
    : `${field.label}を入力してください。`

/** 1 項目だけ値を差し替えたフォームを検査し、その項目のエラーを返す */
const errorFor = (field, value, base = emptyCustomerForm()) =>
  validateCustomerForm({ ...base, [field.key]: value })[field.key]

/** 必須をすべて埋めた（検査を通る）フォーム */
function validForm() {
  const form = emptyCustomerForm()
  for (const field of CUSTOMER_FIELDS) {
    if (!field.required || form[field.key] !== '') continue
    if (field.control === 'select') form[field.key] = 'X'
    else if (isNumeric(field)) form[field.key] = String(field.min ?? 0)
    else form[field.key] = 'テスト'
  }
  return form
}

const birthDate = CUSTOMER_FIELDS.find((field) => field.key === 'birthDate')

/** 法人のとき固定する NISA の 3 項目（CustomerRequest.NISA契約 の description「法人は '0' 固定」） */
const NISA_KEYS = ['nisaContract', 'growthQuota', 'growthQuotaNext']
const lockableFields = CUSTOMER_FIELDS.filter((field) => field.corporateValue !== undefined)
const corporateForm = (overrides = {}) => ({
  ...emptyCustomerForm(),
  corporateType: CORPORATE_TYPE.CORPORATE,
  ...overrides,
})
const individualForm = (overrides = {}) => ({
  ...emptyCustomerForm(),
  corporateType: CORPORATE_TYPE.INDIVIDUAL,
  ...overrides,
})
/** NISA の 3 項目を固定値と違う値（契約済み・買付可能額あり）にした差分 */
const nisaInUse = {
  nisaContract: NISA_CONTRACT.CONTRACTED,
  growthQuota: '1200000',
  growthQuotaNext: '2400000',
}

// シナリオ: docs/unit/utils-customer-fields.md
describe('utils/customerFields', () => {
  it('[CFF-01] 全項目はグループを並び順に畳んだもので、key と testid が重複しない', () => {
    expect(CUSTOMER_FIELDS).toEqual(CUSTOMER_FIELD_GROUPS.flatMap((group) => group.fields))

    const keys = CUSTOMER_FIELDS.map((field) => field.key)
    const testids = CUSTOMER_FIELDS.map((field) => field.testid)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(testids).size).toBe(testids.length)

    for (const field of CUSTOMER_FIELDS) {
      expect(CONTROLS, field.key).toContain(field.control)
    }
  })

  it('[CFF-02] 空のフォームは宣言された初期値から始まり、呼ぶたびに別物になる', () => {
    const form = emptyCustomerForm()

    expect(Object.keys(form)).toEqual(CUSTOMER_FIELDS.map((field) => field.key))
    for (const field of CUSTOMER_FIELDS) {
      expect(form[field.key], field.key).toBe(field.initial ?? '')
    }
    // 初期値を持つ項目が 1 つも無ければ、このシナリオは意味を失う
    expect(CUSTOMER_FIELDS.some((field) => field.initial !== undefined)).toBe(true)

    // 前回の入力を持ち越さない
    form[CUSTOMER_FIELDS[0].key] = '書き換え'
    expect(emptyCustomerForm()).not.toBe(form)
    expect(emptyCustomerForm()[CUSTOMER_FIELDS[0].key]).toBe(CUSTOMER_FIELDS[0].initial ?? '')
  })

  it('[CFF-03] 顧客の値は文字列に開き、null と欠けた項目は空欄にする', () => {
    const numericFields = CUSTOMER_FIELDS.filter(isNumeric)
    const textField = CUSTOMER_FIELDS.find((field) => field.control === 'text')
    const [zeroField, numberField, nullField] = numericFields
    // 0 / 数値 / null の 3 通りを別の項目で試せないと、このシナリオは意味を失う
    expect(numericFields.length).toBeGreaterThanOrEqual(3)

    const customer = {
      [zeroField.key]: 0,
      [numberField.key]: 1234.5,
      [nullField.key]: null,
      [textField.key]: '山田 太郎',
      // それ以外の項目は欠けている
    }

    const form = toCustomerForm(customer)

    expect(Object.keys(form)).toEqual(CUSTOMER_FIELDS.map((field) => field.key))
    for (const value of Object.values(form)) expect(typeof value).toBe('string')
    // 0 と「値が無い」は区別する
    expect(form[zeroField.key]).toBe('0')
    expect(form[numberField.key]).toBe('1234.5')
    expect(form[nullField.key]).toBe('')
    expect(form[textField.key]).toBe('山田 太郎')

    const missing = CUSTOMER_FIELDS.find((field) => !(field.key in customer))
    expect(form[missing.key]).toBe('')
  })

  it('[CFF-04] 空のフォームでは初期値の無い必須項目だけがエラーになる', () => {
    const initial = emptyCustomerForm()
    const errors = validateCustomerForm(initial)

    expect(Object.keys(errors)).toEqual(CUSTOMER_FIELDS.map((field) => field.key))
    for (const field of CUSTOMER_FIELDS) {
      const expected = field.required && initial[field.key] === '' ? requiredMessage(field) : ''
      expect(errors[field.key], field.key).toBe(expected)
    }
    // 入力欄と選択欄の両方の文言を確かめられないと、このシナリオは意味を失う
    const failing = CUSTOMER_FIELDS.filter((field) => errors[field.key])
    expect(failing.some((field) => field.control === 'select')).toBe(true)
    expect(failing.some((field) => field.control !== 'select')).toBe(true)
  })

  it('[CFF-05] 空白だけの入力は未入力とみなす', () => {
    const requiredInputs = CUSTOMER_FIELDS.filter(
      (field) => field.required && field.control !== 'select',
    )
    expect(requiredInputs.length).toBeGreaterThan(0)

    for (const field of requiredInputs) {
      expect(errorFor(field, '   '), field.key).toBe(requiredMessage(field))
    }
  })

  it('[CFF-06] 整数の項目は小数も文字も受け付けない', () => {
    const integerFields = CUSTOMER_FIELDS.filter((field) => field.control === 'integer')
    expect(integerFields.length).toBeGreaterThan(0)

    for (const field of integerFields) {
      for (const value of ['1.5', 'abc']) {
        expect(errorFor(field, value), `${field.key}=${value}`).toBe(
          `${field.label}は整数で入力してください。`,
        )
      }
    }
  })

  it('[CFF-07] 小数を許す項目は数値なら通し、文字は受け付けない', () => {
    const decimalFields = CUSTOMER_FIELDS.filter((field) => field.control === 'decimal')
    expect(decimalFields.length).toBeGreaterThan(0)

    for (const field of decimalFields) {
      expect(errorFor(field, 'abc'), field.key).toBe(`${field.label}は数値で入力してください。`)
      expect(errorFor(field, '1.25'), field.key).toBe('')
    }
  })

  it('[CFF-08] 範囲は境界ちょうどを通し、外れたら上下限を添えて弾く', () => {
    const ranged = CUSTOMER_FIELDS.filter(
      (field) => isNumeric(field) && (field.min !== undefined || field.max !== undefined),
    )
    expect(ranged.length).toBeGreaterThan(0)

    for (const field of ranged) {
      if (field.min !== undefined) {
        expect(errorFor(field, String(field.min)), field.key).toBe('')
        expect(errorFor(field, String(field.min - 1)), field.key).toBe(
          `${field.label}は ${field.min.toLocaleString('ja-JP')} 以上で入力してください。`,
        )
      }
      if (field.max !== undefined) {
        expect(errorFor(field, String(field.max)), field.key).toBe('')
        expect(errorFor(field, String(field.max + 1)), field.key).toBe(
          `${field.label}は ${field.max.toLocaleString('ja-JP')} 以下で入力してください。`,
        )
      }
    }
  })

  it('[CFF-09] 生年月日は 8 桁の数字か 0（法人）だけを受け付ける', () => {
    expect(birthDate?.pattern).toBeTruthy()

    for (const value of ['19620708', '0', '']) {
      expect(errorFor(birthDate, value), value).toBe('')
    }
    for (const value of ['1962-07-08', '1962070']) {
      expect(errorFor(birthDate, value), value).toBe(birthDate.patternMessage)
    }
  })

  it('[CFF-10] 必須をすべて埋めればエラーは無く、1 つでもあれば検出する', () => {
    const errors = validateCustomerForm(validForm())

    for (const field of CUSTOMER_FIELDS) {
      expect(errors[field.key], field.key).toBe('')
    }
    expect(hasCustomerFormErrors(errors)).toBe(false)

    const target = CUSTOMER_FIELDS.find((field) => field.required)
    const broken = validateCustomerForm({ ...validForm(), [target.key]: '' })
    expect(hasCustomerFormErrors(broken)).toBe(true)
  })

  it('[CFF-11] 法人のときだけ NISA の 3 項目が入力不可になる', () => {
    // 固定値を宣言しているのは NISA の 3 項目で、値はどれも '0'
    expect(lockableFields.map((field) => field.key)).toEqual(NISA_KEYS)
    for (const field of lockableFields) expect(field.corporateValue, field.key).toBe('0')

    for (const field of CUSTOMER_FIELDS) {
      const lockable = NISA_KEYS.includes(field.key)
      expect(isLockedByCorporateType(field, corporateForm()), field.key).toBe(lockable)
      expect(isLockedByCorporateType(field, individualForm()), field.key).toBe(false)
    }
    // フォームが未用意（null / undefined）でも落ちずに false
    expect(isLockedByCorporateType(lockableFields[0], null)).toBe(false)
    expect(isLockedByCorporateType(lockableFields[0], undefined)).toBe(false)
  })

  it('[CFF-12] 法人なら固定値と違う NISA の項目だけを固定値で返し、個人なら空を返す', () => {
    const allFixed = Object.fromEntries(lockableFields.map((field) => [field.key, field.corporateValue]))

    // 法人で 3 項目とも固定値と違う → 3 項目すべて
    expect(corporateFixedValues(corporateForm(nisaInUse))).toEqual(allFixed)
    // 法人で揃っている項目は含めない（1 項目だけ違う → その 1 項目）
    expect(corporateFixedValues(corporateForm({ ...allFixed, growthQuota: '5000' }))).toEqual({
      growthQuota: allFixed.growthQuota,
    })
    // 法人で 3 項目とも固定値 → 空（watchEffect が無限に書き戻さない前提）
    expect(corporateFixedValues(corporateForm(allFixed))).toEqual({})
    // 個人は NISA を使っていても触らない
    expect(corporateFixedValues(individualForm(nisaInUse))).toEqual({})
  })
})
