import { http, HttpResponse } from 'msw'
import { mizuhoClosingStatus } from '../fixtures/closing'
import { nowIsoTimestamp, toNonNegativeInt } from './_shared'

/*
 * 締め管理（/closing/*）。みずほ注文締の状態照会・締め実行・締め解除に応える。
 *
 * 締め状態は書き換え可能（締めた状態が照会と注文ファイル作成に効く）。
 * テスト間で持ち越さないよう resetClosingState() を handlers/index.js の resetMockState() に登録してある。
 *
 * 実 API（app/api/order_api.py）に合わせている点:
 *   - 締めの二重実行も解除の二重実行も拒否しない（上書きになる）
 *   - 実行者 は X-User-Code から解決する（本文の 実行者 は無視。無ければ 'SYSTEM'）
 *   - 締め状態名は 締め済 / 未締め(解除)
 *   - 照会は history（新しい順）を history_limit 件（既定 3・0〜50）まで返す
 */

/** history_limit の既定と上限（openapi.json の GET /closing/status） */
const HISTORY_LIMIT_DEFAULT = 3
const HISTORY_LIMIT_MAX = 50

let mizuhoState = structuredClone(mizuhoClosingStatus)

export function resetClosingState() {
  mizuhoState = structuredClone(mizuhoClosingStatus)
}

/** いまのみずほ注文締の状態（ClosingStatusResponse の形）。注文ファイルのモックが締め済かを見る */
export function currentMizuhoClosingStatus() {
  return mizuhoState
}

/** 履歴を件数で切った応答 */
function withHistoryLimit(state, limit) {
  return { ...state, history: state.history.slice(0, Math.min(limit, HISTORY_LIMIT_MAX)) }
}

/** 締め実行・締め解除の共通処理。ClosingActionRequest の本文は読まない */
function changeMizuhoClosing(request, closed) {
  const operator = request.headers.get('X-User-Code') || 'SYSTEM'
  const operatedAt = nowIsoTimestamp()
  const statusName = closed ? '締め済' : '未締め(解除)'
  const nextId = Math.max(0, ...mizuhoState.history.map((entry) => entry.ID)) + 1

  mizuhoState = {
    ...mizuhoState,
    締め状態: closed ? 1 : 0,
    締め状態名: statusName,
    更新日時: operatedAt,
    実行者: operator,
    history: [
      {
        ID: nextId,
        基準日: String(mizuhoState.基準日),
        締め種別: mizuhoState.締め種別,
        操作区分: closed ? 'CLOSE' : 'RESET',
        締め状態: closed ? 1 : 0,
        締め状態名: statusName,
        実行者: operator,
        操作日時: operatedAt,
      },
      ...mizuhoState.history,
    ],
  }
  return HttpResponse.json(withHistoryLimit(mizuhoState, HISTORY_LIMIT_DEFAULT))
}

export const closingHandlers = [
  // closing_type の既定は MIZUHO。IB 締めの照会は何も返さず、次のハンドラか実 API へ流す
  http.get('*/api/closing/status', ({ request }) => {
    const params = new URL(request.url).searchParams
    const closingType = params.get('closing_type') ?? 'MIZUHO'
    if (closingType !== 'MIZUHO') return

    const limit = toNonNegativeInt(params.get('history_limit'), HISTORY_LIMIT_DEFAULT)
    return HttpResponse.json(withHistoryLimit(mizuhoState, limit))
  }),

  http.post('*/api/closing/mizuho', ({ request }) => changeMizuhoClosing(request, true)),

  http.post('*/api/closing/mizuho/reset', ({ request }) => changeMizuhoClosing(request, false)),
]
