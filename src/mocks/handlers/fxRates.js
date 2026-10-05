import { http, HttpResponse } from 'msw'
import { canceledFxRates, fxRates } from '../fixtures/fxRates'
import { detailError, isSameTimestamp, nowIsoTimestamp } from './_shared'

/*
 * 為替マスタ（`/masters/fx`）。**実 API は実装済み**だが、単体テストと E2E がこの handlers を
 * 共用しているので残し、返す形を実 API（openapi.json）に寄せてある。
 *   - キーは日本語、基準日は integer の YYYYMMDD、パスキーは integer の ID
 *   - 拒否は ErrorResponse（`{ detail: '…' }`）と、本文の型違反だけ 422 の HTTPValidationError
 *   - 削除は論理削除（取消区分=1）。latest と詳細は取消済みを返さない
 * 画面が使わない一覧・削除・履歴・CSV はモックしていない（未定義のリクエストは実 API へ素通しされる）。
 */

let fxRows = cloneRows()

function cloneRows() {
  return [...fxRates, ...canceledFxRates].map((row) => ({ ...row }))
}

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetFxRateRows() {
  fxRows = cloneRows()
}

const NOT_FOUND_DETAIL = '指定された為替レートが存在しません'

/** 一般的な範囲。外れても登録はできるが、事前検証が警告を返す（openapi.json の validate の説明） */
const USUAL_RATE_MIN = 50
const USUAL_RATE_MAX = 300

export const fxRateHandlers = [
  /*
   * 指定日（target_date）以前で最新の有効なレート。無ければ 404。
   * `/masters/fx/:fxId` より前に置く（後ろに置くと latest が ID として拾われる）。
   */
  http.get('*/api/masters/fx/latest', ({ request }) => {
    const url = new URL(request.url)
    const currencyCode = url.searchParams.get('currency_code') || 'USD'
    const targetDate = Number(url.searchParams.get('target_date')) || Infinity

    const latest = activeRows()
      .filter((row) => row.通貨コード === currencyCode && row.基準日 <= targetDate)
      .sort((a, b) => b.基準日 - a.基準日)[0]
    if (!latest) return detailError(404, '有効な為替レートが存在しません')

    return HttpResponse.json({
      ID: latest.ID,
      基準日: latest.基準日,
      通貨コード: latest.通貨コード,
      為替レート: latest.為替レート,
      源泉レート: latest.源泉レート,
    })
  }),

  /*
   * 事前検証（DB には登録しない）。変更検証は fx_id と is_update=true のクエリで対象を指す。
   *   errors   … 新規で同じ基準日・通貨の有効な行がある / 変更で対象の ID が無い
   *   warnings … レートが一般的な範囲（50〜300 円）から外れる
   */
  http.post('*/api/masters/fx/validate', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const invalid = bodyValidationError(body)
    if (invalid) return invalid

    const url = new URL(request.url)
    const isUpdate = url.searchParams.get('is_update') === 'true'
    const fxId = Number(url.searchParams.get('fx_id'))

    const errors = []
    if (isUpdate) {
      if (!findActive(fxId)) errors.push(`為替ID ${fxId} は存在しません`)
    } else if (findActiveByKey(body.基準日, currencyOf(body))) {
      errors.push(`基準日 ${body.基準日} の ${currencyOf(body)} は既に登録されています`)
    }

    const rate = body.為替レート
    const warnings =
      errors.length === 0 && (rate < USUAL_RATE_MIN || rate > USUAL_RATE_MAX)
        ? [`為替レート ${rate} は一般的な範囲（${USUAL_RATE_MIN}〜${USUAL_RATE_MAX}円）から外れています`]
        : []

    return HttpResponse.json({ valid: errors.length === 0, errors, warnings, details: null })
  }),

  http.get('*/api/masters/fx/:fxId', ({ params }) => {
    const row = findActive(Number(params.fxId))
    if (!row) return detailError(404, NOT_FOUND_DETAIL)
    return HttpResponse.json({ exchange_rate: row })
  }),

  /*
   * 登録。取消済みの同じ基準日・通貨があれば、新しい行を作らずに復活更新する（実 API の説明どおり）。
   * 有効な行と重複するときは 400。
   */
  http.post('*/api/masters/fx', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const invalid = bodyValidationError(body)
    if (invalid) return invalid

    const currencyCode = currencyOf(body)
    if (findActiveByKey(body.基準日, currencyCode)) {
      return detailError(400, `基準日 ${body.基準日} の ${currencyCode} は既に登録されています`)
    }

    const now = nowIsoTimestamp()
    const operator = operatorOf(request)
    const canceled = fxRows.find(
      (row) => row.取消区分 === 1 && row.基準日 === body.基準日 && row.通貨コード === currencyCode,
    )

    const saved = canceled
      ? Object.assign(canceled, {
          為替レート: body.為替レート,
          源泉レート: withholdingOf(body),
          取消区分: 0,
          ユーザー操作フラグ: 1,
          更新日時: now,
          更新者: operator,
          取消日時: null,
          取消者: null,
        })
      : {
          ID: Math.max(0, ...fxRows.map((row) => row.ID)) + 1,
          基準日: body.基準日,
          通貨コード: currencyCode,
          為替レート: body.為替レート,
          源泉レート: withholdingOf(body),
          取消区分: 0,
          ユーザー操作フラグ: 1,
          作成日時: now,
          作成者: operator,
          更新日時: now,
          更新者: operator,
          取消日時: null,
          取消者: null,
        }
    if (!canceled) fxRows.push(saved)

    return HttpResponse.json(
      { success: true, exchange_rate: saved, message: '為替レートを登録しました' },
      { status: 201 },
    )
  }),

  /* 変更。対象が無ければ 404、更新日時（楽観的ロックの合札）が合わなければ 409 */
  http.put('*/api/masters/fx/:fxId', async ({ params, request }) => {
    const body = await request.json().catch(() => null)
    const invalid = bodyValidationError(body)
    if (invalid) return invalid

    const row = findActive(Number(params.fxId))
    if (!row) return detailError(404, NOT_FOUND_DETAIL)

    if (!isSameTimestamp(body.更新日時 ?? null, row.更新日時)) {
      return detailError(
        409,
        '他のユーザーによって為替レートが更新されました。最新情報を再取得してください。',
      )
    }

    Object.assign(row, {
      基準日: body.基準日,
      通貨コード: currencyOf(body),
      為替レート: body.為替レート,
      源泉レート: withholdingOf(body),
      ユーザー操作フラグ: 1,
      更新日時: nowIsoTimestamp(),
      更新者: operatorOf(request),
    })

    return HttpResponse.json({
      success: true,
      exchange_rate: row,
      message: '為替レートを変更しました',
    })
  }),
]

/* ここから為替マスタのモック用ヘルパ */

function activeRows() {
  return fxRows.filter((row) => row.取消区分 === 0)
}

function findActive(id) {
  return activeRows().find((row) => row.ID === id)
}

function findActiveByKey(baseDate, currencyCode) {
  return activeRows().find((row) => row.基準日 === baseDate && row.通貨コード === currencyCode)
}

/** 通貨コードは FxRequest で default 'USD'（省略されたら USD として扱う） */
function currencyOf(body) {
  return body.通貨コード ?? 'USD'
}

/** 源泉レートは FxRequest で任意（default null）。省略されたら未設定として扱う */
function withholdingOf(body) {
  return body.源泉レート ?? null
}

/** 操作者は X-User-Code ヘッダから取る（client.js の interceptor が付ける）。無ければモックの既定 */
function operatorOf(request) {
  return request.headers.get('X-User-Code') || '006'
}

/**
 * FxRequest の制約（openapi.json）のうち、pydantic が本文の段階で弾くもの。
 * 為替レートは正の数（exclusiveMinimum 0）、源泉レートは null か正の数、
 * 基準日は 19000101〜29991231 の integer。
 * 不合格は 422 の HTTPValidationError。合格なら null。
 */
function bodyValidationError(body) {
  const detail = []
  pushRateError(detail, '為替レート', body?.為替レート)
  if (body?.源泉レート != null) pushRateError(detail, '源泉レート', body.源泉レート)

  const baseDate = body?.基準日
  if (!Number.isInteger(baseDate) || baseDate < 19000101 || baseDate > 29991231) {
    detail.push(fieldError('int_parsing', '基準日', '日付（YYYYMMDD）で入力してください', baseDate))
  }

  return detail.length > 0 ? HttpResponse.json({ detail }, { status: 422 }) : null
}

/** レート（正の数）の型違反を detail に積む */
function pushRateError(detail, field, rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    detail.push(fieldError('float_parsing', field, '数値で入力してください', rate))
  } else if (rate <= 0) {
    detail.push(
      fieldError('greater_than', field, '0 より大きい値を入力してください', rate, { gt: 0 }),
    )
  }
}

/** ValidationError 1 件。loc の先頭は値の出所（本文なので 'body'）。ctx は制約違反のときだけ付く */
function fieldError(type, field, msg, input, ctx) {
  return { type, loc: ['body', field], msg, input, ...(ctx ? { ctx } : {}) }
}
