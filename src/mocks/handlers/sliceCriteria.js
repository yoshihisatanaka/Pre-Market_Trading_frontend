import { http, HttpResponse } from 'msw'
import { sliceCriteriaSetting } from '../fixtures/sliceCriteria'
import { detailError, nowTimestamp } from './_shared'

// スライス基準は 1 件しか無いので、行の配列ではなくオブジェクトの写しを持つ
let sliceCriteriaRow = { ...sliceCriteriaSetting }

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetSliceCriteriaRow() {
  sliceCriteriaRow = { ...sliceCriteriaSetting }
}

export const sliceCriteriaHandlers = [
  // スライス基準（バックエンドの呼称は「スライス注文設定」）。1 件だけの設定なので一覧ではない
  http.get('*/api/masters/hard-limits', () => HttpResponse.json(sliceCriteriaRow)),

  /*
   * スライス基準の更新。拒否の形は実 API（FastAPI）に合わせる。
   *
   *   422 HTTPValidationError … pydantic の制約違反。{ detail: [{ type, loc, msg, input, ctx }] }
   *   409 ErrorResponse       … 楽観的ロックの競合。{ detail: '…' }
   *
   * 409 は openapi.json に宣言が無い（PUT の description にだけ「楽観的ロック（更新日時照合・
   * 409 Conflict）に対応」と書かれた宣言漏れ）が、実 API では実装されている。
   * 画面側では検証しない方針なので、拒否の理由はここが持つ。
   */
  http.put('*/api/masters/hard-limits', async ({ request }) => {
    const body = await request.json().catch(() => null)

    // pydantic は不合格の項目を全部まとめて返す（先勝ちで 1 件ではない）
    const errors = SLICE_FIELD_RULES.flatMap((rule) => validateSliceField(body, rule))
    if (errors.length > 0) {
      return HttpResponse.json({ detail: errors }, { status: 422 })
    }

    // 楽観的ロック。取得してから保存するまでに他の担当者が更新していれば弾く
    const updatedAt = body?.['更新日時'] ?? null
    if (updatedAt && updatedAt !== sliceCriteriaRow['更新日時']) {
      return detailError(409, SLICE_CONFLICT_DETAIL)
    }

    sliceCriteriaRow = {
      ...sliceCriteriaRow,
      市場関与率: body['市場関与率'],
      大口数量閾値: body['大口数量閾値'],
      大口金額閾値: body['大口金額閾値'],
      /*
       * 省略された項目はサーバ側の既定に落とす（実 API の実測どおり。有効フラグは 1、備考は NULL）。
       * ここを「現在値を保つ」に甘くすると、api 層の送り忘れがテストをすり抜ける。
       */
      スライス有効フラグ: body['スライス有効フラグ'] ?? 1,
      備考: body['備考'] ?? null,
      // 画面から更新したので 1 が立つ（システム連携ではない）
      ユーザー操作フラグ: 1,
      更新日時: nowTimestamp(),
      更新者: '006',
    }

    return HttpResponse.json(sliceCriteriaRow)
  }),
]

/* ここからスライス基準（/masters/hard-limits）のモック用ヘルパ。実 API の 422 を模すためだけのもの */

/**
 * SliceSettingUpdateRequest の制約（openapi.json）。
 * 市場関与率 0.0001〜1.0 / 大口数量閾値 1 以上の整数 / 大口金額閾値 1 以上。
 */
const SLICE_FIELD_RULES = [
  { field: '市場関与率', integer: false, ge: 0.0001, le: 1 },
  { field: '大口数量閾値', integer: true, ge: 1 },
  { field: '大口金額閾値', integer: false, ge: 1 },
]

/** 楽観的ロックの競合。実 API が返すのと同じ文言 */
const SLICE_CONFLICT_DETAIL =
  '他のユーザーによってスライス設定が更新されました。最新情報を再取得してください。'

/**
 * pydantic の msg。実 API はおおむね日本語化しているが、整数チェックだけ素の英語で返る
 * （実測。'大口数量閾値' に 1.5 を送ったときの応答）。
 */
const SLICE_MESSAGES = {
  parsing: '数値で入力してください',
  int_from_float: 'Input should be a valid integer, got a number with a fractional part',
  greater_than_equal: '指定できる下限を下回っています',
  less_than_equal: '指定できる上限を超えています',
}

/**
 * 1 項目ぶんの検証。pydantic と同じく「型で落ちたら制約は見ない」順序にする。
 * 合格なら空配列（呼び出し側が flatMap でつなぐ）。
 */
function validateSliceField(body, { field, integer, ge, le }) {
  const input = body?.[field]

  if (typeof input !== 'number' || !Number.isFinite(input)) {
    // 数値に読めない。整数の項目は int_parsing、実数の項目は float_parsing になる
    const type = integer ? 'int_parsing' : 'float_parsing'
    return [sliceValidationError(type, field, SLICE_MESSAGES.parsing, input)]
  }
  if (integer && !Number.isInteger(input)) {
    return [sliceValidationError('int_from_float', field, SLICE_MESSAGES.int_from_float, input)]
  }
  if (ge !== undefined && input < ge) {
    const msg = SLICE_MESSAGES.greater_than_equal
    return [sliceValidationError('greater_than_equal', field, msg, input, { ge })]
  }
  if (le !== undefined && input > le) {
    const msg = SLICE_MESSAGES.less_than_equal
    return [sliceValidationError('less_than_equal', field, msg, input, { le })]
  }
  return []
}

/** ValidationError 1 件。loc の先頭は値の出所（本文なので 'body'）。ctx は制約違反のときだけ付く */
function sliceValidationError(type, field, msg, input, ctx) {
  return { type, loc: ['body', field], msg, input, ...(ctx ? { ctx } : {}) }
}
