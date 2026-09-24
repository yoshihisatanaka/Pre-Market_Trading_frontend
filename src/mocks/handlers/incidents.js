import { http, HttpResponse } from 'msw'
import { suspensionHistories, suspensionTargets } from '../fixtures/incidents'
import {
  detailError,
  isSameTimestamp,
  nowIsoTimestamp,
  requestValidationError,
  toNonNegativeInt,
} from './_shared'

/*
 * 障害管理（/operations/order-suspensions）。実 API と同じパス・同じ形で返す。
 *
 * 停止対象の行（ALL とルート 5 種）は**互いに独立したレコード**として持つ。
 * ALL を停止してもルート行の 発注停止中 は変わらない（実 API も「全体停止はルート単位の停止に
 * 優先」と書くだけで、ルート行を書き換えない）。総合のフラグ（発注停止中 / 全体停止中 /
 * 停止中の対象）はサーバ役のここで行から合成する。
 */

let targetRows = cloneTargets()
let historyRows = cloneHistories()

function cloneTargets() {
  return suspensionTargets.map((row) => ({ ...row }))
}

function cloneHistories() {
  return suspensionHistories.map((row) => ({ ...row }))
}

/** モックの可変状態をフィクスチャの内容に戻す */
export function resetIncidentState() {
  targetRows = cloneTargets()
  historyRows = cloneHistories()
}

/** SuspensionStatusResponse。総合のフラグは行から組み立てる */
function statusResponse() {
  const suspended = targetRows.filter((row) => row['発注停止中'])

  return {
    発注停止中: suspended.length > 0,
    全体停止中: suspended.some((row) => row['停止対象'] === 'ALL'),
    停止中の対象: suspended.map((row) => row['停止対象']),
    targets: targetRows,
  }
}

/** 実 API の既定と上限（openapi.json の limit: 1〜200・既定 50） */
const HISTORY_DEFAULT_LIMIT = 50
const HISTORY_MAX_LIMIT = 200

export const incidentHandlers = [
  http.get('*/api/operations/order-suspensions', () => HttpResponse.json(statusResponse())),

  http.get('*/api/operations/order-suspensions/history', ({ request }) => {
    const params = new URL(request.url).searchParams
    const target = params.get('target')
    const limit = Math.min(
      toNonNegativeInt(params.get('limit'), HISTORY_DEFAULT_LIMIT) || HISTORY_DEFAULT_LIMIT,
      HISTORY_MAX_LIMIT,
    )
    const offset = toNonNegativeInt(params.get('offset'), 0)

    const matched = target ? historyRows.filter((row) => row['停止対象'] === target) : historyRows

    return HttpResponse.json({
      total: matched.length,
      limit,
      offset,
      histories: matched.slice(offset, offset + limit),
    })
  }),

  /*
   * 発注停止。拒否の順序は実 API に合わせる。
   *   422 … 本文のスキーマ（pydantic）。停止理由が無い / 1〜200 字に収まらない
   *   400 … 停止対象が不正 / すでに停止中
   *   409 … 楽観的ロックの競合（更新日時が取得時と違う）
   */
  http.post('*/api/operations/order-suspensions/suspend', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const reason = body?.['停止理由']

    if (typeof reason !== 'string') {
      return requestValidationError(['body', '停止理由'], 'Field required', 'missing')
    }
    if (reason.length < REASON_MIN_LENGTH) {
      return reasonLengthError('string_too_short', 'at least 1 character', {
        min_length: REASON_MIN_LENGTH,
      })
    }
    if (reason.length > REASON_MAX_LENGTH) {
      return reasonLengthError('string_too_long', `at most ${REASON_MAX_LENGTH} characters`, {
        max_length: REASON_MAX_LENGTH,
      })
    }

    const row = findTarget(body?.['停止対象'])
    if (!row) return detailError(400, INVALID_TARGET_DETAIL)
    if (row['発注停止中']) return detailError(400, `${row['停止対象名']}はすでに停止中です。`)
    if (!isSameTimestamp(body?.['更新日時'] ?? null, row['更新日時'])) {
      return detailError(409, CONFLICT_DETAIL)
    }

    const before = snapshot(row)
    const now = nowIsoTimestamp()
    Object.assign(row, {
      発注停止フラグ: 1,
      発注停止中: true,
      停止理由: reason,
      停止日時: now,
      停止者: MOCK_OPERATOR,
      更新日時: now,
      更新者: MOCK_OPERATOR,
    })
    recordHistory(row, 'SUSPEND', before, now)

    return HttpResponse.json({
      success: true,
      target: row,
      message: `${row['停止対象名']}の発注を停止しました。`,
    })
  }),
]

/* ここから停止・再開のモック用ヘルパ */

/** SuspendRequest.停止理由 の制約（openapi.json の minLength / maxLength） */
const REASON_MIN_LENGTH = 1
const REASON_MAX_LENGTH = 200

const INVALID_TARGET_DETAIL = '停止対象が不正です。'
const CONFLICT_DETAIL =
  '他のユーザーによって発注停止状態が更新されました。最新情報を再取得してください。'

// 実 API は X-User-Code か認証情報から解決する。モックは固定値でよい（画面は応答の値を出すだけ）
const MOCK_OPERATOR = '006'

/** 停止対象の行を引く。省略時は ALL（SuspendRequest / ResumeRequest の既定） */
function findTarget(code) {
  return targetRows.find((row) => row['停止対象'] === (code ?? 'ALL')) ?? null
}

/** 履歴の 変更前データ / 変更後データ に写す項目 */
function snapshot(row) {
  return { 発注停止フラグ: row['発注停止フラグ'], 停止理由: row['停止理由'] }
}

/** 操作履歴を先頭（最新）に積む */
function recordHistory(row, operation, before, operatedAt) {
  const nextId = Math.max(0, ...historyRows.map((history) => history['ID'])) + 1

  historyRows.unshift({
    ID: nextId,
    停止対象: row['停止対象'],
    停止対象名: row['停止対象名'],
    操作区分: operation,
    操作区分名: operation === 'SUSPEND' ? '発注停止' : '発注再開',
    操作者: MOCK_OPERATOR,
    変更前データ: before,
    変更後データ: snapshot(row),
    差分データ: null,
    操作日時: operatedAt,
  })
}

/** pydantic の文字数制約違反。ctx に制約値が付く */
function reasonLengthError(type, limitText, ctx) {
  return HttpResponse.json(
    {
      detail: [
        {
          type,
          loc: ['body', '停止理由'],
          msg: `String should have ${limitText}`,
          input: null,
          ctx,
        },
      ],
    },
    { status: 422 },
  )
}
