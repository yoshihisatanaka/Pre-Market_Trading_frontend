import { http, HttpResponse } from 'msw'
import { calculationSetting } from '../fixtures/calculationSettings'
import { detailError, nowIsoTimestamp } from './_shared'

// 仮計算マスタは 1 件しか無いので、行の配列ではなくオブジェクトの写しを持つ
let calculationSettingRow = { ...calculationSetting }

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetCalculationSettingsRow() {
  calculationSettingRow = { ...calculationSetting }
}

export const calculationSettingsHandlers = [
  // 仮計算マスタ。1 件だけの設定なので一覧ではない
  http.get('*/api/masters/calculation-settings', () => HttpResponse.json(calculationSettingRow)),

  /*
   * 仮計算マスタの更新。形は実 API（FastAPI と calculation_setting_service.py）に合わせる。
   *
   *   200 CalculationSettingActionResponse … { success, calculation_setting, message }
   *   422 HTTPValidationError … pydantic の制約違反。{ detail: [{ type, loc, msg, input, ctx }] }
   *   409 ErrorResponse       … 楽観的ロックの競合。{ detail: '…' }
   *
   * 部分更新で、送られた項目だけを上書きする。数値の項目は null と省略が「触らない」で、
   * 備考だけは本文にキーがあれば null や空白でもクリアする（calculation_setting_service.py の _validate と同じ）。
   * 差分が無ければ履歴を残さず「変更はありません。」で現在値を返す。このとき楽観的ロックは見ない
   * （実 API も差分の判定が先で、競合の照合は更新するときだけ）。
   * 画面側では範囲を検証しない方針なので、拒否の理由はここが持つ。
   */
  http.put('*/api/masters/calculation-settings', async ({ request }) => {
    const body = (await request.json().catch(() => null)) ?? {}

    // pydantic は不合格の項目を全部まとめて返す（先勝ちで 1 件ではない）
    const errors = CALCULATION_FIELD_RULES.flatMap((rule) => validateCalculationField(body, rule))
    if (errors.length > 0) {
      return HttpResponse.json({ detail: errors }, { status: 422 })
    }

    const requested = Object.fromEntries(
      NUMERIC_FIELDS.filter((field) => body[field] !== undefined && body[field] !== null).map(
        (field) => [field, body[field]],
      ),
    )
    if ('備考' in body) requested['備考'] = String(body['備考'] ?? '').trim() || null
    const changes = Object.fromEntries(
      Object.entries(requested).filter(([field, value]) => value !== calculationSettingRow[field]),
    )
    if (Object.keys(changes).length === 0) {
      return HttpResponse.json(actionResponse('変更はありません。'))
    }

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    const updatedAt = body['更新日時'] ?? null
    if (updatedAt && updatedAt !== calculationSettingRow['更新日時']) {
      return detailError(409, CALCULATION_CONFLICT_DETAIL)
    }

    calculationSettingRow = {
      ...calculationSettingRow,
      ...changes,
      // 画面から更新したので 1 が立つ（システム連携ではない）
      ユーザー操作フラグ: 1,
      更新日時: nowIsoTimestamp(),
      更新者: '006',
    }

    return HttpResponse.json(actionResponse('仮計算マスタを変更しました。'))
  }),
]

/* ここから仮計算マスタ（/masters/calculation-settings）のモック用ヘルパ。実 API の応答を模すためだけのもの */

function actionResponse(message) {
  return { success: true, calculation_setting: calculationSettingRow, message }
}

/**
 * CalculationSettingUpdateRequest の制約（openapi.json）。いずれも 0 以上で、
 * 比率の 4 項目は 1 以下、NISA為替上乗せ率（%）は 100 以下。為替スプレッドと bp は上限なし。
 */
const CALCULATION_FIELD_RULES = [
  { field: '為替スプレッド', ge: 0 },
  { field: '現地手数料率_bp', ge: 0 },
  { field: '取引所税率', ge: 0, le: 1 },
  { field: '消費税率', ge: 0, le: 1 },
  { field: '譲渡益所得税率', ge: 0, le: 1 },
  { field: '譲渡益住民税率', ge: 0, le: 1 },
  { field: 'NISA為替上乗せ率', ge: 0, le: 100 },
]

/** 更新できる数値の項目。差分の判定と上書きに使う（備考は null の扱いが違うので別に見る） */
const NUMERIC_FIELDS = CALCULATION_FIELD_RULES.map((rule) => rule.field)

/** 楽観的ロックの競合。実 API が返すのと同じ文言 */
const CALCULATION_CONFLICT_DETAIL =
  '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。'

/** pydantic の msg。実 API はおおむね日本語化している（src/mocks/handlers/sliceCriteria.js と同じ文言） */
const CALCULATION_MESSAGES = {
  parsing: '数値で入力してください',
  greater_than_equal: '指定できる下限を下回っています',
  less_than_equal: '指定できる上限を超えています',
}

/**
 * 1 項目ぶんの検証。省略と null は部分更新の「触らない」なので検証しない。
 * pydantic と同じく「型で落ちたら制約は見ない」順序にする。合格なら空配列（呼び出し側が flatMap でつなぐ）。
 */
function validateCalculationField(body, { field, ge, le }) {
  const input = body[field]
  if (input === undefined || input === null) return []

  if (typeof input !== 'number' || !Number.isFinite(input)) {
    const msg = CALCULATION_MESSAGES.parsing
    return [calculationValidationError('float_parsing', field, msg, input)]
  }
  if (ge !== undefined && input < ge) {
    const msg = CALCULATION_MESSAGES.greater_than_equal
    return [calculationValidationError('greater_than_equal', field, msg, input, { ge })]
  }
  if (le !== undefined && input > le) {
    const msg = CALCULATION_MESSAGES.less_than_equal
    return [calculationValidationError('less_than_equal', field, msg, input, { le })]
  }
  return []
}

/** ValidationError 1 件。loc の先頭は値の出所（本文なので 'body'）。ctx は制約違反のときだけ付く */
function calculationValidationError(type, field, msg, input, ctx) {
  return { type, loc: ['body', field], msg, input, ...(ctx ? { ctx } : {}) }
}
