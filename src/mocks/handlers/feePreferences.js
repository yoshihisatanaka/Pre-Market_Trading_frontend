import { http, HttpResponse } from 'msw'
import {
  applyMethodOf,
  canceledFeePreferences,
  feePreferences,
} from '../fixtures/feePreferences'
import { findCustomerByAccountNo } from './customers'
import {
  detailError,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

/**
 * 手数料優遇マスタの行。登録したものが一覧に出るところまで再現したいので書き換え可能に持つ。
 * 取消済みも持つのは、一覧が取消区分で外していることを確かめられるようにするため。
 */
let feePreferenceRows = [...feePreferences, ...canceledFeePreferences]

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetFeePreferenceRows() {
  feePreferenceRows = [...feePreferences, ...canceledFeePreferences]
}

/**
 * 手数料パターンマスタに登録済みと見なすパターン（空文字はデフォルトで常に有効）。
 * 手数料パターンマスタ（/masters/fee-patterns）の画面もモックも無いので、その代役。
 * これ以外のパターンを指定すると、事前検証と登録・変更の応答が警告を返す（登録は通る）。
 */
const REGISTERED_FEE_PATTERNS = ['A', 'B', 'C', 'D']

/** 数値項目の範囲（FeePreferenceRequest の宣言）。上限の無い項目は max を持たない */
const AMOUNT_MAX = 9999999999999
const NUMBER_FIELDS = [
  { field: '掛目', max: 100 },
  { field: '下限手数料', max: AMOUNT_MAX },
  { field: '上限手数料', max: AMOUNT_MAX },
  { field: 'ベイシス' },
  { field: '下限ベイシス円', max: AMOUNT_MAX },
  { field: '上限ベイシス円', max: AMOUNT_MAX },
  { field: 'スプレッド', max: 100 },
]

/** 入力の項目名（本文のキー）。部分更新で「送られてきた項目だけ」を拾うのに使う */
const INPUT_FIELDS = ['口座番号', '手数料パターン', ...NUMBER_FIELDS.map(({ field }) => field)]

export const feePreferenceHandlers = [
  /*
   * 手数料優遇マスタの一覧。取消済み（取消区分 1）は既定で返さない。
   *
   * **クエリ名は英語**（`branch_code` / `account_no` / `fee_pattern`）。レスポンスのキーは日本語。
   * 3 つとも完全一致。`fee_pattern` は**空文字も値**で、デフォルトパターンの口座に絞り込む
   * （クエリが無いときだけ条件なし）。部店の参照制限（全店参照権限の無いロールは自部店のみ）は模さない。
   *
   * 並びは口座番号の昇順を仮に置く（実 API の ORDER BY は仕様に書かれていない）。
   * 詳細照会・更新履歴・CSV 入出力は画面が使わないのでモックしない。
   */
  http.get('*/api/masters/fee-preferences', ({ request }) => {
    const params = new URL(request.url).searchParams
    const branchCode = params.get('branch_code') ?? ''
    const accountNo = params.get('account_no') ?? ''
    const feePattern = params.get('fee_pattern')
    const includeDeleted = params.get('include_deleted') === 'true'
    const limit = toNonNegativeInt(params.get('limit'), 50)
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const filtered = feePreferenceRows
      .filter(
        (row) =>
          (includeDeleted || row.取消区分 === 0) &&
          (!branchCode || row.部店コード === branchCode) &&
          (!accountNo || String(row.口座番号) === accountNo) &&
          (feePattern === null || row.手数料パターン === feePattern),
      )
      .sort((a, b) => a.口座番号 - b.口座番号)

    return HttpResponse.json({
      // total は絞り込み後・ページ切り出し前の件数
      total: filtered.length,
      limit,
      offset,
      fee_preferences: filtered.slice(offset, offset + limit),
    })
  }),

  /*
   * 手数料優遇の事前検証（登録・変更はしない）。
   *
   * 本文（FeePreferenceValidateRequest）は全項目任意で、新規検証の必須（口座番号）はサービス側が見る。
   * 変更検証の対象はクエリの `fee_preference_id`（主キー）で指し、重複検査で自分自身を除く。
   * 範囲と型は pydantic が先に見るので、ここではなく 422 になる。
   */
  http.post('*/api/masters/fee-preferences/validate', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const violation = feePreferenceRequestViolation(body, { strict: false })
    if (violation) return violation

    const query = new URL(request.url).searchParams
    const isUpdate = query.get('is_update') === 'true'
    const currentId = query.has('fee_preference_id') ? Number(query.get('fee_preference_id')) : null
    const target = isUpdate ? findActiveRowById(currentId) : null

    // 変更検証は送られなかった項目を対象の現在値で補う（部分更新と同じ見え方にする）
    const input = target ? mergeInput(toInput(target), body) : toInput(body)
    const errors = feePreferenceServiceErrors(input, { currentId: target?.ID ?? null })
    if (isUpdate && !target) {
      errors.push(`指定された手数料優遇(ID=${currentId})は存在しません`)
    }

    return HttpResponse.json({
      valid: errors.length === 0,
      errors,
      warnings: errors.length === 0 ? feePreferenceWarnings(input) : [],
      details: null,
    })
  }),

  // 手数料優遇の新規登録（1 口座 1 レコード）。ID はサーバが採番する
  http.post('*/api/masters/fee-preferences', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const violation = feePreferenceRequestViolation(body, { strict: true })
    if (violation) return violation

    const input = toInput(body)
    const errors = feePreferenceServiceErrors(input)
    if (errors.length > 0) return detailError(400, errors[0])

    const created = toMockItem(input, { id: nextId() })
    feePreferenceRows = [...feePreferenceRows, created]

    return HttpResponse.json(
      {
        success: true,
        fee_preference: created,
        warnings: feePreferenceWarnings(input),
        message: '手数料優遇を登録しました',
      },
      { status: 201 },
    )
  }),

  /*
   * 手数料優遇の変更（部分更新）。本文に含めた項目だけを更新し、含めない項目は現在値を保つ
   * （FeePreferenceUpdateRequest の説明どおり）。数値項目に null を送ると未設定に戻る。
   *
   * 検査の順序は CA と同じ「本文の形(422) → 対象が居るか(404) → 値の妥当性(400) →
   * 盤面が古くないか(409)」。
   */
  http.put('*/api/masters/fee-preferences/:id', async ({ params, request }) => {
    const body = await request.json().catch(() => null)
    const violation = feePreferenceRequestViolation(body, { strict: false })
    if (violation) return violation

    const targetId = Number(params.id)
    const current = findActiveRowById(targetId)
    if (!current) {
      return detailError(404, '指定された手数料優遇が存在しません')
    }

    const input = mergeInput(toInput(current), body)
    const errors = feePreferenceServiceErrors(input, { currentId: targetId })
    if (errors.length > 0) return detailError(400, errors[0])

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    const providedUpdatedAt = typeof body.更新日時 === 'string' ? body.更新日時 : null
    if (!isSameTimestamp(providedUpdatedAt, current.更新日時)) {
      return detailError(
        409,
        '他のユーザーによって手数料優遇が更新されています。最新データを再取得してください。',
      )
    }

    const updated = {
      ...toMockItem(input, { id: targetId }),
      // 作成の記録は引き継ぐ（UPDATE は INSERT の記録を書き換えない）
      作成日時: current.作成日時,
      作成者: current.作成者,
    }
    feePreferenceRows = feePreferenceRows.map((row) => (row.ID === targetId ? updated : row))

    return HttpResponse.json({
      success: true,
      fee_preference: updated,
      warnings: feePreferenceWarnings(input),
      message: '手数料優遇を変更しました',
    })
  }),

  /*
   * 手数料優遇の論理削除。行は残したまま 取消区分 を 1 にする（一覧は既定で取消済みを返さないので
   * 読み直すと消える）。本文も合札も見ない（DELETE は本文を取らないので 409 の経路は無い）。
   */
  http.delete('*/api/masters/fee-preferences/:id', ({ params }) => {
    const targetId = Number(params.id)
    const target = findActiveRowById(targetId)
    if (!target) {
      return detailError(404, '指定された手数料優遇が存在しないか、既に削除されています')
    }

    const deleted = {
      ...target,
      取消区分: 1,
      ユーザー操作フラグ: 1,
      取消日時: nowIsoTimestamp(),
      取消者: '006',
    }
    feePreferenceRows = feePreferenceRows.map((row) => (row.ID === targetId ? deleted : row))

    return HttpResponse.json({
      success: true,
      fee_preference: deleted,
      warnings: [],
      message: '手数料優遇を削除しました',
    })
  }),
]

/**
 * 本文の宣言（pydantic）で弾かれるもの。型と範囲を見る。
 *
 * strict は登録（FeePreferenceRequest）のとき true。口座番号が必須になり、手数料パターンに null を許さない。
 * 変更・事前検証（*UpdateRequest / *ValidateRequest）は全項目が任意で null を許す。
 */
function feePreferenceRequestViolation(body, { strict }) {
  if (typeof body !== 'object' || body === null) {
    return requestValidationError(['body'], 'Input should be a valid dictionary', 'dict_type')
  }

  const accountNo = body.口座番号
  if (accountNo === undefined || accountNo === null) {
    if (strict) return requestValidationError(['body', '口座番号'], 'Field required', 'missing')
  } else if (!Number.isInteger(accountNo)) {
    return requestValidationError(['body', '口座番号'], 'Input should be a valid integer', 'int_type')
  } else if (accountNo <= 0) {
    return requestValidationError(
      ['body', '口座番号'],
      'Input should be greater than 0',
      'greater_than',
    )
  }

  const pattern = body.手数料パターン
  if (pattern !== undefined && (pattern !== null || strict)) {
    if (typeof pattern !== 'string') {
      return requestValidationError(
        ['body', '手数料パターン'],
        'Input should be a valid string',
        'string_type',
      )
    }
    if (pattern.length > 1) {
      return requestValidationError(
        ['body', '手数料パターン'],
        'String should have at most 1 character',
        'string_too_long',
      )
    }
  }

  for (const { field, max } of NUMBER_FIELDS) {
    const value = body[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return requestValidationError(['body', field], 'Input should be a valid number', 'float_type')
    }
    if (value < 0) {
      return requestValidationError(
        ['body', field],
        'Input should be greater than or equal to 0',
        'greater_than_equal',
      )
    }
    if (max !== undefined && value > max) {
      return requestValidationError(
        ['body', field],
        `Input should be less than or equal to ${max}`,
        'less_than_equal',
      )
    }
  }

  return null
}

/** 本文（または行）から入力の項目だけを取り出す。送られていない項目は undefined のまま */
function toInput(source) {
  return Object.fromEntries(INPUT_FIELDS.map((field) => [field, source?.[field]]))
}

/**
 * 部分更新。送られてきた項目（undefined でないもの）だけを現在値に重ねる。
 * 数値項目の null は「未設定に戻す」なので重ねる。口座番号と手数料パターンの null は「変えない」として扱う
 * （口座番号を消す・パターンを null にする操作は意味を持たないため。実 API の扱いは未確認）。
 */
function mergeInput(current, body) {
  const merged = { ...current }
  for (const field of INPUT_FIELDS) {
    const value = body?.[field]
    if (value === undefined) continue
    if (value === null && (field === '口座番号' || field === '手数料パターン')) continue
    merged[field] = value
  }
  return merged
}

/**
 * サービス層が見る妥当性。pydantic と違い**まとめて全件返す**（事前検証の応答は errors の配列なので、
 * 直せるところを一度に見せられる）。文言はモックの仮置き（実 API の文言は未確認）。
 *
 * @param {{ currentId?: number|null }} [options]
 *   currentId は変更対象の行 ID。新規登録では null（自分自身が存在しないため）
 * @returns {string[]} 問題が無ければ空配列
 */
function feePreferenceServiceErrors(input, { currentId = null } = {}) {
  const errors = []
  const accountNo = input.口座番号

  if (accountNo === undefined || accountNo === null) {
    errors.push('口座番号は必須です')
  } else if (!findCustomerByAccountNo(accountNo)) {
    errors.push(`口座番号(${accountNo})は口座マスタに存在しません`)
  } else {
    // 1 口座 1 レコード。取消済みの行は数えない
    const duplicate = feePreferenceRows.find(
      (row) => row.口座番号 === accountNo && row.取消区分 === 0 && row.ID !== currentId,
    )
    if (duplicate) errors.push(`口座番号(${accountNo})の手数料優遇は既に登録されています`)
  }

  for (const [lower, upper] of [
    ['下限手数料', '上限手数料'],
    ['下限ベイシス円', '上限ベイシス円'],
  ]) {
    if (isNumber(input[lower]) && isNumber(input[upper]) && input[lower] > input[upper]) {
      errors.push(`${lower}は${upper}以下で指定してください`)
    }
  }

  return errors
}

/**
 * 登録は通るが伝えること（事前検証と登録・変更の応答で同じものを返す）。
 *   - 参照先の手数料パターンがマスタ未登録（仮計算ではデフォルトパターンを使う）
 *   - 方式で使われない項目が入っている（ベイシスを設定したのにパターン方式の項目もある、など）
 */
function feePreferenceWarnings(input) {
  const warnings = []
  const pattern = input.手数料パターン ?? ''

  if (pattern && !REGISTERED_FEE_PATTERNS.includes(pattern)) {
    warnings.push(
      `手数料パターン(${pattern})は手数料パターンマスタに未登録です。仮計算ではデフォルトパターンを使用します`,
    )
  }

  if (isNumber(input.ベイシス)) {
    const unused = ['掛目', '下限手数料', '上限手数料'].filter((field) => isNumber(input[field]))
    if (pattern) unused.unshift('手数料パターン')
    if (unused.length > 0) {
      warnings.push(`ベイシス方式のため、${unused.join('・')}は使用されません`)
    }
  } else {
    const unused = ['下限ベイシス円', '上限ベイシス円'].filter((field) => isNumber(input[field]))
    if (unused.length > 0) {
      warnings.push(`パターン方式のため、${unused.join('・')}は使用されません`)
    }
  }

  return warnings
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 主キー（ID）で有効な 1 行を引く（取消済みは返さない） */
function findActiveRowById(id) {
  return feePreferenceRows.find((row) => row.ID === id && row.取消区分 === 0) ?? null
}

/** ID の採番。実 API の AUTO_INCREMENT と同じく単調増加（取消済みの行も母数に入れる） */
function nextId() {
  return Math.max(0, ...feePreferenceRows.map((row) => row.ID)) + 1
}

/**
 * FeePreferenceItem を組み立てる（登録・変更の応答用）。
 * 部店コード・顧客名は口座マスタ（顧客マスタのモック）から結合し、適用方式はベイシスの有無から決める。
 */
function toMockItem(input, { id }) {
  const customer = findCustomerByAccountNo(input.口座番号)
  const basisPoints = input.ベイシス ?? null

  return {
    ID: id,
    口座番号: input.口座番号,
    手数料パターン: input.手数料パターン ?? '',
    掛目: input.掛目 ?? null,
    下限手数料: input.下限手数料 ?? null,
    上限手数料: input.上限手数料 ?? null,
    ベイシス: basisPoints,
    下限ベイシス円: input.下限ベイシス円 ?? null,
    上限ベイシス円: input.上限ベイシス円 ?? null,
    スプレッド: input.スプレッド ?? null,
    部店コード: customer?.部店コード ?? null,
    顧客名: customer?.顧客名 ?? null,
    適用方式: applyMethodOf(basisPoints),
    取消区分: 0,
    // 画面からの登録・変更なので 1
    ユーザー操作フラグ: 1,
    作成日時: nowIsoTimestamp(),
    作成者: '006',
    更新日時: nowIsoTimestamp(),
    更新者: '006',
    取消日時: null,
    取消者: null,
  }
}
