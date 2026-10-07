import { http, HttpResponse } from 'msw'
import { buildCalculationResponse, CalculationRejected } from '../fixtures/calculations'
import { currentCalculationSetting } from './calculationSettings'
import { detailError, requestValidationError } from './_shared'

/*
 * 仮計算（POST /calculations）。実 API と同じパス・同じ形で返す。計算は fixtures/calculations.js。
 *
 *   200 CalculationResponse   … 計算できた。確認が要ること（残高超過・残高なし・未登録の手数料パターン）は warnings
 *   400 ErrorResponse         … 口座・銘柄が無い、特定預り区分が不正（{ detail: '…' }）
 *   422 HTTPValidationError   … 本文の型・制約の違反（pydantic）。最初の 1 件だけを返す
 * 仮計算マスタは、仮計算マスタの画面で変えた値を使う（handlers/calculationSettings.js の現在値）。
 */

/** 本文の制約（openapi.json の CalculationRequest） */
const FIELD_RULES = [
  { field: '口座番号', required: true, integer: true, gt: 0 },
  { field: '銘柄コード', required: true, string: true },
  { field: '売買区分', required: true, pattern: /^(1|3)$/ },
  { field: '数量', required: true, integer: true, gt: 0 },
  { field: '単価', required: true, gt: 0 },
  { field: '為替レート', gt: 0 },
  ...[
    '現地手数料1',
    '現地手数料2',
    'その他諸経費1',
    'その他諸経費2',
    '現地取引税1',
    '現地取引税2',
    '現地取引税3',
    '掛目',
    'BP',
    '手数料下限',
    '手数料上限',
  ].map((field) => ({ field, ge: 0 })),
]

/**
 * 1 項目ぶんの検証。違反があれば 422 の応答、無ければ null。
 * pydantic と同じく「型で落ちたら制約は見ない」順序にし、msg は実 API の日本語化に合わせる（handlers/fxRates.js と同じ文言）。
 */
function fieldProblem(body, rule) {
  const { field } = rule
  const input = body[field]
  const loc = ['body', field]
  if (input === undefined || input === null) {
    return rule.required ? requestValidationError(loc, 'Field required', 'missing') : null
  }
  if (rule.string || rule.pattern) {
    if (typeof input !== 'string' || (rule.string && input.length === 0)) {
      return requestValidationError(loc, '文字列で入力してください', 'string_type')
    }
    if (rule.pattern && !rule.pattern.test(input)) {
      return requestValidationError(loc, '指定できる値ではありません', 'string_pattern_mismatch')
    }
    return null
  }
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return requestValidationError(loc, '数値で入力してください', 'float_parsing')
  }
  if (rule.integer && !Number.isInteger(input)) {
    return requestValidationError(loc, '整数で入力してください', 'int_parsing')
  }
  if (rule.gt !== undefined && input <= rule.gt) {
    return requestValidationError(loc, '0 より大きい値を入力してください', 'greater_than')
  }
  if (rule.ge !== undefined && input < rule.ge) {
    return requestValidationError(loc, '指定できる下限を下回っています', 'greater_than_equal')
  }
  return null
}

export const calculationHandlers = [
  http.post('*/api/calculations', async ({ request }) => {
    const body = (await request.json().catch(() => null)) ?? {}
    for (const rule of FIELD_RULES) {
      const problem = fieldProblem(body, rule)
      if (problem) return problem
    }

    try {
      return HttpResponse.json(
        buildCalculationResponse(body, { setting: currentCalculationSetting() }),
      )
    } catch (e) {
      if (e instanceof CalculationRejected) return detailError(400, e.message)
      throw e
    }
  }),
]
