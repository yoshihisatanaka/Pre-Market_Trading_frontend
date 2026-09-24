import { http, HttpResponse } from 'msw'
import { suspensionHistories, suspensionTargets } from '../fixtures/incidents'
import { toNonNegativeInt } from './_shared'

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
]
